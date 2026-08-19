const vraiTelephone = require('../../../src/utils/phone');

module.exports = {
  sendConfirmationEmail: jest.fn().mockResolvedValue(true),
  sendCancellationEmail: jest.fn().mockResolvedValue(true),
  sendRescheduleEmail: jest.fn().mockResolvedValue(true),
  sendReviewEmail: jest.fn().mockResolvedValue(true),
  sendConfirmationSMS: jest.fn().mockResolvedValue(true),
  sendReminderSMSDirect: jest.fn().mockResolvedValue(true),
  sendWaitlistSMS: jest.fn().mockResolvedValue(true),
  queueNotification: jest.fn().mockResolvedValue(true),
  brevoSMS: jest.fn().mockResolvedValue(true),
  getBrevoConfig: jest.fn().mockReturnValue({
    apiKey: 'test-key',
    senderEmail: 'test@test.com',
    senderName: 'Test',
    smsSender: 'TEST',
  }),
  formatPhoneInternational: jest.fn((p) => p),
  // Le traitement des numéros vient du VRAI module. On ne peut pas require()
  // services/notification (il charge config/env, qui fait process.exit(1) sans
  // variables d'env), mais utils/phone.js est pur : aucune dépendance. La
  // logique était auparavant recopiée ici à la main, et une copie finit
  // toujours par diverger de l'original.
  // Sans ces entrées, cron/reminders.js appelle une fonction undefined, le
  // TypeError est avalé par son try/catch et aucun rappel n'est mis en file.
  repairTruncatedFrenchMobile: jest.fn(vraiTelephone.repairTruncatedFrenchMobile),
  isFrenchPhone: jest.fn(vraiTelephone.isFrenchPhone),
  isFrenchMobile: jest.fn(vraiTelephone.isFrenchMobile),
  escapeHtml: jest.fn((s) => s),
  formatDateFR: jest.fn((dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `Lundi ${d.getDate()} mars 2026`;
  }),
  formatTime: jest.fn((timeStr) => (timeStr || '').substring(0, 5)),
  toGSM: jest.fn((text) => text),
};
