#!/usr/bin/env node
/**
 * Setup Brevo SMS webhooks for both salons.
 *
 * Creates (or updates) one webhook per salon that POSTs SMS delivery events
 * to our backend. Idempotent — safe to re-run.
 *
 * Usage:
 *   API_URL=https://api.barberclub-grenoble.fr \
 *   BREVO_WEBHOOK_SECRET=xxxxx \
 *   node scripts/setup-brevo-webhooks.js
 *
 * Reads BREVO_API_KEY (meylan) and BREVO_API_KEY_GRENOBLE from .env.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const API_URL = process.env.API_URL || process.env.SITE_URL || '';
const SECRET = process.env.BREVO_WEBHOOK_SECRET || '';
const EVENTS = ['delivered', 'sent', 'accepted', 'rejected', 'hardBounce', 'softBounce', 'blocked', 'blacklisted'];

const SALONS = {
  meylan: process.env.BREVO_API_KEY,
  grenoble: process.env.BREVO_API_KEY_GRENOBLE,
};

if (!API_URL) {
  console.error('ERROR: API_URL must be set (https://api.barberclub-grenoble.fr in prod)');
  process.exit(1);
}
if (!SECRET) {
  console.error('ERROR: BREVO_WEBHOOK_SECRET must be set');
  process.exit(1);
}

const webhookUrl = `${API_URL.replace(/\/$/, '')}/api/webhooks/brevo/sms?token=${encodeURIComponent(SECRET)}`;

async function listWebhooks(apiKey) {
  const resp = await fetch('https://api.brevo.com/v3/webhooks?type=transactional', {
    headers: { 'api-key': apiKey, 'accept': 'application/json' },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`List webhooks failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function createWebhook(apiKey) {
  const resp = await fetch('https://api.brevo.com/v3/webhooks', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      url: webhookUrl,
      type: 'transactional',
      channel: 'sms',
      events: EVENTS,
      description: 'BarberClub SMS delivery tracking',
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Create webhook failed: ${resp.status} ${text}`);
  return JSON.parse(text);
}

async function deleteWebhook(apiKey, id) {
  const resp = await fetch(`https://api.brevo.com/v3/webhooks/${id}`, {
    method: 'DELETE',
    headers: { 'api-key': apiKey },
  });
  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text();
    throw new Error(`Delete webhook ${id} failed: ${resp.status} ${text}`);
  }
}

async function setupForSalon(salonId, apiKey, db) {
  if (!apiKey) {
    console.log(`[${salonId}] No API key — skipped`);
    return;
  }

  console.log(`\n[${salonId}] Listing existing webhooks...`);
  const list = await listWebhooks(apiKey);
  const webhooks = Array.isArray(list) ? list : (list.webhooks || []);
  const ours = webhooks.filter(w =>
    (w.description || '').includes('BarberClub') ||
    (w.url || '').includes('/api/webhooks/brevo/sms')
  );

  // Clean up old/stale ones
  for (const w of ours) {
    if (w.url !== webhookUrl) {
      console.log(`[${salonId}] Deleting stale webhook id=${w.id} url=${w.url}`);
      await deleteWebhook(apiKey, w.id);
    }
  }

  // Check if our exact URL+events is already there
  const existing = ours.find(w => w.url === webhookUrl);
  let webhookId;
  if (existing) {
    console.log(`[${salonId}] Webhook already exists id=${existing.id}`);
    webhookId = existing.id;
  } else {
    console.log(`[${salonId}] Creating webhook -> ${webhookUrl}`);
    const created = await createWebhook(apiKey);
    webhookId = created.id;
    console.log(`[${salonId}] Created webhook id=${webhookId}`);
  }

  // Persist in DB for tracking
  await db.query(
    `INSERT INTO brevo_webhooks (salon_id, webhook_id, webhook_url, events)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (salon_id) DO UPDATE
       SET webhook_id = EXCLUDED.webhook_id,
           webhook_url = EXCLUDED.webhook_url,
           events = EXCLUDED.events,
           created_at = NOW()`,
    [salonId, webhookId, webhookUrl, EVENTS]
  );
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
    for (const [salonId, apiKey] of Object.entries(SALONS)) {
      await setupForSalon(salonId, apiKey, pool);
    }
    console.log('\nDone.');
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
