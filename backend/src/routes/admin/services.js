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
      `SELECT s.id, s.name, s.description, s.price, s.duration, s.duration_saturday, s.is_active, s.admin_only, s.sort_order, s.color,
              COALESCE(
                json_agg(json_build_object('id', b.id, 'name', b.name, 'custom_duration', bs.custom_duration))
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
    body('duration_saturday').optional({ values: 'null' }).isInt({ min: 5, max: 480 }).withMessage('Durée samedi invalide'),
    body('color').optional().matches(/^#[0-9a-fA-F]{6}$/).withMessage('Couleur invalide (format #RRGGBB)'),
    body('barber_ids').optional().isArray(),
    body('barber_ids.*').optional().matches(uuidRegex),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { name, description, price, duration, duration_saturday, color, barber_ids } = req.body;

      // Get max sort order
      const maxOrder = await db.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM services WHERE deleted_at IS NULL AND salon_id = $1',
        [salonId]
      );

      const result = await db.query(
        `INSERT INTO services (name, description, price, duration, duration_saturday, sort_order, color, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [name, description || null, price, duration, duration_saturday || null, maxOrder.rows[0].next, color || '#22c55e', salonId]
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
    body('duration_saturday').optional({ values: 'null' }).custom(v => v === null || (Number.isInteger(v) && v >= 5 && v <= 480)).withMessage('Durée samedi invalide'),
    body('is_active').optional().isBoolean(),
    body('sort_order').optional().isInt({ min: 0 }),
    body('color').optional().matches(/^#[0-9a-fA-F]{6}$/).withMessage('Couleur invalide (format #RRGGBB)'),
    body('barber_ids').optional().isArray(),
    body('barber_ids.*').optional().matches(uuidRegex),
    body('admin_only').optional().isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { id } = req.params;
      const { name, description, price, duration, duration_saturday, is_active, admin_only, sort_order, color, barber_ids } = req.body;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) { fields.push(`name = $${paramIndex++}`); values.push(name); }
      if (description !== undefined) { fields.push(`description = $${paramIndex++}`); values.push(description || null); }
      if (price !== undefined) { fields.push(`price = $${paramIndex++}`); values.push(price); }
      if (duration !== undefined) { fields.push(`duration = $${paramIndex++}`); values.push(duration); }
      if (duration_saturday !== undefined) { fields.push(`duration_saturday = $${paramIndex++}`); values.push(duration_saturday); }
      if (is_active !== undefined) { fields.push(`is_active = $${paramIndex++}`); values.push(is_active); }
      if (admin_only !== undefined) { fields.push(`admin_only = $${paramIndex++}`); values.push(admin_only); }
      if (sort_order !== undefined) { fields.push(`sort_order = $${paramIndex++}`); values.push(sort_order); }
      if (color !== undefined) { fields.push(`color = $${paramIndex++}`); values.push(color); }

      if (fields.length > 0) {
        values.push(id, salonId);
        await db.query(
          `UPDATE services SET ${fields.join(', ')} WHERE id = $${paramIndex} AND salon_id = $${paramIndex + 1} AND deleted_at IS NULL`,
          values
        );
      }

      // Update barber assignments if provided.
      // Use UPSERT + targeted DELETE to preserve existing custom_duration values
      // (otherwise per-barber duration overrides are silently wiped on every save).
      if (barber_ids !== undefined) {
        for (const barberId of barber_ids) {
          await db.query(
            'INSERT INTO barber_services (barber_id, service_id) VALUES ($1, $2) ON CONFLICT (barber_id, service_id) DO NOTHING',
            [barberId, id]
          );
        }
        if (barber_ids.length > 0) {
          await db.query(
            `DELETE FROM barber_services WHERE service_id = $1 AND barber_id <> ALL($2::uuid[])`,
            [id, barber_ids]
          );
        } else {
          await db.query('DELETE FROM barber_services WHERE service_id = $1', [id]);
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

// ============================================
// GET /api/admin/services/:id/restrictions — Per-barber availability restrictions
// ============================================
router.get('/:id/restrictions',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const result = await db.query(
        `SELECT id, barber_id, day_of_week, start_time, end_time
         FROM service_restrictions
         WHERE service_id = $1 AND salon_id = $2
         ORDER BY barber_id, day_of_week`,
        [req.params.id, salonId]
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/admin/services/:id/restrictions — Save per-barber restrictions
// Body: { restrictions: [{ barber_id, day_of_week, start_time?, end_time? }] }
// Empty array = no restrictions. Rows = whitelist of allowed days/windows.
// ============================================
router.put('/:id/restrictions',
  [
    param('id').matches(uuidRegex),
    body('restrictions').isArray(),
    body('restrictions.*.barber_id').matches(uuidRegex),
    body('restrictions.*.day_of_week').isInt({ min: 0, max: 6 }),
    body('restrictions.*.start_time').optional({ values: 'null' }).matches(/^\d{2}:\d{2}$/),
    body('restrictions.*.end_time').optional({ values: 'null' }).matches(/^\d{2}:\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { id } = req.params;
      const { restrictions } = req.body;

      // Verify service exists
      const svc = await db.query(
        'SELECT id FROM services WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL',
        [id, salonId]
      );
      if (svc.rows.length === 0) throw ApiError.notFound('Prestation introuvable');

      // Replace all restrictions in a transaction
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'DELETE FROM service_restrictions WHERE service_id = $1 AND salon_id = $2',
          [id, salonId]
        );
        for (const r of restrictions) {
          await client.query(
            `INSERT INTO service_restrictions (service_id, barber_id, day_of_week, start_time, end_time, salon_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, r.barber_id, r.day_of_week, r.start_time || null, r.end_time || null, salonId]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      logAudit(req, 'update', 'service_restrictions', id, { count: restrictions.length });
      res.json({ message: 'Restrictions enregistrées', count: restrictions.length });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
