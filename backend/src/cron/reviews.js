const db = require('../config/database');
const notification = require('../services/notification');
const config = require('../config/env');
const logger = require('../utils/logger');

/**
 * Send review request emails for completed bookings (24h after)
 * Runs every day at 10:00
 * Sends directly via Brevo (queue fallback if direct fails)
 */
async function queueReviewRequests() {
  try {
    // Find yesterday's completed bookings that haven't had a review email sent
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const result = await db.query(
      `SELECT b.id as booking_id, b.review_email_sent,
              c.first_name, c.email,
              br.name as barber_name
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       JOIN barbers br ON b.barber_id = br.id
       WHERE b.date = $1
         AND b.status = 'completed'
         AND b.review_email_sent = false
         AND b.deleted_at IS NULL
         AND c.email IS NOT NULL`,
      [yesterdayStr]
    );

    if (result.rows.length === 0) {
      logger.info('No review requests to send');
      return;
    }

    let sent = 0;
    let failed = 0;

    for (const booking of result.rows) {
      try {
        const html = buildReviewEmailHTML({
          firstName: booking.first_name,
          barberName: booking.barber_name,
          reviewUrl: config.salon.googleReviewUrl,
        });
        await notification.brevoEmail(booking.email, 'Merci pour votre visite chez BarberClub !', html);
        await db.query('UPDATE bookings SET review_email_sent = true WHERE id = $1', [booking.booking_id]);
        sent++;
      } catch (err) {
        logger.error('Direct review email failed, queueing for retry', { bookingId: booking.booking_id, error: err.message });
        try {
          await notification.queueNotification(booking.booking_id, 'review_email');
        } catch (qErr) {
          logger.error('Failed to queue review email fallback', { bookingId: booking.booking_id, error: qErr.message });
        }
        failed++;
      }
    }

    logger.info(`Review emails: ${sent} sent, ${failed} failed`);
  } catch (error) {
    logger.error('Failed to send review requests', { error: error.message });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

module.exports = { queueReviewRequests };
