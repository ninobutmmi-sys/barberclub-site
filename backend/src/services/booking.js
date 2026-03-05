const crypto = require('crypto');
const db = require('../config/database');
const { ApiError } = require('../utils/errors');
const availability = require('./availability');
const notification = require('./notification');
const logger = require('../utils/logger');
const config = require('../config/env');
const {
  MAX_BOOKING_ADVANCE_MONTHS,
  CANCELLATION_DEADLINE_HOURS,
  MIN_BOOKING_LEAD_MINUTES,
  SMS_CONFIRMATION_THRESHOLD_HOURS,
  MAX_RECURRENCE_OCCURRENCES,
} = require('../constants');

/**
 * Create a new booking with atomic transaction
 * Prevents double booking via SELECT ... FOR UPDATE + unique index
 *
 * @param {object} data
 * @param {string} data.barber_id - Barber UUID or 'any'
 * @param {string} data.service_id - Service UUID
 * @param {string} data.date - YYYY-MM-DD
 * @param {string} data.start_time - HH:MM
 * @param {string} data.first_name
 * @param {string} data.last_name
 * @param {string} data.phone
 * @param {string|null} data.email
 * @param {string} data.source - 'online' or 'manual'
 * @returns {object} Created booking with details
 */
async function createBooking(data) {
  const isAdmin = data.source === 'manual';
  const salonId = data.salon_id || 'meylan';

  let result;
  try {
  result = await db.transaction(async (client) => {
    // 0. Validate date/time is not in the past and not too far in the future (client bookings only)
    if (!isAdmin) {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const requestedDate = new Date(data.date + 'T00:00:00');
      if (requestedDate < today) {
        throw ApiError.badRequest('Impossible de réserver dans le passé');
      }
      // Reject bookings starting within MIN_BOOKING_LEAD_MINUTES
      const minBookingTime = new Date(now.getTime() + MIN_BOOKING_LEAD_MINUTES * 60 * 1000);
      const requestedDateTime = new Date(`${data.date}T${data.start_time}:00`);
      if (requestedDateTime < minBookingTime) {
        throw ApiError.badRequest(`Impossible de réserver un créneau dans moins de ${MIN_BOOKING_LEAD_MINUTES} minutes`);
      }
      const maxDate = new Date(today);
      maxDate.setMonth(maxDate.getMonth() + MAX_BOOKING_ADVANCE_MONTHS);
      if (requestedDate > maxDate) {
        throw ApiError.badRequest(`Impossible de réserver plus de ${MAX_BOOKING_ADVANCE_MONTHS} mois à l'avance`);
      }
    }

    // 1. Get service details (price, duration)
    const serviceResult = await client.query(
      'SELECT id, name, price, duration FROM services WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
      [data.service_id]
    );
    if (serviceResult.rows.length === 0) {
      throw ApiError.badRequest('Prestation introuvable ou inactive');
    }
    const service = serviceResult.rows[0];

    // 2. Resolve barber (handle 'any' mode)
    let barberId = data.barber_id;
    let barberName;

    if (barberId === 'any') {
      const best = await availability.findBestBarber(
        data.service_id,
        data.date,
        data.start_time,
        service.duration,
        salonId,
        client
      );
      if (!best) {
        throw ApiError.conflict('Aucun barber disponible pour ce créneau');
      }
      barberId = best.id;
      barberName = best.name;
    } else {
      // Verify barber exists and offers this service
      const barberResult = await client.query(
        `SELECT b.id, b.name FROM barbers b
         JOIN barber_services bs ON b.id = bs.barber_id
         WHERE b.id = $1 AND bs.service_id = $2
           AND b.is_active = true AND b.deleted_at IS NULL`,
        [barberId, data.service_id]
      );
      if (barberResult.rows.length === 0) {
        throw ApiError.badRequest('Ce barber ne propose pas cette prestation');
      }
      barberName = barberResult.rows[0].name;
    }

    // 3. Calculate end time
    const endTime = availability.addMinutesToTime(data.start_time, service.duration);

    // 3b. Validate barber schedule (client bookings only — admin can override)
    if (!isAdmin) {
      await availability.validateBarberSlot(client, barberId, data.date, data.start_time, endTime);

      // Prevent client double-booking (same client, overlapping time, same day)
      const clientDoubleCheck = await client.query(
        `SELECT id FROM bookings
         WHERE date = $1 AND status = 'confirmed' AND deleted_at IS NULL
           AND start_time < $2 AND end_time > $3
           AND client_id IN (SELECT id FROM clients WHERE phone = $4 AND deleted_at IS NULL)`,
        [data.date, endTime, data.start_time, data.phone]
      );
      if (clientDoubleCheck.rows.length > 0) {
        throw ApiError.conflict('Vous avez déjà un rendez-vous sur ce créneau');
      }
    }

    // 4. Serialize booking attempts for same barber+date (advisory lock)
    // Prevents two concurrent transactions from both seeing an empty slot and inserting
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1 || $2))`,
      [barberId, data.date]
    );

    // Check slot is still free (with row lock)
    const slotFree = await availability.isSlotAvailable(
      barberId,
      data.date,
      data.start_time,
      service.duration,
      client
    );
    if (!slotFree) {
      throw ApiError.conflict('Ce créneau vient d\'être pris par un autre client. Veuillez en choisir un autre.');
    }

    // 5. Find or create client — prioritize phone (unique primary identifier)
    let clientResult = await client.query(
      'SELECT id FROM clients WHERE phone = $1 AND deleted_at IS NULL LIMIT 1',
      [data.phone]
    );

    // If not found by phone, try email
    if (clientResult.rows.length === 0 && data.email) {
      clientResult = await client.query(
        'SELECT id FROM clients WHERE email = $1 AND email IS NOT NULL AND deleted_at IS NULL LIMIT 1',
        [data.email]
      );
    }

    let clientId;
    if (clientResult.rows.length > 0) {
      clientId = clientResult.rows[0].id;
      // Update client info (name, phone, email) — keeps data fresh
      await client.query(
        'UPDATE clients SET first_name = $1, last_name = $2, phone = $3, email = COALESCE($4, email) WHERE id = $5',
        [data.first_name, data.last_name, data.phone, data.email || null, clientId]
      );
    } else {
      // Create new client
      const newClient = await client.query(
        `INSERT INTO clients (first_name, last_name, phone, email)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [data.first_name, data.last_name, data.phone, data.email || null]
      );
      clientId = newClient.rows[0].id;
    }

    // 5b. Link client to salon (for per-salon campaigns)
    await client.query(
      `INSERT INTO client_salons (client_id, salon_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [clientId, salonId]
    );

    // 6. Check if first visit (for NEW badge)
    const existingBookings = await client.query(
      'SELECT 1 FROM bookings WHERE client_id = $1 AND deleted_at IS NULL AND status != $2 LIMIT 1',
      [clientId, 'cancelled']
    );
    const isFirstVisit = existingBookings.rows.length === 0;

    // 7. Insert the booking
    const bookingResult = await client.query(
      `INSERT INTO bookings (client_id, barber_id, service_id, date, start_time, end_time, price, source, recurrence_group_id, is_first_visit, color, salon_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [clientId, barberId, data.service_id, data.date, data.start_time, endTime, service.price, data.source || 'online', data.recurrence_group_id || null, isFirstVisit, data.color || null, salonId]
    );

    const booking = bookingResult.rows[0];

    logger.info('Booking created', {
      bookingId: booking.id,
      barberId,
      date: data.date,
      time: data.start_time,
      source: data.source || 'online',
    });

    // Check if client has an account (for "claim account" prompt on frontend)
    const accountCheck = await client.query(
      'SELECT has_account FROM clients WHERE id = $1',
      [clientId]
    );
    const hasAccount = accountCheck.rows[0]?.has_account || false;

    // Return full booking details (notification queued after commit)
    return {
      id: booking.id,
      client_id: clientId,
      barber_id: barberId,
      barber_name: barberName,
      service_id: data.service_id,
      service_name: service.name,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      price: booking.price,
      status: booking.status,
      cancel_token: booking.cancel_token,
      source: booking.source,
      created_at: booking.created_at,
      has_account: hasAccount,
    };
  });
  } catch (err) {
    // Unique constraint violation
    if (err.code === '23505') {
      // Client phone/email conflict (not a slot conflict)
      if (err.constraint && err.constraint.includes('client')) {
        throw ApiError.conflict('Un compte client existe déjà avec ce numéro ou cet email. Essayez de vous connecter.');
      }
      // Booking slot conflict (race condition)
      throw ApiError.conflict('Ce créneau vient d\'être pris par un autre client. Veuillez en choisir un autre.');
    }
    throw err;
  }

  // Send notifications DIRECTLY after transaction commit
  // (direct sends are more reliable than queue — consistent with reschedule/cancel emails)
  let bookingDetails;
  try {
    bookingDetails = await getBookingDetails(result.id);
  } catch (err) {
    logger.error('Failed to fetch booking details for notifications', { bookingId: result.id, error: err.message });
  }

  if (bookingDetails) {
    // 1. Confirmation email
    if (bookingDetails.client_email) {
      try {
        await notification.sendConfirmationEmail({
          booking_id: result.id,
          cancel_token: result.cancel_token,
          email: bookingDetails.client_email,
          first_name: bookingDetails.client_first_name,
          service_name: bookingDetails.service_name,
          barber_name: bookingDetails.barber_name,
          date: bookingDetails.date,
          start_time: bookingDetails.start_time,
          price: bookingDetails.price,
          salon_id: salonId,
        });
        logger.info('Confirmation email sent directly', { bookingId: result.id });
      } catch (err) {
        logger.error('Direct confirmation email failed, queueing for retry', { bookingId: result.id, error: err.message });
        try { await notification.queueNotification(result.id, 'confirmation_email'); } catch (qErr) {
          logger.error('Failed to queue confirmation email fallback', { bookingId: result.id, error: qErr.message });
        }
      }
    }

    // 2. SMS confirmation if booking is within 24h
    const smsNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const [smsY, smsM, smsD] = result.date.split('-').map(Number);
    const [smsH, smsMn] = result.start_time.slice(0, 5).split(':').map(Number);
    const smsBookingDateTime = new Date(smsY, smsM - 1, smsD, smsH, smsMn, 0);
    const hoursUntilBooking = (smsBookingDateTime - smsNow) / (1000 * 60 * 60);

    if (hoursUntilBooking > 0 && hoursUntilBooking <= SMS_CONFIRMATION_THRESHOLD_HOURS && bookingDetails.client_phone) {
      try {
        await notification.sendConfirmationSMS({
          booking_id: result.id,
          cancel_token: result.cancel_token,
          phone: bookingDetails.client_phone,
          barber_name: bookingDetails.barber_name,
          date: bookingDetails.date,
          start_time: bookingDetails.start_time,
          salon_id: salonId,
        });
        await db.query('UPDATE bookings SET reminder_sent = true WHERE id = $1', [result.id]);
        logger.info('Confirmation SMS sent (booking within 24h)', { bookingId: result.id, hoursUntil: Math.round(hoursUntilBooking) });
      } catch (err) {
        logger.error('Confirmation SMS failed', { bookingId: result.id, error: err.message });
      }
    }
  }

  return result;
}

