const db = require('../config/database');
const config = require('../config/env');
const logger = require('../utils/logger');
const {
  NOTIFICATION_RETRY_DELAYS,
  NOTIFICATION_BATCH_SIZE,
  BREVO_CIRCUIT_THRESHOLD,
  BREVO_CIRCUIT_COOLDOWN_MS,
  BREVO_REQUEST_TIMEOUT_MS,
} = require('../constants');
const { alertCircuitOpen, alertCircuitClosed } = require('../utils/discord');

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
 * ALL types are handled here — single code path for the queue processor.
 *
 * SMS types: phone + message are pre-stored in the queue row.
 * Email types: booking data comes from LEFT JOINs on the queue row.
 */
async function sendNotification(notification) {
  const type = notification.type;

  // ── SMS types: use pre-stored phone + message ──
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

  // ── Email types: build template from JOINed booking data ──
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
      // Don't throw on unknown types — just skip (prevents stuck queue entries)
      logger.warn(`Unknown notification type: ${type}, skipping`, { id: notification.id });
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

function isCircuitOpen(salonId = 'meylan') {
  const circuit = getCircuit(salonId);
  // If key is disabled (401), block ALL calls until manually resolved
  if (circuit.keyDisabled) return true;
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
  // 401 = key disabled/not found — permanent block, no retry
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
 * Get Brevo status for all salons (used by systemHealth + dashboard)
 */
function getBrevoStatus() {
  const result = {};
  for (const salonId of ['meylan', 'grenoble']) {
    const circuit = getCircuit(salonId);
    const brevo = getBrevoConfig(salonId);
    result[salonId] = {
      keyConfigured: !!brevo.apiKey,
      keyDisabled: circuit.keyDisabled,
      keyDisabledAt: circuit.keyDisabledAt,
      circuitOpen: isCircuitOpen(salonId),
      failures: circuit.failures,
    };
  }
  return result;
}

/**
 * Check Brevo API keys on startup — logs warning if a key is dead
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
        const circuit = getCircuit(salonId);
        circuit.keyDisabled = true;
        circuit.keyDisabledAt = new Date().toISOString();
        logger.error(`STARTUP CHECK: Brevo key DISABLED for ${salonId} — emails/SMS will NOT work`, { salonId });
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
      // Log failed email
      try {
        await db.query(
          `INSERT INTO notification_queue (id, booking_id, type, status, channel, email, recipient_name, subject, salon_id, created_at, last_error)
           VALUES (gen_random_uuid(), $1, $2, 'failed', 'email', $3, $4, $5, $6, NOW(), $7)`,
          [meta.bookingId || null, meta.type || 'email', to, meta.recipientName || null, subject, salonId, `${response.status}: ${errorBody.slice(0, 200)}`]
        );
      } catch (_) { /* silent */ }
      throw new Error(`Brevo email API error ${response.status}: ${errorBody}`);
    }
    recordBrevoSuccess(salonId);
    // Log successful email
    try {
      await db.query(
        `INSERT INTO notification_queue (id, booking_id, type, status, channel, email, recipient_name, subject, salon_id, created_at, sent_at)
         VALUES (gen_random_uuid(), $1, $2, 'sent', 'email', $3, $4, $5, $6, NOW(), NOW())`,
        [meta.bookingId || null, meta.type || 'email', to, meta.recipientName || null, subject, salonId]
      );
    } catch (_) { /* silent */ }
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
    return;
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
  } catch (err) {
    if (err.name === 'AbortError') recordBrevoFailure(salonId);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send confirmation email via Brevo
 */
async function sendConfirmationEmail(data) {
  const salonId = data.salon_id || 'meylan';
  const salon = config.getSalonConfig(salonId);

  if (!data.email) {
    logger.info('No client email, skipping confirmation email', { bookingId: data.booking_id });
    return;
  }

  const cancelUrl = `${config.siteUrl}${salon.bookingPath}/mon-rdv.html?id=${data.booking_id}&token=${data.cancel_token}`;

  const dateFormatted = formatDateFR(data.date);
  const timeFormatted = formatTime(data.start_time);
  const priceFormatted = (data.price / 100).toFixed(2).replace('.', ',');

  const html = buildConfirmationEmailHTML({
    firstName: data.first_name,
    serviceName: data.service_name,
    barberName: data.barber_name,
    date: dateFormatted,
    time: timeFormatted,
    price: priceFormatted,
    cancelUrl,
    address: salon.address,
    mapsUrl: salon.mapsUrl,
    salonName: salon.name,
    salonId,
  });

  await brevoEmail(data.email, `Confirmation RDV - ${data.service_name} le ${dateFormatted}`, html, salonId, {
    bookingId: data.booking_id, type: 'confirmation_email', recipientName: data.first_name,
  });
}

/**
 * Send SMS reminder via Brevo
 */
async function sendReminderSMS(data) {
  const salonId = data.salon_id || 'meylan';
  const salon = config.getSalonConfig(salonId);

  if (!data.phone) {
    logger.info('No client phone, skipping reminder SMS', { bookingId: data.booking_id });
    return;
  }

  const timeFormatted = formatTime(data.start_time);
  const dateFR = formatDateFR(typeof data.date === 'string' ? data.date.slice(0, 10) : data.date);

  const message = `${salon.name} - Rappel RDV le ${dateFR} a ${timeFormatted} au ${salon.address}.`;

  await brevoSMS(data.phone, message, salonId);

  // Mark reminder as sent on the booking
  await db.query(
    'UPDATE bookings SET reminder_sent = true WHERE id = $1',
    [data.booking_id]
  );
}


// ============================================
// Email HTML templates
// ============================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlToText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/&eacute;/g, 'é').replace(/&agrave;/g, 'à').replace(/&euro;/g, '€')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Base URL for hosted assets (Cloudflare Pages — stable URL for email images)
const ASSETS_BASE = 'https://barberclub-site.pages.dev';
const LOGO_URL = `${ASSETS_BASE}/assets/images/common/logo-blanc.png`;
const CROWN_URL = `${ASSETS_BASE}/assets/images/common/couronne.png`;

// Design tokens — monochrome dark luxury
const ACCENT = '#FFFFFF';
const ACCENT_DIM = '#D4D4D4';
const DARK_BG = '#0C0A09';
const CARD_BG = '#1C1917';
const CARD_BORDER = '#292524';
const TEXT_PRIMARY = '#FAFAF9';
const TEXT_SECONDARY = '#A8A29E';
const TEXT_MUTED = '#78716C';
const INSTAGRAM_URL = 'https://www.instagram.com/barberclub_grenoble/';

/**
 * Extract display label from salon name (e.g. "BarberClub Meylan" → "Meylan")
 */
function getSalonLabel(salonId) {
  return salonId === 'grenoble' ? 'Grenoble' : 'Meylan';
}

function emailShell(content, { showHero = true, marketing = false, salonId = 'meylan' } = {}) {
  const salon = config.getSalonConfig(salonId);
  const salonLabel = getSalonLabel(salonId);
  const salonHeroImg = `${ASSETS_BASE}${salon.heroImage}`;
  const siteUrl = config.siteUrl || 'https://barberclub-grenoble.fr';
  const phoneClean = (salon.phone || '').replace(/[\s.-]/g, '');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; }
    body, .body-bg { background-color: #000000 !important; }
    .dark-bg { background-color: ${DARK_BG} !important; }
    .card-bg { background-color: ${CARD_BG} !important; }
    @media (prefers-color-scheme: dark) {
      .body-bg { background-color: #000000 !important; }
      .dark-bg { background-color: ${DARK_BG} !important; }
      .card-bg { background-color: ${CARD_BG} !important; }
    }
  </style>
</head>
<body class="body-bg" style="margin:0;padding:0;background-color:#000000;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;" bgcolor="#000000">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color:#000000;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" class="dark-bg" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${DARK_BG}" style="max-width:600px;width:100%;background-color:${DARK_BG};border-left:1px solid ${CARD_BORDER};border-right:1px solid ${CARD_BORDER};">

    ${showHero ? `
          <!-- HERO — Salon photo with logo overlay -->
          <tr>
            <td bgcolor="#000000" style="background-color:#000000;padding:0;position:relative;">
              <!--[if gte mso 9]>
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:260px;">
                <v:fill type="frame" src="${salonHeroImg}" />
                <v:textbox inset="0,0,0,0">
              <![endif]-->
              <div style="background:url('${salonHeroImg}') center/cover no-repeat #000;min-height:220px;text-align:center;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="background:linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.7) 100%);padding:44px 24px 36px;text-align:center;">
                    <img src="${CROWN_URL}" alt="" width="22" style="width:22px;height:auto;opacity:0.8;margin-bottom:8px;display:inline-block;">
                    <br>
                    <img src="${LOGO_URL}" alt="BarberClub" width="180" style="width:180px;height:auto;display:inline-block;">
                    <p style="margin:10px 0 0;color:${ACCENT};font-size:10px;letter-spacing:5px;text-transform:uppercase;font-weight:700;">${salonLabel}</p>
                  </td></tr>
                </table>
              </div>
              <!--[if gte mso 9]>
                </v:textbox>
              </v:rect>
              <![endif]-->
            </td>
          </tr>
          <tr>
            <td style="height:2px;background:linear-gradient(90deg, transparent 0%, ${ACCENT_DIM} 20%, ${ACCENT} 50%, ${ACCENT_DIM} 80%, transparent 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
    ` : `
          <!-- Compact header without hero -->
          <tr>
            <td bgcolor="${DARK_BG}" style="background-color:${DARK_BG};text-align:center;padding:36px 24px 20px;border-bottom:1px solid ${CARD_BORDER};">
              <img src="${CROWN_URL}" alt="" width="22" style="width:22px;height:auto;margin-bottom:8px;opacity:0.7;">
              <br>
              <img src="${LOGO_URL}" alt="BarberClub" width="170" style="width:170px;height:auto;">
              <p style="margin:8px 0 0;color:${ACCENT};font-size:10px;letter-spacing:5px;text-transform:uppercase;font-weight:700;">${salonLabel}</p>
            </td>
          </tr>
    `}

          <!-- CONTENT -->
          <tr>
            <td bgcolor="${DARK_BG}" style="background-color:${DARK_BG};padding:36px 32px 40px;color:${TEXT_PRIMARY};">
              ${content}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td bgcolor="#000000" style="background-color:#000000;border-top:1px solid ${CARD_BORDER};padding:28px 32px 32px;text-align:center;">
              <!-- Social + Contact row -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px;">
                <tr>
                  <!-- Instagram -->
                  <td style="padding:0 12px;">
                    <a href="${INSTAGRAM_URL}" style="color:${TEXT_MUTED};text-decoration:none;font-size:12px;letter-spacing:0.5px;">
                      <img src="https://cdn-icons-png.flaticon.com/512/174/174855.png" alt="Instagram" width="18" height="18" style="width:18px;height:18px;vertical-align:middle;opacity:0.6;margin-right:6px;">Instagram
                    </a>
                  </td>
                  <!-- Phone -->
                  ${salon.phone ? `<td style="padding:0 12px;border-left:1px solid ${CARD_BORDER};">
                    <a href="tel:${phoneClean}" style="color:${TEXT_MUTED};text-decoration:none;font-size:12px;letter-spacing:0.5px;">
                      &#9742; ${escapeHtml(salon.phone)}
                    </a>
                  </td>` : ''}
                  <!-- Website -->
                  <td style="padding:0 12px;border-left:1px solid ${CARD_BORDER};">
                    <a href="${siteUrl}" style="color:${TEXT_MUTED};text-decoration:none;font-size:12px;letter-spacing:0.5px;">
                      barberclub-grenoble.fr
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Separator -->
              <div style="height:1px;background:${CARD_BORDER};margin:0 40px 16px;"></div>

              <!-- Address -->
              <p style="margin:0 0 4px;color:${TEXT_MUTED};font-size:11px;letter-spacing:0.3px;">
                ${escapeHtml(salon.name)} &mdash; <a href="${salon.mapsUrl}" style="color:${TEXT_MUTED};text-decoration:underline;">${escapeHtml(salon.address)}</a>
              </p>
              <p style="margin:0;color:${TEXT_MUTED};font-size:10px;opacity:0.5;">Paiement sur place uniquement</p>
              ${marketing ? `<p style="margin:10px 0 0;color:${TEXT_MUTED};font-size:10px;opacity:0.5;">Si vous ne souhaitez plus recevoir ces emails, r&eacute;pondez &laquo;&nbsp;STOP&nbsp;&raquo; &agrave; cet email.</p>` : ''}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildConfirmationEmailHTML({ firstName, serviceName, barberName, date, time, price, cancelUrl, address, mapsUrl, salonId = 'meylan' }) {
  firstName = escapeHtml(firstName);
  serviceName = escapeHtml(serviceName);
  barberName = escapeHtml(barberName);
  date = escapeHtml(date);
  time = escapeHtml(time);
  price = escapeHtml(price);
  address = escapeHtml(address);
  mapsUrl = mapsUrl || '#';

  // Build barber photo URL from name
  const barberPhotoUrl = getBarberPhotoUrl(barberName);

  const content = `
      <div style="text-align:center;margin-bottom:32px;">
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Rendez-vous confirm&eacute;</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          ${firstName ? `${firstName}, votre` : 'Votre'} r&eacute;servation est enregistr&eacute;e.
        </p>
      </div>

      <!-- Time highlight -->
      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};text-align:center;padding:24px 20px;border-radius:16px;">
            <p style="margin:0 0 4px;color:${ACCENT};font-size:11px;text-transform:uppercase;letter-spacing:3px;font-weight:600;">Votre rendez-vous</p>
            <p style="margin:0;color:${ACCENT};font-size:36px;font-weight:800;letter-spacing:1px;">${time}</p>
            <p style="margin:6px 0 0;color:${TEXT_SECONDARY};font-size:14px;">${date}</p>
          </td>
        </tr>
      </table>

      <!-- Detail card -->
      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr>
          <td style="height:3px;background:linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT}, ${ACCENT_DIM});font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;width:100px;">Prestation</td>
                <td style="padding:10px 0;color:${TEXT_PRIMARY};font-size:15px;font-weight:600;text-align:right;">${serviceName}</td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Barbier</td>
                <td style="padding:10px 0;text-align:right;">
                  ${barberPhotoUrl ? `<img src="${barberPhotoUrl}" alt="" width="28" height="28" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:8px;object-fit:cover;border:1.5px solid ${ACCENT_DIM};">` : ''}
                  <span style="color:${TEXT_SECONDARY};font-size:14px;vertical-align:middle;">${barberName}</span>
                </td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Adresse</td>
                <td style="padding:10px 0;text-align:right;">
                  <a href="${mapsUrl}" style="color:${TEXT_SECONDARY};font-size:13px;text-decoration:none;">
                    &#128205; <span style="text-decoration:underline;">${address}</span>
                  </a>
                </td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:12px 0 4px;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Prix</td>
                <td style="padding:12px 0 4px;color:${ACCENT};font-size:22px;font-weight:800;text-align:right;">${price}<span style="font-size:14px;font-weight:400;color:${TEXT_MUTED};"> &euro;</span></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:20px;">
        <a href="${cancelUrl}" style="display:inline-block;background-color:${ACCENT};color:#000000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
          G&eacute;rer mon rendez-vous
        </a>
      </div>

      <!-- Cancellation policy -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
        <tr>
          <td style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px 18px;text-align:center;">
            <p style="margin:0;color:${TEXT_SECONDARY};font-size:12px;line-height:1.5;">
              &#9432; Modification ou annulation <strong style="color:${TEXT_PRIMARY};">gratuite jusqu'&agrave; 12h</strong> avant le rendez-vous
            </p>
          </td>
        </tr>
      </table>`;

  return emailShell(content, { salonId });
}

// ============================================
// Helpers
// ============================================

/**
 * Build barber photo URL from barber name
 * Maps: "Lucas" -> /assets/images/barbers/lucas.png, "Julien" -> julien.jpg, etc.
 */
function getBarberPhotoUrl(barberName) {
  if (!barberName) return null;
  const name = barberName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const known = ['lucas', 'julien', 'tom', 'alan', 'nathan', 'clement'];
  if (!known.includes(name)) return null;
  // Use /email/ subfolder with real JPEG files (originals are AVIF with wrong extension)
  return `${ASSETS_BASE}/assets/images/barbers/email/${name}.jpg`;
}

function formatDateFR(dateStr) {
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  const d = new Date(dateStr + 'T00:00:00');
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const str = typeof timeStr === 'string' ? timeStr : timeStr.toString();
  return str.substring(0, 5); // HH:MM
}

function formatPhoneInternational(phone) {
  // Convert French phone to international format
  let cleaned = phone.replace(/[\s.-]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '+33' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('+')) {
    cleaned = '+33' + cleaned;
  }
  return cleaned;
}

function getNextRetryTime(attempts) {
  // Exponential backoff: 5min, 15min, 1h
  const delayMinutes = NOTIFICATION_RETRY_DELAYS[Math.min(attempts - 1, NOTIFICATION_RETRY_DELAYS.length - 1)];
  const next = new Date();
  next.setMinutes(next.getMinutes() + delayMinutes);
  return next;
}

/**
 * Send cancellation email directly (admin-triggered, not queued)
 */
async function sendCancellationEmail({ email, first_name, service_name, barber_name, date, start_time, price, salon_id }) {
  const salonId = salon_id || 'meylan';
  const salon = config.getSalonConfig(salonId);

  if (!email) {
    logger.warn('No email, skipping cancellation email');
    return;
  }

  const dateFormatted = escapeHtml(formatDateFR(date));
  const timeFormatted = escapeHtml(formatTime(start_time));
  const priceFormatted = escapeHtml((price / 100).toFixed(2).replace('.', ','));
  service_name = escapeHtml(service_name);
  barber_name = escapeHtml(barber_name);

  const bookAgainUrl = `${config.siteUrl}${salon.bookingPath}/reserver.html`;

  const html = emailShell(`
      <div style="text-align:center;margin-bottom:32px;">
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Rendez-vous annul&eacute;</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          Votre r&eacute;servation a bien &eacute;t&eacute; annul&eacute;e.
        </p>
      </div>

      <!-- Cancelled details -->
      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr><td style="height:3px;background:linear-gradient(90deg, rgba(239,68,68,0.3), rgba(239,68,68,0.6), rgba(239,68,68,0.3));font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;width:100px;">Prestation</td>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:15px;text-align:right;text-decoration:line-through;">${service_name}</td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Barbier</td>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:14px;text-align:right;text-decoration:line-through;">${barber_name}</td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Date</td>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:14px;text-align:right;text-decoration:line-through;">${dateFormatted} &agrave; ${timeFormatted}</td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:12px 0 4px;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Prix</td>
                <td style="padding:12px 0 4px;color:${TEXT_MUTED};font-size:18px;font-weight:700;text-align:right;text-decoration:line-through;">${priceFormatted}<span style="font-size:13px;font-weight:400;"> &euro;</span></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:20px;">
        <p style="color:${TEXT_SECONDARY};font-size:13px;margin:0 0 20px;">N'h&eacute;sitez pas &agrave; reprendre rendez-vous en ligne.</p>
        <a href="${bookAgainUrl}" style="display:inline-block;background:${ACCENT};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
          Reprendre rendez-vous
        </a>
      </div>`, { showHero: false, salonId });

  await brevoEmail(email, `RDV annulé - ${service_name} le ${dateFormatted}`, html, salonId, {
    type: 'cancellation_email', recipientName: first_name,
  });
  logger.info('Cancellation email sent', { email, salonId });
}

/**
 * Send reschedule email directly (admin-triggered, not queued)
 */
async function sendRescheduleEmail({ email, first_name, service_name, barber_name, old_date, old_time, new_date, new_time, new_barber_name, price, cancel_token, booking_id, salon_id }) {
  const salonId = salon_id || 'meylan';
  const salon = config.getSalonConfig(salonId);

  if (!email) {
    logger.warn('No email, skipping reschedule email');
    return;
  }

  const oldDateFormatted = escapeHtml(formatDateFR(old_date));
  const oldTimeFormatted = escapeHtml(formatTime(old_time));
  const newDateFormatted = escapeHtml(formatDateFR(new_date));
  const newTimeFormatted = escapeHtml(formatTime(new_time));
  const priceFormatted = escapeHtml((price / 100).toFixed(2).replace('.', ','));
  service_name = escapeHtml(service_name);
  barber_name = escapeHtml(barber_name);
  new_barber_name = escapeHtml(new_barber_name);

  const manageUrl = cancel_token && booking_id
    ? `${config.siteUrl}${salon.bookingPath}/mon-rdv.html?id=${booking_id}&token=${cancel_token}`
    : null;

  const effectiveBarber = new_barber_name || barber_name;
  const barberPhotoUrl = getBarberPhotoUrl(effectiveBarber);

  const html = emailShell(`
      <div style="text-align:center;margin-bottom:32px;">
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Rendez-vous d&eacute;plac&eacute;</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          Votre cr&eacute;neau a &eacute;t&eacute; modifi&eacute; avec succ&egrave;s.
        </p>
      </div>

      <!-- Ancien cr&eacute;neau -->
      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:16px;opacity:0.6;">
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};padding:16px 20px;border-radius:16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td style="padding:4px 0;color:${TEXT_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:1.5px;">Ancien cr&eacute;neau</td>
                <td style="padding:4px 0;color:${TEXT_MUTED};font-size:14px;text-align:right;text-decoration:line-through;">
                  ${oldDateFormatted} &agrave; ${oldTimeFormatted}${old_date !== new_date || barber_name !== new_barber_name ? ` &mdash; ${barber_name}` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Nouveau cr&eacute;neau -->
      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr><td style="height:3px;background:linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT}, ${ACCENT_DIM});font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};padding:24px;">
            <p style="margin:0 0 16px;color:${ACCENT};font-size:11px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">Nouveau cr&eacute;neau</p>

            <table role="presentation" class="dark-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${DARK_BG}" style="background-color:${DARK_BG};border:1px solid ${CARD_BORDER};border-radius:12px;margin-bottom:20px;">
              <tr>
                <td bgcolor="${DARK_BG}" style="background-color:${DARK_BG};text-align:center;padding:16px;border-radius:12px;">
                  <p style="margin:0;color:${ACCENT};font-size:32px;font-weight:800;letter-spacing:1px;">${newTimeFormatted}</p>
                  <p style="margin:4px 0 0;color:${TEXT_SECONDARY};font-size:14px;">${newDateFormatted}</p>
                </td>
              </tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;width:100px;">Prestation</td>
                <td style="padding:10px 0;color:${TEXT_PRIMARY};font-size:15px;font-weight:600;text-align:right;">${service_name}</td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Barbier</td>
                <td style="padding:10px 0;text-align:right;">
                  ${barberPhotoUrl ? `<img src="${barberPhotoUrl}" alt="" width="28" height="28" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:8px;object-fit:cover;border:1.5px solid ${ACCENT_DIM};">` : ''}
                  <span style="color:${TEXT_SECONDARY};font-size:14px;vertical-align:middle;">${effectiveBarber}</span>
                </td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Adresse</td>
                <td style="padding:10px 0;text-align:right;">
                  <a href="${salon.mapsUrl}" style="color:${TEXT_SECONDARY};font-size:13px;text-decoration:none;">
                    &#128205; <span style="text-decoration:underline;">${escapeHtml(salon.address)}</span>
                  </a>
                </td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:12px 0 4px;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Prix</td>
                <td style="padding:12px 0 4px;color:${ACCENT};font-size:22px;font-weight:800;text-align:right;">${priceFormatted}<span style="font-size:14px;font-weight:400;color:${TEXT_MUTED};"> &euro;</span></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${manageUrl ? `<div style="text-align:center;margin-bottom:20px;">
        <a href="${manageUrl}" style="display:inline-block;background:${ACCENT};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
          G&eacute;rer mon rendez-vous
        </a>
      </div>
      <!-- Cancellation policy -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
        <tr>
          <td style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px 18px;text-align:center;">
            <p style="margin:0;color:${TEXT_SECONDARY};font-size:12px;line-height:1.5;">
              &#9432; Modification ou annulation <strong style="color:${TEXT_PRIMARY};">gratuite jusqu'&agrave; 12h</strong> avant le rendez-vous
            </p>
          </td>
        </tr>
      </table>` : ''}`, { showHero: false, salonId });

  await brevoEmail(email, `RDV déplacé - ${service_name} le ${newDateFormatted} à ${newTimeFormatted}`, html, salonId, {
    bookingId: booking_id, type: 'reschedule_email', recipientName: first_name,
  });
  logger.info('Reschedule email sent', { email, salonId });
}

/**
 * Send password reset email directly (not queued)
 */
/**
 * Send review request email (Google review) — triggered 60min post-completed
 */
async function sendReviewEmail(data) {
  const salonId = data.salon_id || 'meylan';
  const salon = config.getSalonConfig(salonId);

  if (!data.email) {
    logger.info('No client email, skipping review email', { bookingId: data.booking_id });
    return;
  }

  const apiUrl = config.apiUrl || 'https://barberclub-grenoble.fr';
  const reviewLink = apiUrl + '/r/avis?salon=' + salonId;
  const barberName = escapeHtml(data.barber_name || '');
  const firstName = escapeHtml(data.first_name || '');
  const barberPhotoUrl = getBarberPhotoUrl(data.barber_name);
  const bookingUrl = `${config.siteUrl}${salon.bookingPath}/reserver.html`;

  const html = emailShell(`
      <div style="text-align:center;margin-bottom:32px;">
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Merci pour votre visite !</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          ${firstName ? `${firstName}, nous` : 'Nous'} esp&eacute;rons que vous &ecirc;tes satisfait.
        </p>
      </div>

      ${barberPhotoUrl ? `
      <div style="text-align:center;margin-bottom:28px;">
        <img src="${barberPhotoUrl}" alt="${barberName}" width="72" height="72" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid ${ACCENT_DIM};">
        <p style="margin:10px 0 0;color:${TEXT_SECONDARY};font-size:13px;">Votre barbier : <strong style="color:${TEXT_PRIMARY};">${barberName}</strong></p>
      </div>` : ''}

      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr><td style="height:3px;background:linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT}, ${ACCENT_DIM});font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};padding:28px 24px;text-align:center;">
            <p style="margin:0 0 8px;font-size:28px;">&#11088;&#11088;&#11088;&#11088;&#11088;</p>
            <p style="margin:0 0 20px;color:${TEXT_SECONDARY};font-size:14px;line-height:1.7;">
              Votre avis compte &eacute;norm&eacute;ment pour nous.<br>
              En 30 secondes, aidez d'autres clients &agrave; d&eacute;couvrir BarberClub.
            </p>
            <a href="${reviewLink}" style="display:inline-block;background:${ACCENT};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
              Laisser un avis Google
            </a>
          </td>
        </tr>
      </table>

      <div style="text-align:center;">
        <a href="${bookingUrl}" style="color:${TEXT_SECONDARY};font-size:13px;text-decoration:underline;">
          Reprendre rendez-vous
        </a>
      </div>`, { salonId });

  await brevoEmail(data.email, `Votre avis compte — ${salon.name}`, html, salonId, {
    bookingId: data.booking_id, type: 'review_email', recipientName: firstName,
  });
  logger.info('Review email sent', { bookingId: data.booking_id, email: data.email, salonId });
}

async function sendResetPasswordEmail({ email, first_name, resetUrl, salon_id }) {
  const salonId = salon_id || 'meylan';
  const brevo = getBrevoConfig(salonId);
  if (!brevo.apiKey) {
    logger.warn('Brevo API key not configured, logging reset URL instead');
    logger.info('Password reset URL', { email, resetUrl });
    return;
  }

  first_name = escapeHtml(first_name);

  const html = emailShell(`
      <div style="text-align:center;margin-bottom:32px;">
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">R&eacute;initialiser votre mot de passe</h2>
      </div>

      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr><td style="height:3px;background:linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT}, ${ACCENT_DIM});font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};padding:28px 24px;">
            <p style="margin:0 0 24px;color:${TEXT_SECONDARY};font-size:14px;line-height:1.7;">
              Bonjour${first_name ? ` ${first_name}` : ''},<br><br>
              Vous avez demand&eacute; la r&eacute;initialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
            </p>
            <div style="text-align:center;">
              <a href="${resetUrl}" style="display:inline-block;background:${ACCENT};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
                Nouveau mot de passe
              </a>
            </div>
          </td>
        </tr>
      </table>

      <div style="text-align:center;color:${TEXT_MUTED};font-size:11px;line-height:1.6;">
        <p style="margin:0 0 4px;">Ce lien expire dans 1 heure.</p>
        <p style="margin:0;">Si vous n'avez pas fait cette demande, ignorez cet email.</p>
      </div>`, { showHero: false, salonId });

  await brevoEmail(email, 'Réinitialisation de votre mot de passe BarberClub', html, salonId, {
    type: 'reset_password_email',
  });
  logger.info('Reset password email sent', { email, salonId });
}

/**
 * Send SMS reminder directly (without DB update — caller handles it)
 */
async function sendReminderSMSDirect(data) {
  const salonId = data.salon_id || 'meylan';
  const salon = config.getSalonConfig(salonId);

  const timeFormatted = formatTime(data.start_time);
  const dateFR = formatDateFR(typeof data.date === 'string' ? data.date.slice(0, 10) : data.date);

  const message = `${salon.name} - Rappel RDV le ${dateFR} a ${timeFormatted} au ${salon.address}.`;

  await brevoSMS(data.phone, message, salonId);
}

/**
 * Send SMS confirmation directly after booking creation
 * Sent when booking is within 24h
 */
async function sendConfirmationSMS(data) {
  const salonId = data.salon_id || 'meylan';
  const salon = config.getSalonConfig(salonId);

  const timeFormatted = formatTime(data.start_time);
  const dateFR = formatDateFR(typeof data.date === 'string' ? data.date.slice(0, 10) : data.date);

  const message = `${salon.name} - RDV confirme le ${dateFR} a ${timeFormatted} avec ${data.barber_name}. ${salon.address}`;

  await brevoSMS(data.phone, message, salonId);
  logger.info('Confirmation SMS sent', { bookingId: data.booking_id, phone: data.phone, salonId });
}

async function sendWaitlistSMS(data) {
  const salonId = data.salon_id || 'meylan';
  if (!data.phone) return;
  await brevoSMS(data.phone, data.message, salonId);
  logger.info('Waitlist SMS sent', { phone: data.phone, salonId });
}

module.exports = {
  queueNotification,
  processPendingNotifications,
  sendNotification,
  sendConfirmationEmail,
  sendConfirmationSMS,
  sendReminderSMSDirect,
  sendCancellationEmail,
  sendRescheduleEmail,
  sendReviewEmail,
  sendResetPasswordEmail,
  sendWaitlistSMS,
  formatDateFR,
  formatTime,
  brevoSMS,
  brevoEmail,
  formatPhoneInternational,
  emailShell,
  escapeHtml,
  getBrevoConfig,
  getSalonLabel,
  getBrevoStatus,
  checkBrevoKeys,
};
