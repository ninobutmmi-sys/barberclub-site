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
  escapeHtml: jest.fn((s) => s),
  formatDateFR: jest.fn((dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `Lundi ${d.getDate()} mars 2026`;
  }),
  formatTime: jest.fn((timeStr) => (timeStr || '').substring(0, 5)),
  toGSM: jest.fn((text) => text),
};