/**
 * Compute recurring dates from a start date
 * @param {string} startDate - YYYY-MM-DD
 * @param {object} recurrence
 * @param {string} recurrence.type - 'weekly' | 'biweekly' | 'monthly'
 * @param {string} recurrence.end_type - 'occurrences' | 'end_date'
 * @param {number} [recurrence.occurrences] - total bookings including first
 * @param {string} [recurrence.end_date] - YYYY-MM-DD
 * @returns {string[]} Array of date strings YYYY-MM-DD (excluding startDate)
 */
function computeRecurringDates(startDate, recurrence) {
  const dates = [];
  const start = new Date(startDate + 'T00:00:00');
  const maxOccurrences = recurrence.end_type === 'occurrences'
    ? Math.min(recurrence.occurrences || 6, MAX_RECURRENCE_OCCURRENCES)
    : MAX_RECURRENCE_OCCURRENCES; // safety cap
  const endDate = recurrence.end_type === 'end_date' && recurrence.end_date
    ? new Date(recurrence.end_date + 'T23:59:59')
    : null;

  for (let i = 1; i < maxOccurrences; i++) {
    let next;
    if (recurrence.type === 'weekly') {
      next = new Date(start);
      next.setDate(start.getDate() + 7 * i);
    } else if (recurrence.type === 'biweekly') {
      next = new Date(start);
      next.setDate(start.getDate() + 14 * i);
    } else if (recurrence.type === 'monthly') {
      next = new Date(start);
      next.setMonth(start.getMonth() + i);
      // Handle month overflow (e.g. Jan 31 → Mar 3 → clamp to Feb 28)
      if (next.getDate() !== start.getDate()) {
        next.setDate(0); // last day of previous month
      }
    } else {
      break;
    }

    if (endDate && next > endDate) break;

    const yyyy = next.getFullYear();
    const mm = String(next.getMonth() + 1).padStart(2, '0');
    const dd = String(next.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }

  return dates;
}

/**
 * Create recurring bookings
 * Creates the first booking normally, then attempts each subsequent date.
 * Skips dates where the slot is already taken.
 *
 * @param {object} data - Same as createBooking data
 * @param {object} recurrence - { type, end_type, occurrences?, end_date? }
 * @returns {{ created: object[], skipped: { date: string, reason: string }[] }}
 */
async function createRecurringBookings(data, recurrence) {
  const groupId = crypto.randomUUID();
  const futureDates = computeRecurringDates(data.date, recurrence);
  const allDates = [data.date, ...futureDates];

  const created = [];
  const skipped = [];

  for (const date of allDates) {
    try {
      const booking = await createBooking({
        ...data,
        date,
        recurrence_group_id: groupId,
      });
      created.push(booking);
    } catch (err) {
      // If slot conflict, skip this date silently
      if (err.status === 409 || err.statusCode === 409) {
        skipped.push({ date, reason: 'Créneau déjà pris' });
        logger.info('Recurring booking skipped (conflict)', { date, time: data.start_time, groupId });
      } else {
        // For other errors, also skip but log
        skipped.push({ date, reason: err.message });
        logger.warn('Recurring booking skipped (error)', { date, error: err.message, groupId });
      }
    }
  }

  logger.info('Recurring bookings created', {
    groupId,
    total: allDates.length,
    created: created.length,
    skipped: skipped.length,
  });

  return { created, skipped, recurrence_group_id: groupId };
}

/**
 * Cancel a booking by cancel_token
 * Enforces 2-hour minimum cancellation window
 */
async function cancelBooking(bookingId, cancelToken) {
  // Use transaction with FOR UPDATE to prevent race condition (double-click / parallel requests)
  const booking = await db.transaction(async (client) => {
    // 1. Lock the booking row
    const result = await client.query(
      `SELECT b.*, b.salon_id, s.name as service_name, br.name as barber_name,
              c.first_name, c.email as client_email
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN barbers br ON b.barber_id = br.id
       JOIN clients c ON b.client_id = c.id
       WHERE b.id = $1 AND b.cancel_token = $2 AND b.deleted_at IS NULL
       FOR UPDATE OF b`,
      [bookingId, cancelToken]
    );

    if (result.rows.length === 0) {
      throw ApiError.notFound('Rendez-vous introuvable');
    }

    const bk = result.rows[0];

    if (bk.status === 'cancelled') {
      throw ApiError.badRequest('Ce rendez-vous a déjà été annulé');
    }

    if (bk.status !== 'confirmed') {
      throw ApiError.badRequest('Ce rendez-vous ne peut plus être annulé');
    }

    // 2. Check cancellation deadline (Paris timezone, consistent with reschedule)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const [bkY, bkM, bkD] = bk.date.split('-').map(Number);
    const [bkH, bkMn] = bk.start_time.slice(0, 5).split(':').map(Number);
    const bookingDateTime = new Date(bkY, bkM - 1, bkD, bkH, bkMn, 0);
    const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);

    if (hoursUntil < CANCELLATION_DEADLINE_HOURS) {
      throw ApiError.badRequest(
        `Les annulations doivent être effectuées au moins ${CANCELLATION_DEADLINE_HOURS} heures avant le rendez-vous`
      );
    }

    // 3. Cancel it (inside transaction — atomic)
    await client.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1`,
      [bookingId]
    );

    return bk;
  });

  logger.info('Booking cancelled', { bookingId, date: booking.date, time: booking.start_time });

  // Send cancellation email (with retry fallback) — outside transaction
  const cancelEmailData = {
    email: booking.client_email,
    first_name: booking.first_name,
    service_name: booking.service_name,
    barber_name: booking.barber_name,
    date: booking.date,
    start_time: booking.start_time,
    price: booking.price,
    salon_id: booking.salon_id || 'meylan',
  };
  try {
    await notification.sendCancellationEmail(cancelEmailData);
  } catch (err) {
    logger.error('Cancellation email failed, retrying once...', { bookingId, error: err.message });
    notification.sendCancellationEmail(cancelEmailData).catch(
      (e) => logger.error('Cancellation email retry failed', { bookingId, error: e.message })
    );
  }

  // Check waitlist — notify clients waiting for this barber/date/time
  try {
    const salonId = booking.salon_id || 'meylan';
    const salon = config.getSalonConfig(salonId);
    const bookingUrl = `${config.siteUrl}${salon.bookingPath}/reserver.html`;

    // Match waitlist entries for same barber + date, optionally overlapping time
    const waitlistEntries = await db.query(
      `SELECT w.id, w.client_name, w.client_phone, w.preferred_date,
              w.preferred_time_start, w.preferred_time_end,
              b.name as barber_name, s.name as service_name
       FROM waitlist w
       JOIN barbers b ON w.barber_id = b.id
       JOIN services s ON w.service_id = s.id
       WHERE w.barber_id = $1 AND w.preferred_date = $2 AND w.status = 'waiting'
         AND (w.preferred_time_start IS NULL OR w.preferred_time_start <= $3)
         AND (w.preferred_time_end IS NULL OR w.preferred_time_end >= $3)
       ORDER BY w.created_at ASC LIMIT 3`,
      [booking.barber_id, booking.date, booking.start_time.slice(0, 5)]
    );

    // Format cancelled slot info for SMS
    const dateParts = booking.date.split('-');
    const dateFormatted = `${dateParts[2]}/${dateParts[1]}`;
    const timeFormatted = booking.start_time.slice(0, 5);

    for (const entry of waitlistEntries.rows) {
      const smsText = `${salon.name} - Bonne nouvelle ${entry.client_name || ''} ! `
        + `Un creneau s'est libere le ${dateFormatted} a ${timeFormatted} `
        + `avec ${entry.barber_name} pour ${entry.service_name}. `
        + `Reserve vite : ${bookingUrl}`;

      try {
        await notification.sendWaitlistSMS({ phone: entry.client_phone, message: smsText, salon_id: salonId });
        await db.query("UPDATE waitlist SET status = 'notified', notified_at = NOW() WHERE id = $1", [entry.id]);
        logger.info('Waitlist SMS sent after cancellation', { waitlistId: entry.id, phone: entry.client_phone, salonId });
      } catch (smsErr) {
        logger.error('Waitlist SMS failed', { waitlistId: entry.id, error: smsErr.message });
      }
    }
  } catch (err) {
    logger.error('Failed to check waitlist after cancellation', { error: err.message });
  }

  return {
    ...booking,
    status: 'cancelled',
    cancelled_at: new Date(),
  };
}

