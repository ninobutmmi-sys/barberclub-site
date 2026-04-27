// ============================================
// Polling fallback : reconcile SMS delivery via Brevo statistics API
// ============================================
// Runs every 30min — for each SMS marked status='sent' but delivery_status='pending'
// in the last N hours, query Brevo's transactionalSMS statistics endpoint to
// catch events the webhook may have missed.
//
// Belt-and-suspenders pattern: webhook is real-time + this is the safety net.

const db = require('../config/database');
const logger = require('../utils/logger');
const { getBrevoConfig, brevoEmail } = require('../services/notification/brevo');
const { notifySmsFailed } = require('../services/push');
const {
  BREVO_SMS_RECONCILE_LOOKBACK_HOURS,
  BREVO_SMS_DELIVERY_TIMEOUT_MS,
  BREVO_REQUEST_TIMEOUT_MS,
} = require('../constants');

/**
 * Fetch Brevo SMS event statistics for a salon over a window.
 * Returns array of events with messageId + event type.
 */
async function fetchBrevoSmsEvents(salonId, startDateISO, endDateISO) {
  const brevo = getBrevoConfig(salonId);
  if (!brevo.apiKey) return [];

  const events = [];
  // Query each interesting event type — Brevo doesn't return all in one call
  const eventTypes = ['delivered', 'rejected', 'hardBounces', 'softBounces', 'blocked'];

  for (const evType of eventTypes) {
    const url = new URL('https://api.brevo.com/v3/transactionalSMS/statistics/events');
    url.searchParams.set('startDate', startDateISO);
    url.searchParams.set('endDate', endDateISO);
    url.searchParams.set('event', evType);
    url.searchParams.set('limit', '500');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BREVO_REQUEST_TIMEOUT_MS);
      const resp = await fetch(url.toString(), {
        headers: { 'api-key': brevo.apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        logger.debug('Brevo stats fetch non-OK', { salonId, evType, status: resp.status });
        continue;
      }
      const data = await resp.json();
      const items = Array.isArray(data.events) ? data.events : (Array.isArray(data) ? data : []);
      for (const item of items) {
        if (item.messageId != null) {
          events.push({
            messageId: String(item.messageId),
            event: evType.replace('Bounces', '_bounce'), // hardBounces -> hard_bounce
            recipient: item.recipient || item.to || null,
            description: item.reason || item.description || null,
            date: item.date || item.eventDate || null,
          });
        }
      }
    } catch (err) {
      logger.debug('Brevo stats fetch failed', { salonId, evType, error: err.message });
    }
  }

  return events;
}

/**
 * Apply an event to notification_queue (idempotent via brevo_sms_events).
 */
async function applyEvent(salonId, ev) {
  // Map event to delivery_status (same logic as webhook)
  let status;
  if (ev.event === 'delivered') status = 'delivered';
  else if (ev.event === 'rejected' || ev.event === 'blocked') status = 'rejected';
  else if (ev.event === 'hard_bounce') status = 'hard_bounce';
  else if (ev.event === 'soft_bounce') status = 'soft_bounce';
  else status = 'unknown';

  // Insert event log (UNIQUE constraint catches duplicates)
  let inserted;
  try {
    inserted = await db.query(
      `INSERT INTO brevo_sms_events (message_id, event, recipient, description, raw_payload, processed)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (message_id, event) DO NOTHING
       RETURNING id`,
      [ev.messageId, ev.event, ev.recipient, ev.description, ev]
    );
  } catch (err) {
    logger.debug('reconcile: event log insert failed', { error: err.message });
    return false;
  }
  if (inserted.rows.length === 0) return false; // already processed

  // Update queue row
  try {
    await db.query(
      `UPDATE notification_queue
       SET delivery_status = $1,
           delivery_event_at = NOW(),
           delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
           last_error = CASE WHEN $1 IN ('hard_bounce','rejected','blacklisted','soft_bounce')
                            THEN COALESCE($2, last_error) ELSE last_error END
       WHERE provider_message_id = $3`,
      [status, ev.description, ev.messageId]
    );
  } catch (err) {
    logger.debug('reconcile: queue update failed', { error: err.message });
  }

  // Auto-blacklist on hard_bounce
  if (status === 'hard_bounce' && ev.recipient) {
    try {
      await db.query(
        `INSERT INTO sms_blacklist (phone, reason)
         VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE
           SET last_seen_at = NOW(),
               occurrences = sms_blacklist.occurrences + 1`,
        [ev.recipient, status]
      );
    } catch (_) { /* silent */ }
  }

  return true;
}

