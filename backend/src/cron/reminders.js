const db = require('../config/database');
const config = require('../config/env');
const { queueNotification, formatDateFR, formatTime, toGSM, isFrenchPhone } = require('../services/notification');
const logger = require('../utils/logger');

/**
 * Queue SMS reminders for bookings in the next 24h.
 * Runs every 30 min — catches ALL confirmed bookings from now to +24h
 * that haven't been reminded yet. Self-healing: if a run is missed
 * (deploy, restart), the next run catches up automatically.
 */
async function queueReminders() {
  try {
    // Find all confirmed bookings in the next 24h that haven't been reminded.
    // Skip bookings created < 2h ago (client just booked, doesn't need reminder yet).
    // Skip blacklisted phones (Brevo already told us they fail).
    // Uses wide window (now → +24h) so missed runs are automatically recovered.
    const result = await db.query(
      `SELECT b.id, b.date, b.start_time, b.cancel_token, b.salon_id,
              c.phone, c.email
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       LEFT JOIN sms_blacklist bl ON bl.phone = c.phone
       WHERE b.status = 'confirmed'
         AND b.deleted_at IS NULL
         AND (c.phone IS NOT NULL OR c.email IS NOT NULL)
         AND b.created_at < NOW() - INTERVAL '2 hours'
         AND (b.date::text || ' ' || b.start_time::text)::timestamp
             BETWEEN (NOW() AT TIME ZONE 'Europe/Paris')
                 AND (NOW() AT TIME ZONE 'Europe/Paris') + INTERVAL '24 hours'
         AND (
           NOT EXISTS (
             SELECT 1 FROM notification_queue nq
             WHERE nq.booking_id = b.id AND nq.type = 'reminder_sms'
               AND nq.status IN ('pending', 'processing', 'sent')
           )
           OR NOT EXISTS (
             SELECT 1 FROM notification_queue nq
             WHERE nq.booking_id = b.id AND nq.type = 'reminder_email'
               AND nq.status IN ('pending', 'processing', 'sent')
           )
         )
       ORDER BY b.date, b.start_time`,
    );

    if (result.rows.length === 0) {
      return;
    }

    let queued = 0;

    for (const booking of result.rows) {
      const salonId = booking.salon_id || 'meylan';
      const salon = config.getSalonConfig(salonId);
      const timeFormatted = formatTime(booking.start_time);
      // Date sans année pour SMS — économise 5 chars (RDV <24h, année implicite)
      const dateFRFull = formatDateFR(typeof booking.date === 'string' ? booking.date.slice(0, 10) : booking.date);
      const dateFR = dateFRFull.replace(/\s+\d{4}$/, '');

      try {
        // SMS for French phones — message court (~95 chars, 1 SMS unit garanti)
        // Format: "BarberClub Meylan - RDV demain Mardi 28 avril a 14:30. A bientot!"
        if (booking.phone && isFrenchPhone(booking.phone)) {
          const salonShort = salonId === 'meylan' ? 'Meylan' : 'Grenoble';
          const message = toGSM(`BarberClub ${salonShort} - RDV ${dateFR} a ${timeFormatted}. A bientot!`);
          await queueNotification(booking.id, 'reminder_sms', {
            phone: booking.phone,
            message,
            salonId,
          });
        } else if (booking.email) {
          // Email reminder ONLY for international phones (no SMS possible)
          await queueNotification(booking.id, 'reminder_email', {
            email: booking.email,
            salonId,
          });
        }

        queued++;
      } catch (err) {
        logger.error('Failed to queue reminder', { bookingId: booking.id, error: err.message });
      }
    }

    logger.info(`Reminders (24h window): ${queued} queued`);
  } catch (error) {
    logger.error('Failed to queue reminders', { error: error.message });
  }
}

module.exports = { queueReminders };
