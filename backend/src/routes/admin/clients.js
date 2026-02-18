const { Router } = require('express');
const { param, query, body } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/clients — List / search clients
// ============================================
router.get('/',
  [
    query('search').optional().trim(),
    query('sort').optional().isIn(['name', 'last_visit', 'total_spent', 'visit_count']),
    query('order').optional().isIn(['asc', 'desc']),
    query('inactive_weeks').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const {
        search,
        sort = 'last_visit',
        order = 'desc',
        inactive_weeks,
        limit = 50,
        offset = 0,
      } = req.query;

      let whereConditions = ['c.deleted_at IS NULL'];
      let params = [];
      let paramIndex = 1;

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

      // Filter inactive clients (no booking in X weeks)
      if (inactive_weeks) {
        whereConditions.push(
          `NOT EXISTS (
            SELECT 1 FROM bookings b2
            WHERE b2.client_id = c.id
              AND b2.status IN ('confirmed', 'completed')
              AND b2.deleted_at IS NULL
              AND b2.date >= CURRENT_DATE - INTERVAL '${parseInt(inactive_weeks)} weeks'
          )`
        );
      }

      // Sort mapping
      const sortMap = {
        name: 'c.last_name',
        last_visit: 'last_visit',
        total_spent: 'total_spent',
        visit_count: 'visit_count',
      };
      const sortCol = sortMap[sort] || 'last_visit';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

      const result = await db.query(
        `SELECT c.id, c.first_name, c.last_name, c.phone, c.email, c.has_account,
                c.notes, c.created_at,
                COUNT(b.id) FILTER (WHERE b.status IN ('completed', 'confirmed')) as visit_count,
                COALESCE(SUM(b.price) FILTER (WHERE b.status IN ('completed', 'confirmed')), 0) as total_spent,
                MAX(b.date) FILTER (WHERE b.status IN ('completed', 'confirmed')) as last_visit
         FROM clients c
         LEFT JOIN bookings b ON c.id = b.client_id AND b.deleted_at IS NULL
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
         LEFT JOIN bookings b ON c.id = b.client_id AND b.deleted_at IS NULL
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
// GET /api/admin/clients/:id — Client profile with full history
// ============================================
router.get('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Client info with aggregated stats
      const clientResult = await db.query(
        `SELECT c.id, c.first_name, c.last_name, c.phone, c.email,
                c.has_account, c.notes, c.created_at,
                COUNT(b.id) FILTER (WHERE b.status IN ('completed', 'confirmed')) as visit_count,
                COUNT(b.id) FILTER (WHERE b.status = 'no_show') as no_show_count,
                COUNT(b.id) FILTER (WHERE b.status = 'cancelled') as cancelled_count,
                COALESCE(SUM(b.price) FILTER (WHERE b.status IN ('completed', 'confirmed')), 0) as total_spent,
                MAX(b.date) FILTER (WHERE b.status IN ('completed', 'confirmed')) as last_visit
         FROM clients c
         LEFT JOIN bookings b ON c.id = b.client_id AND b.deleted_at IS NULL
         WHERE c.id = $1 AND c.deleted_at IS NULL
         GROUP BY c.id`,
        [id]
      );

      if (clientResult.rows.length === 0) {
        throw ApiError.notFound('Client introuvable');
      }

      const client = clientResult.rows[0];

      // Favourite service
      const favServiceResult = await db.query(
        `SELECT s.name, COUNT(*) as count
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         WHERE b.client_id = $1 AND b.status IN ('completed', 'confirmed') AND b.deleted_at IS NULL
         GROUP BY s.name ORDER BY count DESC LIMIT 1`,
        [id]
      );

      // Favourite barber
      const favBarberResult = await db.query(
        `SELECT br.name, COUNT(*) as count
         FROM bookings b
         JOIN barbers br ON b.barber_id = br.id
         WHERE b.client_id = $1 AND b.status IN ('completed', 'confirmed') AND b.deleted_at IS NULL
         GROUP BY br.name ORDER BY count DESC LIMIT 1`,
        [id]
      );

      // Booking history
      const historyResult = await db.query(
        `SELECT b.id, b.date, b.start_time, b.end_time, b.status, b.price, b.source,
                s.name as service_name, br.name as barber_name
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         JOIN barbers br ON b.barber_id = br.id
         WHERE b.client_id = $1 AND b.deleted_at IS NULL
         ORDER BY b.date DESC, b.start_time DESC
         LIMIT 50`,
        [id]
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
// PUT /api/admin/clients/:id — Update client notes
// ============================================
router.put('/:id',
  [
    param('id').matches(uuidRegex),
    body('notes').optional().trim().isLength({ max: 2000 }),
    body('first_name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('last_name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { notes, first_name, last_name, email } = req.body;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (notes !== undefined) { fields.push(`notes = $${paramIndex++}`); values.push(notes); }
      if (first_name) { fields.push(`first_name = $${paramIndex++}`); values.push(first_name); }
      if (last_name) { fields.push(`last_name = $${paramIndex++}`); values.push(last_name); }
      if (email !== undefined) { fields.push(`email = $${paramIndex++}`); values.push(email || null); }

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
        `UPDATE clients SET deleted_at = NOW(), email = NULL, phone = 'DELETED',
         first_name = 'Client', last_name = 'supprimé', password_hash = NULL,
         has_account = false
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Client introuvable');
      }

      res.json({ message: 'Données client supprimées (RGPD)' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
