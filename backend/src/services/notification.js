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
     WHERE nq.status = 'pending'
       AND nq.next_retry_at <= NOW()
       AND nq.attempts < nq.max_attempts
     ORDER BY nq.created_at
     LIMIT 10`
  );

  for (const notification of result.rows) {
    try {
      await sendNotification(notification);
      // Mark as sent
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

  const cancelUrl = `${config.siteUrl}/pages/meylan/mon-rdv.html?id=${data.booking_id}&token=${data.cancel_token}`;
  const timeFormatted = formatTime(data.start_time);
  const dateFR = formatDateFR(typeof data.date === 'string' ? data.date.slice(0, 10) : data.date);

  const message = `Bonjour ${data.first_name}, rappel de votre RDV chez BarberClub le ${dateFR} a ${timeFormatted}. 26 Av. du Gresivaudan, Corenc. A bientot ! Pour annuler : ${cancelUrl}`;

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

function buildConfirmationEmailHTML({ firstName, serviceName, barberName, date, time, price, cancelUrl, address }) {
  firstName = escapeHtml(firstName);
  serviceName = escapeHtml(serviceName);
  barberName = escapeHtml(barberName);
  date = escapeHtml(date);
  time = escapeHtml(time);
  price = escapeHtml(price);
  address = escapeHtml(address);
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#000;color:#fff;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-family:'Orbitron',monospace;font-size:24px;font-weight:800;margin:0;letter-spacing:0.05em;">
        BARBERCLUB
      </h1>
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:4px 0 0;">Meylan</p>
    </div>

    <div style="text-align:center;margin-bottom:32px;">
      <h2 style="font-size:20px;font-weight:600;margin:0;">Rendez-vous confirmé</h2>
    </div>

    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 12px;color:rgba(255,255,255,0.6);font-size:13px;">RÉCAPITULATIF</p>
      <p style="margin:0 0 8px;font-size:16px;font-weight:600;">${serviceName}</p>
      <p style="margin:0 0 8px;color:rgba(255,255,255,0.8);">avec ${barberName}</p>
      <p style="margin:0 0 8px;color:rgba(255,255,255,0.8);">${date} à ${time}</p>
      <p style="margin:0 0 8px;font-size:18px;font-weight:600;">${price} €</p>
      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:16px 0;">
      <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px;">📍 ${address}</p>
    </div>

    <div style="text-align:center;margin-bottom:32px;">
      <a href="${cancelUrl}" style="display:inline-block;background:rgba(255,255,255,0.08);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;border:1px solid rgba(255,255,255,0.15);">
        Gérer mon rendez-vous
      </a>
      <p style="color:rgba(255,255,255,0.3);font-size:11px;margin-top:8px;">
        Annulation ou modification gratuite jusqu'à 12h avant le rendez-vous
      </p>
    </div>

    <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;">
      <p>Paiement sur place uniquement</p>
      <p>BarberClub Meylan — ${address}</p>
    </div>
  </div>
</body>
</html>`;
}

