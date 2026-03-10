// ============================================
// Web Push Notifications Service
// ============================================

const webpush = require('web-push');
const db = require('../config/database');
const config = require('../config/env');
const logger = require('../utils/logger');

// Configure VAPID
if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
}

/**
 * Send push notification to all subscribers of a salon (fire-and-forget)
 */
async function notifySalon(salonId, payload) {
  if (!config.vapid.publicKey) return;

  try {
    const result = await db.query(
      'SELECT id, endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE salon_id = $1',
      [salonId]
    );

    const body = JSON.stringify(payload);

    for (const sub of result.rows) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
      };

      webpush.sendNotification(pushSub, body).catch(async (err) => {
        // 410 Gone or 404 = subscription expired, remove it
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
          logger.debug('Removed expired push subscription', { id: sub.id });
        } else {
          logger.debug('Push notification failed', { endpoint: sub.endpoint.substring(0, 50), error: err.message });
        }
      });
    }
  } catch (err) {
    logger.debug('Push notifySalon failed', { error: err.message });
  }
}

/**
 * Notify salon of a new booking
 */
function notifyNewBooking(salonId, booking) {
  const clientName = [booking.first_name, booking.last_name].filter(Boolean).join(' ') || 'Client';
  const time = (booking.start_time || '').slice(0, 5);
  const salonLabel = salonId === 'grenoble' ? 'Grenoble' : 'Meylan';
  const barber = booking.barber_name || '';

  notifySalon(salonId, {
    title: `Nouveau RDV — ${salonLabel}`,
    body: `${clientName} avec ${barber} — ${booking.date} à ${time}`,
    tag: `booking-${booking.id}`,
    url: '/#/planning',
  });
}

module.exports = { notifySalon, notifyNewBooking };
