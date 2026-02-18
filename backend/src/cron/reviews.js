const db = require('../config/database');
const notification = require('../services/notification');
const logger = require('../utils/logger');

/**
 * Queue review request emails for completed bookings (24h after)
 * Runs every day at 10:00
 */
async function queueReviewRequests() {
  try {
    // Find yesterday's completed bookings that haven't had a review email sent
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const result = await db.query(
      `SELECT b.id
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       WHERE b.date = $1
         AND b.status = 'completed'
         AND b.review_email_sent = false
         AND b.deleted_at IS NULL
         AND c.email IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM notification_queue nq
           WHERE nq.booking_id = b.id AND nq.type = 'review_email'
         )`,
      [yesterdayStr]
    );

    if (result.rows.length === 0) {
      logger.info('No review requests to queue');
      return;
    }

    for (const booking of result.rows) {
      await notification.queueNotification(booking.id, 'review_email');
    }

    logger.info(`Queued ${result.rows.length} review request emails`);
  } catch (error) {
    logger.error('Failed to queue review requests', { error: error.message });
  }
}

module.exports = { queueReviewRequests };
