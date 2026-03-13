const db = require('../config/database');
const config = require('../config/env');
const { queueNotification, formatDateFR, formatTime } = require('../services/notification');
const logger = require('../utils/logger');

/**
 * Queue SMS reminders for tomorrow's bookings.
 * Runs every day at 18:00 — builds messages and inserts into notification_queue.
 * The queue processor (processQueue, every 1 min) handles actual sending + retries.
 */
async function queueReminders() {
  try {
    const nowParis = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const tomorrow = new Date(nowParis);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const result = await db.query(
      `SELECT b.id, b.date, b.start_time, b.cancel_token, b.salon_id,
              c.phone
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       WHERE b.date = $1
         AND b.status = 'confirmed'
         AND (b.reminder_sent = false OR b.reminder_sent IS NULL)
         AND b.deleted_at IS NULL
         AND c.phone IS NOT NULL`,
      [tomorrowStr]
    );

    if (result.rows.length === 0) {
      logger.info('No reminders to send for tomorrow');
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

    logger.info(`SMS reminders for ${tomorrowStr}: ${queued} queued`);
  } catch (error) {
    logger.error('Failed to queue reminders', { error: error.message });
  }
}

module.exports = { queueReminders };
