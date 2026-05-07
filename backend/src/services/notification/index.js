/**
 * Notification service — re-exports all sub-modules.
 *
 * This barrel file ensures that `require('../services/notification')` still works
 * exactly as before the split. Every function previously exported from the monolithic
 * notification.js is re-exported here.
 */

const helpers = require('./helpers');
const brevo = require('./brevo');
const twilio = require('./twilio');
const config = require('../../config/env');
const logger = require('../../utils/logger');
const templates = require('./templates');
const queue = require('./queue');

/**
 * Provider-agnostic SMS dispatcher.
 * Routes to Twilio or Brevo based on config.smsProvider env.
 * Same signature/return shape as brevoSMS for backward compat.
 */
async function sendSMS(phone, content, salonId = 'meylan') {
  const provider = (config.smsProvider || 'brevo').toLowerCase();
  if (provider === 'twilio') {
    return twilio.twilioSMS(phone, content, salonId);
  }
  // Default / legacy fallback
  return brevo.brevoSMS(phone, content, salonId);
}

function getSmsProviderStatus(salonId) {
  const ids = salonId ? [salonId] : ['meylan', 'grenoble'];
  const perSalon = {};
  for (const id of ids) {
    const salon = config.getSalonConfig(id);
    perSalon[id] = ((salon && salon.smsProvider) || config.smsProvider || 'brevo').toLowerCase();
  }
  return {
    activeProviderBySalon: perSalon,
    activeProvider: salonId ? perSalon[salonId] : null,
    brevo: brevo.getBrevoStatus(salonId),
    twilio: twilio.getTwilioStatus(salonId),
  };
}

async function checkSmsProviderKeys() {
  // Check Twilio if any salon uses it
  const anyTwilio = ['meylan', 'grenoble'].some((id) => {
    const salon = config.getSalonConfig(id);
    return ((salon && salon.smsProvider) || config.smsProvider || 'brevo').toLowerCase() === 'twilio';
  });
  if (anyTwilio) await twilio.checkTwilioKeys();
  // Always check Brevo (used for emails regardless of SMS provider)
  await brevo.checkBrevoKeys();
}

module.exports = {
  // helpers.js
  toGSM: helpers.toGSM,
  formatDateFR: helpers.formatDateFR,
  formatTime: helpers.formatTime,
  isFrenchPhone: helpers.isFrenchPhone,
  formatPhoneInternational: helpers.formatPhoneInternational,
  escapeHtml: helpers.escapeHtml,
  emailShell: helpers.emailShell,
  getSalonLabel: helpers.getSalonLabel,

  // SMS dispatcher (provider-agnostic) — preferred entry point
  sendSMS,
  getSmsProviderStatus,
  checkSmsProviderKeys,

  // brevo.js (email always via Brevo; SMS for legacy callers)
  brevoEmail: brevo.brevoEmail,
  brevoSMS: brevo.brevoSMS, // legacy alias — new code should use sendSMS()
  getBrevoConfig: brevo.getBrevoConfig,
  getBrevoStatus: brevo.getBrevoStatus,
  checkBrevoKeys: brevo.checkBrevoKeys,

  // twilio.js
  twilioSMS: twilio.twilioSMS,
  getTwilioConfig: twilio.getTwilioConfig,
  getTwilioStatus: twilio.getTwilioStatus,
  checkTwilioKeys: twilio.checkTwilioKeys,

  // templates.js
  sendConfirmationEmail: templates.sendConfirmationEmail,
  sendCancellationEmail: templates.sendCancellationEmail,
  sendRescheduleEmail: templates.sendRescheduleEmail,
  sendReviewEmail: templates.sendReviewEmail,
  sendReminderEmail: templates.sendReminderEmail,
  sendResetPasswordEmail: templates.sendResetPasswordEmail,
  sendReminderSMSDirect: templates.sendReminderSMSDirect,
  sendConfirmationSMS: templates.sendConfirmationSMS,
  sendWaitlistSMS: templates.sendWaitlistSMS,

  // queue.js
  queueNotification: queue.queueNotification,
  processPendingNotifications: queue.processPendingNotifications,
  sendNotification: queue.sendNotification,
};
