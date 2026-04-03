const { Router } = require('express');
const express = require('express');
const { param, query, body } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const { logAudit } = require('../../middleware/auditLog');

const router = Router();
const photoBodyParser = express.json({ limit: '500kb' });
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/clients — List / search clients
// ============================================
router.get('/',
  [
    query('search').optional().trim(),
    query('sort').optional().isIn(['name', 'last_visit', 'total_spent', 'visit_count']),
    query('order').optional().isIn(['asc', 'desc']),
    query('has_account').optional().isIn(['true', 'false']),
    query('inactive_weeks').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const {
        search,
        sort = 'last_visit',
        order = 'desc',
        inactive_weeks,
        limit = 50,
        offset = 0,
      } = req.query;

      let whereConditions = ['c.deleted_at IS NULL', 'EXISTS (SELECT 1 FROM client_salons cs WHERE cs.client_id = c.id AND cs.salon_id = $1)'];
      let params = [salonId];
      let paramIndex = 2;

      // Search by name, phone, or email
      if (search) {
        whereConditions.push(
          `(c.first_name ILIKE $${paramIndex} OR c.last_name ILIKE $${paramIndex}
            OR c.phone ILIKE $${paramIndex} OR c.email ILIKE $${paramIndex}
            OR (c.first_name || ' ' || c.last_name) ILIKE $${paramIndex})`
        );
        params.push(`%${search}%`);
        paramIndex++;
      }

      // Filter by account status
      if (req.query.has_account === 'true') {
        whereConditions.push('c.has_account = true');
      } else if (req.query.has_account === 'false') {
        whereConditions.push('(c.has_account = false OR c.has_account IS NULL)');
      }

      // Filter inactive clients (no booking in X weeks)
      if (inactive_weeks) {
        whereConditions.push(
          `NOT EXISTS (
            SELECT 1 FROM bookings b2
            WHERE b2.client_id = c.id
              AND b2.salon_id = $1
              AND b2.status IN ('confirmed', 'completed')
              AND b2.deleted_at IS NULL
              AND b2.date >= CURRENT_DATE - ($${paramIndex} || ' weeks')::INTERVAL
          )`
        );
        params.push(parseInt(inactive_weeks));
        paramIndex++;
      }

      // Sort mapping
      const sortMap = {
        name: 'c.last_name, c.first_name',
        last_visit: 'last_visit',
        total_spent: 'total_spent',
        visit_count: 'visit_count',
      };
      const sortCol = sortMap[sort] || 'last_visit';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

      const result = await db.query(
        `SELECT c.id, c.first_name, c.last_name, c.phone, c.email, c.has_account,
                c.notes, c.created_at,
                COUNT(b.id) FILTER (WHERE b.status = 'completed') as visit_count,
                COALESCE(SUM(b.price) FILTER (WHERE b.status = 'completed'), 0) as total_spent,
                MAX(b.date) FILTER (WHERE b.status IN ('completed', 'confirmed')) as last_visit
         FROM clients c
         LEFT JOIN bookings b ON c.id = b.client_id AND b.deleted_at IS NULL AND b.salon_id = $1
         WHERE ${whereConditions.join(' AND ')}
         GROUP BY c.id
         ORDER BY ${sortCol} ${sortOrder} NULLS LAST
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, parseInt(limit), parseInt(offset)]
      );

      // Get total count
      const countResult = await db.query(
        `SELECT COUNT(DISTINCT c.id) as total
         FROM clients c
         LEFT JOIN bookings b ON c.id = b.client_id AND b.deleted_at IS NULL AND b.salon_id = $1
         WHERE ${whereConditions.join(' AND ')}`,
        params
      );

      res.json({
        clients: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/clients/inactive — Regular clients with no visit in 45+ days
// ============================================
router.get('/inactive', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const result = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.phone,
              COUNT(b.id) FILTER (WHERE b.status = 'completed') AS visit_count,
              MAX(b.date) FILTER (WHERE b.status = 'completed') AS last_visit,
              CURRENT_DATE - MAX(b.date) FILTER (WHERE b.status = 'completed') AS days_since_visit
       FROM clients c
       JOIN bookings b ON c.id = b.client_id AND b.deleted_at IS NULL AND b.salon_id = $1
       WHERE c.deleted_at IS NULL
       GROUP BY c.id
       HAVING COUNT(b.id) FILTER (WHERE b.status = 'completed') >= 3
          AND MAX(b.date) FILTER (WHERE b.status = 'completed') <= CURRENT_DATE - INTERVAL '90 days'
       ORDER BY days_since_visit DESC
       LIMIT 20`,
      [salonId]
    );

    res.json({ clients: result.rows });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/clients/:id — Client profile with full history
// ============================================
router.get('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { id } = req.params;

      // Client info with aggregated stats (booking stats filtered by salon)
      const clientResult = await db.query(
        `SELECT c.id, c.first_name, c.last_name, c.phone, c.email,
                c.has_account, c.notes, c.created_at,
                COUNT(b.id) FILTER (WHERE b.status = 'completed') as visit_count,
                COUNT(b.id) FILTER (WHERE b.status = 'no_show') as no_show_count,
                COUNT(b.id) FILTER (WHERE b.status = 'cancelled') as cancelled_count,
                COALESCE(SUM(b.price) FILTER (WHERE b.status = 'completed'), 0) as total_spent,
                MAX(b.date) FILTER (WHERE b.status IN ('completed', 'confirmed')) as last_visit
         FROM clients c
         LEFT JOIN bookings b ON c.id = b.client_id AND b.deleted_at IS NULL AND b.salon_id = $2
         WHERE c.id = $1 AND c.deleted_at IS NULL
         GROUP BY c.id`,
        [id, salonId]
      );

      if (clientResult.rows.length === 0) {
        throw ApiError.notFound('Client introuvable');
      }

      const client = clientResult.rows[0];

      // Favourite service (this salon only)
      const favServiceResult = await db.query(
        `SELECT s.name, COUNT(*) as count
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         WHERE b.client_id = $1 AND b.salon_id = $2 AND b.status = 'completed' AND b.deleted_at IS NULL
         GROUP BY s.name ORDER BY count DESC LIMIT 1`,
        [id, salonId]
      );

      // Favourite barber (this salon only)
      const favBarberResult = await db.query(
        `SELECT br.name, COUNT(*) as count
         FROM bookings b
         JOIN barbers br ON b.barber_id = br.id
         WHERE b.client_id = $1 AND b.salon_id = $2 AND b.status = 'completed' AND b.deleted_at IS NULL
         GROUP BY br.name ORDER BY count DESC LIMIT 1`,
        [id, salonId]
      );

      // Booking history (this salon only)
      const historyResult = await db.query(
        `SELECT b.id, b.date, b.start_time, b.end_time, b.status, b.price, b.source,
                s.name as service_name, br.name as barber_name
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         JOIN barbers br ON b.barber_id = br.id
         WHERE b.client_id = $1 AND b.salon_id = $2 AND b.deleted_at IS NULL
         ORDER BY b.date DESC, b.start_time DESC
         LIMIT 50`,
        [id, salonId]
      );

      res.json({
        ...client,
        favourite_service: favServiceResult.rows[0]?.name || null,
        favourite_barber: favBarberResult.rows[0]?.name || null,
        bookings: historyResult.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/admin/clients/:id — Update client info
// ============================================
router.put('/:id',
  [
    param('id').matches(uuidRegex),
    body('notes').optional().trim().isLength({ max: 2000 }),
    body('first_name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('last_name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
    body('phone').optional().trim().matches(/^(?:0|\+33)[1-9]\d{8}$/).withMessage('Numéro de téléphone invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { notes, first_name, last_name, email, phone } = req.body;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (notes !== undefined) { fields.push(`notes = $${paramIndex++}`); values.push(notes); }
      if (first_name) { fields.push(`first_name = $${paramIndex++}`); values.push(first_name); }
      if (last_name) { fields.push(`last_name = $${paramIndex++}`); values.push(last_name); }
      if (email !== undefined) { fields.push(`email = $${paramIndex++}`); values.push(email || null); }

      if (phone) {
        // Normaliser en +33
        const normalized = phone.startsWith('0') ? '+33' + phone.slice(1) : phone;
        // Vérifier unicité
        const existing = await db.query(
          'SELECT id FROM clients WHERE phone = $1 AND id != $2 AND deleted_at IS NULL',
          [normalized, id]
        );
        if (existing.rows.length > 0) {
          throw ApiError.conflict('Ce numéro de téléphone appartient déjà à un autre client');
        }
        fields.push(`phone = $${paramIndex++}`);
        values.push(normalized);
      }

      if (fields.length === 0) {
        throw ApiError.badRequest('Aucune donnée à mettre à jour');
      }

      values.push(id);
      const result = await db.query(
        `UPDATE clients SET ${fields.join(', ')}
         WHERE id = $${paramIndex} AND deleted_at IS NULL
         RETURNING id, first_name, last_name, phone, email, notes`,
        values
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Client introuvable');
      }

      logAudit(req, 'update', 'client', id, { changes: req.body });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/clients/:id — Soft delete (RGPD)
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.query(
        `UPDATE clients SET deleted_at = NOW(), email = NULL,
         phone = 'DEL_' || LEFT($1::text, 15),
         first_name = 'Client', last_name = 'supprimé', password_hash = NULL,
         has_account = false, reset_token = NULL, reset_token_expires = NULL
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Client introuvable');
      }

      // Invalidate all refresh tokens for this client
      await db.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1 AND user_type = $2',
        [req.params.id, 'client']
      );

      logAudit(req, 'delete', 'client', req.params.id);
      res.json({ message: 'Données client supprimées (RGPD)' });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/clients/photos/portfolio — All photos grouped by barber (portfolio page)
// ============================================
router.get('/photos/portfolio',
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const result = await db.query(
        `SELECT cp.id, cp.photo_data, cp.created_at, cp.created_by,
                b.name as barber_name, b.photo_url as barber_photo, b.salon_id as barber_salon,
                c.first_name as client_first_name, c.last_name as client_last_name
         FROM client_photos cp
         JOIN clients c ON cp.client_id = c.id
         JOIN barbers b ON cp.created_by = b.id
         WHERE b.salon_id = $1
         ORDER BY cp.created_at DESC`,
        [salonId]
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/clients/:id/photos — List client photos
// ============================================
router.get('/:id/photos',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT id, photo_data, created_at FROM client_photos
         WHERE client_id = $1 ORDER BY created_at DESC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/clients/:id/photos — Upload photo (base64 JPEG)
// ============================================
router.post('/:id/photos',
  photoBodyParser,
  [
    param('id').matches(uuidRegex),
    body('photo_data').notEmpty().withMessage('Photo requise')
      .custom(val => {
        // Must be a data URL or raw base64, max ~200Ko encoded
        const size = typeof val === 'string' ? val.length : 0;
        if (size > 300000) throw new Error('Photo trop volumineuse (max ~200Ko)');
        return true;
      }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { photo_data } = req.body;

      // Check client exists
      const clientCheck = await db.query(
        'SELECT id FROM clients WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (clientCheck.rows.length === 0) {
        throw ApiError.notFound('Client introuvable');
      }

      // Check max 2 photos
      const countResult = await db.query(
        'SELECT COUNT(*) as count FROM client_photos WHERE client_id = $1',
        [id]
      );
      if (parseInt(countResult.rows[0].count, 10) >= 2) {
        throw ApiError.badRequest('Maximum 2 photos par client');
      }

      const result = await db.query(
        `INSERT INTO client_photos (client_id, photo_data, created_by)
         VALUES ($1, $2, $3) RETURNING id, created_at`,
        [id, photo_data, req.user.id]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/clients/:id/photos/:photoId — Delete photo
// ============================================
router.delete('/:id/photos/:photoId',
  [
    param('id').matches(uuidRegex),
    param('photoId').matches(uuidRegex),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.query(
        'DELETE FROM client_photos WHERE id = $1 AND client_id = $2 RETURNING id',
        [req.params.photoId, req.params.id]
      );
      if (result.rows.length === 0) {
        throw ApiError.notFound('Photo introuvable');
      }
      res.json({ message: 'Photo supprimée' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
