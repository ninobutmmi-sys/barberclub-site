const db = require('../config/database');
const config = require('../config/env');
const logger = require('../utils/logger');

/**
 * Process automation triggers (runs every 10 minutes)
 * Checks each trigger type if active and processes accordingly
 */
async function processAutomationTriggers() {
  try {
    const triggers = await db.query('SELECT * FROM automation_triggers WHERE is_active = true');

    for (const trigger of triggers.rows) {
      try {
        switch (trigger.type) {
          case 'review_sms':
            await processReviewSms(trigger.config);
            break;
          case 'reactivation_sms':
            await processReactivationSms(trigger.config);
            break;
          case 'waitlist_notify':
            await processWaitlistNotify(trigger.config);
            break;
        }
      } catch (err) {
        logger.error(`Automation trigger ${trigger.type} failed`, { error: err.message });
      }
    }
  } catch (err) {
    logger.error('Failed to process automation triggers', { error: err.message });
  }
}

/**
 * Review SMS: Send SMS X minutes after a booking is completed
 * Looks for bookings completed recently that haven't been sent a review SMS
 */
async function processReviewSms(triggerConfig) {
  const delayMinutes = triggerConfig.delay_minutes || 60;
  const message = triggerConfig.message || '';
  const googleReviewUrl = triggerConfig.google_review_url || '';

  if (!message) return;

  // Find bookings completed more than delayMinutes ago, not yet sent review SMS
  const result = await db.query(
    `SELECT b.id, b.date, b.start_time,
            c.first_name, c.last_name, c.phone
     FROM bookings b
     JOIN clients c ON b.client_id = c.id
     WHERE b.status = 'completed'
       AND b.deleted_at IS NULL
       AND b.review_email_sent = false
       AND c.phone IS NOT NULL
       AND b.date = CURRENT_DATE
       AND (b.end_time::time + ($1 || ' minutes')::interval) <= CURRENT_TIME
       AND NOT EXISTS (
         SELECT 1 FROM notification_queue nq
         WHERE nq.booking_id = b.id AND nq.type = 'review_email'
       )
     LIMIT 20`,
    [delayMinutes]
  );

  for (const booking of result.rows) {
    const personalMessage = message
      .replace(/\{prenom\}/gi, booking.first_name || '')
      .replace(/\{nom\}/gi, booking.last_name || '')
      .replace(/\{lien_avis\}/gi, googleReviewUrl);

    logger.info('Review SMS trigger', {
      bookingId: booking.id,
      phone: booking.phone,
      message: personalMessage.substring(0, 50) + '...',
    });

    // Mark as processed to avoid re-sending
    await db.query('UPDATE bookings SET review_email_sent = true WHERE id = $1', [booking.id]);

    // Note: Actual SMS sending will use Octopush when configured
    // For now, just log and mark processed
  }

  if (result.rows.length > 0) {
    logger.info(`Review SMS: processed ${result.rows.length} bookings`);
  }
}

/**
 * Reactivation SMS: Send to clients inactive for X days
 * Uses a simple approach: check clients table for last booking
 */
async function processReactivationSms(triggerConfig) {
  const inactiveDays = triggerConfig.inactive_days || 45;
  const message = triggerConfig.message || '';

  if (!message) return;

  // Find clients with 3+ visits, inactive for inactiveDays, not contacted in last 30 days
  const result = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.phone,
            MAX(b.date) as last_visit
     FROM clients c
     JOIN bookings b ON c.id = b.client_id
     WHERE c.phone IS NOT NULL
       AND c.deleted_at IS NULL
       AND b.deleted_at IS NULL
       AND b.status IN ('completed', 'confirmed')
     GROUP BY c.id
     HAVING COUNT(b.id) >= 3
       AND MAX(b.date) < CURRENT_DATE - $1::int
       AND MAX(b.date) > CURRENT_DATE - ($1::int + 30)`,
    [inactiveDays]
  );

  for (const client of result.rows) {
    const personalMessage = message
      .replace(/\{prenom\}/gi, client.first_name || '')
      .replace(/\{nom\}/gi, client.last_name || '')
      .replace(/\{lien_reservation\}/gi, 'https://barberclub-grenoble.fr/pages/meylan/reserver.html');

    logger.info('Reactivation SMS trigger', {
      clientId: client.id,
      phone: client.phone,
      lastVisit: client.last_visit,
    });
  }

  if (result.rows.length > 0) {
    logger.info(`Reactivation SMS: found ${result.rows.length} inactive clients`);
  }
}

/**
 * Waitlist Notify: When a booking is cancelled, check if someone is on the waitlist
 * for that barber/date and notify them
 */
async function processWaitlistNotify(triggerConfig) {
  const message = triggerConfig.message || '';
  if (!message) return;

  // Find waiting entries for today or upcoming dates where slots may have opened
  const result = await db.query(
    `SELECT w.id, w.client_name, w.client_phone, w.preferred_date,
            w.preferred_time_start, w.preferred_time_end,
            b.name as barber_name, s.name as service_name
     FROM waitlist w
     JOIN barbers b ON w.barber_id = b.id
     JOIN services s ON w.service_id = s.id
     WHERE w.status = 'waiting'
       AND w.preferred_date >= CURRENT_DATE
     ORDER BY w.created_at ASC
     LIMIT 10`
  );

  // Just log for now — actual notification happens when a cancellation is detected
  if (result.rows.length > 0) {
    logger.info(`Waitlist: ${result.rows.length} clients waiting for slots`);
  }
}

module.exports = { processAutomationTriggers };
