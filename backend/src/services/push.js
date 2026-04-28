// ============================================
// Web Push Notifications Service
// ============================================
// Rich payloads pour iOS/Android : icones, hero images, actions, vibrate patterns.
// Le service worker (dashboard/public/sw.js) consomme ces payloads.

const webpush = require('web-push');
const db = require('../config/database');
const config = require('../config/env');
const logger = require('../utils/logger');

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
}

// Patterns de vibration (ms) — plus c'est long/repete, plus c'est urgent
const VIBRATE = {
  info:    [120],                         // ping discret
  booking: [180, 90, 180],                // double tap chaleureux
  warn:    [300, 120, 300],               // attention
  urgent:  [400, 150, 400, 150, 400, 150, 400], // 4 vibrations longues = urgent
};

// Map nom de barber -> chemin de la photo dans /public/barbers/
function barberPhoto(name) {
  if (!name) return null;
  // Strip diacritics (Clément -> clement) and non-letters
  const slug = String(name).toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
  if (!slug) return null;
  // .jpg pour julien et louay, .png pour les autres
  const jpgs = ['julien', 'louay'];
  return `/barbers/${slug}.${jpgs.includes(slug) ? 'jpg' : 'png'}`;
}

function salonPhoto(salonId) {
  if (salonId === 'grenoble') return '/salons/comptoir-grenoble.webp';
  return '/salons/devanture-meylan.webp';
}

// Format compact sans accents (cohérent avec le style des bodies push existants)
// "2026-04-28" -> "lun. 28 avr."
function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const days = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const months = ['janv.', 'fevr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.'];
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return String(dateStr);
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

/**
 * Send rich push notification to all subscribers of a salon (fire-and-forget)
 */
async function notifySalon(salonId, payload) {
  if (!config.vapid.publicKey) return;

  try {
    const result = await db.query(
      'SELECT id, endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE salon_id = $1',
      [salonId]
    );

    // Default fields applied to every push
    const enriched = {
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      timestamp: Date.now(),
      lang: 'fr',
      dir: 'ltr',
      ...payload,
    };
    const body = JSON.stringify(enriched);

    for (const sub of result.rows) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
      };

      webpush.sendNotification(pushSub, body).catch(async (err) => {
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
 * Nouveau RDV — push chaleureux avec photo du barber.
 */
function notifyNewBooking(salonId, booking) {
  const clientName = [booking.first_name, booking.last_name].filter(Boolean).join(' ') || 'Client';
  const time = (booking.start_time || '').slice(0, 5);
  const salonLabel = salonId === 'grenoble' ? 'Grenoble' : 'Meylan';
  const barber = booking.barber_name || '';
  const service = booking.service_name || '';
  const date = booking.date || '';

  const dateLabel = formatDateShort(date);
  const whenWho = [dateLabel, time && `a ${time}`, barber && `avec ${barber}`].filter(Boolean).join(' ');
  const lines = [
    service ? `${clientName} - ${service}` : clientName,
    whenWho,
  ].filter(Boolean);

  notifySalon(salonId, {
    title: `Nouveau RDV - ${salonLabel}`,
    body: lines.join('\n'),
    image: barberPhoto(barber),
    tag: `booking-${booking.id || Date.now()}`,
    vibrate: VIBRATE.booking,
    renotify: false,
    data: {
      url: `/#/planning?date=${date}`,
      type: 'booking',
    },
    actions: [{ action: 'view', title: 'Planning' }],
  });
}

/**
 * Annulation — couleur warn.
 */
function notifyCancellation(salonId, booking) {
  const clientName = [booking.first_name, booking.last_name].filter(Boolean).join(' ') || 'Client';
  const time = (booking.start_time || '').slice(0, 5);
  const salonLabel = salonId === 'grenoble' ? 'Grenoble' : 'Meylan';
  const barber = booking.barber_name || '';
  const date = booking.date || '';

  notifySalon(salonId, {
    title: `Annulation - ${salonLabel}`,
    body: `${clientName} a annule\n${formatDateShort(date)} a ${time}${barber ? ' avec ' + barber : ''}`,
    image: salonPhoto(salonId),
    tag: `cancel-${booking.id || Date.now()}`,
    vibrate: VIBRATE.warn,
    data: {
      url: `/#/planning?date=${date}`,
      type: 'cancel',
    },
    actions: [{ action: 'view', title: 'Voir planning' }],
  });
}

/**
 * Reschedule — couleur info.
 */
function notifyReschedule(salonId, booking) {
  const clientName = [booking.first_name, booking.last_name].filter(Boolean).join(' ') || 'Client';
  const time = (booking.start_time || '').slice(0, 5);
  const salonLabel = salonId === 'grenoble' ? 'Grenoble' : 'Meylan';
  const barber = booking.barber_name || '';
  const date = booking.date || '';

  notifySalon(salonId, {
    title: `RDV deplace - ${salonLabel}`,
    body: `${clientName} a deplace son RDV\nNouveau: ${formatDateShort(date)} a ${time}${barber ? ' avec ' + barber : ''}`,
    image: barberPhoto(barber),
    tag: `reschedule-${booking.id || Date.now()}`,
    vibrate: VIBRATE.info,
    data: {
      url: `/#/planning?date=${date}`,
      type: 'reschedule',
    },
    actions: [{ action: 'view', title: 'Voir planning' }],
  });
}

/**
 * SMS rejete par Brevo/operateur — alerte urgente avec bouton Appeler.
 * Reste affichee jusqu'a interaction (requireInteraction).
 */
function notifySmsFailed(salonId, info) {
  const salonLabel = salonId === 'grenoble' ? 'Grenoble' : 'Meylan';
  const phone = info.phone || info.recipient || '';
  const reason = info.reason || info.event || 'rejete';
  const client = info.clientName || 'Client';
  const dateTime = info.dateTime || '';

  const lines = [
    `${client} - ${phone}`,
    dateTime ? `RDV: ${dateTime}` : null,
    `Raison: ${reason}`,
  ].filter(Boolean);

  notifySalon(salonId, {
    title: `URGENT - SMS non delivre (${salonLabel})`,
    body: lines.join('\n'),
    image: salonPhoto(salonId),
    tag: `sms-failed-${info.messageId || Date.now()}`,
    vibrate: VIBRATE.urgent,
    requireInteraction: true,
    renotify: true,
    data: {
      url: '/#/notifications',
      type: 'sms_failed',
      phone,
      messageId: info.messageId || null,
    },
    actions: [
      { action: 'call', title: 'Appeler' },
      { action: 'view', title: 'Voir' },
    ],
  });
}

module.exports = { notifySalon, notifyNewBooking, notifyCancellation, notifyReschedule, notifySmsFailed };
