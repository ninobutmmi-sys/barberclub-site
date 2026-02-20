const crypto = require('crypto');
const db = require('../config/database');
const { ApiError } = require('../utils/errors');
const availability = require('./availability');
const notification = require('./notification');
const logger = require('../utils/logger');

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
  return db.transaction(async (client) => {
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
        service.duration
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

    // 4. Check slot is still free (with row lock)
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

    // 5. Find or create client by phone OR email (centralizes client data)
    let clientResult = await client.query(
      'SELECT id FROM clients WHERE (phone = $1 OR (email = $2 AND email IS NOT NULL AND email != \'\')) AND deleted_at IS NULL LIMIT 1',
      [data.phone, data.email || '']
    );

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

    // 6. Check if first visit (for NEW badge)
    const existingBookings = await client.query(
      'SELECT 1 FROM bookings WHERE client_id = $1 AND deleted_at IS NULL AND status != $2 LIMIT 1',
      [clientId, 'cancelled']
    );
    const isFirstVisit = existingBookings.rows.length === 0;

    // 7. Insert the booking
    const bookingResult = await client.query(
      `INSERT INTO bookings (client_id, barber_id, service_id, date, start_time, end_time, price, source, recurrence_group_id, is_first_visit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [clientId, barberId, data.service_id, data.date, data.start_time, endTime, service.price, data.source || 'online', data.recurrence_group_id || null, isFirstVisit]
    );

    const booking = bookingResult.rows[0];

    logger.info('Booking created', {
      bookingId: booking.id,
      barberId,
      date: data.date,
      time: data.start_time,
      source: data.source || 'online',
    });

    // 7. Queue confirmation email (async — don't block the booking)
    try {
      await notification.queueNotification(booking.id, 'confirmation_email');
    } catch (err) {
      logger.error('Failed to queue confirmation email', { bookingId: booking.id, error: err.message });
      // Don't throw — booking is confirmed regardless
    }

    // Return full booking details
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
    };
  });
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
    ? Math.min(recurrence.occurrences || 6, 52)
    : 52; // safety cap
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
  // Find the booking
  const result = await db.query(
    `SELECT b.*, s.name as service_name, br.name as barber_name
     FROM bookings b
     JOIN services s ON b.service_id = s.id
     JOIN barbers br ON b.barber_id = br.id
     WHERE b.id = $1 AND b.cancel_token = $2 AND b.deleted_at IS NULL`,
    [bookingId, cancelToken]
  );

  if (result.rows.length === 0) {
    throw ApiError.notFound('Rendez-vous introuvable');
  }

  const booking = result.rows[0];

  if (booking.status === 'cancelled') {
    throw ApiError.badRequest('Ce rendez-vous a déjà été annulé');
  }

  if (booking.status !== 'confirmed') {
    throw ApiError.badRequest('Ce rendez-vous ne peut plus être annulé');
  }

  // Check 12-hour cancellation window
  const bookingDateTime = new Date(`${booking.date}T${booking.start_time}`);
  const now = new Date();
  const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);

  if (hoursUntil < 12) {
    throw ApiError.badRequest(
      'Les annulations doivent être effectuées au moins 12 heures avant le rendez-vous'
    );
  }

  // Cancel it
  await db.query(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = $1`,
    [bookingId]
  );

  logger.info('Booking cancelled', { bookingId, date: booking.date, time: booking.start_time });

  // Check waitlist — notify clients waiting for this barber/date
  try {
    const waitlistEntries = await db.query(
      `SELECT id, client_name, client_phone FROM waitlist
       WHERE barber_id = $1 AND preferred_date = $2 AND status = 'waiting'
       ORDER BY created_at ASC LIMIT 1`,
      [booking.barber_id, booking.date]
    );
    if (waitlistEntries.rows.length > 0) {
      const entry = waitlistEntries.rows[0];
      await db.query('UPDATE waitlist SET status = $1, notified_at = NOW() WHERE id = $2', ['notified', entry.id]);
      logger.info('Waitlist client notified of cancellation', { waitlistId: entry.id, phone: entry.client_phone });
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

module.exports = {
  createBooking,
  createRecurringBookings,
  cancelBooking,
  updateBookingStatus,
  getBookingDetails,
};
