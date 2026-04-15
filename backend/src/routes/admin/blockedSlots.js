const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const ws = require('../../services/websocket');
const { getParisTodayISO } = require('../../utils/date');

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
      const targetDate = date || getParisTodayISO();
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
    body('start_time').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Heure de début invalide'),
    body('end_time').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Heure de fin invalide'),
    body('type').isIn(['break', 'personal', 'closed']).withMessage('Type invalide'),
    body('reason').optional({ values: 'falsy' }).isString().isLength({ max: 255 }),
    body('recurrence').optional().isObject(),
    body('recurrence.type').optional().isIn(['weekly', 'biweekly']),
    body('recurrence.end_type').optional().isIn(['occurrences', 'end_date']),
    body('recurrence.occurrences').optional().isInt({ min: 2, max: 52 }).toInt(),
    body('recurrence.end_date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { barber_id, date, start_time, end_time, reason, type, recurrence } = req.body;

      if (start_time >= end_time) {
        throw ApiError.badRequest('L\'heure de fin doit être après l\'heure de début');
      }

      const barberResult = await db.query(
        'SELECT id, name FROM barbers WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL',
        [barber_id, salonId]
      );
      if (barberResult.rows.length === 0) {
        throw ApiError.badRequest('Barber introuvable');
      }

      // Generate dates (single or recurring)
      const dates = [date];
      if (recurrence && recurrence.type) {
        const interval = recurrence.type === 'biweekly' ? 14 : 7;
        const startDate = new Date(date + 'T00:00:00');
        let maxDates = 52;
        if (recurrence.end_type === 'occurrences') {
          maxDates = recurrence.occurrences || 10;
        }
        const endDate = recurrence.end_type === 'end_date' && recurrence.end_date
          ? new Date(recurrence.end_date + 'T00:00:00')
          : null;
        for (let i = 1; i < maxDates; i++) {
          const next = new Date(startDate);
          next.setDate(startDate.getDate() + i * interval);
          if (endDate && next > endDate) break;
          dates.push(next.toISOString().split('T')[0]);
        }
      }

      const created = [];
      const skipped = [];
      for (const d of dates) {
        // Auto-delete overlapping blocked slots
        await db.query(
          `DELETE FROM blocked_slots WHERE barber_id = $1 AND date = $2 AND start_time < $3 AND end_time > $4`,
          [barber_id, d, end_time, start_time]
        );
        // Check booking overlap
        const overlap = await db.query(
          `SELECT id FROM bookings WHERE barber_id = $1 AND date = $2 AND status != 'cancelled' AND deleted_at IS NULL AND start_time < $3 AND end_time > $4`,
          [barber_id, d, end_time, start_time]
        );
        if (overlap.rows.length > 0) {
          skipped.push(d);
          continue;
        }
        const result = await db.query(
          `INSERT INTO blocked_slots (barber_id, date, start_time, end_time, reason, type, salon_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [barber_id, d, start_time, end_time, reason || null, type, salonId]
        );
        const slot = result.rows[0];
        slot.barber_name = barberResult.rows[0].name;
        created.push(slot);
      }

      if (dates.length === 1) {
        if (created.length === 0) throw ApiError.conflict('Ce créneau chevauche un rendez-vous existant');
        ws.emitBlockedSlotChanged(salonId);
        res.status(201).json(created[0]);
      } else {
        ws.emitBlockedSlotChanged(salonId);
        res.status(201).json({ created: created.length, skipped: skipped.length, slots: created });
      }
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/blocked-slots/barber/:barberId — List future breaks for a barber
// ============================================
router.get('/barber/:barberId',
  [param('barberId').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { barberId } = req.params;
      const today = getParisTodayISO();

      const result = await db.query(
        `SELECT bs.id, bs.barber_id, bs.date, bs.start_time, bs.end_time,
                bs.reason, bs.type, bs.created_at
         FROM blocked_slots bs
         JOIN barbers br ON bs.barber_id = br.id
         WHERE bs.barber_id = $1 AND br.salon_id = $2 AND bs.date >= $3
         ORDER BY bs.date, bs.start_time`,
        [barberId, salonId, today]
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/blocked-slots/barber/:barberId/bulk — Remove all future breaks for a barber
// Supports optional ?reason=... to only delete matching reason
// ============================================
router.delete('/barber/:barberId/bulk',
  [param('barberId').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { barberId } = req.params;
      const { reason } = req.query;
      const today = getParisTodayISO();

      let query = `DELETE FROM blocked_slots
         WHERE barber_id = $1 AND date >= $2
         AND barber_id IN (SELECT id FROM barbers WHERE salon_id = $3)`;
      const params = [barberId, today, salonId];

      if (reason) {
        query += ` AND reason = $4`;
        params.push(reason);
      }

      query += ' RETURNING id';

      const result = await db.query(query, params);

      ws.emitBlockedSlotChanged(salonId);
      res.json({ deleted: result.rows.length });
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

      ws.emitBlockedSlotChanged(salonId);
      res.json({ message: 'Créneau bloqué supprimé' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
