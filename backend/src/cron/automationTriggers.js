const db = require('../config/database');
const config = require('../config/env');
const logger = require('../utils/logger');
const { BREVO_REQUEST_TIMEOUT_MS } = require('../constants');

function formatPhoneInternational(phone) {
  let cleaned = phone.replace(/[\s.-]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '+33' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('+')) {
    cleaned = '+33' + cleaned;
  }
  return cleaned;
}

async function brevoSMS(phone, content) {
  if (!config.brevo.apiKey) {
    logger.warn('Brevo API key not configured, skipping SMS');
    return;
  }
  const recipient = formatPhoneInternational(phone);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BREVO_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
      method: 'POST',
      headers: {
        'api-key': config.brevo.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: config.brevo.smsSender,
        recipient,
        content,
        type: 'transactional',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Brevo SMS API error ${response.status}: ${errorBody}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Process automation triggers (runs every 10 minutes)
 * Checks each trigger type if active and processes accordingly
 */
async function processAutomationTriggers() {
  try {
    // Auto-complete past bookings (confirmed + end_time passed today)
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

  // Find bookings completed more than delayMinutes ago
  // Only for clients who have NEVER received a review SMS (once per lifetime)
  const result = await db.query(
    `SELECT b.id, b.client_id, b.date, b.start_time,
            c.first_name, c.last_name, c.phone
     FROM bookings b
     JOIN clients c ON b.client_id = c.id
     WHERE b.status = 'completed'
       AND b.deleted_at IS NULL
       AND b.review_email_sent = false
       AND c.phone IS NOT NULL
       AND c.review_requested = false
       AND b.date = (NOW() AT TIME ZONE 'Europe/Paris')::date
       AND (b.end_time::time + ($1 || ' minutes')::interval) <= (NOW() AT TIME ZONE 'Europe/Paris')::time
       AND NOT EXISTS (
         SELECT 1 FROM notification_queue nq
         WHERE nq.booking_id = b.id AND nq.type = 'review_sms'
       )
     LIMIT 20`,
    [delayMinutes]
  );

  const apiUrl = config.apiUrl || 'https://barberclub-grenoble.fr';
  const reviewLink = apiUrl + '/r/avis';

  for (const booking of result.rows) {
    const personalMessage = message
      .replace(/\{prenom\}/gi, booking.first_name || '')
      .replace(/\{nom\}/gi, booking.last_name || '')
      .replace(/\{lien_avis\}/gi, reviewLink);

    try {
      await brevoSMS(booking.phone, personalMessage);
      logger.info('Review SMS sent', { bookingId: booking.id, phone: booking.phone });
      // Mark client as already contacted for review (lifetime flag)
      await db.query('UPDATE clients SET review_requested = true WHERE id = $1', [booking.client_id]);
    } catch (err) {
      logger.error('Review SMS failed', { bookingId: booking.id, error: err.message });
    }

    // Mark booking as processed
    await db.query('UPDATE bookings SET review_email_sent = true WHERE id = $1', [booking.id]);
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

  // Find clients with 3+ visits, inactive for inactiveDays, not already contacted recently
  const result = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.phone,
            MAX(b.date) as last_visit
     FROM clients c
     JOIN bookings b ON c.id = b.client_id
     WHERE c.phone IS NOT NULL
       AND c.deleted_at IS NULL
       AND b.deleted_at IS NULL
       AND b.status IN ('completed', 'confirmed')
       AND (c.reactivation_sms_sent_at IS NULL OR c.reactivation_sms_sent_at < NOW() - INTERVAL '30 days')
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

    try {
      await brevoSMS(client.phone, personalMessage);
      await db.query('UPDATE clients SET reactivation_sms_sent_at = NOW() WHERE id = $1', [client.id]);
      logger.info('Reactivation SMS sent', { clientId: client.id, phone: client.phone });
    } catch (err) {
      logger.error('Reactivation SMS failed', { clientId: client.id, error: err.message });
    }
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

  for (const entry of result.rows) {
    const personalMessage = message
      .replace(/\{prenom\}/gi, entry.client_name || '')
      .replace(/\{barbier\}/gi, entry.barber_name || '')
      .replace(/\{prestation\}/gi, entry.service_name || '');

    try {
      await brevoSMS(entry.client_phone, personalMessage);
      logger.info('Waitlist SMS sent', { waitlistId: entry.id, phone: entry.client_phone });
      await db.query("UPDATE waitlist SET status = 'notified' WHERE id = $1", [entry.id]);
    } catch (err) {
      logger.error('Waitlist SMS failed', { waitlistId: entry.id, error: err.message });
    }
  }

  if (result.rows.length > 0) {
    logger.info(`Waitlist: notified ${result.rows.length} clients`);
  }
}

module.exports = { processAutomationTriggers };
