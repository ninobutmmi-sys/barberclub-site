const config = require('../../config/env');

/**
 * Strip non-GSM characters to avoid Unicode encoding (70 chars/segment -> 160 chars/segment).
 * GSM 03.38 includes: e e u i o C O o A a A O N U a o n u a SS ? ! PS Y and basic ASCII.
 * Characters like o e a i u e i c (lowercase) are NOT in GSM -> replace with ASCII equivalents.
 */
function toGSM(text) {
  return text
    .replace(/[ôö]/g, 'o').replace(/[êë]/g, 'e').replace(/[âä]/g, 'a')
    .replace(/[îï]/g, 'i').replace(/[ûü]/g, 'u').replace(/ç/g, 'c')
    .replace(/[ÔÖ]/g, 'O').replace(/[ÊË]/g, 'E').replace(/[ÂÄ]/g, 'A')
    .replace(/[ÎÏ]/g, 'I').replace(/[ÛÜ]/g, 'U').replace(/Ç/g, 'C')
    .replace(/[àá]/g, 'a').replace(/[éè]/g, 'e')
    .replace(/['']/g, "'").replace(/[""]/g, '"')
    .replace(/…/g, '...').replace(/—/g, '-').replace(/–/g, '-');
}

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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlToText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/&eacute;/g, 'é').replace(/&agrave;/g, 'à').replace(/&euro;/g, '€')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Base URL for hosted assets (Cloudflare Pages -- stable URL for email images)
const ASSETS_BASE = 'https://barberclub-site.pages.dev';
const LOGO_URL = `${ASSETS_BASE}/assets/images/common/logo-blanc.png`;
const CROWN_URL = `${ASSETS_BASE}/assets/images/common/couronne.png`;

// Design tokens -- monochrome dark luxury
const ACCENT = '#FFFFFF';
const ACCENT_DIM = '#D4D4D4';
const DARK_BG = '#0C0A09';
const CARD_BG = '#1C1917';
const CARD_BORDER = '#292524';
const TEXT_PRIMARY = '#FAFAF9';
const TEXT_SECONDARY = '#A8A29E';
const TEXT_MUTED = '#78716C';
const INSTAGRAM_URL = 'https://www.instagram.com/barberclub_grenoble/';

/**
 * Extract display label from salon name (e.g. "BarberClub Meylan" -> "Meylan")
 */
function getSalonLabel(salonId) {
  return salonId === 'grenoble' ? 'Grenoble' : 'Meylan';
}

/**
 * Build barber photo URL from barber name
 * Maps: "Lucas" -> /assets/images/barbers/lucas.png, "Julien" -> julien.jpg, etc.
 */
function getBarberPhotoUrl(barberName) {
  if (!barberName) return null;
  const name = barberName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const known = ['lucas', 'julien', 'tom', 'alan', 'nathan', 'clement'];
  if (!known.includes(name)) return null;
  // Use /email/ subfolder with real JPEG files (originals are AVIF with wrong extension)
  return `${ASSETS_BASE}/assets/images/barbers/email/${name}.jpg`;
}

