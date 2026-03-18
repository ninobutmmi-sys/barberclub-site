/**
 * Notification service — re-exports all sub-modules.
 *
 * This barrel file ensures that `require('../services/notification')` still works
 * exactly as before the split. Every function previously exported from the monolithic
 * notification.js is re-exported here.
 */

const helpers = require('./helpers');
const brevo = require('./brevo');
const templates = require('./templates');
const queue = require('./queue');

module.exports = {
  // helpers.js
  toGSM: helpers.toGSM,
  formatDateFR: helpers.formatDateFR,
  formatTime: helpers.formatTime,
  formatPhoneInternational: helpers.formatPhoneInternational,
  escapeHtml: helpers.escapeHtml,
  emailShell: helpers.emailShell,
  getSalonLabel: helpers.getSalonLabel,

  // brevo.js
  brevoEmail: brevo.brevoEmail,
  brevoSMS: brevo.brevoSMS,
  getBrevoConfig: brevo.getBrevoConfig,
  getBrevoStatus: brevo.getBrevoStatus,
  checkBrevoKeys: brevo.checkBrevoKeys,

  // templates.js
  sendConfirmationEmail: templates.sendConfirmationEmail,
  sendCancellationEmail: templates.sendCancellationEmail,
  sendRescheduleEmail: templates.sendRescheduleEmail,
  sendReviewEmail: templates.sendReviewEmail,
  sendResetPasswordEmail: templates.sendResetPasswordEmail,
  sendReminderSMSDirect: templates.sendReminderSMSDirect,
  sendConfirmationSMS: templates.sendConfirmationSMS,
  sendWaitlistSMS: templates.sendWaitlistSMS,

  // queue.js
  queueNotification: queue.queueNotification,
  processPendingNotifications: queue.processPendingNotifications,
  sendNotification: queue.sendNotification,
};
