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

function notifyCancellation(salonId, booking) {
  const clientName = booking.first_name || 'Client';
  const time = (booking.start_time || '').slice(0, 5);
  const salonLabel = salonId === 'grenoble' ? 'Grenoble' : 'Meylan';

  notifySalon(salonId, {
    title: `RDV annulé — ${salonLabel}`,
    body: `${clientName} a annulé son RDV du ${booking.date} à ${time}`,
    tag: `cancel-${booking.id || Date.now()}`,
    url: '/#/planning',
  });
}

function notifyReschedule(salonId, booking) {
  const clientName = booking.first_name || 'Client';
  const time = (booking.start_time || '').slice(0, 5);
  const salonLabel = salonId === 'grenoble' ? 'Grenoble' : 'Meylan';

  notifySalon(salonId, {
    title: `RDV déplacé — ${salonLabel}`,
    body: `${clientName} a déplacé son RDV au ${booking.date} à ${time}`,
    tag: `reschedule-${Date.now()}`,
    url: '/#/planning',
  });
}

/**
 * Push alert when an SMS reminder/notification fails to deliver.
 * Lands on Nino's phone via the dashboard PWA — replaces Discord alerts.
 */
function notifySmsFailed(salonId, info) {
  const salonLabel = salonId === 'grenoble' ? 'Grenoble' : 'Meylan';
  const phone = info.phone || info.recipient || 'inconnu';
  const reason = info.reason || info.event || 'rejected';
  const client = info.clientName || '';
  const dateTime = info.dateTime ? ` (${info.dateTime})` : '';

  notifySalon(salonId, {
    title: `SMS NON DELIVRE — ${salonLabel}`,
    body: `${client ? client + ' ' : ''}${phone}${dateTime} • ${reason}`,
    tag: `sms-failed-${info.messageId || Date.now()}`,
    url: '/#/notifications',
    requireInteraction: true,
  });
}

module.exports = { notifySalon, notifyNewBooking, notifyCancellation, notifyReschedule, notifySmsFailed };
