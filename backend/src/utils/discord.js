// ============================================
// Discord Webhook — Monitoring Alerts
// ============================================
// Fire-and-forget alerts to Discord channel.
// Set DISCORD_WEBHOOK_URL in .env to enable.

const config = require('../config/env');
const logger = require('./logger');

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const TIMEOUT_MS = 5000;

// Rate limiting: max 1 alert per type per 5 minutes
const alertCooldowns = {};
const COOLDOWN_MS = 5 * 60 * 1000;

function canSend(type) {
  const now = Date.now();
  const last = alertCooldowns[type] || 0;
  if (now - last < COOLDOWN_MS) return false;
  alertCooldowns[type] = now;
  return true;
}

/**
 * Send a Discord webhook embed (fire-and-forget)
 */
function sendDiscordAlert(title, description, color = 0xff0000, fields = []) {
  if (!WEBHOOK_URL) return;

  const body = JSON.stringify({
    embeds: [{
      title,
      description,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: `BarberClub API — ${config.nodeEnv}` },
    }],
  });

  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => {
    logger.debug('Discord webhook failed', { error: err.message });
  });
}

// ---- Pre-built alert helpers ----

function alertCronFailure(cronLabel, consecutiveFailures, errorMessage) {
  if (!canSend(`cron_${cronLabel}`)) return;
  sendDiscordAlert(
    'Cron en echec',
    `**${cronLabel}** a echoue ${consecutiveFailures} fois d'affilee.`,
    0xff0000,
    [{ name: 'Erreur', value: errorMessage.substring(0, 200), inline: false }]
  );
}

function alertCircuitOpen(salonId, failures) {
  if (!canSend(`circuit_open_${salonId}`)) return;
  sendDiscordAlert(
    'Circuit breaker OUVERT',
    `Brevo (${salonId}) — ${failures} echecs consecutifs. Les notifications sont suspendues.`,
    0xff9900
  );
}

function alertCircuitClosed(salonId) {
  if (!canSend(`circuit_closed_${salonId}`)) return;
  sendDiscordAlert(
    'Circuit breaker ferme',
    `Brevo (${salonId}) est de nouveau operationnel.`,
    0x00ff00
  );
}

function alertDatabaseDown(errorMessage) {
  if (!canSend('db_down')) return;
  sendDiscordAlert(
    'Base de donnees injoignable',
    'Le pool PostgreSQL a signale une erreur.',
    0xff0000,
    [{ name: 'Erreur', value: errorMessage.substring(0, 200), inline: false }]
  );
}

module.exports = {
  sendDiscordAlert,
  alertCronFailure,
  alertCircuitOpen,
  alertCircuitClosed,
  alertDatabaseDown,
};
