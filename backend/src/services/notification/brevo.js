const db = require('../../config/database');
const config = require('../../config/env');
const logger = require('../../utils/logger');
const {
  BREVO_CIRCUIT_THRESHOLD,
  BREVO_CIRCUIT_COOLDOWN_MS,
  BREVO_REQUEST_TIMEOUT_MS,
  BREVO_CREDIT_LOW_THRESHOLD,
  BREVO_CREDIT_CRITICAL_THRESHOLD,
} = require('../../constants');
const { alertCircuitOpen, alertCircuitClosed, alertBrevoCreditsLow } = require('../../utils/discord');
const { formatPhoneInternational, htmlToText } = require('./helpers');

// In-memory latest credit balance per salon (exposed via getBrevoStatus)
const latestCredits = {};

async function logCredits(salonId, remaining, used, smsCount) {
  latestCredits[salonId] = { remainingCredits: remaining, recordedAt: new Date().toISOString() };
  try {
    await db.query(
      `INSERT INTO brevo_credit_log (salon_id, remaining_credits, used_credits, sms_count)
       VALUES ($1, $2, $3, $4)`,
      [salonId, remaining, used || null, smsCount || null]
    );
  } catch (err) {
    logger.debug('Failed to log brevo credits', { error: err.message });
  }
  if (typeof remaining === 'number' && remaining < BREVO_CREDIT_LOW_THRESHOLD) {
    alertBrevoCreditsLow(salonId, remaining);
  }
}

// ============================================
// Circuit breaker for Brevo API (per salon)
// After 3 consecutive failures, short-circuit for 60s
// ============================================
const brevoCircuits = {};

function getCircuit(salonId) {
  if (!brevoCircuits[salonId]) {
    brevoCircuits[salonId] = {
      failures: 0,
      threshold: BREVO_CIRCUIT_THRESHOLD,
      cooldownMs: BREVO_CIRCUIT_COOLDOWN_MS,
      openedAt: null,
      keyDisabled: false,      // true when Brevo returns 401 (key disabled/not found)
      keyDisabledAt: null,
    };
  }
  return brevoCircuits[salonId];
}

// keyDisabled cooldown: re-test the key every 5 min instead of blocking forever.
// Brevo can return transient 401s (account checks, recharge in progress) — without
// this, the in-memory flag stays true until server restart even after the key recovers.
const KEY_DISABLED_COOLDOWN_MS = 5 * 60 * 1000;

function isCircuitOpen(salonId = 'meylan') {
  const circuit = getCircuit(salonId);
  if (circuit.keyDisabled) {
    if (circuit.keyDisabledAt && Date.now() - new Date(circuit.keyDisabledAt).getTime() > KEY_DISABLED_COOLDOWN_MS) {
      circuit.keyDisabled = false;
      circuit.keyDisabledAt = null;
      logger.info('Brevo keyDisabled flag reset (cooldown elapsed) — will retry', { salonId });
      return false;
    }
    return true;
  }
  if (circuit.failures < circuit.threshold) return false;
  if (!circuit.openedAt) return false;
  if (Date.now() - circuit.openedAt > circuit.cooldownMs) {
    circuit.failures = 0;
    circuit.openedAt = null;
    logger.info('Brevo circuit breaker reset (cooldown elapsed)', { salonId });
    alertCircuitClosed(salonId);
    return false;
  }
  return true;
}

function recordBrevoSuccess(salonId = 'meylan') {
  const circuit = getCircuit(salonId);
  if (circuit.failures > 0 || circuit.keyDisabled) {
    circuit.failures = 0;
    circuit.openedAt = null;
    circuit.keyDisabled = false;
    circuit.keyDisabledAt = null;
  }
}

function recordBrevoFailure(salonId = 'meylan', statusCode) {
  const circuit = getCircuit(salonId);
  // 401 = key disabled/not found -- permanent block, no retry
  if (statusCode === 401) {
    circuit.keyDisabled = true;
    circuit.keyDisabledAt = new Date().toISOString();
    logger.error(`BREVO KEY DISABLED for ${salonId} — all emails/SMS blocked until key is reactivated`, { salonId });
    alertCircuitOpen(salonId, 0, 'CLE API DESACTIVEE');
    return;
  }
  circuit.failures++;
  if (circuit.failures >= circuit.threshold && !circuit.openedAt) {
    circuit.openedAt = Date.now();
    logger.warn(`Brevo circuit breaker OPEN — skipping calls for ${BREVO_CIRCUIT_COOLDOWN_MS / 1000}s`, { salonId, failures: circuit.failures });
    alertCircuitOpen(salonId, circuit.failures);
  }
}

