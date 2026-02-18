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

/**
 * Send confirmation email via Resend
 */
async function sendConfirmationEmail(data) {
  if (!config.resend.apiKey) {
    logger.warn('Resend API key not configured, skipping email');
    return;
  }

  const cancelUrl = `${config.corsOrigins[0]}/pages/meylan/annuler.html?id=${data.booking_id}&token=${data.cancel_token}`;

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

  // Send via Resend API
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resend.from,
      to: [data.email],
      subject: `Confirmation RDV - ${data.service_name} le ${dateFormatted}`,
      html,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API error ${response.status}: ${errorBody}`);
  }

  // Update booking email tracking
  await db.query(
    'UPDATE bookings SET reminder_sent = false WHERE id = $1',
    [data.booking_id]
  );
}

/**
 * Send SMS reminder via Twilio
 */
async function sendReminderSMS(data) {
  if (!config.twilio.accountSid || !config.twilio.authToken) {
    logger.warn('Twilio not configured, skipping SMS');
    return;
  }

  const cancelUrl = `${config.corsOrigins[0]}/pages/meylan/annuler.html?id=${data.booking_id}&token=${data.cancel_token}`;
  const timeFormatted = formatTime(data.start_time);

  const message = `Rappel : votre RDV chez ${config.salon.name} demain à ${timeFormatted} avec ${data.barber_name}. Pour annuler : ${cancelUrl}`;

  // Format phone to international
  const phone = formatPhoneInternational(data.phone);

  // Send via Twilio API
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;
  const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');

  const response = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      From: config.twilio.phoneNumber,
      To: phone,
      Body: message,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Twilio API error ${response.status}: ${errorBody}`);
  }

  // Mark reminder as sent on the booking
  await db.query(
    'UPDATE bookings SET reminder_sent = true WHERE id = $1',
    [data.booking_id]
  );
}

/**
 * Send Google review request email
 */
async function sendReviewEmail(data) {
  if (!config.resend.apiKey || !data.email) {
    logger.warn('Resend not configured or no email, skipping review email');
    return;
  }

  const html = buildReviewEmailHTML({
    firstName: data.first_name,
    barberName: data.barber_name,
    reviewUrl: config.salon.googleReviewUrl,
  });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resend.from,
      to: [data.email],
      subject: 'Merci pour votre visite chez BarberClub !',
      html,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API error ${response.status}: ${errorBody}`);
  }

  await db.query(
    'UPDATE bookings SET review_email_sent = true WHERE id = $1',
    [data.booking_id]
  );
}

// ============================================
// Email HTML templates
// ============================================

function buildConfirmationEmailHTML({ firstName, serviceName, barberName, date, time, price, cancelUrl, address }) {
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
      <div style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.1);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:28px;">✓</span>
      </div>
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
      <a href="${cancelUrl}" style="color:rgba(255,255,255,0.4);font-size:13px;text-decoration:underline;">
        Annuler ce rendez-vous
      </a>
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

module.exports = {
  queueNotification,
  processPendingNotifications,
  sendNotification,
  formatDateFR,
  formatTime,
};
