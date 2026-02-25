const db = require('../config/database');
const config = require('../config/env');
const logger = require('../utils/logger');

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
       LIMIT 10
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
    case 'review_email':
      await sendReviewEmail(notification);
      break;
    default:
      throw new Error(`Unknown notification type: ${notification.type}`);
  }
}

// ============================================
// Brevo API helpers
// ============================================

async function brevoEmail(to, subject, htmlContent) {
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
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo email API error ${response.status}: ${errorBody}`);
  }
}

async function brevoSMS(phone, content) {
  const recipient = formatPhoneInternational(phone);
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
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo SMS API error ${response.status}: ${errorBody}`);
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

  // Update booking email tracking
  await db.query(
    'UPDATE bookings SET reminder_sent = false WHERE id = $1',
    [data.booking_id]
  );
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

/**
 * Send Google review request email via Brevo
 */
async function sendReviewEmail(data) {
  if (!config.brevo.apiKey || !data.email) {
    logger.warn('Brevo not configured or no email, skipping review email');
    return;
  }

  const html = buildReviewEmailHTML({
    firstName: data.first_name,
    barberName: data.barber_name,
    reviewUrl: config.salon.googleReviewUrl,
  });

  await brevoEmail(data.email, 'Merci pour votre visite chez BarberClub !', html);

  await db.query(
    'UPDATE bookings SET review_email_sent = true WHERE id = $1',
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

// Base URL for hosted assets (Cloudflare Pages)
const ASSETS_BASE = 'https://barberclub-site.pages.dev';
const LOGO_URL = `${ASSETS_BASE}/assets/images/common/logo-blanc.png`;
const CROWN_URL = `${ASSETS_BASE}/assets/images/common/couronne.png`;
const HERO_URL = `${ASSETS_BASE}/assets/images/salons/meylan/salon-meylan-interieur.jpg`;

// Design tokens — luxury dark + gold
const GOLD = '#CA8A04';
const GOLD_LIGHT = '#EAB308';
const DARK_BG = '#0C0A09';
const CARD_BG = '#1C1917';
const CARD_BORDER = '#292524';
const TEXT_PRIMARY = '#FAFAF9';
const TEXT_SECONDARY = '#A8A29E';
const TEXT_MUTED = '#78716C';

function emailShell(content, { showHero = true, accentColor = GOLD } = {}) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:600px;margin:0 auto;background:${DARK_BG};border-left:1px solid ${CARD_BORDER};border-right:1px solid ${CARD_BORDER};">

    ${showHero ? `
    <!-- HERO — Salon photo with overlay -->
    <div style="position:relative;overflow:hidden;height:240px;background:#000;">
      <img src="${HERO_URL}" alt="" style="width:100%;height:240px;object-fit:cover;display:block;opacity:0.35;">
      <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(180deg, rgba(12,10,9,0.2) 0%, rgba(12,10,9,0.95) 100%);"></div>
      <div style="position:absolute;bottom:0;left:0;right:0;text-align:center;padding:0 24px 28px;">
        <img src="${LOGO_URL}" alt="BarberClub" style="width:200px;height:auto;margin-bottom:4px;">
        <div style="display:inline-block;margin-top:6px;">
          <span style="color:${GOLD};font-size:10px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">Meylan</span>
        </div>
      </div>
    </div>
    <!-- Gold accent line -->
    <div style="height:2px;background:linear-gradient(90deg, transparent 0%, ${GOLD} 30%, ${GOLD_LIGHT} 50%, ${GOLD} 70%, transparent 100%);"></div>
    ` : `
    <!-- Compact header without hero -->
    <div style="text-align:center;padding:36px 24px 20px;border-bottom:1px solid ${CARD_BORDER};">
      <img src="${CROWN_URL}" alt="" style="width:28px;height:auto;margin-bottom:8px;opacity:0.7;">
      <br>
      <img src="${LOGO_URL}" alt="BarberClub" style="width:170px;height:auto;">
      <div style="margin-top:8px;">
        <span style="color:${GOLD};font-size:10px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">Meylan</span>
      </div>
    </div>
    <div style="height:1px;background:linear-gradient(90deg, transparent 10%, ${GOLD}40 50%, transparent 90%);"></div>
    `}

    <!-- CONTENT -->
    <div style="padding:36px 32px 40px;color:${TEXT_PRIMARY};">
      ${content}
    </div>

    <!-- FOOTER -->
    <div style="border-top:1px solid ${CARD_BORDER};padding:24px 32px 28px;text-align:center;">
      <img src="${CROWN_URL}" alt="" style="width:16px;height:auto;opacity:0.3;margin-bottom:10px;">
      <p style="margin:0 0 4px;color:${TEXT_MUTED};font-size:11px;letter-spacing:0.3px;">BarberClub Meylan &mdash; 26 Av. du Gr&eacute;sivaudan, 38700 Corenc</p>
      <p style="margin:0;color:${TEXT_MUTED};font-size:10px;opacity:0.6;">Paiement sur place uniquement</p>
    </div>
  </div>
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
      <!-- Status badge -->
      <div style="text-align:center;margin-bottom:32px;">
        <div style="display:inline-block;border:2px solid ${GOLD};border-radius:50%;width:56px;height:56px;line-height:52px;text-align:center;margin-bottom:16px;">
          <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/check.svg" alt="" style="width:28px;height:28px;vertical-align:middle;filter:invert(62%) sepia(98%) saturate(375%) hue-rotate(11deg) brightness(97%) contrast(89%);">
        </div>
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Rendez-vous confirm&eacute;</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          ${firstName ? `${firstName}, votre` : 'Votre'} r&eacute;servation est enregistr&eacute;e.
        </p>
      </div>

      <!-- Time highlight -->
      <div style="text-align:center;margin-bottom:28px;padding:20px;background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;">
        <p style="margin:0 0 4px;color:${TEXT_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:2px;">Votre rendez-vous</p>
        <p style="margin:0;color:${GOLD_LIGHT};font-size:32px;font-weight:800;letter-spacing:1px;">${time}</p>
        <p style="margin:4px 0 0;color:${TEXT_SECONDARY};font-size:14px;">${date}</p>
      </div>

      <!-- Detail card -->
      <div style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;overflow:hidden;margin-bottom:28px;">
        <!-- Gold top border -->
        <div style="height:3px;background:linear-gradient(90deg, ${GOLD}, ${GOLD_LIGHT}, ${GOLD});"></div>
        <div style="padding:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;width:100px;">
                <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/scissors.svg" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.5;filter:invert(1);">Prestation
              </td>
              <td style="padding:10px 0;color:${TEXT_PRIMARY};font-size:15px;font-weight:600;text-align:right;">${serviceName}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid ${CARD_BORDER};"></div></td></tr>
            <tr>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">
                <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/user.svg" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.5;filter:invert(1);">Barbier
              </td>
              <td style="padding:10px 0;color:${TEXT_SECONDARY};font-size:14px;text-align:right;">${barberName}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid ${CARD_BORDER};"></div></td></tr>
            <tr>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">
                <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/map-pin.svg" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.5;filter:invert(1);">Adresse
              </td>
              <td style="padding:10px 0;color:${TEXT_SECONDARY};font-size:13px;text-align:right;">${address}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid ${CARD_BORDER};"></div></td></tr>
            <tr>
              <td style="padding:12px 0 4px;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Prix</td>
              <td style="padding:12px 0 4px;color:${GOLD_LIGHT};font-size:22px;font-weight:800;text-align:right;">${price}<span style="font-size:14px;font-weight:400;color:${TEXT_MUTED};"> &euro;</span></td>
            </tr>
          </table>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:20px;">
        <a href="${cancelUrl}" style="display:inline-block;background:${GOLD};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
          G&eacute;rer mon rendez-vous
        </a>
      </div>
      <p style="text-align:center;color:${TEXT_MUTED};font-size:11px;margin:0;">
        Modification ou annulation gratuite jusqu'&agrave; 12h avant
      </p>`;

  return emailShell(content);
}

function buildReviewEmailHTML({ firstName, barberName, reviewUrl }) {
  firstName = escapeHtml(firstName);
  barberName = escapeHtml(barberName);

  const content = `
      <!-- Star icon -->
      <div style="text-align:center;margin-bottom:32px;">
        <div style="display:inline-block;border:2px solid ${GOLD};border-radius:50%;width:56px;height:56px;line-height:52px;text-align:center;margin-bottom:16px;">
          <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/star.svg" alt="" style="width:28px;height:28px;vertical-align:middle;filter:invert(62%) sepia(98%) saturate(375%) hue-rotate(11deg) brightness(97%) contrast(89%);">
        </div>
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">
          Merci pour votre visite${firstName ? `, ${firstName}` : ''}&nbsp;!
        </h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:10px 0 0;line-height:1.6;">
          Nous esp&eacute;rons que votre passage avec <strong style="color:${TEXT_PRIMARY};">${barberName}</strong> vous a plu.
        </p>
      </div>

      <!-- 5 stars visual -->
      <div style="text-align:center;margin-bottom:28px;">
        <table style="margin:0 auto;border-collapse:collapse;"><tr>
          ${[1,2,3,4,5].map(() => `<td style="padding:0 3px;"><img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/star.svg" alt="" style="width:24px;height:24px;filter:invert(62%) sepia(98%) saturate(375%) hue-rotate(11deg) brightness(97%) contrast(89%);"></td>`).join('')}
        </tr></table>
      </div>

      <!-- Review card -->
      <div style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;overflow:hidden;margin-bottom:28px;">
        <div style="height:3px;background:linear-gradient(90deg, ${GOLD}, ${GOLD_LIGHT}, ${GOLD});"></div>
        <div style="padding:28px 24px;text-align:center;">
          <p style="color:${TEXT_SECONDARY};font-size:14px;margin:0 0 6px;line-height:1.6;">Votre avis compte &eacute;norm&eacute;ment pour nous</p>
          <p style="color:${TEXT_MUTED};font-size:12px;margin:0 0 24px;line-height:1.6;">
            Un petit mot sur Google aide d'autres clients &agrave; nous d&eacute;couvrir<br>et nous permet de continuer &agrave; nous am&eacute;liorer.
          </p>
          <a href="${reviewUrl}" style="display:inline-block;background:${GOLD};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
            Laisser un avis Google
          </a>
        </div>
      </div>

      <p style="text-align:center;color:${TEXT_MUTED};font-size:11px;margin:0;opacity:0.6;">
        Cet email est envoy&eacute; une seule fois apr&egrave;s votre premi&egrave;re visite.
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
  const delays = [5, 15, 60];
  const delayMinutes = delays[Math.min(attempts - 1, delays.length - 1)];
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
      <!-- Status icon -->
      <div style="text-align:center;margin-bottom:32px;">
        <div style="display:inline-block;border:2px solid #DC2626;border-radius:50%;width:56px;height:56px;line-height:52px;text-align:center;margin-bottom:16px;">
          <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/x.svg" alt="" style="width:28px;height:28px;vertical-align:middle;filter:invert(25%) sepia(98%) saturate(7404%) hue-rotate(355deg) brightness(93%) contrast(90%);">
        </div>
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Rendez-vous annul&eacute;</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          Votre r&eacute;servation a bien &eacute;t&eacute; annul&eacute;e.
        </p>
      </div>

      <!-- Cancelled details -->
      <div style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;overflow:hidden;margin-bottom:28px;">
        <div style="height:3px;background:linear-gradient(90deg, #DC2626, #EF4444, #DC2626);"></div>
        <div style="padding:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;width:100px;">
                <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/scissors.svg" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.5;filter:invert(1);">Prestation
              </td>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:15px;text-align:right;text-decoration:line-through;">${service_name}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid ${CARD_BORDER};"></div></td></tr>
            <tr>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">
                <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/user.svg" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.5;filter:invert(1);">Barbier
              </td>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:14px;text-align:right;text-decoration:line-through;">${barber_name}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid ${CARD_BORDER};"></div></td></tr>
            <tr>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">
                <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/calendar.svg" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.5;filter:invert(1);">Date
              </td>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:14px;text-align:right;text-decoration:line-through;">${dateFormatted} &agrave; ${timeFormatted}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid ${CARD_BORDER};"></div></td></tr>
            <tr>
              <td style="padding:12px 0 4px;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Prix</td>
              <td style="padding:12px 0 4px;color:${TEXT_MUTED};font-size:18px;font-weight:700;text-align:right;text-decoration:line-through;">${priceFormatted}<span style="font-size:13px;font-weight:400;"> &euro;</span></td>
            </tr>
          </table>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:20px;">
        <p style="color:${TEXT_SECONDARY};font-size:13px;margin:0 0 20px;">N'h&eacute;sitez pas &agrave; reprendre rendez-vous en ligne.</p>
        <a href="${config.siteUrl}/pages/meylan/reserver.html" style="display:inline-block;background:${GOLD};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
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
      <!-- Status icon -->
      <div style="text-align:center;margin-bottom:32px;">
        <div style="display:inline-block;border:2px solid #3B82F6;border-radius:50%;width:56px;height:56px;line-height:52px;text-align:center;margin-bottom:16px;">
          <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/calendar-clock.svg" alt="" style="width:28px;height:28px;vertical-align:middle;filter:invert(42%) sepia(93%) saturate(1352%) hue-rotate(207deg) brightness(99%) contrast(97%);">
        </div>
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Rendez-vous d&eacute;plac&eacute;</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          Votre cr&eacute;neau a &eacute;t&eacute; modifi&eacute; avec succ&egrave;s.
        </p>
      </div>

      <!-- Ancien cr&eacute;neau (barr&eacute;) -->
      <div style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;overflow:hidden;margin-bottom:12px;opacity:0.6;">
        <div style="height:2px;background:#DC2626;"></div>
        <div style="padding:16px 20px;display:flex;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;color:${TEXT_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:1.5px;">Ancien cr&eacute;neau</td>
              <td style="padding:4px 0;color:${TEXT_MUTED};font-size:14px;text-align:right;text-decoration:line-through;">
                ${oldDateFormatted} &agrave; ${oldTimeFormatted}${old_date !== new_date || barber_name !== new_barber_name ? ` &mdash; ${barber_name}` : ''}
              </td>
            </tr>
          </table>
        </div>
      </div>

      <!-- Arrow down -->
      <div style="text-align:center;margin:4px 0;">
        <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/arrow-down.svg" alt="" style="width:20px;height:20px;opacity:0.3;filter:invert(1);">
      </div>

      <!-- Nouveau cr&eacute;neau -->
      <div style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;overflow:hidden;margin-bottom:28px;margin-top:4px;">
        <div style="height:3px;background:linear-gradient(90deg, ${GOLD}, ${GOLD_LIGHT}, ${GOLD});"></div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;color:${GOLD};font-size:11px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">Nouveau cr&eacute;neau</p>

          <!-- Time highlight -->
          <div style="text-align:center;margin-bottom:20px;padding:16px;background:${DARK_BG};border:1px solid ${CARD_BORDER};border-radius:12px;">
            <p style="margin:0;color:${GOLD_LIGHT};font-size:32px;font-weight:800;letter-spacing:1px;">${newTimeFormatted}</p>
            <p style="margin:4px 0 0;color:${TEXT_SECONDARY};font-size:14px;">${newDateFormatted}</p>
          </div>

          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;width:100px;">
                <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/scissors.svg" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.5;filter:invert(1);">Prestation
              </td>
              <td style="padding:10px 0;color:${TEXT_PRIMARY};font-size:15px;font-weight:600;text-align:right;">${service_name}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid ${CARD_BORDER};"></div></td></tr>
            <tr>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">
                <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/user.svg" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.5;filter:invert(1);">Barbier
              </td>
              <td style="padding:10px 0;color:${TEXT_SECONDARY};font-size:14px;text-align:right;">${new_barber_name || barber_name}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid ${CARD_BORDER};"></div></td></tr>
            <tr>
              <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">
                <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/map-pin.svg" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.5;filter:invert(1);">Adresse
              </td>
              <td style="padding:10px 0;color:${TEXT_SECONDARY};font-size:13px;text-align:right;">${escapeHtml(config.salon.address)}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid ${CARD_BORDER};"></div></td></tr>
            <tr>
              <td style="padding:12px 0 4px;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Prix</td>
              <td style="padding:12px 0 4px;color:${GOLD_LIGHT};font-size:22px;font-weight:800;text-align:right;">${priceFormatted}<span style="font-size:14px;font-weight:400;color:${TEXT_MUTED};"> &euro;</span></td>
            </tr>
          </table>
        </div>
      </div>

      <!-- CTA -->
      ${manageUrl ? `<div style="text-align:center;margin-bottom:20px;">
        <a href="${manageUrl}" style="display:inline-block;background:${GOLD};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
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
      <!-- Lock icon -->
      <div style="text-align:center;margin-bottom:32px;">
        <div style="display:inline-block;border:2px solid ${GOLD};border-radius:50%;width:56px;height:56px;line-height:52px;text-align:center;margin-bottom:16px;">
          <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/lock-keyhole.svg" alt="" style="width:28px;height:28px;vertical-align:middle;filter:invert(62%) sepia(98%) saturate(375%) hue-rotate(11deg) brightness(97%) contrast(89%);">
        </div>
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">R&eacute;initialiser votre mot de passe</h2>
      </div>

      <!-- Card -->
      <div style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;overflow:hidden;margin-bottom:28px;">
        <div style="height:3px;background:linear-gradient(90deg, ${GOLD}, ${GOLD_LIGHT}, ${GOLD});"></div>
        <div style="padding:28px 24px;">
          <p style="margin:0 0 24px;color:${TEXT_SECONDARY};font-size:14px;line-height:1.7;">
            Bonjour${first_name ? ` ${first_name}` : ''},<br><br>
            Vous avez demand&eacute; la r&eacute;initialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
          </p>
          <div style="text-align:center;">
            <a href="${resetUrl}" style="display:inline-block;background:${GOLD};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
              Nouveau mot de passe
            </a>
          </div>
        </div>
      </div>

      <!-- Security notice -->
      <div style="text-align:center;padding:16px;background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:12px;">
        <table style="margin:0 auto;border-collapse:collapse;">
          <tr>
            <td style="padding-right:10px;vertical-align:middle;">
              <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/shield-check.svg" alt="" style="width:16px;height:16px;opacity:0.4;filter:invert(1);">
            </td>
            <td style="vertical-align:middle;">
              <p style="margin:0;color:${TEXT_MUTED};font-size:11px;line-height:1.6;">
                Ce lien expire dans 1 heure.<br>
                Si vous n'avez pas fait cette demande, ignorez cet email.
              </p>
            </td>
          </tr>
        </table>
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

module.exports = {
  queueNotification,
  processPendingNotifications,
  sendNotification,
  sendConfirmationEmail,
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