function buildReviewEmailHTML({ firstName, barberName, reviewUrl }) {
  firstName = escapeHtml(firstName);
  barberName = escapeHtml(barberName);
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#000;color:#fff;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-family:'Orbitron',monospace;font-size:24px;font-weight:800;margin:0;letter-spacing:0.05em;">
        BARBERCLUB
      </h1>
    </div>

    <div style="text-align:center;margin-bottom:24px;">
      <h2 style="font-size:20px;font-weight:600;margin:0 0 12px;">
        Merci pour votre visite${firstName ? `, ${firstName}` : ''} !
      </h2>
      <p style="color:rgba(255,255,255,0.7);margin:0;">
        Nous espérons que votre passage avec ${barberName} vous a plu.
      </p>
    </div>

    <div style="text-align:center;margin:32px 0;">
      <a href="${reviewUrl}" style="display:inline-block;background:#fff;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Laisser un avis ⭐
      </a>
    </div>

    <p style="text-align:center;color:rgba(255,255,255,0.5);font-size:13px;">
      Votre avis compte énormément pour nous et aide d'autres clients à nous découvrir.
    </p>
  </div>
</body>
</html>`;
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

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#000;color:#fff;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-family:'Orbitron',monospace;font-size:24px;font-weight:800;margin:0;letter-spacing:0.05em;">
        BARBERCLUB
      </h1>
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:4px 0 0;">Meylan</p>
    </div>

    <div style="text-align:center;margin-bottom:32px;">
      <h2 style="font-size:20px;font-weight:600;margin:0;">Rendez-vous annulé</h2>
    </div>

    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 12px;color:rgba(255,255,255,0.6);font-size:13px;">VOTRE RDV SUIVANT A ÉTÉ ANNULÉ</p>
      <p style="margin:0 0 8px;font-size:16px;font-weight:600;">${service_name}</p>
      <p style="margin:0 0 8px;color:rgba(255,255,255,0.8);">avec ${barber_name}</p>
      <p style="margin:0 0 8px;color:rgba(255,255,255,0.8);">${dateFormatted} à ${timeFormatted}</p>
      <p style="margin:0;font-size:16px;font-weight:600;">${priceFormatted} €</p>
    </div>

    <div style="text-align:center;margin-bottom:24px;">
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:0 0 16px;">
        N'hésitez pas à reprendre rendez-vous en ligne.
      </p>
    </div>

    <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;">
      <p>BarberClub Meylan — ${config.salon.address}</p>
    </div>
  </div>
</body>
</html>`;

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

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#000;color:#fff;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-family:'Orbitron',monospace;font-size:24px;font-weight:800;margin:0;letter-spacing:0.05em;">
        BARBERCLUB
      </h1>
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:4px 0 0;">Meylan</p>
    </div>

    <div style="text-align:center;margin-bottom:32px;">
      <h2 style="font-size:20px;font-weight:600;margin:0;">Rendez-vous déplacé</h2>
    </div>

    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px;margin-bottom:16px;">
      <p style="margin:0 0 12px;color:rgba(239,68,68,0.7);font-size:13px;text-decoration:line-through;">ANCIEN CRÉNEAU</p>
      <p style="margin:0 0 4px;color:rgba(255,255,255,0.5);text-decoration:line-through;">${oldDateFormatted} à ${oldTimeFormatted}</p>
      ${old_date !== new_date || barber_name !== new_barber_name ? `<p style="margin:0;color:rgba(255,255,255,0.4);text-decoration:line-through;">avec ${barber_name}</p>` : ''}
    </div>

    <div style="background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 12px;color:rgba(34,197,94,0.8);font-size:13px;">NOUVEAU CRÉNEAU</p>
      <p style="margin:0 0 8px;font-size:16px;font-weight:600;">${service_name}</p>
      <p style="margin:0 0 8px;color:rgba(255,255,255,0.8);">avec ${new_barber_name || barber_name}</p>
      <p style="margin:0 0 8px;color:rgba(255,255,255,0.8);">${newDateFormatted} à ${newTimeFormatted}</p>
      <p style="margin:0;font-size:16px;font-weight:600;">${priceFormatted} €</p>
      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:16px 0;">
      <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px;">📍 ${config.salon.address}</p>
    </div>

    ${cancel_token && booking_id ? `<div style="text-align:center;margin-bottom:24px;">
      <a href="${config.siteUrl}/pages/meylan/mon-rdv.html?id=${booking_id}&token=${cancel_token}" style="display:inline-block;background:rgba(255,255,255,0.08);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;border:1px solid rgba(255,255,255,0.15);">
        Gérer mon rendez-vous
      </a>
    </div>` : ''}

    <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;">
      <p>Paiement sur place uniquement</p>
      <p>BarberClub Meylan — ${config.salon.address}</p>
    </div>
  </div>
</body>
</html>`;

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

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#000;color:#fff;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-family:'Orbitron',monospace;font-size:24px;font-weight:800;margin:0;letter-spacing:0.05em;">
        BARBERCLUB
      </h1>
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:4px 0 0;">Meylan</p>
    </div>

    <div style="text-align:center;margin-bottom:32px;">
      <div style="width:56px;height:56px;border-radius:50%;background:rgba(59,130,246,0.15);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:28px;">🔑</span>
      </div>
      <h2 style="font-size:20px;font-weight:600;margin:0;">Réinitialiser votre mot de passe</h2>
    </div>

    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 16px;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;">
        Bonjour${first_name ? ` ${first_name}` : ''},<br><br>
        Vous avez demandé la réinitialisation de votre mot de passe BarberClub. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
      </p>
      <div style="text-align:center;">
        <a href="${resetUrl}" style="display:inline-block;background:#fff;color:#000;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
          Nouveau mot de passe
        </a>
      </div>
    </div>

    <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;line-height:1.6;">
      <p>Ce lien expire dans 1 heure.</p>
      <p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
      <p style="margin-top:16px;">BarberClub Meylan — ${config.salon.address}</p>
    </div>
  </div>
</body>
</html>`;

  await brevoEmail(email, 'Réinitialisation de votre mot de passe BarberClub', html);
  logger.info('Reset password email sent', { email });
}

module.exports = {
  queueNotification,
  processPendingNotifications,
  sendNotification,
  sendCancellationEmail,
  sendRescheduleEmail,
  sendResetPasswordEmail,
  formatDateFR,
  formatTime,
  brevoSMS,
  brevoEmail,
  formatPhoneInternational,
};
