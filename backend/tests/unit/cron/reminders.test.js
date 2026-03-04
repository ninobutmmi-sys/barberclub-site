/**
 * Unit tests for reminders cron job.
 * Tests: tomorrow calculation (Paris TZ), SMS sending, queue fallback, no bookings.
 */

const mockDb = require('../helpers/mockDb');
const mockNotification = require('../helpers/mockNotification');

jest.mock('../../../src/config/database', () => mockDb);
jest.mock('../../../src/services/notification', () => mockNotification);
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { queueReminders } = require('../../../src/cron/reminders');

beforeEach(() => {
  mockDb.resetMocks();
  jest.clearAllMocks();
});

describe('queueReminders', () => {
  test('calculates "tomorrow" in Paris timezone', async () => {
    // The function should use toLocaleString with Europe/Paris
    mockDb.query.mockResolvedValue({ rows: [] });

    await queueReminders();

    // Should have been called with a date string for tomorrow
    expect(mockDb.query).toHaveBeenCalled();
    const call = mockDb.query.mock.calls[0];
    const dateParam = call[1][0]; // First param is tomorrowStr

    // Verify it's a valid YYYY-MM-DD date
    expect(dateParam).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // It should be tomorrow in Paris TZ
    const nowParis = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const tomorrow = new Date(nowParis);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const expectedDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    expect(dateParam).toBe(expectedDate);
  });

  test('sends SMS for confirmed bookings', async () => {
    const bookings = [
      {
        id: 'booking-1',
        date: '2026-03-05',
        start_time: '10:00:00',
        cancel_token: 'tok-1',
        salon_id: 'meylan',
        phone: '+33600000001',
      },
      {
        id: 'booking-2',
        date: '2026-03-05',
        start_time: '14:00:00',
        cancel_token: 'tok-2',
        salon_id: 'meylan',
        phone: '+33600000002',
      },
    ];

    mockDb.query.mockImplementation(async (sql) => {
      // Fetch bookings
      if (sql.includes('SELECT b.id')) {
        return { rows: bookings };
      }
      // Update reminder_sent
      if (sql.includes('UPDATE bookings SET reminder_sent')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    await queueReminders();

    expect(mockNotification.sendReminderSMSDirect).toHaveBeenCalledTimes(2);
    expect(mockNotification.sendReminderSMSDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-1',
        phone: '+33600000001',
        salon_id: 'meylan',
      })
    );
  });

  test('queues fallback on direct SMS failure', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT b.id')) {
        return {
          rows: [{
            id: 'booking-fail',
            date: '2026-03-05',
            start_time: '10:00:00',
            cancel_token: 'tok-fail',
            salon_id: 'meylan',
            phone: '+33600000001',
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    // Make direct SMS fail
    mockNotification.sendReminderSMSDirect.mockRejectedValue(new Error('Brevo down'));

    await queueReminders();

    // Should have tried the queue fallback
    expect(mockNotification.queueNotification).toHaveBeenCalledWith('booking-fail', 'reminder_sms');
  });

  test('handles no bookings gracefully', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });

    // Should not throw
    await queueReminders();

    expect(mockNotification.sendReminderSMSDirect).not.toHaveBeenCalled();
  });

  test('continues processing after individual SMS failure', async () => {
    const bookings = [
      { id: 'b1', date: '2026-03-05', start_time: '10:00:00', cancel_token: 'tok-1', salon_id: 'meylan', phone: '+33600000001' },
      { id: 'b2', date: '2026-03-05', start_time: '14:00:00', cancel_token: 'tok-2', salon_id: 'meylan', phone: '+33600000002' },
    ];

    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT b.id')) return { rows: bookings };
      if (sql.includes('UPDATE bookings SET reminder_sent')) return { rowCount: 1 };
      return { rows: [] };
    });

    // First SMS fails, second succeeds
    mockNotification.sendReminderSMSDirect
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(true);

    await queueReminders();

    // Both should have been attempted
    expect(mockNotification.sendReminderSMSDirect).toHaveBeenCalledTimes(2);
  });

  test('uses correct salon_id from booking (multi-salon support)', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT b.id')) {
        return {
          rows: [{
            id: 'b-gre',
            date: '2026-03-05',
            start_time: '11:00:00',
            cancel_token: 'tok-gre',
            salon_id: 'grenoble',
            phone: '+33600000003',
          }],
        };
      }
      if (sql.includes('UPDATE bookings SET reminder_sent')) return { rowCount: 1 };
      return { rows: [] };
    });

    await queueReminders();

    expect(mockNotification.sendReminderSMSDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        salon_id: 'grenoble',
      })
    );
  });
});
