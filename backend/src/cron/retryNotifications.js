const notification = require('../services/notification');
const logger = require('../utils/logger');
const db = require('../config/database');
const { NOTIFICATION_CLEANUP_DAYS } = require('../constants');

/**
 * Process pending notifications from the queue
 * Runs every 2 minutes
 */
async function processQueue() {
  try {
    await notification.processPendingNotifications();
  } catch (error) {
    logger.error('Failed to process notification queue', { error: error.message });
  }
}

/**
 * Clean up old sent/failed notifications (older than 30 days)
 * Runs once a day at 03:00
 */
async function cleanupOldNotifications() {
  try {
    const result = await db.query(
      `DELETE FROM notification_queue
       WHERE (status = 'sent' OR status = 'failed')
         AND created_at < NOW() - INTERVAL $1`,
      [NOTIFICATION_CLEANUP_DAYS + ' days']
    );
    if (result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} old notifications`);
    }
  } catch (error) {
    logger.error('Failed to cleanup notifications', { error: error.message });
  }
}

/**
 * Clean up expired refresh tokens
 * Runs once a day at 03:30
 */
async function cleanupExpiredTokens() {
  try {
    const result = await db.query(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW()'
    );
    if (result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} expired refresh tokens`);
    }
  } catch (error) {
    logger.error('Failed to cleanup tokens', { error: error.message });
  }
}

module.exports = { processQueue, cleanupOldNotifications, cleanupExpiredTokens };
