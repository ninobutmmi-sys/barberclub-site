const db = require('../../config/database');
const logger = require('../../utils/logger');
const {
  NOTIFICATION_RETRY_DELAYS,
  NOTIFICATION_BATCH_SIZE,
} = require('../../constants');
const { brevoSMS } = require('./brevo');
const {
  sendConfirmationEmail,
  sendCancellationEmail,
  sendReviewEmail,
  sendRescheduleEmail,
  sendReminderSMS,
  sendReminderEmail,
} = require('./templates');

/**
 * Queue a notification for async sending (universal)
 * All notification types go through this single entry point.
 * The queue processor (processPendingNotifications) handles retries.
 *
 * @param {string|null} bookingId - booking UUID (null for campaigns)
 * @param {string} type - notification type (confirmation_email, reminder_sms, etc.)
 * @param {object} [opts] - extra data stored in the queue row
 * @param {string} [opts.phone] - recipient phone (SMS types)
 * @param {string} [opts.email] - recipient email (email types)
 * @param {string} [opts.message] - pre-built SMS text
 * @param {string} [opts.salonId] - salon identifier
 * @param {string} [opts.recipientName] - for audit
 * @param {object} [opts.metadata] - extra JSON (e.g. old_date/old_time for reschedule)
 */
async function queueNotification(bookingId, type, opts = {}) {
  const { phone, email, message, salonId, recipientName, metadata } = opts;
  const channel = type.endsWith('_sms') ? 'sms' : 'email';
  await db.query(
    `INSERT INTO notification_queue
       (booking_id, type, status, channel, phone, email, message, salon_id, recipient_name, metadata, next_retry_at)
     VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [
      bookingId || null, type, channel,
      phone || null, email || null, message || null,
      salonId || null, recipientName || null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  logger.info('Notification queued', { bookingId, type, channel });
}

/**
 * Process pending notifications (called by cron job)
 * Picks up pending items and attempts to send them
 */
async function processPendingNotifications() {
  // Atomically claim pending notifications by setting status = 'processing'
  const claimed = await db.query(
    `UPDATE notification_queue
     SET status = 'processing'
     WHERE id IN (
       SELECT nq.id FROM notification_queue nq
       WHERE nq.status = 'pending'
         AND nq.next_retry_at <= NOW()
         AND nq.attempts < nq.max_attempts
       ORDER BY nq.created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id`,
    [NOTIFICATION_BATCH_SIZE]
  );

  if (claimed.rows.length === 0) return;

  const claimedIds = claimed.rows.map(r => r.id);

  // Fetch full data for claimed notifications
  // LEFT JOINs: SMS types store phone+message in the row and may not need booking data
  const result = await db.query(
    `SELECT nq.*,
            b.date, b.start_time, b.end_time, b.price, b.cancel_token,
            COALESCE(nq.salon_id, b.salon_id) as salon_id,
            s.name as service_name,
            br.name as barber_name,
            c.first_name, c.last_name,
            COALESCE(nq.phone, c.phone) as phone,
            COALESCE(nq.email, c.email) as email
     FROM notification_queue nq
     LEFT JOIN bookings b ON nq.booking_id = b.id
     LEFT JOIN services s ON b.service_id = s.id
     LEFT JOIN barbers br ON b.barber_id = br.id
     LEFT JOIN clients c ON b.client_id = c.id
     WHERE nq.id = ANY($1)`,
    [claimedIds]
  );

  for (const notification of result.rows) {
    try {
      notification.fromQueue = true;
      notification.queueId = notification.id;
      await sendNotification(notification);
      await db.query(
        `UPDATE notification_queue SET status = 'sent', sent_at = NOW()
         WHERE id = $1`,
        [notification.id]
      );
      logger.info('Notification sent', { id: notification.id, type: notification.type });
    } catch (error) {
      const attempts = notification.attempts + 1;
      const nextRetry = getNextRetryTime(attempts);

      await db.query(
        `UPDATE notification_queue
         SET attempts = $1, last_error = $2, next_retry_at = $3,
             status = CASE WHEN $1 >= max_attempts THEN 'failed' ELSE 'pending' END
         WHERE id = $4`,
        [attempts, error.message, nextRetry, notification.id]
      );

      logger.error('Notification failed', {
        id: notification.id,
        type: notification.type,
        attempt: attempts,
        error: error.message,
      });
    }
  }
}

/**
 * Send a notification based on its type.
 * ALL types are handled here -- single code path for the queue processor.
 *
 * SMS types: phone + message are pre-stored in the queue row.
 * Email types: booking data comes from LEFT JOINs on the queue row.
 */
async function sendNotification(notification) {
  const type = notification.type;

  // -- SMS types: use pre-stored phone + message --
  if (type.endsWith('_sms')) {
    if (!notification.phone || !notification.message) {
      // Legacy fallback for old reminder_sms entries queued without message
      if (type === 'reminder_sms' && notification.booking_id) {
        await sendReminderSMS(notification);
        return;
      }
      throw new Error(`Missing phone/message for ${type}`);
    }
    await brevoSMS(notification.phone, notification.message, notification.salon_id || 'meylan');
    // Post-send: mark reminder_sent on booking (confirmation_sms / reminder_sms)
    if ((type === 'reminder_sms' || type === 'confirmation_sms') && notification.booking_id) {
      await db.query('UPDATE bookings SET reminder_sent = true WHERE id = $1', [notification.booking_id]);
    }
    return;
  }

  // -- Email types: build template from JOINed booking data --
  switch (type) {
    case 'confirmation_email':
      await sendConfirmationEmail(notification);
      break;
    case 'cancellation_email':
      await sendCancellationEmail(notification);
      break;
    case 'review_email':
      await sendReviewEmail(notification);
      break;
    case 'reminder_email':
      await sendReminderEmail(notification);
      if (notification.booking_id) {
        await db.query('UPDATE bookings SET reminder_sent = true WHERE id = $1', [notification.booking_id]);
      }
      break;
    case 'reschedule_email': {
      const meta = typeof notification.metadata === 'string'
        ? JSON.parse(notification.metadata)
        : (notification.metadata || {});
      await sendRescheduleEmail({
        ...notification,
        old_date: meta.old_date,
        old_time: meta.old_time,
        new_date: notification.date,
        new_time: notification.start_time,
        new_barber_name: meta.new_barber_name || notification.barber_name,
      });
      break;
    }
    default:
      // Don't throw on unknown types -- just skip (prevents stuck queue entries)
      logger.warn(`Unknown notification type: ${type}, skipping`, { id: notification.id });
  }
}

function getNextRetryTime(attempts) {
  // Exponential backoff: 5min, 15min, 1h
  const delayMinutes = NOTIFICATION_RETRY_DELAYS[Math.min(attempts - 1, NOTIFICATION_RETRY_DELAYS.length - 1)];
  const next = new Date();
  next.setMinutes(next.getMinutes() + delayMinutes);
  return next;
}

module.exports = {
  queueNotification,
  processPendingNotifications,
  sendNotification,
  getNextRetryTime,
};
