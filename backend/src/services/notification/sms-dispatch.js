/**
 * Provider-agnostic SMS dispatcher.
 * Routes SMS to either Twilio or Brevo based on env SMS_PROVIDER.
 * Importable from anywhere without circular dependency on notification/index.js.
 */

const config = require('../../config/env');
const { brevoSMS } = require('./brevo');
const { twilioSMS } = require('./twilio');

async function sendSMS(phone, content, salonId = 'meylan') {
  // Per-salon provider switch (so Grenoble can run Twilio while Meylan stays on Brevo, etc.)
  const salon = config.getSalonConfig(salonId);
  const provider = ((salon && salon.smsProvider) || config.smsProvider || 'brevo').toLowerCase();
  if (provider === 'twilio') {
    return twilioSMS(phone, content, salonId);
  }
  return brevoSMS(phone, content, salonId);
}

module.exports = { sendSMS };
