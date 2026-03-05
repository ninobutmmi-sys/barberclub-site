const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const logger = require('../../utils/logger');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/waitlist/count — Active waiting entries count
// ============================================
router.get('/count', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const result = await db.query(
      `SELECT COUNT(*) as count FROM waitlist WHERE status = 'waiting' AND salon_id = $1`,
      [salonId]
    );

    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/waitlist — List waitlist entries
// ============================================
router.get('/',
  [
    query('status').optional().isIn(['waiting', 'notified', 'booked', 'expired']),
    query('date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('barber_id').optional().matches(uuidRegex),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { status, date, barber_id } = req.query;

      const conditions = [`w.salon_id = $1`];
      const params = [salonId];
      let paramIndex = 2;

      if (status) {
        conditions.push(`w.status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }

      if (date) {
        conditions.push(`w.preferred_date = $${paramIndex}`);
        params.push(date);
        paramIndex++;
      }

      if (barber_id) {
        conditions.push(`w.barber_id = $${paramIndex}`);
        params.push(barber_id);
        paramIndex++;
      }

      const whereClause = 'WHERE ' + conditions.join(' AND ');

      const result = await db.query(
        `SELECT w.id, w.client_id, w.client_name, w.client_phone,
                w.barber_id, w.service_id,
                w.preferred_date, w.preferred_time_start, w.preferred_time_end,
                w.status, w.notified_at, w.created_at,
                s.name AS service_name,
                br.name AS barber_name
         FROM waitlist w
         LEFT JOIN services s ON w.service_id = s.id
         LEFT JOIN barbers br ON w.barber_id = br.id
         ${whereClause}
         ORDER BY w.created_at DESC`,
        params
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/waitlist — Add to waitlist
// ============================================
router.post('/',
  [
    body('client_name').trim().notEmpty().withMessage('Nom du client requis').isLength({ max: 200 }),
    body('client_phone').trim().notEmpty().withMessage('Téléphone requis')
      .matches(/^(\+33|0)[1-9]\d{8}$/).withMessage('Numéro de téléphone invalide'),
    body('barber_id').matches(uuidRegex).withMessage('Barbier requis'),
    body('service_id').matches(uuidRegex).withMessage('Prestation requise'),
    body('preferred_date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide'),
    body('client_id').optional().matches(uuidRegex),
    body('preferred_time_start').optional().matches(/^\d{2}:\d{2}$/).withMessage('Heure de début invalide'),
    body('preferred_time_end').optional().matches(/^\d{2}:\d{2}$/).withMessage('Heure de fin invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const {
        client_id,
        client_name,
        client_phone,
        barber_id,
        service_id,
        preferred_date,
        preferred_time_start,
        preferred_time_end,
      } = req.body;

      // Verify barber exists and belongs to this salon
      const salonId = req.user.salon_id;
      const barberCheck = await db.query(
        'SELECT id FROM barbers WHERE id = $1 AND deleted_at IS NULL AND salon_id = $2',
        [barber_id, salonId]
      );
      if (barberCheck.rows.length === 0) {
        throw ApiError.notFound('Barbier introuvable');
      }

      // Verify service exists
      const serviceCheck = await db.query(
        'SELECT id FROM services WHERE id = $1 AND deleted_at IS NULL',
        [service_id]
      );
      if (serviceCheck.rows.length === 0) {
        throw ApiError.notFound('Prestation introuvable');
      }

      const result = await db.query(
        `INSERT INTO waitlist
           (client_id, client_name, client_phone, barber_id, service_id,
            preferred_date, preferred_time_start, preferred_time_end, status, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'waiting', $9)
         RETURNING *`,
        [
          client_id || null,
          client_name,
          client_phone,
          barber_id,
          service_id,
          preferred_date,
          preferred_time_start || null,
          preferred_time_end || null,
          salonId,
        ]
      );

      logger.info('Waitlist entry created', {
        id: result.rows[0].id,
        client_name,
        preferred_date,
      });

      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/admin/waitlist/:id — Update entry
// ============================================
router.put('/:id',
  [
    param('id').matches(uuidRegex),
    body('status').optional().isIn(['waiting', 'notified', 'booked', 'expired']),
    body('preferred_date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    body('preferred_time_start').optional().matches(/^\d{2}:\d{2}$/),
    body('preferred_time_end').optional().matches(/^\d{2}:\d{2}$/),
    body('barber_id').optional().matches(uuidRegex),
    body('service_id').optional().matches(uuidRegex),
    body('client_name').optional().trim().notEmpty().isLength({ max: 200 }),
    body('client_phone').optional().trim()
      .matches(/^(\+33|0)[1-9]\d{8}$/).withMessage('Numéro de téléphone invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const {
        status,
        preferred_date,
        preferred_time_start,
        preferred_time_end,
        barber_id,
        service_id,
        client_name,
        client_phone,
      } = req.body;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (status !== undefined) {
        fields.push(`status = $${paramIndex++}`);
        values.push(status);

        // Automatically set notified_at when marking as notified
        if (status === 'notified') {
          fields.push(`notified_at = NOW()`);
        }
      }
      if (preferred_date !== undefined) { fields.push(`preferred_date = $${paramIndex++}`); values.push(preferred_date); }
      if (preferred_time_start !== undefined) { fields.push(`preferred_time_start = $${paramIndex++}`); values.push(preferred_time_start); }
      if (preferred_time_end !== undefined) { fields.push(`preferred_time_end = $${paramIndex++}`); values.push(preferred_time_end); }
      if (barber_id !== undefined) { fields.push(`barber_id = $${paramIndex++}`); values.push(barber_id); }
      if (service_id !== undefined) { fields.push(`service_id = $${paramIndex++}`); values.push(service_id); }
      if (client_name !== undefined) { fields.push(`client_name = $${paramIndex++}`); values.push(client_name); }
      if (client_phone !== undefined) { fields.push(`client_phone = $${paramIndex++}`); values.push(client_phone); }

      if (fields.length === 0) {
        throw ApiError.badRequest('Aucune donnée à mettre à jour');
      }

      const salonId = req.user.salon_id;
      values.push(id, salonId);
      const result = await db.query(
        `UPDATE waitlist SET ${fields.join(', ')}
         WHERE id = $${paramIndex} AND salon_id = $${paramIndex + 1}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Entrée liste d\'attente introuvable');
      }

      logger.info('Waitlist entry updated', { id, status });

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/waitlist/:id — Remove from waitlist
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const result = await db.query(
        'DELETE FROM waitlist WHERE id = $1 AND salon_id = $2 RETURNING id',
        [req.params.id, salonId]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Entrée liste d\'attente introuvable');
      }

      logger.info('Waitlist entry removed', { id: req.params.id });

      res.json({ message: 'Entrée supprimée de la liste d\'attente' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
