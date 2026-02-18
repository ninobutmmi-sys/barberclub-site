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

    // 5. Find or create client by phone
    let clientResult = await client.query(
      'SELECT id FROM clients WHERE phone = $1 AND deleted_at IS NULL',
      [data.phone]
    );

    let clientId;
    if (clientResult.rows.length > 0) {
      clientId = clientResult.rows[0].id;
      // Update name if provided (client may have corrected it)
      await client.query(
        'UPDATE clients SET first_name = $1, last_name = $2 WHERE id = $3',
        [data.first_name, data.last_name, clientId]
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

    // Update email if provided and client doesn't have one
    if (data.email) {
      await client.query(
        'UPDATE clients SET email = $1 WHERE id = $2 AND (email IS NULL OR email = $3)',
        [data.email, clientId, '']
      );
    }

    // 6. Insert the booking
    const bookingResult = await client.query(
      `INSERT INTO bookings (client_id, barber_id, service_id, date, start_time, end_time, price, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [clientId, barberId, data.service_id, data.date, data.start_time, endTime, service.price, data.source || 'online']
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

  // Check 2-hour window
  const bookingDateTime = new Date(`${booking.date}T${booking.start_time}`);
  const now = new Date();
  const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);

  if (hoursUntil < 2) {
    throw ApiError.badRequest(
      'Les annulations doivent être effectuées au moins 2 heures avant le rendez-vous'
    );
  }

  // Cancel it
  await db.query(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = $1`,
    [bookingId]
  );

  logger.info('Booking cancelled', { bookingId, date: booking.date, time: booking.start_time });

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
  cancelBooking,
  updateBookingStatus,
  getBookingDetails,
};
