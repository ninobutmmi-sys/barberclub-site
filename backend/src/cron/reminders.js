const db = require('../config/database');
const notification = require('../services/notification');
const logger = require('../utils/logger');

/**
 * Queue SMS reminders for tomorrow's bookings
 * Runs every day at 18:00 (sends reminder the evening before)
 */
async function queueReminders() {
  try {
    // Find tomorrow's confirmed bookings that haven't had a reminder sent
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const result = await db.query(
      `SELECT b.id
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       WHERE b.date = $1
         AND b.status = 'confirmed'
         AND b.reminder_sent = false
         AND b.deleted_at IS NULL
         AND c.phone IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM notification_queue nq
           WHERE nq.booking_id = b.id AND nq.type = 'reminder_sms'
         )`,
      [tomorrowStr]
    );

    if (result.rows.length === 0) {
      logger.info('No reminders to queue for tomorrow');
      return;
    }

    for (const booking of result.rows) {
      await notification.queueNotification(booking.id, 'reminder_sms');
    }

    logger.info(`Queued ${result.rows.length} SMS reminders for ${tomorrowStr}`);
  } catch (error) {
    logger.error('Failed to queue reminders', { error: error.message });
  }
}

module.exports = { queueReminders };
