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

const router = Router();

// UUID-shaped regex (accepts non-standard UUIDs like our seed data)
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/barbers — List active barbers
// ============================================
router.get('/barbers', publicLimiter, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, role, photo_url
       FROM barbers
       WHERE is_active = true AND deleted_at IS NULL
       ORDER BY sort_order`
    );
    // Attach off-days for each barber (day_of_week where is_working=false)
    const schedResult = await db.query(
      `SELECT barber_id, day_of_week FROM schedules WHERE is_working = false`
    );
    const offMap = {};
    for (const row of schedResult.rows) {
      if (!offMap[row.barber_id]) offMap[row.barber_id] = [];
      offMap[row.barber_id].push(row.day_of_week);
    }
    const barbers = result.rows.map((b) => ({
      ...b,
      off_days: offMap[b.id] || [],
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
  [query('barber_id').optional().custom((val) => val === 'any' || uuidRegex.test(val)).withMessage('Barber ID invalide')],
  handleValidation,
  async (req, res, next) => {
  try {
    const { barber_id } = req.query;

    let queryText;
    let params;

    if (barber_id && barber_id !== 'any') {
      // Services offered by this specific barber
      queryText = `
        SELECT s.id, s.name, s.price, s.duration
        FROM services s
        JOIN barber_services bs ON s.id = bs.service_id
        WHERE bs.barber_id = $1 AND s.is_active = true AND s.deleted_at IS NULL
        ORDER BY s.sort_order`;
      params = [barber_id];
    } else {
      // All active services
      queryText = `
        SELECT id, name, price, duration
        FROM services
        WHERE is_active = true AND deleted_at IS NULL
        ORDER BY sort_order`;
      params = [];
    }

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

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
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { barber_id, service_id, date } = req.query;

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

      // If date is today, filter out past slots
      const isToday = requestedDate.getTime() === today.getTime();

      const slots = await availabilityService.getAvailableSlots(
        barber_id || 'any',
        service_id,
        date
      );

      if (isToday) {
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const filtered = slots.filter((slot) => {
          const [h, m] = slot.time.split(':').map(Number);
          return h * 60 + m > currentMinutes;
        });
        return res.json(filtered);
      }

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
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      let bookingData = { ...req.body, source: 'online' };

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
      res.setHeader('Content-Disposition', 'attachment; filename="barberclub-rdv.ics"');
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
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { barber_id, service_id, preferred_date, preferred_time_start, preferred_time_end } = req.body;
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
        `INSERT INTO waitlist (client_id, client_name, client_phone, barber_id, service_id, preferred_date, preferred_time_start, preferred_time_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, status, created_at`,
        [clientId, client_name, client_phone, barber_id, service_id, preferred_date, preferred_time_start || null, preferred_time_end || null]
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
