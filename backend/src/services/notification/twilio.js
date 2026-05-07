const db = require('../../config/database');
const config = require('../../config/env');
const logger = require('../../utils/logger');
const {
  BREVO_CIRCUIT_THRESHOLD,
  BREVO_CIRCUIT_COOLDOWN_MS,
  BREVO_REQUEST_TIMEOUT_MS,
} = require('../../constants');
const { alertCircuitOpen, alertCircuitClosed } = require('../../utils/discord');
const { formatPhoneInternational } = require('./helpers');

// Lazy-load Twilio SDK so backend can boot even if package missing in dev
let TwilioClass = null;
function getTwilio() {
  if (!TwilioClass) TwilioClass = require('twilio');
  return TwilioClass;
}

// In-memory client cache per salon (Twilio client is reusable)
const clientsBySalon = {};

// ============================================
// Salon-aware Twilio credentials helper
// ============================================
function getTwilioConfig(salonId) {
  const salon = config.getSalonConfig(salonId);
  return salon.twilio && salon.twilio.accountSid
    ? salon.twilio
    : config.twilio;
}

function getTwilioClient(salonId) {
  if (clientsBySalon[salonId]) return clientsBySalon[salonId];
  const cfg = getTwilioConfig(salonId);
  if (!cfg.accountSid || !cfg.authToken) return null;
  const Twilio = getTwilio();
  clientsBySalon[salonId] = Twilio(cfg.accountSid, cfg.authToken);
  return clientsBySalon[salonId];
}

// ============================================
// Circuit breaker for Twilio API (per salon)
// Reuses Brevo thresholds (3 failures -> 60s cooldown)
// ============================================
const twilioCircuits = {};

function getCircuit(salonId) {
  if (!twilioCircuits[salonId]) {
    twilioCircuits[salonId] = {
      failures: 0,
      threshold: BREVO_CIRCUIT_THRESHOLD,
      cooldownMs: BREVO_CIRCUIT_COOLDOWN_MS,
      openedAt: null,
      authDisabled: false,    // true on auth errors (401, 20003)
      authDisabledAt: null,
    };
  }
  return twilioCircuits[salonId];
}

function isCircuitOpen(salonId = 'meylan') {
  const c = getCircuit(salonId);
  if (c.authDisabled) return true;
  if (c.failures < c.threshold) return false;
  if (!c.openedAt) return false;
  if (Date.now() - c.openedAt > c.cooldownMs) {
    c.failures = 0;
    c.openedAt = null;
    logger.info('Twilio circuit breaker reset (cooldown elapsed)', { salonId });
    alertCircuitClosed(salonId);
    return false;
  }
  return true;
}

function recordSuccess(salonId = 'meylan') {
  const c = getCircuit(salonId);
  if (c.failures > 0 || c.authDisabled) {
    c.failures = 0;
    c.openedAt = null;
    c.authDisabled = false;
    c.authDisabledAt = null;
  }
}

function recordFailure(salonId = 'meylan', err) {
  const c = getCircuit(salonId);
  // Twilio auth errors: 20003 (auth failed), 20005 (account suspended), HTTP 401
  const status = err && (err.status || err.statusCode);
  const code = err && err.code;
  if (status === 401 || code === 20003 || code === 20005) {
    c.authDisabled = true;
    c.authDisabledAt = new Date().toISOString();
    logger.error(`TWILIO AUTH DISABLED for ${salonId} — all SMS blocked until credentials reactivated`, {
      salonId, status, code,
    });
    alertCircuitOpen(salonId, 0, 'TWILIO AUTH DESACTIVEE');
    return;
  }
  c.failures++;
  if (c.failures >= c.threshold && !c.openedAt) {
    c.openedAt = Date.now();
    logger.warn(`Twilio circuit breaker OPEN — skipping calls for ${BREVO_CIRCUIT_COOLDOWN_MS / 1000}s`, {
      salonId, failures: c.failures,
    });
    alertCircuitOpen(salonId, c.failures);
  }
}

/**
 * Get Twilio status, scoped to a salon (used by systemHealth + dashboard).
 */
function getTwilioStatus(salonId) {
  const salonIds = salonId ? [salonId] : ['meylan', 'grenoble'];
  const result = {};
  for (const id of salonIds) {
    const c = getCircuit(id);
    const cfg = getTwilioConfig(id);
    result[id] = {
      configured: !!(cfg.accountSid && cfg.authToken),
      sender: cfg.smsSender || null,
      authDisabled: c.authDisabled,
      authDisabledAt: c.authDisabledAt,
      circuitOpen: isCircuitOpen(id),
      failures: c.failures,
    };
  }
  return result;
}