/**
 * Main reconciliation cron — for each salon, fetch recent events and apply.
 * Also flags SMS that are still 'pending' after BREVO_SMS_DELIVERY_TIMEOUT_MS.
 */
async function reconcileSmsDelivery() {
  // 1. Check if we have any SMS still pending — skip Brevo API call if not
  const pending = await db.query(
    `SELECT DISTINCT salon_id
     FROM notification_queue
     WHERE channel = 'sms'
       AND status = 'sent'
       AND delivery_status = 'pending'
       AND sent_at > NOW() - ($1 || ' hours')::INTERVAL`,
    [BREVO_SMS_RECONCILE_LOOKBACK_HOURS]
  );

  if (pending.rows.length === 0) {
    return;
  }

  const now = new Date();
  const start = new Date(now.getTime() - BREVO_SMS_RECONCILE_LOOKBACK_HOURS * 3600 * 1000);
  const startISO = start.toISOString().split('T')[0];
  const endISO = now.toISOString().split('T')[0];

  let totalApplied = 0;
  for (const row of pending.rows) {
    const salonId = row.salon_id;
    try {
      const events = await fetchBrevoSmsEvents(salonId, startISO, endISO);
      for (const ev of events) {
        const applied = await applyEvent(salonId, ev);
        if (applied) totalApplied++;
      }
    } catch (err) {
      logger.error('Reconcile failed for salon', { salonId, error: err.message });
    }
  }

  if (totalApplied > 0) {
    logger.info('SMS delivery reconciliation', { applied: totalApplied });
  }

  // 2. Alert on SMS stuck in 'pending' beyond delivery timeout — DLR never came back
  try {
    const stuck = await db.query(
      `SELECT id, salon_id, phone, type, sent_at, provider_message_id
       FROM notification_queue
       WHERE channel = 'sms'
         AND status = 'sent'
         AND delivery_status = 'pending'
         AND sent_at < NOW() - ($1 || ' milliseconds')::INTERVAL
         AND sent_at > NOW() - INTERVAL '24 hours'
       LIMIT 20`,
      [BREVO_SMS_DELIVERY_TIMEOUT_MS]
    );
    if (stuck.rows.length > 0) {
      // Mark them 'unknown' so we don't re-alert
      const ids = stuck.rows.map(r => r.id);
      await db.query(
        `UPDATE notification_queue SET delivery_status = 'unknown' WHERE id = ANY($1)`,
        [ids]
      );
      // Push notification + email pour chaque SMS bloqué
      for (const r of stuck.rows.slice(0, 5)) {
        notifySmsFailed(r.salon_id, {
          phone: r.phone,
          reason: 'pas de confirmation delivery',
          messageId: r.provider_message_id,
        });
      }
      const ownerEmail = process.env.OWNER_ALERT_EMAIL || 'barberclubmeylan@gmail.com';
      const list = stuck.rows.slice(0, 10)
        .map(r => `<li>${r.salon_id} • ${r.phone} • ${r.type} • msgId=${r.provider_message_id || 'n/a'}</li>`)
        .join('');
      const subject = `[BarberClub] ${stuck.rows.length} SMS sans confirmation delivery`;
      const html = `
        <h2>SMS envoye(s) sans event delivered/rejected</h2>
        <p>${stuck.rows.length} SMS apres +${Math.round(BREVO_SMS_DELIVERY_TIMEOUT_MS / 60000)}min sans confirmation Brevo.</p>
        <ul>${list}</ul>
      `;
      const firstSalon = stuck.rows[0]?.salon_id || 'meylan';
      brevoEmail(ownerEmail, subject, html, firstSalon, { type: 'sms_stuck_alert' })
        .catch((e) => logger.error('Stuck SMS owner alert failed', { error: e.message }));
    }
  } catch (err) {
    logger.error('Stuck SMS check failed', { error: err.message });
  }
}

module.exports = { reconcileSmsDelivery };
