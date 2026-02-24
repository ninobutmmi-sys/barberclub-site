const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const bookingService = require('../../services/booking');
const { sendCancellationEmail, sendRescheduleEmail } = require('../../services/notification');
const { ApiError } = require('../../utils/errors');
const logger = require('../../utils/logger');
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
                b.created_at, b.service_id, b.is_first_visit, b.color as booking_color,
                b.recurrence_group_id,
                s.name as service_name, s.duration as service_duration, COALESCE(b.color, s.color) as service_color,
                br.id as barber_id, br.name as barber_name,
                c.id as client_id, c.first_name as client_first_name,
                c.last_name as client_last_name, c.phone as client_phone,
                c.email as client_email, c.notes as client_notes
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
// GET /api/admin/bookings/history — Full history with filters & pagination
// ============================================
router.get('/history',
  [
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('barber_id').optional().matches(uuidRegex),
    query('status').optional().isIn(['confirmed', 'completed', 'no_show', 'cancelled']),
    query('search').optional().isString().trim(),
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    query('sort').optional().isIn(['date', 'price', 'client_last_name', 'barber_name', 'status']),
    query('order').optional().isIn(['asc', 'desc']),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const {
        from, to, barber_id, status, search,
        limit = 50, offset = 0,
        sort = 'date', order = 'desc',
      } = req.query;

      const conditions = ['b.deleted_at IS NULL'];
      const params = [];
      let paramIndex = 1;

      if (from) {
        conditions.push(`b.date >= $${paramIndex}`);
        params.push(from);
        paramIndex++;
      }

      if (to) {
        conditions.push(`b.date <= $${paramIndex}`);
        params.push(to);
        paramIndex++;
      }

      if (barber_id) {
        conditions.push(`b.barber_id = $${paramIndex}`);
        params.push(barber_id);
        paramIndex++;
      }

      if (status) {
        conditions.push(`b.status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }

      if (search) {
        conditions.push(
          `(LOWER(c.first_name) LIKE $${paramIndex}
            OR LOWER(c.last_name) LIKE $${paramIndex}
            OR c.phone LIKE $${paramIndex})`
        );
        params.push(`%${search.toLowerCase()}%`);
        paramIndex++;
      }

      const whereClause = conditions.length > 0
        ? 'WHERE ' + conditions.join(' AND ')
        : '';

      // Mapping for sort columns
      const sortMap = {
        date: 'b.date DESC, b.start_time',
        price: 'b.price',
        client_last_name: 'c.last_name',
        barber_name: 'br.name',
        status: 'b.status',
      };
      const sortCol = sortMap[sort] || 'b.date DESC, b.start_time';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

      // Count query
      const countResult = await db.query(
        `SELECT COUNT(*) as total
         FROM bookings b
         JOIN clients c ON b.client_id = c.id
         JOIN barbers br ON b.barber_id = br.id
         JOIN services s ON b.service_id = s.id
         ${whereClause}`,
        params
      );

      // Data query
      const dataResult = await db.query(
        `SELECT b.id, b.date, b.start_time, b.end_time, b.status, b.price, b.source,
                b.created_at,
                s.id as service_id, s.name as service_name, s.duration as service_duration,
                br.id as barber_id, br.name as barber_name,
                c.id as client_id, c.first_name as client_first_name,
                c.last_name as client_last_name, c.phone as client_phone,
                c.email as client_email
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         JOIN barbers br ON b.barber_id = br.id
         JOIN clients c ON b.client_id = c.id
         ${whereClause}
         ORDER BY ${sortCol} ${sortOrder}
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
      );

      res.json({
        bookings: dataResult.rows,
        total: parseInt(countResult.rows[0].total, 10),
        limit,
        offset,
      });
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
      .customSanitizer(v => v.replace(/\s/g, ''))
      .matches(/^(\+33|0)[1-9]\d{8}$/).withMessage('Numéro invalide'),
    body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
    body('color').optional({ values: 'falsy' }).matches(/^#[0-9a-fA-F]{6}$/).withMessage('Couleur invalide'),
    body('recurrence').optional().isObject(),
    body('recurrence.type').optional().isIn(['weekly', 'biweekly', 'monthly']),
    body('recurrence.end_type').optional().isIn(['occurrences', 'end_date']),
    body('recurrence.occurrences').optional().isInt({ min: 2, max: 52 }).toInt(),
    body('recurrence.end_date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { recurrence, ...bookingData } = req.body;

      if (recurrence && recurrence.type) {
        const result = await bookingService.createRecurringBookings(
          { ...bookingData, source: 'manual' },
          recurrence
        );
        res.status(201).json(result);
      } else {
        const booking = await bookingService.createBooking({
          ...bookingData,
          source: 'manual',
        });
        res.status(201).json(booking);
      }
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
    body('color').optional({ values: 'falsy' }).matches(/^#[0-9a-fA-F]{6}$/).withMessage('Couleur invalide'),
    body('notify_client').optional().isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { date, start_time, barber_id, service_id, color, notify_client } = req.body;

      // Get current booking with client info
      const current = await db.query(
        `SELECT b.*, c.first_name, c.last_name, c.email, c.phone,
                s.name as service_name, br.name as barber_name
         FROM bookings b
         JOIN clients c ON b.client_id = c.id
         JOIN services s ON b.service_id = s.id
         JOIN barbers br ON b.barber_id = br.id
         WHERE b.id = $1 AND b.deleted_at IS NULL`,
        [id]
      );
      if (current.rows.length === 0) {
        throw ApiError.notFound('RDV introuvable');
      }

      const booking = current.rows[0];
      const oldDate = typeof booking.date === 'string' ? booking.date.slice(0, 10) : booking.date;
      const oldTime = booking.start_time;
      const oldBarberName = booking.barber_name;

      const newDate = date || oldDate;
      const newStartTime = start_time || booking.start_time;
      const newBarberId = barber_id || booking.barber_id;
      const newServiceId = service_id || booking.service_id;

      // Get service duration
      const serviceResult = await db.query('SELECT duration, price, name FROM services WHERE id = $1', [newServiceId]);
      if (serviceResult.rows.length === 0) throw ApiError.badRequest('Service introuvable');

      const { duration, price } = serviceResult.rows[0];
      const { addMinutesToTime } = require('../../services/availability');
      const newEndTime = addMinutesToTime(newStartTime, duration);

      // Get new barber name if barber changed
      let newBarberName = oldBarberName;
      if (barber_id && barber_id !== booking.barber_id) {
        const brResult = await db.query('SELECT name FROM barbers WHERE id = $1', [barber_id]);
        if (brResult.rows.length > 0) newBarberName = brResult.rows[0].name;
      }

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

      // Check blocked slots
      const blockedCheck = await db.query(
        `SELECT id FROM blocked_slots
         WHERE barber_id = $1 AND date = $2
           AND start_time < $3 AND end_time > $4`,
        [newBarberId, newDate, newEndTime, newStartTime]
      );
      if (blockedCheck.rows.length > 0) {
        throw ApiError.conflict('Ce créneau est bloqué (pause ou congé)');
      }

      const result = await db.query(
        `UPDATE bookings SET date = $1, start_time = $2, end_time = $3,
         barber_id = $4, service_id = $5, price = $6, color = $7
         WHERE id = $8 RETURNING *`,
        [newDate, newStartTime, newEndTime, newBarberId, newServiceId, price, color !== undefined ? color : booking.color || null, id]
      );

      // Send reschedule email if requested (non-blocking)
      if (notify_client && booking.email) {
        sendRescheduleEmail({
          email: booking.email,
          first_name: booking.first_name,
          service_name: serviceResult.rows[0].name,
          barber_name: oldBarberName,
          old_date: oldDate,
          old_time: oldTime,
          new_date: newDate,
          new_time: newStartTime,
          new_barber_name: newBarberName,
          price,
        }).catch((err) => logger.error('Email notification failed', { error: err.message }));
      }

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
// DELETE /api/admin/bookings/group/:groupId — Delete all bookings in a recurrence group
// ============================================
router.delete('/group/:groupId',
  [param('groupId').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const { groupId } = req.params;
      const notify = req.query.notify === 'true';
      const futureOnly = req.query.future_only === 'true';

      // Build date condition: future_only = only today and future bookings
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      const todayStr = now.toISOString().split('T')[0];
      const dateCondition = futureOnly ? ` AND b.date >= '${todayStr}'` : '';

      // If notify, fetch all bookings info before deleting
      let bookingsInfo = [];
      if (notify) {
        const infoResult = await db.query(
          `SELECT b.id, b.date, b.start_time, b.price,
                  s.name as service_name, br.name as barber_name,
                  c.first_name, c.email
           FROM bookings b
           JOIN services s ON b.service_id = s.id
           JOIN barbers br ON b.barber_id = br.id
           JOIN clients c ON b.client_id = c.id
           WHERE b.recurrence_group_id = $1
             AND b.deleted_at IS NULL AND b.status != 'cancelled'
             ${dateCondition}`,
          [groupId]
        );
        bookingsInfo = infoResult.rows;
      }

      // Soft delete all bookings in the group
      const result = await db.query(
        `UPDATE bookings b SET deleted_at = NOW(), status = 'cancelled'
         WHERE recurrence_group_id = $1
           AND deleted_at IS NULL AND status != 'cancelled'
           ${dateCondition}
         RETURNING id`,
        [groupId]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Aucun RDV trouvé dans ce groupe');
      }

      // Send cancellation emails (non-blocking)
      if (notify && bookingsInfo.length > 0) {
        for (const info of bookingsInfo) {
          if (info.email) {
            const dateStr = typeof info.date === 'string' ? info.date.slice(0, 10) : info.date;
            sendCancellationEmail({
              email: info.email,
              first_name: info.first_name,
              service_name: info.service_name,
              barber_name: info.barber_name,
              date: dateStr,
              start_time: info.start_time,
              price: info.price,
            }).catch((err) => logger.error('Email notification failed', { error: err.message, bookingId: info.id }));
          }
        }
      }

      logger.info('Recurring group deleted', { groupId, count: result.rows.length, futureOnly });
      res.json({ message: `${result.rows.length} RDV supprimés`, count: result.rows.length });
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
      const notify = req.query.notify === 'true';

      // If notify, fetch booking + client info before deleting
      let bookingInfo = null;
      if (notify) {
        const infoResult = await db.query(
          `SELECT b.date, b.start_time, b.price,
                  s.name as service_name, br.name as barber_name,
                  c.first_name, c.email
           FROM bookings b
           JOIN services s ON b.service_id = s.id
           JOIN barbers br ON b.barber_id = br.id
           JOIN clients c ON b.client_id = c.id
           WHERE b.id = $1 AND b.deleted_at IS NULL`,
          [req.params.id]
        );
        if (infoResult.rows.length > 0) bookingInfo = infoResult.rows[0];
      }

      const result = await db.query(
        `UPDATE bookings SET deleted_at = NOW(), status = 'cancelled'
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('RDV introuvable');
      }

      // Send cancellation email if requested (non-blocking)
      if (notify && bookingInfo && bookingInfo.email) {
        const dateStr = typeof bookingInfo.date === 'string'
          ? bookingInfo.date.slice(0, 10) : bookingInfo.date;
        sendCancellationEmail({
          email: bookingInfo.email,
          first_name: bookingInfo.first_name,
          service_name: bookingInfo.service_name,
          barber_name: bookingInfo.barber_name,
          date: dateStr,
          start_time: bookingInfo.start_time,
          price: bookingInfo.price,
        }).catch((err) => logger.error('Email notification failed', { error: err.message }));
      }

      res.json({ message: 'RDV supprimé' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
