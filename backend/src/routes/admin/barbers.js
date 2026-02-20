const { Router } = require('express');
const { body, param } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/barbers — All barbers
// ============================================
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, role, photo_url, email, is_active, sort_order
       FROM barbers WHERE deleted_at IS NULL
       ORDER BY sort_order`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ============================================
// PUT /api/admin/barbers/:id — Update a barber
// ============================================
router.put('/:id',
  [
    param('id').matches(uuidRegex),
    body('name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('role').optional().trim().isLength({ max: 200 }),
    body('photo_url').optional().trim(),
    body('is_active').optional().isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { name, role, photo_url, is_active } = req.body;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) { fields.push(`name = $${paramIndex++}`); values.push(name); }
      if (role !== undefined) { fields.push(`role = $${paramIndex++}`); values.push(role); }
      if (photo_url !== undefined) { fields.push(`photo_url = $${paramIndex++}`); values.push(photo_url); }
      if (is_active !== undefined) { fields.push(`is_active = $${paramIndex++}`); values.push(is_active); }

      if (fields.length === 0) {
        throw ApiError.badRequest('Aucune donnée à mettre à jour');
      }

      values.push(id);
      const result = await db.query(
        `UPDATE barbers SET ${fields.join(', ')}
         WHERE id = $${paramIndex} AND deleted_at IS NULL
         RETURNING id, name, role, photo_url, email, is_active, sort_order`,
        values
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Barber introuvable');
      }

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/barbers/:id/schedule — Get barber schedule
// ============================================
router.get('/:id/schedule',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const schedules = await db.query(
        'SELECT * FROM schedules WHERE barber_id = $1 ORDER BY day_of_week',
        [id]
      );

      const overrides = await db.query(
        `SELECT * FROM schedule_overrides
         WHERE barber_id = $1 AND date >= CURRENT_DATE
         ORDER BY date`,
        [id]
      );

      res.json({
        weekly: schedules.rows,
        overrides: overrides.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/admin/barbers/:id/schedule — Update weekly schedule
// ============================================
router.put('/:id/schedule',
  [
    param('id').matches(uuidRegex),
    body('schedules').isArray().withMessage('Tableau d\'horaires requis'),
    body('schedules.*.day_of_week').isInt({ min: 0, max: 6 }),
    body('schedules.*.is_working').isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { schedules } = req.body;

      // Replace all schedules for this barber
      await db.query('DELETE FROM schedules WHERE barber_id = $1', [id]);

      for (const schedule of schedules) {
        // Normalize times: strip seconds if present, default to 09:00/19:00 for rest days
        const startTime = schedule.is_working ? (schedule.start_time || '09:00').slice(0, 5) : '09:00';
        const endTime = schedule.is_working ? (schedule.end_time || '19:00').slice(0, 5) : '19:00';
        await db.query(
          `INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, schedule.day_of_week, startTime, endTime, schedule.is_working]
        );
      }

      const result = await db.query(
        'SELECT * FROM schedules WHERE barber_id = $1 ORDER BY day_of_week',
        [id]
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/barbers/:id/overrides — Add schedule override
// ============================================
router.post('/:id/overrides',
  [
    param('id').matches(uuidRegex),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide'),
    body('is_day_off').isBoolean(),
    body('start_time').optional().matches(/^\d{2}:\d{2}$/),
    body('end_time').optional().matches(/^\d{2}:\d{2}$/),
    body('reason').optional().trim().isLength({ max: 500 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { date, is_day_off, start_time, end_time, reason } = req.body;

      const result = await db.query(
        `INSERT INTO schedule_overrides (barber_id, date, is_day_off, start_time, end_time, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (barber_id, date) DO UPDATE SET
           is_day_off = $3, start_time = $4, end_time = $5, reason = $6
         RETURNING *`,
        [id, date, is_day_off, is_day_off ? null : start_time, is_day_off ? null : end_time, reason]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/overrides/:id — Remove an override
// ============================================
router.delete('/overrides/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.query(
        'DELETE FROM schedule_overrides WHERE id = $1 RETURNING id',
        [req.params.id]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Exception introuvable');
      }

      res.json({ message: 'Exception supprimée' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
