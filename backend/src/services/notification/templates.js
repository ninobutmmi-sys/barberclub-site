const db = require('../../config/database');
const config = require('../../config/env');
const logger = require('../../utils/logger');
const { brevoEmail, brevoSMS, getBrevoConfig } = require('./brevo');
const {
  toGSM,
  formatDateFR,
  formatTime,
  escapeHtml,
  emailShell,
  getBarberPhotoUrl,
  ACCENT,
  ACCENT_DIM,
  DARK_BG,
  CARD_BG,
  CARD_BORDER,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_MUTED,
} = require('./helpers');
const { loadTemplate } = require('./loadTemplate');

// Shared design tokens object for template injection
const DESIGN_TOKENS = {
  ACCENT, ACCENT_DIM, DARK_BG, CARD_BG, CARD_BORDER,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
};

/**
 * Build barber photo <img> tag or empty string
 */
function barberPhotoImg(barberName, opts = {}) {
  const url = getBarberPhotoUrl(barberName);
  if (!url) return '';
  const size = opts.size || 28;
  const border = opts.border || `1.5px solid ${ACCENT_DIM}`;
  return `<img src="${url}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:50%;vertical-align:middle;margin-right:8px;object-fit:cover;border:${border};">`;
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
    bookingId: data.booking_id, type: 'confirmation_email', recipientName: data.first_name, fromQueue: data.fromQueue, queueId: data.queueId,
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

/**
 * Send cancellation email directly (admin-triggered, not queued)
 */
async function sendCancellationEmail({ email, first_name, service_name, barber_name, date, start_time, price, salon_id, fromQueue, queueId }) {
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

  const content = loadTemplate('cancellation', {
    ...DESIGN_TOKENS,
    service_name,
    barber_name,
    dateFormatted,
    timeFormatted,
    priceFormatted,
    bookAgainUrl,
  });

  const html = emailShell(content, { showHero: false, salonId });

  await brevoEmail(email, `RDV annulé - ${service_name} le ${dateFormatted}`, html, salonId, {
    type: 'cancellation_email', recipientName: first_name, fromQueue, queueId,
  });
  logger.info('Cancellation email sent', { email, salonId });
}

/**
 * Send reschedule email directly (admin-triggered, not queued)
 */
async function sendRescheduleEmail({ email, first_name, service_name, barber_name, old_date, old_time, new_date, new_time, new_barber_name, price, cancel_token, booking_id, salon_id, fromQueue, queueId }) {
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

  // Build the old barber suffix exactly as before
  const oldBarberSuffix = (old_date !== new_date || barber_name !== new_barber_name)
    ? ` &mdash; ${barber_name}`
    : '';

  // Build the manage block (CTA + cancellation policy) or empty string
  let manageBlock = '';
  if (manageUrl) {
    manageBlock = `<div style="text-align:center;margin-bottom:20px;">
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
      </table>`;
  }

  const content = loadTemplate('reschedule', {
    ...DESIGN_TOKENS,
    oldDateFormatted,
    oldTimeFormatted,
    oldBarberSuffix,
    newDateFormatted,
    newTimeFormatted,
    service_name,
    effectiveBarber,
    barberPhotoHtml: barberPhotoImg(effectiveBarber),
    salonAddress: escapeHtml(salon.address),
    mapsUrl: salon.mapsUrl,
    priceFormatted,
    manageBlock,
  });

  const html = emailShell(content, { showHero: false, salonId });

  await brevoEmail(email, `RDV déplacé - ${service_name} le ${newDateFormatted} à ${newTimeFormatted}`, html, salonId, {
    bookingId: booking_id, type: 'reschedule_email', recipientName: first_name, fromQueue, queueId,
  });
  logger.info('Reschedule email sent', { email, salonId });
}

/**
 * Send review request email (Google review) -- triggered 60min post-completed
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

  // Build the barber photo block or empty string
  let barberPhotoBlock = '';
  if (barberPhotoUrl) {
    barberPhotoBlock = `
      <div style="text-align:center;margin-bottom:28px;">
        <img src="${barberPhotoUrl}" alt="${barberName}" width="72" height="72" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid ${ACCENT_DIM};">
        <p style="margin:10px 0 0;color:${TEXT_SECONDARY};font-size:13px;">Votre barbier : <strong style="color:${TEXT_PRIMARY};">${barberName}</strong></p>
      </div>`;
  }

  const content = loadTemplate('review', {
    ...DESIGN_TOKENS,
    firstNameIntro: firstName ? `${firstName}, nous` : 'Nous',
    barberPhotoBlock,
    reviewLink,
    bookingUrl,
  });

  const html = emailShell(content, { salonId });

  await brevoEmail(data.email, `Votre avis compte — ${salon.name}`, html, salonId, {
    bookingId: data.booking_id, type: 'review_email', recipientName: firstName, fromQueue: data.fromQueue, queueId: data.queueId,
  });
  logger.info('Review email sent', { bookingId: data.booking_id, email: data.email, salonId });
}

/**
 * Send password reset email directly (not queued)
 */
async function sendResetPasswordEmail({ email, first_name, resetUrl, salon_id }) {
  const salonId = salon_id || 'meylan';
  const brevo = getBrevoConfig(salonId);
  if (!brevo.apiKey) {
    logger.warn('Brevo API key not configured, logging reset URL instead');
    logger.info('Password reset URL', { email, resetUrl });
    return;
  }

  first_name = escapeHtml(first_name);

  const content = loadTemplate('reset-password', {
    ...DESIGN_TOKENS,
    firstNameGreeting: first_name ? ` ${first_name}` : '',
    resetUrl,
  });

  const html = emailShell(content, { showHero: false, salonId });

  await brevoEmail(email, 'Réinitialisation de votre mot de passe BarberClub', html, salonId, {
    type: 'reset_password_email',
  });
  logger.info('Reset password email sent', { email, salonId });
}

/**
 * Send SMS reminder directly (without DB update -- caller handles it)
 */
async function sendReminderSMSDirect(data) {
  const salonId = data.salon_id || 'meylan';
  const salon = config.getSalonConfig(salonId);

  const timeFormatted = formatTime(data.start_time);
  const dateFR = formatDateFR(typeof data.date === 'string' ? data.date.slice(0, 10) : data.date);

  const message = toGSM(`BarberClub - Rappel\nRDV le ${dateFR} a ${timeFormatted}\n${salon.address}.\nA bientot!`);

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

  const message = toGSM(`BarberClub - RDV confirme\nLe ${dateFR} a ${timeFormatted} avec ${data.barber_name}.\n${salon.address}`);

  await brevoSMS(data.phone, message, salonId);
  logger.info('Confirmation SMS sent', { bookingId: data.booking_id, phone: data.phone, salonId });
}

/**
 * Send reminder email (for international phone numbers that don't receive SMS)
 */
async function sendReminderEmail(data) {
  const salonId = data.salon_id || 'meylan';
  const salon = config.getSalonConfig(salonId);

  if (!data.email) {
    logger.info('No client email, skipping reminder email', { bookingId: data.booking_id });
    return;
  }

  const dateFormatted = formatDateFR(typeof data.date === 'string' ? data.date.slice(0, 10) : data.date);
  const timeFormatted = formatTime(data.start_time);
  const firstName = escapeHtml(data.first_name || '');
  const barberName = escapeHtml(data.barber_name || '');
  const cancelUrl = data.cancel_token
    ? `${config.siteUrl}${salon.bookingPath}/mon-rdv.html?id=${data.booking_id}&token=${data.cancel_token}`
    : null;

  // Build cancel CTA block or empty string
  let cancelBlock = '';
  if (cancelUrl) {
    cancelBlock = `<div style="text-align:center;margin-bottom:20px;">
        <a href="${cancelUrl}" style="display:inline-block;background:${ACCENT};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
          G&eacute;rer mon rendez-vous
        </a>
      </div>`;
  }

  const content = loadTemplate('reminder', {
    ...DESIGN_TOKENS,
    firstNameIntro: firstName ? `${firstName}, c` : 'C',
    timeFormatted: escapeHtml(timeFormatted),
    dateFormatted: escapeHtml(dateFormatted),
    barberName,
    barberPhotoHtml: barberPhotoImg(data.barber_name),
    salonAddress: escapeHtml(salon.address),
    mapsUrl: salon.mapsUrl,
    cancelBlock,
  });

  const html = emailShell(content, { salonId });

  await brevoEmail(data.email, `Rappel RDV demain à ${timeFormatted} — ${salon.name}`, html, salonId, {
    bookingId: data.booking_id, type: 'reminder_email', recipientName: firstName, fromQueue: data.fromQueue, queueId: data.queueId,
  });
  logger.info('Reminder email sent', { bookingId: data.booking_id, email: data.email, salonId });
}

async function sendWaitlistSMS(data) {
  const salonId = data.salon_id || 'meylan';
  if (!data.phone) return;
  await brevoSMS(data.phone, data.message, salonId);
  logger.info('Waitlist SMS sent', { phone: data.phone, salonId });
}

// ============================================
// Confirmation email HTML builder (internal)
// ============================================

function buildConfirmationEmailHTML({ firstName, serviceName, barberName, date, time, price, cancelUrl, address, mapsUrl, salonId = 'meylan' }) {
  firstName = escapeHtml(firstName);
  serviceName = escapeHtml(serviceName);
  barberName = escapeHtml(barberName);
  date = escapeHtml(date);
  time = escapeHtml(time);
  price = escapeHtml(price);
  address = escapeHtml(address);
  mapsUrl = mapsUrl || '#';

  const content = loadTemplate('confirmation', {
    ...DESIGN_TOKENS,
    firstNameIntro: firstName ? `${firstName}, votre` : 'Votre',
    time,
    date,
    serviceName,
    barberName,
    barberPhotoHtml: barberPhotoImg(barberName),
    address,
    mapsUrl,
    price,
    cancelUrl,
  });

  return emailShell(content, { salonId });
}

module.exports = {
  sendConfirmationEmail,
  sendReminderSMS,
  sendReminderEmail,
  sendCancellationEmail,
  sendRescheduleEmail,
  sendReviewEmail,
  sendResetPasswordEmail,
  sendReminderSMSDirect,
  sendConfirmationSMS,
  sendWaitlistSMS,
};
