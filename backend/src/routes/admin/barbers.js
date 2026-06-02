const express = require('express');
const { Router } = require('express');
const { body, param, query } = require('express-validator');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const { queueNotification } = require('../../services/notification');
const logger = require('../../utils/logger');
const db = require('../../config/database');
const { BCRYPT_ROUNDS } = require('../../constants');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/barbers — All barbers (residents + guests for the current view)
// ============================================
router.get('/', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    // Resident barbers
    const result = await db.query(
      `SELECT id, name, role, photo_url, email, is_active, sort_order, salon_id, FALSE as is_guest
       FROM barbers WHERE deleted_at IS NULL AND salon_id = $1
       ORDER BY sort_order`,
      [salonId]
    );
    // Guest barbers with future assignments in this salon
    const guestResult = await db.query(
      `SELECT DISTINCT b.id, b.name, b.role, b.photo_url, b.email, b.is_active, b.sort_order, b.salon_id, TRUE as is_guest
       FROM barbers b
       JOIN guest_assignments ga ON b.id = ga.barber_id
       WHERE b.is_active = true AND b.deleted_at IS NULL
         AND ga.host_salon_id = $1 AND ga.date >= CURRENT_DATE
         AND b.salon_id != $1
       ORDER BY b.sort_order`,
      [salonId]
    );
    res.json([...result.rows, ...guestResult.rows]);
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/barbers/guest-assignments/list — All guest assignments for this salon
// (Must be defined BEFORE /:id routes to avoid param collision)
// ============================================
router.get('/guest-assignments/list', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const result = await db.query(
      `SELECT ga.id, ga.barber_id, ga.host_salon_id, ga.date, ga.start_time, ga.end_time,
              b.name as barber_name, b.salon_id as home_salon_id
       FROM guest_assignments ga
       JOIN barbers b ON ga.barber_id = b.id
       WHERE ga.date >= CURRENT_DATE
         AND (ga.host_salon_id = $1 OR b.salon_id = $1)
       ORDER BY ga.date`,
      [salonId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/admin/barbers — Create a new barber
// ============================================
router.post('/',
  express.json({ limit: '5mb' }),
  [
    body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Nom requis (max 100 caractères)'),
    body('role').optional().trim().isLength({ max: 200 }),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Email invalide'),
    body('photo_url').optional({ values: 'falsy' }).trim().isLength({ max: 3000000 }),
    body('schedules').isArray({ min: 7, max: 7 }).withMessage('7 horaires requis (lundi à dimanche)'),
    body('schedules.*.day_of_week').isInt({ min: 0, max: 6 }),
    body('schedules.*.is_working').isBoolean(),
    body('schedules.*.start_time').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('schedules.*.end_time').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('service_ids').optional().isArray(),
    body('service_ids.*').optional().matches(uuidRegex).withMessage('UUID service invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { name, role, email, photo_url, schedules, service_ids } = req.body;

      // Auto-generate email if not provided: name-slug@barberclub-{salonId}.fr
      let barberEmail = email;
      if (!barberEmail) {
        const slug = name
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
          .replace(/[^a-z0-9]+/g, '-')                       // non-alphanum -> dash
          .replace(/^-+|-+$/g, '');                           // trim dashes
        barberEmail = `${slug}@barberclub-${salonId}.fr`;
      }

      // Check email uniqueness
      const emailCheck = await db.query(
        'SELECT id FROM barbers WHERE email = $1 AND deleted_at IS NULL',
        [barberEmail]
      );
      if (emailCheck.rows.length > 0) {
        throw ApiError.conflict('Un barber avec cet email existe déjà');
      }

      // Generate random password hash (barbers don't login individually)
      const passwordHash = await bcrypt.hash(crypto.randomUUID(), BCRYPT_ROUNDS);

      // Get next sort_order
      const sortResult = await db.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM barbers WHERE salon_id = $1 AND deleted_at IS NULL',
        [salonId]
      );
      const nextSortOrder = sortResult.rows[0].next_order;

      // Transaction: INSERT barber + schedules + barber_services
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        const barberResult = await client.query(
          `INSERT INTO barbers (name, role, photo_url, email, password_hash, is_active, sort_order, salon_id)
           VALUES ($1, $2, $3, $4, $5, false, $6, $7)
           RETURNING id, name, role, photo_url, email, is_active, sort_order, salon_id`,
          [name, role || null, photo_url || null, barberEmail, passwordHash, nextSortOrder, salonId]
        );
        const barber = barberResult.rows[0];

        // Insert 7 schedules
        for (const schedule of schedules) {
          const startTime = schedule.is_working ? (schedule.start_time || '09:00').slice(0, 5) : '09:00';
          const endTime = schedule.is_working ? (schedule.end_time || '19:00').slice(0, 5) : '19:00';
          await client.query(
            `INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working, salon_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [barber.id, schedule.day_of_week, startTime, endTime, schedule.is_working, salonId]
          );
        }

        // Insert barber_services if provided
        if (service_ids && service_ids.length > 0) {
          for (const serviceId of service_ids) {
            await client.query(
              'INSERT INTO barber_services (barber_id, service_id) VALUES ($1, $2)',
              [barber.id, serviceId]
            );
          }
        }

        await client.query('COMMIT');

        res.status(201).json(barber);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/barbers/:id — Soft delete a barber
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const salonId = req.user.salon_id;

      // Verify barber belongs to this salon
      const barberCheck = await db.query(
        'SELECT id, name FROM barbers WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL',
        [id, salonId]
      );
      if (barberCheck.rows.length === 0) {
        throw ApiError.notFound('Barber introuvable');
      }

      const client = await db.pool.connect();
      let cancelledCount = 0;
      try {
        await client.query('BEGIN');

        // Soft delete the barber
        await client.query(
          'UPDATE barbers SET deleted_at = NOW(), is_active = false WHERE id = $1',
          [id]
        );

        // Cancel future confirmed bookings
        const cancelledBookings = await client.query(
          `UPDATE bookings SET status = 'cancelled', deleted_at = NOW()
           WHERE barber_id = $1 AND deleted_at IS NULL AND status = 'confirmed'
             AND (date > CURRENT_DATE OR (date = CURRENT_DATE AND start_time > LOCALTIME))
           RETURNING id, salon_id`,
          [id]
        );
        cancelledCount = cancelledBookings.rows.length;

        // Queue cancellation notifications for each cancelled booking
        for (const booking of cancelledBookings.rows) {
          await client.query(
            `INSERT INTO notification_queue (booking_id, type, status, channel, salon_id, next_retry_at)
             VALUES ($1, 'cancellation_email', 'pending', 'email', $2, NOW())`,
            [booking.id, booking.salon_id]
          );
        }

        // Cleanup: delete future guest assignments
        await client.query(
          'DELETE FROM guest_assignments WHERE barber_id = $1 AND date >= CURRENT_DATE',
          [id]
        );

        // Cleanup: delete future blocked slots
        await client.query(
          'DELETE FROM blocked_slots WHERE barber_id = $1 AND date >= CURRENT_DATE',
          [id]
        );

        // Cleanup: delete barber_services
        await client.query(
          'DELETE FROM barber_services WHERE barber_id = $1',
          [id]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      logger.info('Barber deleted', { barberId: id, name: barberCheck.rows[0].name, cancelledBookings: cancelledCount });

      res.json({ deleted: true, cancelled_bookings: cancelledCount });
    } catch (error) {
      next(error);
    }
  }
);

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

      values.push(id, req.user.salon_id);
      const result = await db.query(
        `UPDATE barbers SET ${fields.join(', ')}
         WHERE id = $${paramIndex} AND salon_id = $${paramIndex + 1} AND deleted_at IS NULL
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

      const salonId = req.user.salon_id;

      const schedules = await db.query(
        'SELECT * FROM schedules WHERE barber_id = $1 AND salon_id = $2 ORDER BY day_of_week',
        [id, salonId]
      );

      const overrides = await db.query(
        `SELECT * FROM schedule_overrides
         WHERE barber_id = $1 AND salon_id = $2 AND date >= CURRENT_DATE
         ORDER BY date`,
        [id, salonId]
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

      // Replace all schedules for this barber (in a transaction)
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        await client.query('DELETE FROM schedules WHERE barber_id = $1 AND salon_id = $2', [id, req.user.salon_id]);

        for (const schedule of schedules) {
          // Normalize times: strip seconds if present, default to 09:00/19:00 for rest days
          const startTime = schedule.is_working ? (schedule.start_time || '09:00').slice(0, 5) : '09:00';
          const endTime = schedule.is_working ? (schedule.end_time || '19:00').slice(0, 5) : '19:00';
          const breakStart = schedule.is_working && schedule.break_start ? schedule.break_start.slice(0, 5) : null;
          const breakEnd = schedule.is_working && schedule.break_end ? schedule.break_end.slice(0, 5) : null;
          await client.query(
            `INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working, salon_id, break_start, break_end)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, schedule.day_of_week, startTime, endTime, schedule.is_working, req.user.salon_id, breakStart, breakEnd]
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
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
    body('start_time').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('end_time').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('reason').optional().trim().isLength({ max: 500 }),
    body('end_time').custom((value, { req: r }) => {
      if (r.body.is_day_off === false || r.body.is_day_off === 'false') {
        if (r.body.start_time && value && value <= r.body.start_time) {
          throw new Error('L\'heure de fin doit être après l\'heure de début');
        }
      }
      return true;
    }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { date, is_day_off, start_time, end_time, reason } = req.body;

      const result = await db.query(
        `INSERT INTO schedule_overrides (barber_id, date, is_day_off, start_time, end_time, reason, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (barber_id, date) DO UPDATE SET
           is_day_off = $3, start_time = $4, end_time = $5, reason = $6
         RETURNING *`,
        [id, date, is_day_off, is_day_off ? null : start_time, is_day_off ? null : end_time, reason, req.user.salon_id]
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
      const salonId = req.user.salon_id;
      const result = await db.query(
        'DELETE FROM schedule_overrides WHERE id = $1 AND barber_id IN (SELECT id FROM barbers WHERE salon_id = $2) RETURNING id',
        [req.params.id, salonId]
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

// ============================================
// GET /api/admin/barbers/:id/guest-days — List guest assignments for a barber
// ============================================
router.get('/:id/guest-days',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT id, barber_id, host_salon_id, date, start_time, end_time, created_at
         FROM guest_assignments
         WHERE barber_id = $1 AND date >= CURRENT_DATE
         ORDER BY date`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/barbers/:id/guest-days — Add a guest day
// ============================================
router.post('/:id/guest-days',
  [
    param('id').matches(uuidRegex),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide'),
    body('host_salon_id').isIn(['meylan', 'grenoble']).withMessage('Salon invalide'),
    body('start_time').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Heure debut invalide'),
    body('end_time').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Heure fin invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { date, host_salon_id, start_time, end_time } = req.body;

      // Verify barber exists
      const barberCheck = await db.query(
        'SELECT id, salon_id FROM barbers WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
        [id]
      );
      if (barberCheck.rows.length === 0) {
        throw ApiError.notFound('Barber introuvable');
      }
      // Cannot be guest in own salon
      if (barberCheck.rows[0].salon_id === host_salon_id) {
        throw ApiError.badRequest('Le barber est deja dans ce salon');
      }

      const result = await db.query(
        `INSERT INTO guest_assignments (barber_id, host_salon_id, date, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (barber_id, date) DO UPDATE SET
           host_salon_id = $2, start_time = $4, end_time = $5
         RETURNING *`,
        [id, host_salon_id, date, (start_time || '09:00').slice(0, 5), (end_time || '19:00').slice(0, 5)]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/guest-days/:id — Remove a guest day
// ============================================
router.delete('/guest-days/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const result = await db.query(
        'DELETE FROM guest_assignments WHERE id = $1 AND (barber_id IN (SELECT id FROM barbers WHERE salon_id = $2) OR host_salon_id = $2) RETURNING id',
        [req.params.id, salonId]
      );
      if (result.rows.length === 0) {
        throw ApiError.notFound('Jour invite introuvable');
      }
      res.json({ message: 'Jour invite supprime' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
