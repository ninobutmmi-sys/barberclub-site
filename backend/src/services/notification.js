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
const HERO_URL = `${ASSETS_BASE}/assets/images/salons/meylan/salon-meylan-interieur.jpg`;

function emailShell(content, { showHero = true } = {}) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:600px;margin:0 auto;background:#0a0a0a;">
    ${showHero ? `
    <!-- HERO with salon photo -->
    <div style="position:relative;background:#000;text-align:center;overflow:hidden;">
      <img src="${HERO_URL}" alt="BarberClub" style="width:100%;height:220px;object-fit:cover;display:block;opacity:0.4;">
      <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(180deg,rgba(0,0,0,0.3) 0%,rgba(0,0,0,0.8) 100%);"></div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
        <img src="${LOGO_URL}" alt="BarberClub" style="width:180px;height:auto;margin-bottom:8px;">
        <p style="color:rgba(255,255,255,0.6);font-size:12px;margin:0;letter-spacing:2px;text-transform:uppercase;">Meylan</p>
      </div>
    </div>
    ` : `
    <div style="text-align:center;padding:32px 24px 16px;">
      <img src="${LOGO_URL}" alt="BarberClub" style="width:160px;height:auto;">
      <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:6px 0 0;letter-spacing:2px;text-transform:uppercase;">Meylan</p>
    </div>
    `}
    <!-- CONTENT -->
    <div style="padding:32px 28px 40px;color:#fff;">
      ${content}
    </div>
    <!-- FOOTER -->
    <div style="padding:20px 28px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
      <p style="margin:0 0 4px;color:rgba(255,255,255,0.25);font-size:11px;">BarberClub Meylan — 26 Av. du Grésivaudan, 38700 Corenc</p>
      <p style="margin:0;color:rgba(255,255,255,0.2);font-size:10px;">Paiement sur place uniquement</p>
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
      <!-- Title -->
      <div style="text-align:center;margin-bottom:28px;">
        <div style="display:inline-block;background:rgba(34,197,94,0.12);border-radius:50%;width:48px;height:48px;line-height:48px;text-align:center;margin-bottom:12px;">
          <span style="font-size:22px;">✓</span>
        </div>
        <h2 style="font-size:22px;font-weight:700;margin:0;color:#fff;">Rendez-vous confirmé</h2>
        <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:6px 0 0;">Bonjour${firstName ? ` ${firstName}` : ''}, votre réservation est enregistrée.</p>
      </div>

      <!-- Recap card -->
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:24px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;width:110px;">Prestation</td>
            <td style="padding:8px 0;color:#fff;font-size:15px;font-weight:600;text-align:right;">${serviceName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Barbier</td>
            <td style="padding:8px 0;color:rgba(255,255,255,0.85);font-size:14px;text-align:right;">${barberName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Date</td>
            <td style="padding:8px 0;color:rgba(255,255,255,0.85);font-size:14px;text-align:right;">${date}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Heure</td>
            <td style="padding:8px 0;color:#fff;font-size:16px;font-weight:700;text-align:right;">${time}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:12px 0 0;"><div style="border-top:1px solid rgba(255,255,255,0.06);"></div></td>
          </tr>
          <tr>
            <td style="padding:12px 0 4px;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Prix</td>
            <td style="padding:12px 0 4px;color:#fff;font-size:20px;font-weight:800;text-align:right;">${price} <span style="font-size:14px;font-weight:400;">€</span></td>
          </tr>
        </table>
      </div>

      <!-- Address -->
      <div style="background:rgba(255,255,255,0.02);border-radius:10px;padding:14px 18px;margin-bottom:28px;text-align:center;">
        <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px;">📍 ${address}</p>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:16px;">
        <a href="${cancelUrl}" style="display:inline-block;background:#fff;color:#000;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
          Gérer mon rendez-vous
        </a>
      </div>
      <p style="text-align:center;color:rgba(255,255,255,0.3);font-size:11px;margin:0;">
        Modification ou annulation gratuite jusqu'à 12h avant
      </p>`;

  return emailShell(content);
}

function buildReviewEmailHTML({ firstName, barberName, reviewUrl }) {
  firstName = escapeHtml(firstName);
  barberName = escapeHtml(barberName);

  const content = `
      <div style="text-align:center;margin-bottom:28px;">
        <div style="display:inline-block;background:rgba(251,191,36,0.12);border-radius:50%;width:56px;height:56px;line-height:56px;text-align:center;margin-bottom:14px;">
          <span style="font-size:26px;">⭐</span>
        </div>
        <h2 style="font-size:22px;font-weight:700;margin:0;color:#fff;">
          Merci pour votre visite${firstName ? `, ${firstName}` : ''} !
        </h2>
        <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:10px 0 0;line-height:1.5;">
          Nous espérons que votre passage avec <strong style="color:rgba(255,255,255,0.85);">${barberName}</strong> vous a plu.
        </p>
      </div>

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:24px;margin-bottom:28px;text-align:center;">
        <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0 0 8px;">Votre avis compte pour nous</p>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0 0 20px;line-height:1.5;">
          Un petit mot sur Google aide d'autres clients à nous découvrir et nous permet de nous améliorer.
        </p>
        <a href="${reviewUrl}" style="display:inline-block;background:#fff;color:#000;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
          Laisser un avis Google
        </a>
      </div>

      <p style="text-align:center;color:rgba(255,255,255,0.25);font-size:11px;margin:0;">
        Cet email est envoyé une seule fois après votre première visite.
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
      <div style="text-align:center;margin-bottom:28px;">
        <div style="display:inline-block;background:rgba(239,68,68,0.12);border-radius:50%;width:48px;height:48px;line-height:48px;text-align:center;margin-bottom:12px;">
          <span style="font-size:22px;">✕</span>
        </div>
        <h2 style="font-size:22px;font-weight:700;margin:0;color:#fff;">Rendez-vous annulé</h2>
      </div>

      <div style="background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.12);border-radius:14px;padding:24px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;width:110px;">Prestation</td>
            <td style="padding:6px 0;color:rgba(255,255,255,0.6);font-size:14px;text-align:right;text-decoration:line-through;">${service_name}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Barbier</td>
            <td style="padding:6px 0;color:rgba(255,255,255,0.6);font-size:14px;text-align:right;text-decoration:line-through;">${barber_name}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Date</td>
            <td style="padding:6px 0;color:rgba(255,255,255,0.6);font-size:14px;text-align:right;text-decoration:line-through;">${dateFormatted} à ${timeFormatted}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Prix</td>
            <td style="padding:6px 0;color:rgba(255,255,255,0.6);font-size:14px;text-align:right;text-decoration:line-through;">${priceFormatted} €</td>
          </tr>
        </table>
      </div>

      <div style="text-align:center;margin-bottom:16px;">
        <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 20px;">N'hésitez pas à reprendre rendez-vous en ligne.</p>
        <a href="${config.siteUrl}/pages/meylan/reserver.html" style="display:inline-block;background:#fff;color:#000;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
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
      <div style="text-align:center;margin-bottom:28px;">
        <div style="display:inline-block;background:rgba(59,130,246,0.12);border-radius:50%;width:48px;height:48px;line-height:48px;text-align:center;margin-bottom:12px;">
          <span style="font-size:22px;">↻</span>
        </div>
        <h2 style="font-size:22px;font-weight:700;margin:0;color:#fff;">Rendez-vous déplacé</h2>
      </div>

      <!-- Ancien créneau -->
      <div style="background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.1);border-radius:14px;padding:16px 20px;margin-bottom:12px;">
        <p style="margin:0 0 6px;color:rgba(239,68,68,0.6);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Ancien créneau</p>
        <p style="margin:0;color:rgba(255,255,255,0.4);font-size:14px;text-decoration:line-through;">
          ${oldDateFormatted} à ${oldTimeFormatted}${old_date !== new_date || barber_name !== new_barber_name ? ` — avec ${barber_name}` : ''}
        </p>
      </div>

      <!-- Nouveau créneau -->
      <div style="background:rgba(34,197,94,0.04);border:1px solid rgba(34,197,94,0.15);border-radius:14px;padding:24px;margin-bottom:24px;">
        <p style="margin:0 0 10px;color:rgba(34,197,94,0.7);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Nouveau créneau</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;width:110px;">Prestation</td>
            <td style="padding:6px 0;color:#fff;font-size:15px;font-weight:600;text-align:right;">${service_name}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Barbier</td>
            <td style="padding:6px 0;color:rgba(255,255,255,0.85);font-size:14px;text-align:right;">${new_barber_name || barber_name}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Date</td>
            <td style="padding:6px 0;color:rgba(255,255,255,0.85);font-size:14px;text-align:right;">${newDateFormatted}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Heure</td>
            <td style="padding:6px 0;color:#fff;font-size:16px;font-weight:700;text-align:right;">${newTimeFormatted}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:10px 0 0;"><div style="border-top:1px solid rgba(255,255,255,0.06);"></div></td>
          </tr>
          <tr>
            <td style="padding:10px 0 0;color:rgba(255,255,255,0.45);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Prix</td>
            <td style="padding:10px 0 0;color:#fff;font-size:18px;font-weight:800;text-align:right;">${priceFormatted} <span style="font-size:13px;font-weight:400;">€</span></td>
          </tr>
        </table>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;color:rgba(255,255,255,0.4);font-size:12px;">📍 ${config.salon.address}</p>
        </div>
      </div>

      ${manageUrl ? `<div style="text-align:center;margin-bottom:16px;">
        <a href="${manageUrl}" style="display:inline-block;background:#fff;color:#000;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
          Gérer mon rendez-vous
        </a>
      </div>
      <p style="text-align:center;color:rgba(255,255,255,0.3);font-size:11px;margin:0;">
        Modification ou annulation gratuite jusqu'à 12h avant
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
      <div style="text-align:center;margin-bottom:28px;">
        <div style="display:inline-block;background:rgba(59,130,246,0.12);border-radius:50%;width:48px;height:48px;line-height:48px;text-align:center;margin-bottom:12px;">
          <span style="font-size:22px;">🔑</span>
        </div>
        <h2 style="font-size:22px;font-weight:700;margin:0;color:#fff;">Réinitialiser votre mot de passe</h2>
      </div>

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:24px;margin-bottom:24px;">
        <p style="margin:0 0 20px;color:rgba(255,255,255,0.65);font-size:14px;line-height:1.6;">
          Bonjour${first_name ? ` ${first_name}` : ''},<br><br>
          Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
        </p>
        <div style="text-align:center;">
          <a href="${resetUrl}" style="display:inline-block;background:#fff;color:#000;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
            Nouveau mot de passe
          </a>
        </div>
      </div>

      <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:11px;line-height:1.6;">
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