/**
 * Get Brevo status, scoped to one salon (used by systemHealth + dashboard).
 * Pass a salonId to get only that salon's status; omit to get all salons (internal use).
 */
function getBrevoStatus(salonId) {
  const salonIds = salonId ? [salonId] : ['meylan', 'grenoble'];
  const result = {};
  for (const id of salonIds) {
    const circuit = getCircuit(id);
    const brevo = getBrevoConfig(id);
    const credits = latestCredits[id] || null;
    result[id] = {
      keyConfigured: !!brevo.apiKey,
      keyDisabled: circuit.keyDisabled,
      keyDisabledAt: circuit.keyDisabledAt,
      circuitOpen: isCircuitOpen(id),
      failures: circuit.failures,
      smsCredits: credits ? credits.remainingCredits : null,
      smsCreditsRecordedAt: credits ? credits.recordedAt : null,
      lowCreditThreshold: BREVO_CREDIT_LOW_THRESHOLD,
    };
  }
  return result;
}

/**
 * Check Brevo API keys on startup -- logs warning if a key is dead
 */
async function checkBrevoKeys() {
  for (const salonId of ['meylan', 'grenoble']) {
    const brevo = getBrevoConfig(salonId);
    if (!brevo.apiKey) {
      logger.warn(`Brevo API key not configured for ${salonId}`);
      continue;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': brevo.apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status === 401) {
        // Don't flip the circuit at boot — Brevo occasionally returns transient 401s on cold start.
        // Real sends will trip the flag if the key is genuinely dead.
        logger.warn(`STARTUP CHECK: Brevo returned 401 for ${salonId} — will retry on first real send`, { salonId });
      } else if (response.ok) {
        logger.info(`Brevo key OK for ${salonId}`);
      } else {
        logger.warn(`Brevo key check returned ${response.status} for ${salonId}`);
      }
    } catch (err) {
      logger.warn(`Brevo key check failed for ${salonId}: ${err.message}`);
    }
  }
}

// ============================================
// Salon-aware Brevo credentials helper
// ============================================
function getBrevoConfig(salonId) {
  const salon = config.getSalonConfig(salonId);
  // Fallback to global config.brevo for backward compat
  return salon.brevo && salon.brevo.apiKey
    ? salon.brevo
    : config.brevo;
}

// ============================================
// Brevo API helpers (salon-aware)
// ============================================