/**
 * Update booking status (completed / no_show) — admin only
 */
async function updateBookingStatus(bookingId, newStatus) {
  const validStatuses = ['completed', 'no_show', 'confirmed'];
  if (!validStatuses.includes(newStatus)) {
    throw ApiError.badRequest(`Statut invalide. Valeurs possibles : ${validStatuses.join(', ')}`);
  }

  const result = await db.query(
    `UPDATE bookings SET status = $1
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [newStatus, bookingId]
  );

  if (result.rows.length === 0) {
    throw ApiError.notFound('Rendez-vous introuvable');
  }

  logger.info('Booking status updated', { bookingId, newStatus });
  return result.rows[0];
}

/**
 * Get booking details by ID (with related data)
 */
async function getBookingDetails(bookingId) {
  const result = await db.query(
    `SELECT b.*,
            s.name as service_name, s.duration as service_duration,
            br.name as barber_name, br.photo_url as barber_photo,
            c.first_name as client_first_name, c.last_name as client_last_name,
            c.phone as client_phone, c.email as client_email
     FROM bookings b
     JOIN services s ON b.service_id = s.id
     JOIN barbers br ON b.barber_id = br.id
     JOIN clients c ON b.client_id = c.id
     WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [bookingId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Reschedule a booking by cancel_token (public, no auth needed)
 * Atomic: validates new slot, updates booking, regenerates cancel_token
 */
async function rescheduleBooking(bookingId, cancelToken, newDate, newStartTime) {
  const result = await db.transaction(async (client) => {
    // 1. Fetch booking with lock
    const bookingResult = await client.query(
      `SELECT b.*, s.name as service_name, s.duration as service_duration, s.price as service_price,
              br.name as barber_name,
              c.first_name, c.last_name, c.phone, c.email
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN barbers br ON b.barber_id = br.id
       JOIN clients c ON b.client_id = c.id
       WHERE b.id = $1 AND b.cancel_token = $2 AND b.deleted_at IS NULL
       FOR UPDATE OF b`,
      [bookingId, cancelToken]
    );

    if (bookingResult.rows.length === 0) {
      throw ApiError.notFound('Rendez-vous introuvable');
    }

    const booking = bookingResult.rows[0];

    if (booking.status !== 'confirmed') {
      throw ApiError.badRequest('Ce rendez-vous ne peut plus être modifié');
    }

    // 1b. Check if already rescheduled (limit: 1 reschedule per booking)
    if (booking.rescheduled) {
      throw ApiError.badRequest('Ce rendez-vous a déjà été décalé une fois. Vous pouvez toujours l\'annuler.');
    }

    // 2. Check cancellation/reschedule deadline (same as cancel)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const [rsY, rsM, rsD] = booking.date.split('-').map(Number);
    const [rsH, rsMn] = booking.start_time.slice(0, 5).split(':').map(Number);
    const bookingDateTime = new Date(rsY, rsM - 1, rsD, rsH, rsMn, 0);
    const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);

    if (hoursUntil < CANCELLATION_DEADLINE_HOURS) {
      throw ApiError.badRequest(
        `Les modifications doivent être effectuées au moins ${CANCELLATION_DEADLINE_HOURS} heures avant le rendez-vous`
      );
    }

    // 3. Validate new date is not in the past and not too far
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(newDate + 'T00:00:00');
    if (requestedDate < today) {
      throw ApiError.badRequest('Impossible de déplacer dans le passé');
    }
    const minBookingTime = new Date(now.getTime() + MIN_BOOKING_LEAD_MINUTES * 60 * 1000);
    const newDateTime = new Date(`${newDate}T${newStartTime}:00`);
    if (newDateTime < minBookingTime) {
      throw ApiError.badRequest(`Impossible de déplacer sur un créneau dans moins de ${MIN_BOOKING_LEAD_MINUTES} minutes`);
    }
    const maxDate = new Date(today);
    maxDate.setMonth(maxDate.getMonth() + MAX_BOOKING_ADVANCE_MONTHS);
    if (requestedDate > maxDate) {
      throw ApiError.badRequest(`Impossible de réserver plus de ${MAX_BOOKING_ADVANCE_MONTHS} mois à l'avance`);
    }

    // 4. Calculate new end time
    const newEndTime = availability.addMinutesToTime(newStartTime, booking.service_duration);

    // 5-6. Validate barber schedule + blocked slots for new date
    await availability.validateBarberSlot(client, booking.barber_id, newDate, newStartTime, newEndTime);

    // 7. Check new slot is available (excluding current booking)
    const conflictCheck = await client.query(
      `SELECT id FROM bookings
       WHERE barber_id = $1 AND date = $2
         AND status != 'cancelled' AND deleted_at IS NULL
         AND start_time < $3 AND end_time > $4
         AND id != $5
       FOR UPDATE`,
      [booking.barber_id, newDate, newEndTime, newStartTime, bookingId]
    );
    if (conflictCheck.rows.length > 0) {
      throw ApiError.conflict('Ce créneau est déjà pris');
    }

    // 8. Update booking (keep same cancel_token so original email link stays valid)
    const updateResult = await client.query(
      `UPDATE bookings
       SET date = $1, start_time = $2, end_time = $3, rescheduled = true
       WHERE id = $4
       RETURNING *`,
      [newDate, newStartTime, newEndTime, bookingId]
    );

    logger.info('Booking rescheduled', {
      bookingId,
      oldDate: booking.date,
      oldTime: booking.start_time.slice(0, 5),
      newDate,
      newTime: newStartTime,
    });

    return {
      booking: updateResult.rows[0],
      oldDate: booking.date,
      oldTime: booking.start_time,
      service_name: booking.service_name,
      barber_name: booking.barber_name,
      email: booking.email,
      first_name: booking.first_name,
      price: booking.service_price,
      cancelToken: booking.cancel_token,
      salonId: booking.salon_id || 'meylan',
    };
  });

  // Send reschedule email after transaction commit (with retry fallback)
  const rescheduleEmailData = {
    email: result.email,
    first_name: result.first_name,
    service_name: result.service_name,
    barber_name: result.barber_name,
    old_date: result.oldDate,
    old_time: result.oldTime,
    new_date: newDate,
    new_time: newStartTime,
    new_barber_name: result.barber_name,
    price: result.price,
    cancel_token: result.cancelToken,
    booking_id: bookingId,
    salon_id: result.salonId,
  };
  try {
    await notification.sendRescheduleEmail(rescheduleEmailData);
  } catch (err) {
    logger.error('Reschedule email failed, retrying once...', { bookingId, error: err.message });
    notification.sendRescheduleEmail(rescheduleEmailData).catch(
      (e) => logger.error('Reschedule email retry failed', { bookingId, error: e.message })
    );
  }

  return {
    id: bookingId,
    date: newDate,
    start_time: newStartTime,
    end_time: result.booking.end_time,
    status: result.booking.status,
    cancel_token: result.cancelToken,
    service_name: result.service_name,
    barber_name: result.barber_name,
    price: result.price,
  };
}

module.exports = {
  createBooking,
  createRecurringBookings,
  cancelBooking,
  rescheduleBooking,
  updateBookingStatus,
  getBookingDetails,
};
