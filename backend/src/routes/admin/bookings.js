const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const bookingService = require('../../services/booking');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/bookings — Planning view
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
      const { date, barber_id, view } = req.query;
      const targetDate = date || new Date().toISOString().split('T')[0];
      const viewType = view || 'day';

      let dateCondition;
      let params = [];
      let paramIndex = 1;

      if (viewType === 'week') {
        // Get Monday of the week
        const d = new Date(targetDate + 'T00:00:00');
        const dayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1; // Monday=0
        const monday = new Date(d);
        monday.setDate(d.getDate() - dayIndex);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        dateCondition = `b.date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        params.push(monday.toISOString().split('T')[0], sunday.toISOString().split('T')[0]);
        paramIndex += 2;
      } else {
        dateCondition = `b.date = $${paramIndex}`;
        params.push(targetDate);
        paramIndex += 1;
      }

      let barberCondition = '';
      if (barber_id) {
        barberCondition = `AND b.barber_id = $${paramIndex}`;
        params.push(barber_id);
        paramIndex += 1;
      }

      const result = await db.query(
        `SELECT b.id, b.date, b.start_time, b.end_time, b.status, b.price, b.source,
                b.created_at,
                s.name as service_name, s.duration as service_duration,
                br.id as barber_id, br.name as barber_name,
                c.id as client_id, c.first_name as client_first_name,
                c.last_name as client_last_name, c.phone as client_phone
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         JOIN barbers br ON b.barber_id = br.id
         JOIN clients c ON b.client_id = c.id
         WHERE ${dateCondition} ${barberCondition}
           AND b.status != 'cancelled' AND b.deleted_at IS NULL
         ORDER BY b.start_time`,
        params
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/bookings — Add booking manually
// ============================================
router.post('/',
  [
    body('barber_id').matches(uuidRegex).withMessage('Barber requis'),
    body('service_id').matches(uuidRegex).withMessage('Service requis'),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide'),
    body('start_time').matches(/^\d{2}:\d{2}$/).withMessage('Heure invalide'),
    body('first_name').trim().notEmpty().withMessage('Prénom requis').isLength({ max: 100 }),
    body('last_name').trim().notEmpty().withMessage('Nom requis').isLength({ max: 100 }),
    body('phone').trim().notEmpty().withMessage('Téléphone requis')
      .matches(/^(\+33|0)[1-9]\d{8}$/).withMessage('Numéro invalide'),
    body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const booking = await bookingService.createBooking({
        ...req.body,
        source: 'manual',
      });
      res.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/admin/bookings/:id — Modify a booking
// ============================================
router.put('/:id',
  [
    param('id').matches(uuidRegex),
    body('date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    body('start_time').optional().matches(/^\d{2}:\d{2}$/),
    body('barber_id').optional().matches(uuidRegex),
    body('service_id').optional().matches(uuidRegex),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { date, start_time, barber_id, service_id } = req.body;

      // Get current booking
      const current = await db.query(
        'SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (current.rows.length === 0) {
        throw ApiError.notFound('RDV introuvable');
      }

      const booking = current.rows[0];
      const newDate = date || booking.date;
      const newStartTime = start_time || booking.start_time;
      const newBarberId = barber_id || booking.barber_id;
      const newServiceId = service_id || booking.service_id;

      // Get service duration
      const serviceResult = await db.query('SELECT duration, price FROM services WHERE id = $1', [newServiceId]);
      if (serviceResult.rows.length === 0) throw ApiError.badRequest('Service introuvable');

      const { duration, price } = serviceResult.rows[0];
      const { addMinutesToTime } = require('../../services/availability');
      const newEndTime = addMinutesToTime(newStartTime, duration);

      // Check for conflicts (excluding current booking)
      const conflictCheck = await db.query(
        `SELECT id FROM bookings
         WHERE barber_id = $1 AND date = $2
           AND status != 'cancelled' AND deleted_at IS NULL
           AND id != $3
           AND start_time < $4 AND end_time > $5`,
        [newBarberId, newDate, id, newEndTime, newStartTime]
      );

      if (conflictCheck.rows.length > 0) {
        throw ApiError.conflict('Ce créneau est déjà pris');
      }

      const result = await db.query(
        `UPDATE bookings SET date = $1, start_time = $2, end_time = $3,
         barber_id = $4, service_id = $5, price = $6
         WHERE id = $7 RETURNING *`,
        [newDate, newStartTime, newEndTime, newBarberId, newServiceId, price, id]
      );

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PATCH /api/admin/bookings/:id/status — Mark completed/no_show
// ============================================
router.patch('/:id/status',
  [
    param('id').matches(uuidRegex),
    body('status').isIn(['confirmed', 'completed', 'no_show']).withMessage('Statut invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await bookingService.updateBookingStatus(req.params.id, req.body.status);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/bookings/:id — Soft delete
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.query(
        `UPDATE bookings SET deleted_at = NOW(), status = 'cancelled'
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('RDV introuvable');
      }

      res.json({ message: 'RDV supprimé' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
