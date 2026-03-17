const db = require('../config/database');
const config = require('../config/env');
const { queueNotification, formatDateFR, formatTime } = require('../services/notification');
const logger = require('../utils/logger');

/**
 * Queue SMS reminders exactly 24h before each booking.
 * Runs every 30 min — finds confirmed bookings starting in 23h30–24h30 window.
 * The queue processor (processQueue, every 1 min) handles actual sending + retries.
 */
async function queueReminders() {
  try {
    // Find bookings whose start datetime is 23.5h to 24.5h from now (Paris time)
    // Using PostgreSQL timestamp arithmetic for precision
    const result = await db.query(
      `SELECT b.id, b.date, b.start_time, b.cancel_token, b.salon_id,
              c.phone
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       WHERE b.status = 'confirmed'
         AND (b.reminder_sent = false OR b.reminder_sent IS NULL)
         AND b.deleted_at IS NULL
         AND c.phone IS NOT NULL
         AND (b.date::text || ' ' || b.start_time::text)::timestamp
             BETWEEN (NOW() AT TIME ZONE 'Europe/Paris') + INTERVAL '23 hours 30 minutes'
                 AND (NOW() AT TIME ZONE 'Europe/Paris') + INTERVAL '24 hours 30 minutes'`
    );

    if (result.rows.length === 0) {
      return;
    }

    let queued = 0;

    for (const booking of result.rows) {
      const salonId = booking.salon_id || 'meylan';
      const salon = config.getSalonConfig(salonId);
      const apiUrl = config.apiUrl || 'https://barberclub-grenoble.fr';
      const rdvUrl = `${apiUrl}/r/rdv/${booking.id}/${booking.cancel_token}`;
      const timeFormatted = formatTime(booking.start_time);
      const dateFR = formatDateFR(typeof booking.date === 'string' ? booking.date.slice(0, 10) : booking.date);
      const message = `${salon.name} - Rappel\n\nVotre RDV le ${dateFR} a ${timeFormatted} au ${salon.address}.\n\nGerer votre RDV : ${rdvUrl}`;

      try {
        // Mark BEFORE queuing to prevent duplicates on next cron run
        await db.query('UPDATE bookings SET reminder_sent = true WHERE id = $1', [booking.id]);
        await queueNotification(booking.id, 'reminder_sms', {
          phone: booking.phone,
          message,
          salonId,
        });
        queued++;
      } catch (err) {
        logger.error('Failed to queue reminder SMS', { bookingId: booking.id, error: err.message });
        // Revert reminder_sent so next cron picks it up
        await db.query('UPDATE bookings SET reminder_sent = false WHERE id = $1', [booking.id]).catch(() => {});
      }
    }

    logger.info(`SMS reminders (24h window): ${queued} queued`);
  } catch (error) {
    logger.error('Failed to queue reminders', { error: error.message });
  }
}

module.exports = { queueReminders };