async function brevoEmail(to, subject, htmlContent, salonId = 'meylan', meta = {}) {
  if (config.nodeEnv === 'test') {
    logger.debug('Brevo email skipped (test mode)', { to, subject });
    return;
  }
  if (isCircuitOpen(salonId)) {
    throw new Error('Brevo circuit breaker open — skipping email');
  }
  const brevo = getBrevoConfig(salonId);
  if (!brevo.apiKey) {
    logger.error('Brevo API key not configured — email not sent', { salonId, to });
    throw new Error(`Brevo API key not configured for salon ${salonId}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BREVO_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevo.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: brevo.senderEmail, name: brevo.senderName },
        to: [{ email: to }],
        subject,
        htmlContent,
        textContent: htmlToText(htmlContent),
        headers: {
          'X-Mailin-Tag': meta.type || 'transactional',
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      recordBrevoFailure(salonId, response.status);
      // Log failed email (skip if already tracked by queue processor)
      if (!meta.fromQueue) {
        try {
          await db.query(
            `INSERT INTO notification_queue (id, booking_id, type, status, channel, email, recipient_name, subject, salon_id, created_at, last_error)
             VALUES (gen_random_uuid(), $1, $2, 'failed', 'email', $3, $4, $5, $6, NOW(), $7)`,
            [meta.bookingId || null, meta.type || 'email', to, meta.recipientName || null, subject, salonId, `${response.status}: ${errorBody.slice(0, 200)}`]
          );
        } catch (_) { /* silent */ }
      }
      throw new Error(`Brevo email API error ${response.status}: ${errorBody}`);
    }
    recordBrevoSuccess(salonId);

    let parsed = {};
    try { parsed = await response.json(); } catch (_) {}
    const messageId = parsed.messageId != null ? String(parsed.messageId) : null;

    if (meta.fromQueue) {
      // Update subject + messageId on the existing queue row
      try {
        if (meta.queueId) {
          await db.query(
            'UPDATE notification_queue SET subject = $1, provider_message_id = COALESCE($2, provider_message_id) WHERE id = $3',
            [subject, messageId, meta.queueId]
          );
        }
      } catch (_) { /* silent */ }
    } else {
      // Log successful email as a new row (direct send, not from queue)
      try {
        await db.query(
          `INSERT INTO notification_queue (id, booking_id, type, status, channel, email, recipient_name, subject, salon_id, created_at, sent_at, provider_message_id)
           VALUES (gen_random_uuid(), $1, $2, 'sent', 'email', $3, $4, $5, $6, NOW(), NOW(), $7)`,
          [meta.bookingId || null, meta.type || 'email', to, meta.recipientName || null, subject, salonId, messageId]
        );
      } catch (_) { /* silent */ }
    }
    return { messageId };
  } catch (err) {
    if (err.name === 'AbortError') recordBrevoFailure(salonId);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function brevoSMS(phone, content, salonId = 'meylan') {
  if (config.nodeEnv === 'test') {
    logger.debug('Brevo SMS skipped (test mode)', { phone });
    return { messageId: null, remainingCredits: null };
  }
  if (isCircuitOpen(salonId)) {
    throw new Error('Brevo circuit breaker open — skipping SMS');
  }
  const brevo = getBrevoConfig(salonId);
  if (!brevo.apiKey) {
    logger.error('Brevo API key not configured — SMS not sent', { salonId, phone });
    throw new Error(`Brevo API key not configured for salon ${salonId}`);
  }
  const recipient = formatPhoneInternational(phone);

  // Pre-send credit gate — block if last known balance is critical
  // Avoid silent failures: better to throw and let queue mark failed than
  // burn an API call that Brevo will reject silently
  const known = latestCredits[salonId];
  if (known && typeof known.remainingCredits === 'number'
      && known.remainingCredits < BREVO_CREDIT_CRITICAL_THRESHOLD) {
    logger.warn('Brevo SMS blocked — credits below critical threshold', {
      salonId, remaining: known.remainingCredits, threshold: BREVO_CREDIT_CRITICAL_THRESHOLD,
    });
    throw new Error(`Brevo credits epuises (${known.remainingCredits}) pour ${salonId}`);
  }

  // Skip blacklisted numbers — Brevo already told us they fail permanently
  try {
    const bl = await db.query('SELECT 1 FROM sms_blacklist WHERE phone = $1', [recipient]);
    if (bl.rows.length > 0) {
      logger.info('Brevo SMS blocked — phone blacklisted', { recipient, salonId });
      throw new Error(`Numero blackliste: ${recipient}`);
    }
  } catch (err) {
    if (err.message.startsWith('Numero blackliste')) throw err;
    // DB error: continue (don't block SMS on DB hiccup)
    logger.debug('Blacklist check skipped', { error: err.message });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BREVO_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
      method: 'POST',
      headers: {
        'api-key': brevo.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: brevo.smsSender,
        recipient,
        content,
        type: 'transactional',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      recordBrevoFailure(salonId, response.status);
      throw new Error(`Brevo SMS API error ${response.status}: ${errorBody}`);
    }
    recordBrevoSuccess(salonId);

    // Parse Brevo response: { reference, messageId, smsCount, usedCredits, remainingCredits }
    let parsed = {};
    try {
      parsed = await response.json();
    } catch (_) {
      // Shouldn't happen on 2xx but don't break the send if body is weird
    }
    const messageId = parsed.messageId != null ? String(parsed.messageId) : null;
    const remainingCredits = typeof parsed.remainingCredits === 'number' ? parsed.remainingCredits : null;
    const usedCredits = typeof parsed.usedCredits === 'number' ? parsed.usedCredits : null;
    const smsCount = typeof parsed.smsCount === 'number' ? parsed.smsCount : null;

    if (remainingCredits != null) {
      // Fire and forget — don't block the send on credit logging
      logCredits(salonId, remainingCredits, usedCredits, smsCount).catch(() => {});
    }

    return { messageId, remainingCredits, reference: parsed.reference || null };
  } catch (err) {
    if (err.name === 'AbortError') recordBrevoFailure(salonId);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  brevoEmail,
  brevoSMS,
  getBrevoConfig,
  getBrevoStatus,
  checkBrevoKeys,
};
