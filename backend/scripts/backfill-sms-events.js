#!/usr/bin/env node
/**
 * Backfill SMS delivery events from Brevo API.
 *
 * Pulls last N days of SMS events (per salon API key) from
 * /v3/transactionalSMS/statistics/events and writes them into:
 *  - brevo_sms_events (audit trail, ON CONFLICT DO NOTHING)
 *  - notification_queue.delivery_status / delivered_at
 *
 * Run after fixing webhook config to recover missing delivery status.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const DAYS = parseInt(process.env.BACKFILL_DAYS || '7', 10);
const SALONS = {
  meylan: process.env.BREVO_API_KEY,
  grenoble: process.env.BREVO_API_KEY_GRENOBLE,
};

function mapEventToStatus(event) {
  const e = String(event || '').toLowerCase();
  if (e === 'delivered') return 'delivered';
  if (e === 'sent') return 'sent';
  if (e === 'accepted') return 'accepted';
  if (e === 'softbounce' || e === 'soft_bounce') return 'soft_bounce';
  if (e === 'hardbounce' || e === 'hard_bounce') return 'hard_bounce';
  if (e === 'rejected' || e === 'blocked' || e === 'error') return 'rejected';
  if (e === 'blacklisted') return 'blacklisted';
  return 'unknown';
}

async function fetchEventsRange(apiKey, startDate, endDate) {
  const events = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const url = `https://api.brevo.com/v3/transactionalSMS/statistics/events?startDate=${startDate}&endDate=${endDate}&limit=${limit}&offset=${offset}`;
    const resp = await fetch(url, { headers: { 'api-key': apiKey, accept: 'application/json' } });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Brevo API failed: ${resp.status} ${text}`);
    }
    const json = await resp.json();
    const batch = json.events || [];
    events.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
    if (offset > 5000) {
      console.warn('  -> stopped at offset 5000 to avoid runaway');
      break;
    }
  }
  return events;
}

async function fetchAllEvents(apiKey) {
  // Brevo quirk: when startDate < endDate (multi-day range), endDate is treated as
  // exclusive. So we query the historical range up to yesterday, then today separately.
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
  const start = new Date(today.getTime() - DAYS * 24 * 3600 * 1000);
  const startDate = start.toISOString().split('T')[0];
  const yesterdayDate = yesterday.toISOString().split('T')[0];
  const todayDate = today.toISOString().split('T')[0];

  const historical = await fetchEventsRange(apiKey, startDate, yesterdayDate);
  // Single-day query for today (endDate inclusive when startDate==endDate)
  const todayEvents = todayDate !== yesterdayDate
    ? await fetchEventsRange(apiKey, todayDate, todayDate)
    : [];
  return historical.concat(todayEvents);
}

async function backfillSalon(salonId, apiKey, db) {
  if (!apiKey) {
    console.log(`[${salonId}] No API key — skipped`);
    return { fetched: 0, queueUpdated: 0 };
  }
  console.log(`\n[${salonId}] Fetching SMS events (last ${DAYS} days)...`);
  const events = await fetchAllEvents(apiKey);
  console.log(`[${salonId}] Got ${events.length} events`);

  let queueUpdated = 0;
  for (const e of events) {
    const messageId = String(e.messageId || '');
    if (!messageId) continue;
    const status = mapEventToStatus(e.event);

    // 1. Audit log (ignore duplicates)
    await db.query(
      `INSERT INTO brevo_sms_events (message_id, event, recipient, raw_payload, received_at, processed)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (message_id, event) DO NOTHING`,
      [messageId, e.event, e.phoneNumber || null, e, e.date || new Date().toISOString()]
    );

    // 2. Update notification_queue (delivered wins over sent/accepted/pending)
    const upd = await db.query(
      `UPDATE notification_queue
       SET delivery_status = $1::text,
           delivery_event_at = COALESCE(delivery_event_at, $3::timestamptz),
           delivered_at = CASE WHEN $1::text = 'delivered'
                              THEN COALESCE(delivered_at, $3::timestamptz)
                              ELSE delivered_at END
       WHERE provider_message_id = $2::text
         AND (delivery_status IS NULL
              OR delivery_status IN ('unknown','pending','sent','accepted')
              OR ($1::text = 'delivered' AND delivery_status != 'delivered'))
       RETURNING id`,
      [status, messageId, e.date || new Date().toISOString()]
    );
    if (upd.rows.length) queueUpdated++;
  }
  return { fetched: events.length, queueUpdated };
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    let totalEvents = 0;
    let totalUpdated = 0;
    for (const [salonId, apiKey] of Object.entries(SALONS)) {
      const r = await backfillSalon(salonId, apiKey, pool);
      totalEvents += r.fetched;
      totalUpdated += r.queueUpdated;
    }
    console.log(`\nDone. Pulled ${totalEvents} events, updated ${totalUpdated} queue rows.`);
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
