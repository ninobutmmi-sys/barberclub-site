const db = require('../config/database');
const notification = require('../services/notification');
const logger = require('../utils/logger');

/**
 * Send SMS reminders for tomorrow's bookings
 * Runs every day at 18:00 (sends reminder the evening before)
 * Sends directly via Brevo (queue fallback if direct fails)
 * Handles both salons — uses booking.salon_id for correct SMS content
 */
async function queueReminders() {
  try {
    // Find tomorrow's confirmed bookings that haven't had a reminder sent
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
         AND b.reminder_sent = false
         AND b.deleted_at IS NULL
         AND c.phone IS NOT NULL`,
      [tomorrowStr]
    );

    if (result.rows.length === 0) {
      logger.info('No reminders to send for tomorrow');
      return;
    }

    let sent = 0;
    let failed = 0;

    for (const booking of result.rows) {
      const salonId = booking.salon_id || 'meylan';
      try {
        await notification.sendReminderSMSDirect({
          booking_id: booking.id,
          cancel_token: booking.cancel_token,
          phone: booking.phone,
          date: booking.date,
          start_time: booking.start_time,
          salon_id: salonId,
        });
        await db.query('UPDATE bookings SET reminder_sent = true WHERE id = $1', [booking.id]);
        // Log to notification_queue for SMS history
        await db.query(
          `INSERT INTO notification_queue (booking_id, type, status, channel, phone, salon_id, sent_at, attempts)
           VALUES ($1, 'reminder_sms', 'sent', 'sms', $2, $3, NOW(), 1)`,
          [booking.id, booking.phone, salonId]
        );
        sent++;
      } catch (err) {
        logger.error('Direct reminder SMS failed, queueing for retry', { bookingId: booking.id, error: err.message });
        try {
          await notification.queueNotification(booking.id, 'reminder_sms');
        } catch (qErr) {
          logger.error('Failed to queue reminder SMS fallback', { bookingId: booking.id, error: qErr.message });
        }
        failed++;
      }
    }

    logger.info(`SMS reminders for ${tomorrowStr}: ${sent} sent, ${failed} failed`);
  } catch (error) {
    logger.error('Failed to send reminders', { error: error.message });
  }
}

module.exports = { queueReminders };
