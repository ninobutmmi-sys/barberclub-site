const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/blocked-slots — List blocked slots
// Supports ?date=YYYY-MM-DD&barber_id=UUID&view=day|week
// ============================================
router.get('/',
  [
    query('date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('barber_id').optional().matches(uuidRegex),
    query('view').optional().isIn(['day', 'week']),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { date, barber_id, view } = req.query;
      const targetDate = date || new Date().toISOString().split('T')[0];
      const viewType = view || 'day';

      let dateCondition;
      const params = [];
      let paramIndex = 1;

      if (viewType === 'week') {
        // Calculate Monday–Sunday of the target week
        const d = new Date(targetDate + 'T00:00:00');
        const dayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1; // Monday=0
        const monday = new Date(d);
        monday.setDate(d.getDate() - dayIndex);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        dateCondition = `bs.date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        params.push(monday.toISOString().split('T')[0], sunday.toISOString().split('T')[0]);
        paramIndex += 2;
      } else {
        dateCondition = `bs.date = $${paramIndex}`;
        params.push(targetDate);
        paramIndex += 1;
      }

      let barberCondition = '';
      if (barber_id) {
        barberCondition = `AND bs.barber_id = $${paramIndex}`;
        params.push(barber_id);
        paramIndex += 1;
      }

      // Add salon filter through barber
      const salonCondition = `AND br.salon_id = $${paramIndex}`;
      params.push(salonId);
      paramIndex++;

      const result = await db.query(
        `SELECT bs.id, bs.barber_id, bs.date, bs.start_time, bs.end_time,
                bs.reason, bs.type, bs.created_at,
                br.name as barber_name
         FROM blocked_slots bs
         JOIN barbers br ON bs.barber_id = br.id
         WHERE ${dateCondition} ${barberCondition} ${salonCondition}
         ORDER BY bs.date, bs.start_time`,
        params
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/blocked-slots — Create a blocked slot
// ============================================
router.post('/',
  [
    body('barber_id').matches(uuidRegex).withMessage('Barber requis'),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide'),
    body('start_time').matches(/^\d{2}:\d{2}$/).withMessage('Heure de début invalide'),
    body('end_time').matches(/^\d{2}:\d{2}$/).withMessage('Heure de fin invalide'),
    body('type').isIn(['break', 'personal', 'closed']).withMessage('Type invalide'),
    body('reason').optional({ values: 'falsy' }).isString().isLength({ max: 255 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { barber_id, date, start_time, end_time, reason, type } = req.body;

      // Validate that end_time > start_time
      if (start_time >= end_time) {
        throw ApiError.badRequest('L\'heure de fin doit être après l\'heure de début');
      }

      // Check barber exists and belongs to salon
      const barberResult = await db.query(
        'SELECT id, name FROM barbers WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL',
        [barber_id, salonId]
      );
      if (barberResult.rows.length === 0) {
        throw ApiError.badRequest('Barber introuvable');
      }

      // Check for overlap with existing blocked slots
      const overlapCheck = await db.query(
        `SELECT id FROM blocked_slots
         WHERE barber_id = $1 AND date = $2
           AND start_time < $3 AND end_time > $4`,
        [barber_id, date, end_time, start_time]
      );
      if (overlapCheck.rows.length > 0) {
        throw ApiError.conflict('Ce créneau chevauche un blocage existant');
      }

      // Check for overlap with existing bookings
      const bookingOverlap = await db.query(
        `SELECT id FROM bookings
         WHERE barber_id = $1 AND date = $2
           AND status != 'cancelled' AND deleted_at IS NULL
           AND start_time < $3 AND end_time > $4`,
        [barber_id, date, end_time, start_time]
      );
      if (bookingOverlap.rows.length > 0) {
        throw ApiError.conflict('Ce créneau chevauche un rendez-vous existant');
      }

      const result = await db.query(
        `INSERT INTO blocked_slots (barber_id, date, start_time, end_time, reason, type, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [barber_id, date, start_time, end_time, reason || null, type, salonId]
      );

      const slot = result.rows[0];
      slot.barber_name = barberResult.rows[0].name;

      res.status(201).json(slot);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/blocked-slots/:id — Remove a blocked slot
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const result = await db.query(
        `DELETE FROM blocked_slots
         WHERE id = $1 AND barber_id IN (SELECT id FROM barbers WHERE salon_id = $2)
         RETURNING id`,
        [req.params.id, salonId]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Créneau bloqué introuvable');
      }

      res.json({ message: 'Créneau bloqué supprimé' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
