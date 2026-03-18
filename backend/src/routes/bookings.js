const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { handleValidation } = require('../middleware/validate');
const { publicLimiter } = require('../middleware/rateLimiter');
const { optionalAuth } = require('../middleware/auth');
const bookingService = require('../services/booking');
const availabilityService = require('../services/availability');
const { generateICS } = require('../utils/ics');
const { ApiError } = require('../utils/errors');
const db = require('../config/database');
const { MAX_BOOKING_ADVANCE_MONTHS } = require('../constants');
const ws = require('../services/websocket');

const router = Router();

// UUID-shaped regex (accepts non-standard UUIDs like our seed data)
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/barbers — List active barbers
// ============================================
router.get('/barbers', publicLimiter,
  [query('salon_id').optional().isIn(['meylan', 'grenoble']).withMessage('Salon invalide')],
  handleValidation,
  async (req, res, next) => {
  try {
    const salonId = req.query.salon_id || 'meylan';
    // Resident barbers
    const result = await db.query(
      `SELECT id, name, role, photo_url, FALSE as is_guest
       FROM barbers
       WHERE is_active = true AND deleted_at IS NULL AND salon_id = $1
       ORDER BY sort_order`,
      [salonId]
    );
    // Guest barbers with future assignments in this salon
    const guestResult = await db.query(
      `SELECT DISTINCT b.id, b.name, b.role, b.photo_url, b.sort_order, TRUE as is_guest
       FROM barbers b
       JOIN guest_assignments ga ON b.id = ga.barber_id
       WHERE b.is_active = true AND b.deleted_at IS NULL
         AND ga.host_salon_id = $1 AND ga.date >= CURRENT_DATE
         AND b.salon_id != $1
       ORDER BY b.sort_order`,
      [salonId]
    );
    const allBarbers = [...result.rows, ...guestResult.rows];

    // Attach off-days for resident barbers
    const schedResult = await db.query(
      `SELECT barber_id, day_of_week FROM schedules WHERE is_working = false AND salon_id = $1`,
      [salonId]
    );
    const offMap = {};
    for (const row of schedResult.rows) {
      if (!offMap[row.barber_id]) offMap[row.barber_id] = [];
      offMap[row.barber_id].push(row.day_of_week);
    }

    // Load schedule overrides (working on off-days, or day-off on working days)
    const residentIds = result.rows.map(b => b.id);
    let overrideWorkDates = {};
    let overrideOffDates = {};
    if (residentIds.length > 0) {
      const overrides = await db.query(
        `SELECT barber_id, date, is_day_off FROM schedule_overrides
         WHERE salon_id = $1 AND date >= CURRENT_DATE AND barber_id = ANY($2)`,
        [salonId, residentIds]
      );
      for (const row of overrides.rows) {
        if (row.is_day_off) {
          if (!overrideOffDates[row.barber_id]) overrideOffDates[row.barber_id] = [];
          overrideOffDates[row.barber_id].push(row.date);
        } else {
          if (!overrideWorkDates[row.barber_id]) overrideWorkDates[row.barber_id] = [];
          overrideWorkDates[row.barber_id].push(row.date);
        }
      }
    }

    // For guest barbers, load their guest assignment dates
    const guestIds = guestResult.rows.map(b => b.id);
    let guestDatesMap = {};
    if (guestIds.length > 0) {
      const gaDates = await db.query(
        `SELECT barber_id, date FROM guest_assignments
         WHERE host_salon_id = $1 AND date >= CURRENT_DATE AND barber_id = ANY($2)`,
        [salonId, guestIds]
      );
      for (const row of gaDates.rows) {
        if (!guestDatesMap[row.barber_id]) guestDatesMap[row.barber_id] = [];
        guestDatesMap[row.barber_id].push(row.date);
      }
    }

    const barbers = allBarbers.map((b) => ({
      ...b,
      off_days: offMap[b.id] || [],
      work_dates: overrideWorkDates[b.id] || undefined,
      off_dates: overrideOffDates[b.id] || undefined,
      guest_dates: guestDatesMap[b.id] || undefined,
    }));
    res.json(barbers);
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/services — List services (optionally filtered by barber)
// ============================================
router.get('/services', publicLimiter,
  [
    query('barber_id').optional().custom((val) => val === 'any' || uuidRegex.test(val)).withMessage('Barber ID invalide'),
    query('salon_id').optional().isIn(['meylan', 'grenoble']).withMessage('Salon invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
  try {
    const { barber_id } = req.query;
    const salonId = req.query.salon_id || 'meylan';

    let queryText;
    let params;

    if (barber_id && barber_id !== 'any') {
      // Check if this barber is a guest (their home salon != requested salon)
      const barberCheck = await db.query(
        'SELECT salon_id FROM barbers WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
        [barber_id]
      );
      const barberHomeSalon = barberCheck.rows[0]?.salon_id || salonId;
      // Use the barber's home salon services (guest keeps their own tarifs)
      const serviceSalonId = barberHomeSalon !== salonId ? barberHomeSalon : salonId;

      queryText = `
        SELECT s.id, s.name, s.price, s.duration, s.duration_saturday, s.description, s.time_restrictions
        FROM services s
        JOIN barber_services bs ON s.id = bs.service_id
        WHERE bs.barber_id = $1 AND s.is_active = true AND s.deleted_at IS NULL AND s.salon_id = $2
          AND (s.admin_only = false OR s.admin_only IS NULL)
        ORDER BY s.sort_order`;
      params = [barber_id, serviceSalonId];
    } else {
      // All active services
      queryText = `
        SELECT id, name, price, duration, duration_saturday, description, time_restrictions
        FROM services
        WHERE is_active = true AND deleted_at IS NULL AND salon_id = $1
          AND (admin_only = false OR admin_only IS NULL)
        ORDER BY sort_order`;
      params = [salonId];
    }

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/availability/month — Month-level availability summary (batch)
// ============================================
router.get('/availability/month',
  publicLimiter,
  [
    query('service_id').matches(uuidRegex).withMessage('Service ID invalide'),
    query('year').isInt({ min: 2024, max: 2030 }).withMessage('Année invalide'),
    query('month').isInt({ min: 0, max: 11 }).withMessage('Mois invalide (0-11)'),
    query('barber_id').optional().custom((val) => val === 'any' || uuidRegex.test(val)).withMessage('Barber ID invalide'),
    query('salon_id').optional().isIn(['meylan', 'grenoble']).withMessage('Salon invalide'),
    query('include_alternatives').optional().isIn(['true', 'false']).withMessage('Valeur invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { service_id, barber_id } = req.query;
      const year = parseInt(req.query.year, 10);
      const month = parseInt(req.query.month, 10);
      const salonId = req.query.salon_id || 'meylan';
      const includeAlternatives = req.query.include_alternatives === 'true';

      const summary = await availabilityService.getMonthAvailabilitySummary(
        service_id, year, month, barber_id || 'any', salonId, includeAlternatives
      );

      res.json(summary);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/availability — Available time slots
// ============================================
router.get('/availability',
  publicLimiter,
  [
    query('service_id').matches(uuidRegex).withMessage('Service ID invalide'),
    query('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide (format: YYYY-MM-DD)')
      .custom((val) => !isNaN(new Date(val + 'T00:00:00').getTime())).withMessage('Date invalide'),
    query('barber_id').optional().custom((val) => val === 'any' || uuidRegex.test(val)).withMessage('Barber ID invalide'),
    query('salon_id').optional().isIn(['meylan', 'grenoble']).withMessage('Salon invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { barber_id, service_id, date } = req.query;
      const salonId = req.query.salon_id || 'meylan';

      // Validate date is not in the past
      const requestedDate = new Date(date + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (requestedDate < today) {
        throw new ApiError(400, 'La date doit être aujourd\'hui ou dans le futur');
      }

      // Validate date is not more than MAX_BOOKING_ADVANCE_MONTHS in the future
      const maxDate = new Date(today);
      maxDate.setMonth(maxDate.getMonth() + MAX_BOOKING_ADVANCE_MONTHS);
      if (requestedDate > maxDate) {
        throw new ApiError(400, `Réservation possible jusqu'à ${MAX_BOOKING_ADVANCE_MONTHS} mois à l'avance maximum`);
      }

      const slots = await availabilityService.getAvailableSlots(
        barber_id || 'any',
        service_id,
        date,
        { salonId }
      );

      res.json(slots);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/bookings — Create a booking
// ============================================
router.post('/bookings',
  publicLimiter,
  optionalAuth,
  [
    body('barber_id').notEmpty().withMessage('Barber requis')
      .custom((val) => val === 'any' || uuidRegex.test(val)).withMessage('Barber ID invalide'),
    body('service_id').matches(uuidRegex).withMessage('Service ID invalide'),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide')
      .custom((val) => !isNaN(new Date(val + 'T00:00:00').getTime())).withMessage('Date invalide'),
    body('start_time').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Heure invalide (format: HH:MM)'),
    // Client info only required for guest booking (not when authenticated as client)
    body('first_name').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('last_name').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('phone').optional({ values: 'falsy' }).trim()
      .matches(/^(\+33|0)[1-9]\d{8}$/).withMessage('Numéro de téléphone français invalide'),
    body('email').trim().custom((value, { req }) => {
      if (!req.headers.authorization && !value) {
        throw new Error('Email requis pour une réservation en invité');
      }
      if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new Error('Email invalide');
      }
      return true;
    }),
    body('salon_id').optional().isIn(['meylan', 'grenoble']).withMessage('Salon invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.body.salon_id || 'meylan';
      let bookingData = { ...req.body, source: 'online', salon_id: salonId };

      if (req.user && req.user.type === 'client') {
        // Authenticated client: get info from database
        const clientResult = await db.query(
          'SELECT id, first_name, last_name, phone, email FROM clients WHERE id = $1 AND deleted_at IS NULL',
          [req.user.id]
        );
        if (clientResult.rows.length === 0) {
          throw ApiError.notFound('Client introuvable');
        }
        const client = clientResult.rows[0];
        bookingData.first_name = client.first_name;
        bookingData.last_name = client.last_name;
        bookingData.phone = client.phone;
        bookingData.email = client.email;
      } else {
        // Guest booking: require client info fields
        if (!bookingData.first_name || !bookingData.last_name || !bookingData.phone || !bookingData.email) {
          throw ApiError.badRequest('Prénom, nom, téléphone et email sont requis pour une réservation en invité');
        }
      }

      const booking = await bookingService.createBooking(bookingData);
      ws.emitBookingCreated(salonId, booking);

      res.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/bookings/:id — Get booking details (via cancel token)
// ============================================
router.get('/bookings/:id',
  publicLimiter,
  [
    param('id').matches(uuidRegex).withMessage('ID invalide'),
    query('token').matches(uuidRegex).withMessage('Token invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT b.id, b.date, b.start_time, b.end_time, b.status, b.price, b.cancel_token,
                b.barber_id, b.service_id, b.rescheduled,
                s.name as service_name, s.duration as service_duration,
                br.name as barber_name, br.photo_url as barber_photo
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         JOIN barbers br ON b.barber_id = br.id
         WHERE b.id = $1 AND b.cancel_token = $2 AND b.deleted_at IS NULL`,
        [req.params.id, req.query.token]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Rendez-vous introuvable');
      }

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/bookings/:id/cancel — Cancel a booking
// ============================================
router.post('/bookings/:id/cancel',
  publicLimiter,
  [
    param('id').matches(uuidRegex).withMessage('ID invalide'),
    body('token').matches(uuidRegex).withMessage('Token invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await bookingService.cancelBooking(req.params.id, req.body.token);
      res.json({ message: 'Rendez-vous annulé avec succès', booking: result });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/bookings/:id/reschedule — Reschedule a booking (public, via cancel_token)
// ============================================
router.post('/bookings/:id/reschedule',
  publicLimiter,
  [
    param('id').matches(uuidRegex).withMessage('ID invalide'),
    body('token').matches(uuidRegex).withMessage('Token invalide'),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide (format: YYYY-MM-DD)')
      .custom((val) => !isNaN(new Date(val + 'T00:00:00').getTime())).withMessage('Date invalide'),
    body('start_time').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Heure invalide (format: HH:MM)'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await bookingService.rescheduleBooking(
        req.params.id,
        req.body.token,
        req.body.date,
        req.body.start_time
      );
      res.json({ message: 'Rendez-vous déplacé avec succès', booking: result });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/bookings/:id/ics — Download ICS calendar file
// ============================================
router.get('/bookings/:id/ics',
  publicLimiter,
  [
    param('id').matches(uuidRegex).withMessage('ID invalide'),
    query('token').matches(uuidRegex).withMessage('Token invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT b.id, b.date, b.start_time, b.end_time,
                s.name as service_name, br.name as barber_name
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         JOIN barbers br ON b.barber_id = br.id
         WHERE b.id = $1 AND b.cancel_token = $2 AND b.deleted_at IS NULL`,
        [req.params.id, req.query.token]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Rendez-vous introuvable');
      }

      const icsContent = generateICS(result.rows[0]);

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline; filename="barberclub-rdv.ics"');
      res.send(icsContent);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/waitlist — Public: join waitlist when no slots available
// ============================================
router.post('/waitlist',
  publicLimiter,
  optionalAuth,
  [
    body('barber_id').matches(uuidRegex).withMessage('Barber ID invalide'),
    body('service_id').matches(uuidRegex).withMessage('Service ID invalide'),
    body('preferred_date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide'),
    body('client_name').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('client_phone').optional({ values: 'falsy' }).trim()
      .matches(/^(\+33|0)[1-9]\d{8}$/).withMessage('Numero de telephone francais invalide'),
    body('preferred_time_start').optional({ values: 'falsy' }).matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('preferred_time_end').optional({ values: 'falsy' }).matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('salon_id').optional().isIn(['meylan', 'grenoble']).withMessage('Salon invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { barber_id, service_id, preferred_date, preferred_time_start, preferred_time_end } = req.body;
      const salonId = req.body.salon_id || 'meylan';
      let { client_name, client_phone } = req.body;

      // Resolve client info: authenticated client → fetch from DB
      let clientId = null;
      if (req.user && req.user.type === 'client') {
        const clientResult = await db.query(
          'SELECT id, first_name, last_name, phone FROM clients WHERE id = $1 AND deleted_at IS NULL',
          [req.user.id]
        );
        if (clientResult.rows.length === 0) {
          throw ApiError.notFound('Client introuvable');
        }
        const client = clientResult.rows[0];
        clientId = client.id;
        client_name = `${client.first_name} ${client.last_name}`;
        client_phone = client.phone;
      } else {
        // Guest: require name + phone
        if (!client_name || !client_phone) {
          throw ApiError.badRequest('Nom et telephone requis pour les invites');
        }
      }

      // Validate date is not in the past
      const reqDate = new Date(preferred_date + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (reqDate < today) {
        throw ApiError.badRequest('La date ne peut pas etre dans le passe');
      }

      // Validate barber works on this day (skip silently if not — for "any" barber mode)
      const jsDay = reqDate.getDay();
      const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // 0=Monday convention
      const barberSchedule = await db.query(
        `SELECT is_working FROM schedules
         WHERE barber_id = $1 AND day_of_week = $2 AND salon_id = $3`,
        [barber_id, dayOfWeek, salonId]
      );
      if (barberSchedule.rows.length > 0 && !barberSchedule.rows[0].is_working) {
        // Barber doesn't work this day — skip silently (return success to not break "any" barber loop)
        return res.status(201).json({
          message: 'Barber ne travaille pas ce jour',
          skipped: true,
        });
      }

      // Check for duplicate: same phone + barber + date already waiting
      const existing = await db.query(
        `SELECT id FROM waitlist
         WHERE client_phone = $1 AND barber_id = $2 AND preferred_date = $3 AND status = 'waiting'`,
        [client_phone, barber_id, preferred_date]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Vous etes deja en liste d\'attente pour ce barber a cette date.' });
      }

      const result = await db.query(
        `INSERT INTO waitlist (client_id, client_name, client_phone, barber_id, service_id, preferred_date, preferred_time_start, preferred_time_end, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, status, created_at`,
        [clientId, client_name, client_phone, barber_id, service_id, preferred_date, preferred_time_start || null, preferred_time_end || null, salonId]
      );

      res.status(201).json({
        message: 'Vous serez prevenu par SMS si une place se libere.',
        waitlist_id: result.rows[0].id,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