function emailShell(content, { showHero = true, marketing = false, salonId = 'meylan' } = {}) {
  const salon = config.getSalonConfig(salonId);
  const salonLabel = getSalonLabel(salonId);
  const salonHeroImg = `${ASSETS_BASE}${salon.heroImage}`;
  const siteUrl = config.siteUrl || 'https://barberclub-grenoble.fr';
  const phoneClean = (salon.phone || '').replace(/[\s.-]/g, '');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; }
    body, .body-bg { background-color: #000000 !important; }
    .dark-bg { background-color: ${DARK_BG} !important; }
    .card-bg { background-color: ${CARD_BG} !important; }
    @media (prefers-color-scheme: dark) {
      .body-bg { background-color: #000000 !important; }
      .dark-bg { background-color: ${DARK_BG} !important; }
      .card-bg { background-color: ${CARD_BG} !important; }
    }
  </style>
</head>
<body class="body-bg" style="margin:0;padding:0;background-color:#000000;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;" bgcolor="#000000">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color:#000000;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" class="dark-bg" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${DARK_BG}" style="max-width:600px;width:100%;background-color:${DARK_BG};border-left:1px solid ${CARD_BORDER};border-right:1px solid ${CARD_BORDER};">

    ${showHero ? `
          <!-- HERO — Salon photo with logo overlay -->
          <tr>
            <td bgcolor="#000000" style="background-color:#000000;padding:0;position:relative;">
              <!--[if gte mso 9]>
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:260px;">
                <v:fill type="frame" src="${salonHeroImg}" />
                <v:textbox inset="0,0,0,0">
              <![endif]-->
              <div style="background:url('${salonHeroImg}') center/cover no-repeat #000;min-height:220px;text-align:center;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="background:linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.7) 100%);padding:44px 24px 36px;text-align:center;">
                    <img src="${CROWN_URL}" alt="" width="22" style="width:22px;height:auto;opacity:0.8;margin-bottom:8px;display:inline-block;">
                    <br>
                    <img src="${LOGO_URL}" alt="BarberClub" width="180" style="width:180px;height:auto;display:inline-block;">
                    <p style="margin:10px 0 0;color:${ACCENT};font-size:10px;letter-spacing:5px;text-transform:uppercase;font-weight:700;">${salonLabel}</p>
                  </td></tr>
                </table>
              </div>
              <!--[if gte mso 9]>
                </v:textbox>
              </v:rect>
              <![endif]-->
            </td>
          </tr>
          <tr>
            <td style="height:2px;background:linear-gradient(90deg, transparent 0%, ${ACCENT_DIM} 20%, ${ACCENT} 50%, ${ACCENT_DIM} 80%, transparent 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
    ` : `
          <!-- Compact header without hero -->
          <tr>
            <td bgcolor="${DARK_BG}" style="background-color:${DARK_BG};text-align:center;padding:36px 24px 20px;border-bottom:1px solid ${CARD_BORDER};">
              <img src="${CROWN_URL}" alt="" width="22" style="width:22px;height:auto;margin-bottom:8px;opacity:0.7;">
              <br>
              <img src="${LOGO_URL}" alt="BarberClub" width="170" style="width:170px;height:auto;">
              <p style="margin:8px 0 0;color:${ACCENT};font-size:10px;letter-spacing:5px;text-transform:uppercase;font-weight:700;">${salonLabel}</p>
            </td>
          </tr>
    `}

          <!-- CONTENT -->
          <tr>
            <td bgcolor="${DARK_BG}" style="background-color:${DARK_BG};padding:36px 32px 40px;color:${TEXT_PRIMARY};">
              ${content}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td bgcolor="#000000" style="background-color:#000000;border-top:1px solid ${CARD_BORDER};padding:28px 32px 32px;text-align:center;">
              <!-- Social + Contact row -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px;">
                <tr>
                  <!-- Instagram -->
                  <td style="padding:0 12px;">
                    <a href="${INSTAGRAM_URL}" style="color:${TEXT_MUTED};text-decoration:none;font-size:12px;letter-spacing:0.5px;">
                      <img src="https://cdn-icons-png.flaticon.com/512/174/174855.png" alt="Instagram" width="18" height="18" style="width:18px;height:18px;vertical-align:middle;opacity:0.6;margin-right:6px;">Instagram
                    </a>
                  </td>
                  <!-- Phone -->
                  ${salon.phone ? `<td style="padding:0 12px;border-left:1px solid ${CARD_BORDER};">
                    <a href="tel:${phoneClean}" style="color:${TEXT_MUTED};text-decoration:none;font-size:12px;letter-spacing:0.5px;">
                      &#9742; ${escapeHtml(salon.phone)}
                    </a>
                  </td>` : ''}
                  <!-- Website -->
                  <td style="padding:0 12px;border-left:1px solid ${CARD_BORDER};">
                    <a href="${siteUrl}" style="color:${TEXT_MUTED};text-decoration:none;font-size:12px;letter-spacing:0.5px;">
                      barberclub-grenoble.fr
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Separator -->
              <div style="height:1px;background:${CARD_BORDER};margin:0 40px 16px;"></div>

              <!-- Address -->
              <p style="margin:0 0 4px;color:${TEXT_MUTED};font-size:11px;letter-spacing:0.3px;">
                ${escapeHtml(salon.name)} &mdash; <a href="${salon.mapsUrl}" style="color:${TEXT_MUTED};text-decoration:underline;">${escapeHtml(salon.address)}</a>
              </p>
              <p style="margin:0;color:${TEXT_MUTED};font-size:10px;opacity:0.5;">Paiement sur place uniquement</p>
              ${marketing ? `<p style="margin:10px 0 0;color:${TEXT_MUTED};font-size:10px;opacity:0.5;">Si vous ne souhaitez plus recevoir ces emails, r&eacute;pondez &laquo;&nbsp;STOP&nbsp;&raquo; &agrave; cet email.</p>` : ''}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = {
  toGSM,
  formatDateFR,
  formatTime,
  formatPhoneInternational,
  escapeHtml,
  htmlToText,
  emailShell,
  getSalonLabel,
  getBarberPhotoUrl,
  // Re-export design tokens for templates
  ASSETS_BASE,
  LOGO_URL,
  CROWN_URL,
  ACCENT,
  ACCENT_DIM,
  DARK_BG,
  CARD_BG,
  CARD_BORDER,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_MUTED,
  INSTAGRAM_URL,
};
