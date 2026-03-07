const { Router } = require('express');
const { body, param } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const { logAudit } = require('../../middleware/auditLog');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/services — All services (including inactive)
// ============================================
router.get('/', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const result = await db.query(
      `SELECT s.id, s.name, s.description, s.price, s.duration, s.is_active, s.sort_order, s.color,
              COALESCE(
                json_agg(json_build_object('id', b.id, 'name', b.name))
                FILTER (WHERE b.id IS NOT NULL), '[]'
              ) as barbers
       FROM services s
       LEFT JOIN barber_services bs ON s.id = bs.service_id
       LEFT JOIN barbers b ON bs.barber_id = b.id AND b.deleted_at IS NULL
       WHERE s.deleted_at IS NULL AND s.salon_id = $1
       GROUP BY s.id
       ORDER BY s.sort_order`,
      [salonId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/admin/services — Add a service
// ============================================
router.post('/',
  [
    body('name').trim().notEmpty().withMessage('Nom requis').isLength({ max: 200 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
    body('price').isInt({ min: 0 }).withMessage('Prix invalide (en centimes)'),
    body('duration').isInt({ min: 5, max: 480 }).withMessage('Durée invalide (5-480 minutes)'),
    body('color').optional().matches(/^#[0-9a-fA-F]{6}$/).withMessage('Couleur invalide (format #RRGGBB)'),
    body('barber_ids').optional().isArray(),
    body('barber_ids.*').optional().matches(uuidRegex),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { name, description, price, duration, color, barber_ids } = req.body;

      // Get max sort order
      const maxOrder = await db.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM services WHERE deleted_at IS NULL AND salon_id = $1',
        [salonId]
      );

      const result = await db.query(
        `INSERT INTO services (name, description, price, duration, sort_order, color, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [name, description || null, price, duration, maxOrder.rows[0].next, color || '#22c55e', salonId]
      );

      const service = result.rows[0];

      // Assign barbers if provided
      if (barber_ids && barber_ids.length > 0) {
        for (const barberId of barber_ids) {
          await db.query(
            'INSERT INTO barber_services (barber_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [barberId, service.id]
          );
        }
      }

      logAudit(req, 'create', 'service', service.id, { name, price, duration });
      res.status(201).json(service);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/admin/services/:id — Update a service
// ============================================
router.put('/:id',
  [
    param('id').matches(uuidRegex),
    body('name').optional().trim().notEmpty().isLength({ max: 200 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
    body('price').optional().isInt({ min: 0 }),
    body('duration').optional().isInt({ min: 5, max: 480 }),
    body('is_active').optional().isBoolean(),
    body('sort_order').optional().isInt({ min: 0 }),
    body('color').optional().matches(/^#[0-9a-fA-F]{6}$/).withMessage('Couleur invalide (format #RRGGBB)'),
    body('barber_ids').optional().isArray(),
    body('barber_ids.*').optional().matches(uuidRegex),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { id } = req.params;
      const { name, description, price, duration, is_active, sort_order, color, barber_ids } = req.body;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) { fields.push(`name = $${paramIndex++}`); values.push(name); }
      if (description !== undefined) { fields.push(`description = $${paramIndex++}`); values.push(description || null); }
      if (price !== undefined) { fields.push(`price = $${paramIndex++}`); values.push(price); }
      if (duration !== undefined) { fields.push(`duration = $${paramIndex++}`); values.push(duration); }
      if (is_active !== undefined) { fields.push(`is_active = $${paramIndex++}`); values.push(is_active); }
      if (sort_order !== undefined) { fields.push(`sort_order = $${paramIndex++}`); values.push(sort_order); }
      if (color !== undefined) { fields.push(`color = $${paramIndex++}`); values.push(color); }

      if (fields.length > 0) {
        values.push(id, salonId);
        await db.query(
          `UPDATE services SET ${fields.join(', ')} WHERE id = $${paramIndex} AND salon_id = $${paramIndex + 1} AND deleted_at IS NULL`,
          values
        );
      }

      // Update barber assignments if provided
      if (barber_ids !== undefined) {
        await db.query('DELETE FROM barber_services WHERE service_id = $1', [id]);
        for (const barberId of barber_ids) {
          await db.query(
            'INSERT INTO barber_services (barber_id, service_id) VALUES ($1, $2)',
            [barberId, id]
          );
        }
      }

      // Return updated service with barbers
      const result = await db.query(
        `SELECT s.*, COALESCE(
           json_agg(json_build_object('id', b.id, 'name', b.name))
           FILTER (WHERE b.id IS NOT NULL), '[]'
         ) as barbers
         FROM services s
         LEFT JOIN barber_services bs ON s.id = bs.service_id
         LEFT JOIN barbers b ON bs.barber_id = b.id AND b.deleted_at IS NULL
         WHERE s.id = $1 AND s.salon_id = $2 AND s.deleted_at IS NULL
         GROUP BY s.id`,
        [id, salonId]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Prestation introuvable');
      }

      logAudit(req, 'update', 'service', id, { changes: req.body });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/services/:id — Soft delete
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const result = await db.query(
        'UPDATE services SET deleted_at = NOW(), is_active = false WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL RETURNING id',
        [req.params.id, salonId]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Prestation introuvable');
      }

      logAudit(req, 'delete', 'service', req.params.id);
      res.json({ message: 'Prestation supprimée' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