/**
 * Verify Twilio credentials at startup.
 * Calls accounts.fetch() which fails fast if SID/Token are wrong.
 */
async function checkTwilioKeys() {
  for (const salonId of ['meylan', 'grenoble']) {
    const cfg = getTwilioConfig(salonId);
    if (!cfg.accountSid || !cfg.authToken) {
      logger.warn(`Twilio not configured for ${salonId}`);
      continue;
    }
    try {
      const client = getTwilioClient(salonId);
      const acc = await client.api.accounts(cfg.accountSid).fetch();
      logger.info(`Twilio key OK for ${salonId} — account status: ${acc.status}`);
      if (acc.status !== 'active') {
        const c = getCircuit(salonId);
        c.authDisabled = true;
        c.authDisabledAt = new Date().toISOString();
        logger.error(`STARTUP CHECK: Twilio account NOT ACTIVE for ${salonId} (status=${acc.status})`, { salonId });
      }
    } catch (err) {
      logger.warn(`Twilio key check failed for ${salonId}: ${err.message}`);
      const status = err && (err.status || err.statusCode);
      if (status === 401 || err.code === 20003) {
        const c = getCircuit(salonId);
        c.authDisabled = true;
        c.authDisabledAt = new Date().toISOString();
        logger.error(`STARTUP CHECK: Twilio AUTH FAILED for ${salonId} — SMS will NOT work`, { salonId });
      }
    }
  }
}

/**
 * Send SMS via Twilio.
 * Returns { messageId, remainingCredits: null, reference: null }
 * (Twilio doesn't return credits in send response — balance fetched separately)
 */
async function twilioSMS(phone, content, salonId = 'meylan') {
  if (config.nodeEnv === 'test') {
    logger.debug('Twilio SMS skipped (test mode)', { phone });
    return { messageId: null, remainingCredits: null, reference: null };
  }
  if (isCircuitOpen(salonId)) {
    throw new Error('Twilio circuit breaker open — skipping SMS');
  }
  const cfg = getTwilioConfig(salonId);
  if (!cfg.accountSid || !cfg.authToken) {
    logger.error('Twilio not configured — SMS not sent', { salonId, phone });
    throw new Error(`Twilio not configured for salon ${salonId}`);
  }
  if (!cfg.smsSender) {
    throw new Error(`Twilio sender not configured for salon ${salonId}`);
  }

  const recipient = formatPhoneInternational(phone);

  // Skip blacklisted numbers (re-use Brevo's blacklist table — same data)
  try {
    const bl = await db.query('SELECT 1 FROM sms_blacklist WHERE phone = $1', [recipient]);
    if (bl.rows.length > 0) {
      logger.info('Twilio SMS blocked — phone blacklisted', { recipient, salonId });
      throw new Error(`Numero blackliste: ${recipient}`);
    }
  } catch (err) {
    if (err.message.startsWith('Numero blackliste')) throw err;
    logger.debug('Blacklist check skipped', { error: err.message });
  }

  const client = getTwilioClient(salonId);
  const params = {
    body: content,
    from: cfg.smsSender,
    to: recipient,
  };
  // Status callback for delivery receipts (optional but recommended)
  if (cfg.statusCallbackUrl) {
    params.statusCallback = cfg.statusCallbackUrl;
  }

  // Twilio SDK uses its own internal timeout; wrap in our own abort for safety
  let timer;
  try {
    const sendPromise = client.messages.create(params);
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Twilio request timeout')), BREVO_REQUEST_TIMEOUT_MS);
    });
    const message = await Promise.race([sendPromise, timeoutPromise]);
    clearTimeout(timer);

    recordSuccess(salonId);

    // Twilio returns: { sid, status, ... }
    const messageId = message.sid || null;
    return {
      messageId,
      remainingCredits: null, // Twilio doesn't expose per-send balance
      reference: null,
    };
  } catch (err) {
    if (timer) clearTimeout(timer);
    recordFailure(salonId, err);
    // Re-throw with cleaner message
    const code = err.code ? ` (code ${err.code})` : '';
    throw new Error(`Twilio SMS error${code}: ${err.message}`);
  }
}

module.exports = {
  twilioSMS,
  getTwilioConfig,
  getTwilioStatus,
  checkTwilioKeys,
};
