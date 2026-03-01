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

/**
 * Queue a notification for async sending
 * @param {string} bookingId
 * @param {string} type - 'confirmation_email', 'reminder_sms', 'review_email'
 */
async function queueNotification(bookingId, type) {
  await db.query(
    `INSERT INTO notification_queue (booking_id, type, status, next_retry_at)
     VALUES ($1, $2, 'pending', NOW())`,
    [bookingId, type]
  );
  logger.info('Notification queued', { bookingId, type });
}

/**
 * Process pending notifications (called by cron job)
 * Picks up pending items and attempts to send them
 */
async function processPendingNotifications() {
  // Atomically claim pending notifications by setting status = 'processing'
  // This prevents duplicate sends if the cron overlaps or runs concurrently
  const claimed = await db.query(
    `UPDATE notification_queue
     SET status = 'processing'
     WHERE id IN (
       SELECT nq.id FROM notification_queue nq
       WHERE nq.status = 'pending'
         AND nq.next_retry_at <= NOW()
         AND nq.attempts < nq.max_attempts
       ORDER BY nq.created_at
       LIMIT ${NOTIFICATION_BATCH_SIZE}
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id`
  );

  if (claimed.rows.length === 0) return;

  const claimedIds = claimed.rows.map(r => r.id);

  // Now fetch full data for claimed notifications
  const result = await db.query(
    `SELECT nq.*, b.date, b.start_time, b.end_time, b.price, b.cancel_token,
            s.name as service_name,
            br.name as barber_name,
            c.first_name, c.last_name, c.phone, c.email
     FROM notification_queue nq
     JOIN bookings b ON nq.booking_id = b.id
     JOIN services s ON b.service_id = s.id
     JOIN barbers br ON b.barber_id = br.id
     JOIN clients c ON b.client_id = c.id
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
 * Actually send a notification based on its type
 */
async function sendNotification(notification) {
  switch (notification.type) {
    case 'confirmation_email':
      await sendConfirmationEmail(notification);
      break;
    case 'reminder_sms':
      await sendReminderSMS(notification);
      break;
    default:
      throw new Error(`Unknown notification type: ${notification.type}`);
  }
}

// ============================================
// Circuit breaker for Brevo API
// After 3 consecutive failures, short-circuit for 60s to avoid
// blocking every booking with 15s timeouts.
// ============================================
const brevoCircuit = {
  failures: 0,
  threshold: BREVO_CIRCUIT_THRESHOLD,
  cooldownMs: BREVO_CIRCUIT_COOLDOWN_MS,
  openedAt: null,
};

function isCircuitOpen() {
  if (brevoCircuit.failures < brevoCircuit.threshold) return false;
  if (!brevoCircuit.openedAt) return false;
  if (Date.now() - brevoCircuit.openedAt > brevoCircuit.cooldownMs) {
    // Half-open: allow one attempt through
    brevoCircuit.failures = 0;
    brevoCircuit.openedAt = null;
    logger.info('Brevo circuit breaker reset (cooldown elapsed)');
    return false;
  }
  return true;
}

function recordBrevoSuccess() {
  if (brevoCircuit.failures > 0) {
    brevoCircuit.failures = 0;
    brevoCircuit.openedAt = null;
  }
}

function recordBrevoFailure() {
  brevoCircuit.failures++;
  if (brevoCircuit.failures >= brevoCircuit.threshold && !brevoCircuit.openedAt) {
    brevoCircuit.openedAt = Date.now();
    logger.warn(`Brevo circuit breaker OPEN — skipping calls for ${BREVO_CIRCUIT_COOLDOWN_MS / 1000}s`, { failures: brevoCircuit.failures });
  }
}

// ============================================
// Brevo API helpers
// ============================================

async function brevoEmail(to, subject, htmlContent) {
  if (isCircuitOpen()) {
    throw new Error('Brevo circuit breaker open — skipping email');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BREVO_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': config.brevo.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: config.brevo.senderEmail, name: config.brevo.senderName },
        to: [{ email: to }],
        subject,
        htmlContent,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      recordBrevoFailure();
      throw new Error(`Brevo email API error ${response.status}: ${errorBody}`);
    }
    recordBrevoSuccess();
  } catch (err) {
    if (err.name === 'AbortError') recordBrevoFailure();
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function brevoSMS(phone, content) {
  if (isCircuitOpen()) {
    throw new Error('Brevo circuit breaker open — skipping SMS');
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
      recordBrevoFailure();
      throw new Error(`Brevo SMS API error ${response.status}: ${errorBody}`);
    }
    recordBrevoSuccess();
  } catch (err) {
    if (err.name === 'AbortError') recordBrevoFailure();
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send confirmation email via Brevo
 */
async function sendConfirmationEmail(data) {
  if (!config.brevo.apiKey) {
    logger.warn('Brevo API key not configured, skipping email');
    return;
  }
  if (!data.email) {
    logger.info('No client email, skipping confirmation email', { bookingId: data.booking_id });
    return;
  }

  const cancelUrl = `${config.siteUrl}/pages/meylan/mon-rdv.html?id=${data.booking_id}&token=${data.cancel_token}`;

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
    address: config.salon.address,
  });

  await brevoEmail(data.email, `Confirmation RDV - ${data.service_name} le ${dateFormatted}`, html);
}

/**
 * Send SMS reminder via Brevo
 */
async function sendReminderSMS(data) {
  if (!config.brevo.apiKey) {
    logger.warn('Brevo not configured, skipping SMS');
    return;
  }
  if (!data.phone) {
    logger.info('No client phone, skipping reminder SMS', { bookingId: data.booking_id });
    return;
  }

  const rdvUrl = `${config.apiUrl}/r/rdv/${data.booking_id}/${data.cancel_token}`;
  const timeFormatted = formatTime(data.start_time);
  const dateFR = formatDateFR(typeof data.date === 'string' ? data.date.slice(0, 10) : data.date);

  const message = `BarberClub Meylan - Rappel\n\nVotre RDV le ${dateFR} a ${timeFormatted} au 26 Av. du Gresivaudan, Corenc.\n\nGerer votre RDV : ${rdvUrl}`;

  await brevoSMS(data.phone, message);

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

// Base URL for hosted assets (production domain)
const ASSETS_BASE = config.siteUrl || 'https://barberclub-grenoble.fr';
const LOGO_URL = `${ASSETS_BASE}/assets/images/common/logo-blanc.png`;
const CROWN_URL = `${ASSETS_BASE}/assets/images/common/couronne.png`;
const HERO_URL = `${ASSETS_BASE}/assets/images/salons/meylan/salon-meylan-interieur.jpg`;

// Design tokens — monochrome dark luxury
const ACCENT = '#FFFFFF';
const ACCENT_DIM = '#D4D4D4';
const DARK_BG = '#0C0A09';
const CARD_BG = '#1C1917';
const CARD_BORDER = '#292524';
const TEXT_PRIMARY = '#FAFAF9';
const TEXT_SECONDARY = '#A8A29E';
const TEXT_MUTED = '#78716C';

function emailShell(content, { showHero = true, marketing = false } = {}) {
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
          <!-- HERO — Logo + salon name on dark bg -->
          <tr>
            <td bgcolor="#000000" style="background-color:#000000;text-align:center;padding:40px 24px 32px;">
              <img src="${LOGO_URL}" alt="BarberClub" width="200" style="width:200px;height:auto;display:inline-block;">
              <p style="margin:10px 0 0;color:${TEXT_SECONDARY};font-size:10px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">Meylan</p>
            </td>
          </tr>
          <tr>
            <td style="height:2px;background:linear-gradient(90deg, transparent 0%, ${ACCENT_DIM} 30%, ${ACCENT} 50%, ${ACCENT_DIM} 70%, transparent 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
    ` : `
          <!-- Compact header without hero -->
          <tr>
            <td bgcolor="${DARK_BG}" style="background-color:${DARK_BG};text-align:center;padding:36px 24px 20px;border-bottom:1px solid ${CARD_BORDER};">
              <img src="${CROWN_URL}" alt="" width="28" style="width:28px;height:auto;margin-bottom:8px;opacity:0.7;">
              <br>
              <img src="${LOGO_URL}" alt="BarberClub" width="170" style="width:170px;height:auto;">
              <p style="margin:8px 0 0;color:${TEXT_SECONDARY};font-size:10px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">Meylan</p>
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
            <td bgcolor="${DARK_BG}" style="background-color:${DARK_BG};border-top:1px solid ${CARD_BORDER};padding:24px 32px 28px;text-align:center;">
              <img src="${CROWN_URL}" alt="" width="16" style="width:16px;height:auto;opacity:0.3;margin-bottom:10px;">
              <p style="margin:0 0 4px;color:${TEXT_MUTED};font-size:11px;letter-spacing:0.3px;">BarberClub Meylan &mdash; 26 Av. du Gr&eacute;sivaudan, 38700 Corenc</p>
              <p style="margin:0;color:${TEXT_MUTED};font-size:10px;opacity:0.6;">Paiement sur place uniquement</p>
              ${marketing ? `<p style="margin:8px 0 0;color:${TEXT_MUTED};font-size:10px;opacity:0.5;">Si vous ne souhaitez plus recevoir ces emails, r&eacute;pondez &laquo;&nbsp;STOP&nbsp;&raquo; &agrave; cet email.</p>` : ''}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildConfirmationEmailHTML({ firstName, serviceName, barberName, date, time, price, cancelUrl, address }) {
  firstName = escapeHtml(firstName);
  serviceName = escapeHtml(serviceName);
  barberName = escapeHtml(barberName);
  date = escapeHtml(date);
  time = escapeHtml(time);
  price = escapeHtml(price);
  address = escapeHtml(address);

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
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};text-align:center;padding:20px;border-radius:16px;">
            <p style="margin:0 0 4px;color:${TEXT_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:2px;">Votre rendez-vous</p>
            <p style="margin:0;color:${ACCENT};font-size:32px;font-weight:800;letter-spacing:1px;">${time}</p>
            <p style="margin:4px 0 0;color:${TEXT_SECONDARY};font-size:14px;">${date}</p>
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
                <td style="padding:10px 0;color:${TEXT_SECONDARY};font-size:14px;text-align:right;">${barberName}</td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Adresse</td>
                <td style="padding:10px 0;color:${TEXT_SECONDARY};font-size:13px;text-align:right;"><a href="https://maps.google.com/?q=26+Av+du+Gr%C3%A9sivaudan+38700+Corenc" style="color:${TEXT_SECONDARY};text-decoration:underline;">${address}</a></td>
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
      <p style="text-align:center;color:${TEXT_MUTED};font-size:11px;margin:0;">
        Modification ou annulation gratuite jusqu'&agrave; 12h avant
      </p>`;

  return emailShell(content);
}

// ============================================
// Helpers
// ============================================

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
async function sendCancellationEmail({ email, first_name, service_name, barber_name, date, start_time, price }) {
  if (!config.brevo.apiKey || !email) {
    logger.warn('Brevo not configured or no email, skipping cancellation email');
    return;
  }

  const dateFormatted = escapeHtml(formatDateFR(date));
  const timeFormatted = escapeHtml(formatTime(start_time));
  const priceFormatted = escapeHtml((price / 100).toFixed(2).replace('.', ','));
  service_name = escapeHtml(service_name);
  barber_name = escapeHtml(barber_name);

  const html = emailShell(`
      <div style="text-align:center;margin-bottom:32px;">
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Rendez-vous annul&eacute;</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          Votre r&eacute;servation a bien &eacute;t&eacute; annul&eacute;e.
        </p>
      </div>

      <!-- Cancelled details -->
      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr><td style="height:3px;background:linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT}, ${ACCENT_DIM});font-size:0;line-height:0;">&nbsp;</td></tr>
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
        <a href="${config.siteUrl}/pages/meylan/reserver.html" style="display:inline-block;background:${ACCENT};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
          Reprendre rendez-vous
        </a>
      </div>`, { showHero: false });

  try {
    await brevoEmail(email, `RDV annulé - ${service_name} le ${dateFormatted}`, html);
    logger.info('Cancellation email sent', { email });
  } catch (err) {
    logger.error('Cancellation email failed', { error: err.message });
  }
}

/**
 * Send reschedule email directly (admin-triggered, not queued)
 */
async function sendRescheduleEmail({ email, first_name, service_name, barber_name, old_date, old_time, new_date, new_time, new_barber_name, price, cancel_token, booking_id }) {
  if (!config.brevo.apiKey || !email) {
    logger.warn('Brevo not configured or no email, skipping reschedule email');
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
    ? `${config.siteUrl}/pages/meylan/mon-rdv.html?id=${booking_id}&token=${cancel_token}`
    : null;

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
                <td style="padding:10px 0;color:${TEXT_SECONDARY};font-size:14px;text-align:right;">${new_barber_name || barber_name}</td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Adresse</td>
                <td style="padding:10px 0;color:${TEXT_SECONDARY};font-size:13px;text-align:right;">${escapeHtml(config.salon.address)}</td>
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
      <p style="text-align:center;color:${TEXT_MUTED};font-size:11px;margin:0;">
        Modification ou annulation gratuite jusqu'&agrave; 12h avant
      </p>` : ''}`, { showHero: false });

  try {
    await brevoEmail(email, `RDV déplacé - ${service_name} le ${newDateFormatted} à ${newTimeFormatted}`, html);
    logger.info('Reschedule email sent', { email });
  } catch (err) {
    logger.error('Reschedule email failed', { error: err.message });
  }
}

/**
 * Send password reset email directly (not queued)
 */
async function sendResetPasswordEmail({ email, first_name, resetUrl }) {
  if (!config.brevo.apiKey) {
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
      </div>`, { showHero: false });

  await brevoEmail(email, 'Réinitialisation de votre mot de passe BarberClub', html);
  logger.info('Reset password email sent', { email });
}

/**
 * Send SMS reminder directly (without DB update — caller handles it)
 * Used for immediate reminders when booking is within 24h
 */
async function sendReminderSMSDirect(data) {
  if (!config.brevo.apiKey) {
    logger.warn('Brevo not configured, skipping SMS');
    return;
  }

  const rdvUrl = `${config.apiUrl}/r/rdv/${data.booking_id}/${data.cancel_token}`;
  const timeFormatted = formatTime(data.start_time);
  const dateFR = formatDateFR(typeof data.date === 'string' ? data.date.slice(0, 10) : data.date);

  const message = `BarberClub Meylan - Rappel\n\nVotre RDV le ${dateFR} a ${timeFormatted} au 26 Av. du Gresivaudan, Corenc.\n\nGerer votre RDV : ${rdvUrl}`;

  await brevoSMS(data.phone, message);
}

/**
 * Send SMS confirmation directly after booking creation
 * Sent when booking is within 24h
 */
async function sendConfirmationSMS(data) {
  if (!config.brevo.apiKey) {
    logger.warn('Brevo not configured, skipping SMS');
    return;
  }

  const rdvUrl = `${config.apiUrl}/r/rdv/${data.booking_id}/${data.cancel_token}`;
  const timeFormatted = formatTime(data.start_time);
  const dateFR = formatDateFR(typeof data.date === 'string' ? data.date.slice(0, 10) : data.date);

  const message = `BarberClub Meylan - Confirmation\n\nVotre RDV le ${dateFR} a ${timeFormatted} avec ${data.barber_name} est confirme.\n\n26 Av. du Gresivaudan, Corenc\n\nGerer votre RDV : ${rdvUrl}`;

  await brevoSMS(data.phone, message);
  logger.info('Confirmation SMS sent', { bookingId: data.booking_id, phone: data.phone });
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
  sendResetPasswordEmail,
  formatDateFR,
  formatTime,
  brevoSMS,
  brevoEmail,
  formatPhoneInternational,
};
