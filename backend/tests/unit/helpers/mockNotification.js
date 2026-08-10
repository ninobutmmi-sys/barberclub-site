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
  // Logique recopiée de services/notification/helpers.js (repairTruncatedFrenchMobile
  // + isFrenchPhone). On ne peut pas require() le vrai module ici : il charge
  // config/env, qui fait process.exit(1) quand les variables d'env manquent.
  // Sans cette entrée, cron/reminders.js appelle isFrenchPhone === undefined,
  // le TypeError est avalé par son try/catch et aucun rappel n'est mis en file.
  repairTruncatedFrenchMobile: jest.fn((cleaned) => (
    /^\+[67]\d{8}$/.test(cleaned) ? '+33' + cleaned.slice(1) : cleaned
  )),
  isFrenchPhone: jest.fn((phone) => {
    if (!phone) return false;
    const stripped = phone.replace(/[\s.-]/g, '');
    const cleaned = /^\+[67]\d{8}$/.test(stripped) ? '+33' + stripped.slice(1) : stripped;
    return /^(\+33|0033|0)[1-9]\d{8}$/.test(cleaned);
  }),
  escapeHtml: jest.fn((s) => s),
  formatDateFR: jest.fn((dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `Lundi ${d.getDate()} mars 2026`;
  }),
  formatTime: jest.fn((timeStr) => (timeStr || '').substring(0, 5)),
  toGSM: jest.fn((text) => text),
};
