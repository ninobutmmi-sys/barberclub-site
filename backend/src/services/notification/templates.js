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

  const html = emailShell(`
      <div style="text-align:center;margin-bottom:32px;">
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Rendez-vous annul&eacute;</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          Votre r&eacute;servation a bien &eacute;t&eacute; annul&eacute;e.
        </p>
      </div>

      <!-- Cancelled details -->
      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr><td style="height:3px;background:linear-gradient(90deg, rgba(239,68,68,0.3), rgba(239,68,68,0.6), rgba(239,68,68,0.3));font-size:0;line-height:0;">&nbsp;</td></tr>
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
        <a href="${bookAgainUrl}" style="display:inline-block;background:${ACCENT};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
          Reprendre rendez-vous
        </a>
      </div>`, { showHero: false, salonId });

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
  const barberPhotoUrl = getBarberPhotoUrl(effectiveBarber);

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
                <td style="padding:10px 0;text-align:right;">
                  ${barberPhotoUrl ? `<img src="${barberPhotoUrl}" alt="" width="28" height="28" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:8px;object-fit:cover;border:1.5px solid ${ACCENT_DIM};">` : ''}
                  <span style="color:${TEXT_SECONDARY};font-size:14px;vertical-align:middle;">${effectiveBarber}</span>
                </td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Adresse</td>
                <td style="padding:10px 0;text-align:right;">
                  <a href="${salon.mapsUrl}" style="color:${TEXT_SECONDARY};font-size:13px;text-decoration:none;">
                    &#128205; <span style="text-decoration:underline;">${escapeHtml(salon.address)}</span>
                  </a>
                </td>
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
      <!-- Cancellation policy -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
        <tr>
          <td style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px 18px;text-align:center;">
            <p style="margin:0;color:${TEXT_SECONDARY};font-size:12px;line-height:1.5;">
              &#9432; Modification ou annulation <strong style="color:${TEXT_PRIMARY};">gratuite jusqu'&agrave; 12h</strong> avant le rendez-vous
            </p>
          </td>
        </tr>
      </table>` : ''}`, { showHero: false, salonId });

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

  const html = emailShell(`
      <div style="text-align:center;margin-bottom:32px;">
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Merci pour votre visite !</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          ${firstName ? `${firstName}, nous` : 'Nous'} esp&eacute;rons que vous &ecirc;tes satisfait.
        </p>
      </div>

      ${barberPhotoUrl ? `
      <div style="text-align:center;margin-bottom:28px;">
        <img src="${barberPhotoUrl}" alt="${barberName}" width="72" height="72" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid ${ACCENT_DIM};">
        <p style="margin:10px 0 0;color:${TEXT_SECONDARY};font-size:13px;">Votre barbier : <strong style="color:${TEXT_PRIMARY};">${barberName}</strong></p>
      </div>` : ''}

      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr><td style="height:3px;background:linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT}, ${ACCENT_DIM});font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};padding:28px 24px;text-align:center;">
            <p style="margin:0 0 8px;font-size:28px;">&#11088;&#11088;&#11088;&#11088;&#11088;</p>
            <p style="margin:0 0 20px;color:${TEXT_SECONDARY};font-size:14px;line-height:1.7;">
              Votre avis compte &eacute;norm&eacute;ment pour nous.<br>
              En 30 secondes, aidez d'autres clients &agrave; d&eacute;couvrir BarberClub.
            </p>
            <a href="${reviewLink}" style="display:inline-block;background:${ACCENT};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
              Laisser un avis Google
            </a>
          </td>
        </tr>
      </table>

      <div style="text-align:center;">
        <a href="${bookingUrl}" style="color:${TEXT_SECONDARY};font-size:13px;text-decoration:underline;">
          Reprendre rendez-vous
        </a>
      </div>`, { salonId });

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
      </div>`, { showHero: false, salonId });

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
  const barberPhotoUrl = getBarberPhotoUrl(data.barber_name);
  const cancelUrl = data.cancel_token
    ? `${config.siteUrl}${salon.bookingPath}/mon-rdv.html?id=${data.booking_id}&token=${data.cancel_token}`
    : null;

  const html = emailShell(`
      <div style="text-align:center;margin-bottom:32px;">
        <h2 style="font-size:24px;font-weight:700;margin:0;color:${TEXT_PRIMARY};letter-spacing:-0.3px;">Rappel rendez-vous</h2>
        <p style="color:${TEXT_SECONDARY};font-size:14px;margin:8px 0 0;">
          ${firstName ? `${firstName}, c` : 'C'}'est demain !
        </p>
      </div>

      <!-- Time highlight -->
      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr><td style="height:3px;background:linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT}, ${ACCENT_DIM});font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};text-align:center;padding:24px 20px;border-radius:16px;">
            <p style="margin:0 0 4px;color:${ACCENT};font-size:11px;text-transform:uppercase;letter-spacing:3px;font-weight:600;">Votre rendez-vous</p>
            <p style="margin:0;color:${ACCENT};font-size:36px;font-weight:800;letter-spacing:1px;">${escapeHtml(timeFormatted)}</p>
            <p style="margin:6px 0 0;color:${TEXT_SECONDARY};font-size:14px;">${escapeHtml(dateFormatted)}</p>
          </td>
        </tr>
      </table>

      <!-- Details -->
      <table role="presentation" class="card-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;margin-bottom:28px;">
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};padding:20px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;width:100px;">Barbier</td>
                <td style="padding:10px 0;text-align:right;">
                  ${barberPhotoUrl ? `<img src="${barberPhotoUrl}" alt="" width="28" height="28" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:8px;object-fit:cover;border:1.5px solid ${ACCENT_DIM};">` : ''}
                  <span style="color:${TEXT_SECONDARY};font-size:14px;vertical-align:middle;">${barberName}</span>
                </td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Adresse</td>
                <td style="padding:10px 0;text-align:right;">
                  <a href="${salon.mapsUrl}" style="color:${TEXT_SECONDARY};font-size:13px;text-decoration:none;">
                    &#128205; <span style="text-decoration:underline;">${escapeHtml(salon.address)}</span>
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${cancelUrl ? `<div style="text-align:center;margin-bottom:20px;">
        <a href="${cancelUrl}" style="display:inline-block;background:${ACCENT};color:#000;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
          G&eacute;rer mon rendez-vous
        </a>
      </div>` : ''}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
        <tr>
          <td style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px 18px;text-align:center;">
            <p style="margin:0;color:${TEXT_SECONDARY};font-size:12px;line-height:1.5;">
              &#9432; Modification ou annulation <strong style="color:${TEXT_PRIMARY};">gratuite jusqu'&agrave; 12h</strong> avant le rendez-vous
            </p>
          </td>
        </tr>
      </table>`, { salonId });

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

  // Build barber photo URL from name
  const barberPhotoUrl = getBarberPhotoUrl(barberName);

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
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};text-align:center;padding:24px 20px;border-radius:16px;">
            <p style="margin:0 0 4px;color:${ACCENT};font-size:11px;text-transform:uppercase;letter-spacing:3px;font-weight:600;">Votre rendez-vous</p>
            <p style="margin:0;color:${ACCENT};font-size:36px;font-weight:800;letter-spacing:1px;">${time}</p>
            <p style="margin:6px 0 0;color:${TEXT_SECONDARY};font-size:14px;">${date}</p>
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
                <td style="padding:10px 0;text-align:right;">
                  ${barberPhotoUrl ? `<img src="${barberPhotoUrl}" alt="" width="28" height="28" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:8px;object-fit:cover;border:1.5px solid ${ACCENT_DIM};">` : ''}
                  <span style="color:${TEXT_SECONDARY};font-size:14px;vertical-align:middle;">${barberName}</span>
                </td>
              </tr>
              <tr><td colspan="2" style="padding:0;border-top:1px solid ${CARD_BORDER};"></td></tr>
              <tr>
                <td style="padding:10px 0;color:${TEXT_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:1px;vertical-align:middle;">Adresse</td>
                <td style="padding:10px 0;text-align:right;">
                  <a href="${mapsUrl}" style="color:${TEXT_SECONDARY};font-size:13px;text-decoration:none;">
                    &#128205; <span style="text-decoration:underline;">${address}</span>
                  </a>
                </td>
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

      <!-- Cancellation policy -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
        <tr>
          <td style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px 18px;text-align:center;">
            <p style="margin:0;color:${TEXT_SECONDARY};font-size:12px;line-height:1.5;">
              &#9432; Modification ou annulation <strong style="color:${TEXT_PRIMARY};">gratuite jusqu'&agrave; 12h</strong> avant le rendez-vous
            </p>
          </td>
        </tr>
      </table>`;

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
