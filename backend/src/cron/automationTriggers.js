const db = require('../config/database');
const config = require('../config/env');
const logger = require('../utils/logger');
const { queueNotification } = require('../services/notification');

/**
 * Process automation triggers (runs every 10 minutes)
 * Checks each trigger type if active and processes accordingly
 * Handles both salons — triggers are per-salon in automation_triggers table
 */
async function processAutomationTriggers() {
  try {
    // Auto-complete past bookings (confirmed + end_time passed today) — all salons
    const autoCompleted = await db.query(
      `UPDATE bookings SET status = 'completed'
       WHERE status = 'confirmed'
         AND deleted_at IS NULL
         AND date = (NOW() AT TIME ZONE 'Europe/Paris')::date
         AND end_time::time < (NOW() AT TIME ZONE 'Europe/Paris')::time
       RETURNING id`
    );
    if (autoCompleted.rowCount > 0) {
      logger.info(`Auto-completed ${autoCompleted.rowCount} past bookings`);
    }

    // Fetch all active triggers (each has a salon_id)
    const triggers = await db.query('SELECT * FROM automation_triggers WHERE is_active = true');

    for (const trigger of triggers.rows) {
      try {
        const salonId = trigger.salon_id || 'meylan';
        switch (trigger.type) {
          case 'review_sms':
            await processReviewSms(trigger.config, salonId);
            break;
          case 'waitlist_notify':
            await processWaitlistNotify(trigger.config, salonId);
            break;
        }
      } catch (err) {
        logger.error(`Automation trigger ${trigger.type} failed`, { error: err.message, salonId: trigger.salon_id });
      }
    }
  } catch (err) {
    logger.error('Failed to process automation triggers', { error: err.message });
  }
}

/**
 * Review email: Send email X minutes after a booking is completed
 * Filtered by salon_id — once per client lifetime (review_requested flag)
 */
async function processReviewSms(triggerConfig, salonId) {
  const delayMinutes = triggerConfig.delay_minutes || 60;

  // Find bookings completed more than delayMinutes ago (for this salon)
  // Only for clients who have NEVER received a review request (once per lifetime)
  const result = await db.query(
    `SELECT b.id, b.client_id, b.date, b.start_time,
            c.first_name, c.last_name, c.email
     FROM bookings b
     JOIN clients c ON b.client_id = c.id
     WHERE b.status = 'completed'
       AND b.deleted_at IS NULL
       AND b.review_email_sent = false
       AND b.salon_id = $2
       AND c.email IS NOT NULL
       AND c.review_requested = false
       AND b.date = (NOW() AT TIME ZONE 'Europe/Paris')::date
       AND (b.end_time::time + ($1 || ' minutes')::interval) <= (NOW() AT TIME ZONE 'Europe/Paris')::time
       AND NOT EXISTS (
         SELECT 1 FROM notification_queue nq
         WHERE nq.booking_id = b.id AND nq.type IN ('review_sms', 'review_email')
       )
     LIMIT 20`,
    [delayMinutes, salonId]
  );

  for (const booking of result.rows) {
    try {
      // Mark BEFORE queuing to prevent duplicates on next cron run
      await db.query('UPDATE clients SET review_requested = true WHERE id = $1', [booking.client_id]);
      await db.query('UPDATE bookings SET review_email_sent = true WHERE id = $1', [booking.id]);
      // Queue review email — processQueue handles retries
      await queueNotification(booking.id, 'review_email', {
        email: booking.email,
        salonId,
        recipientName: booking.first_name || '',
      });
      logger.info('Review email queued', { bookingId: booking.id, email: booking.email, salonId });
    } catch (err) {
      logger.error('Review email queue failed', { bookingId: booking.id, error: err.message });
    }
  }

  if (result.rows.length > 0) {
    logger.info(`Review email (${salonId}): processed ${result.rows.length} bookings`);
  }
}

/**
 * Waitlist Notify: Expire old waitlist entries (past dates)
 * Actual SMS notification happens in booking.js cancelBooking() when a slot opens up.
 */
async function processWaitlistNotify(triggerConfig, salonId) {
  // Expire waitlist entries for past dates
  const expired = await db.query(
    `UPDATE waitlist SET status = 'expired'
     WHERE status = 'waiting' AND salon_id = $1 AND preferred_date < CURRENT_DATE
     RETURNING id`,
    [salonId]
  );
  if (expired.rowCount > 0) {
    logger.info(`Waitlist (${salonId}): expired ${expired.rowCount} past entries`);
  }
}

module.exports = { processAutomationTriggers };
