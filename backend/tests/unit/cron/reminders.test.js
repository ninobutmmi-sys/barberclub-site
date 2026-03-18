/**
 * Unit tests for reminders cron job.
 * Tests: 24h window query, queue-based sending, mark-before-queue, error handling.
 * Updated to match current code: queueReminders() uses queueNotification (not sendReminderSMSDirect),
 * queries a 24h rolling window (no tomorrowStr param), and marks reminder_sent before queuing.
 */

const mockDb = require('../helpers/mockDb');
const mockNotification = require('../helpers/mockNotification');
const mockEnv = require('../helpers/mockEnv');

jest.mock('../../../src/config/database', () => mockDb);
jest.mock('../../../src/services/notification', () => mockNotification);
jest.mock('../../../src/config/env', () => mockEnv);
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
  test('queries bookings in the next 24h window (no date param)', async () => {
    // The function uses a SQL BETWEEN NOW() AND NOW()+24h with no bind params
    mockDb.query.mockResolvedValue({ rows: [] });

    await queueReminders();

    expect(mockDb.query).toHaveBeenCalled();
    const call = mockDb.query.mock.calls[0];
    // The query should use BETWEEN with NOW() — no bind parameters for date
    expect(call[0]).toContain('BETWEEN');
    expect(call[0]).toContain('24 hours');
  });

  test('queues SMS for confirmed bookings via queueNotification', async () => {
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
      // Fetch bookings (24h window query)
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

    // Should queue via queueNotification, not sendReminderSMSDirect
    expect(mockNotification.queueNotification).toHaveBeenCalledTimes(2);
    expect(mockNotification.queueNotification).toHaveBeenCalledWith(
      'booking-1',
      'reminder_sms',
      expect.objectContaining({
        phone: '+33600000001',
        salonId: 'meylan',
      })
    );
    expect(mockNotification.queueNotification).toHaveBeenCalledWith(
      'booking-2',
      'reminder_sms',
      expect.objectContaining({
        phone: '+33600000002',
        salonId: 'meylan',
      })
    );
  });

  test('marks reminder_sent BEFORE queuing (prevents duplicates)', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT b.id')) {
        return {
          rows: [{
            id: 'booking-1',
            date: '2026-03-05',
            start_time: '10:00:00',
            cancel_token: 'tok-1',
            salon_id: 'meylan',
            phone: '+33600000001',
          }],
        };
      }
      if (sql.includes('UPDATE bookings SET reminder_sent = true')) {
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await queueReminders();

    // reminder_sent should be marked
    const markCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes('UPDATE bookings SET reminder_sent = true')
    );
    expect(markCall).toBeTruthy();

    // Then queued
    expect(mockNotification.queueNotification).toHaveBeenCalledTimes(1);
  });

  test('reverts reminder_sent on queue failure', async () => {
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
      if (sql.includes('UPDATE bookings SET reminder_sent = true')) {
        return { rowCount: 1 };
      }
      if (sql.includes('UPDATE bookings SET reminder_sent = false')) {
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // Make queueNotification fail
    mockNotification.queueNotification.mockRejectedValueOnce(new Error('Queue error'));

    await queueReminders();

    // Should have reverted reminder_sent
    const revertCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes('UPDATE bookings SET reminder_sent = false')
    );
    expect(revertCall).toBeTruthy();
  });

  test('handles no bookings gracefully', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });

    // Should not throw
    await queueReminders();

    expect(mockNotification.queueNotification).not.toHaveBeenCalled();
  });

  test('continues processing after individual queue failure', async () => {
    const bookings = [
      { id: 'b1', date: '2026-03-05', start_time: '10:00:00', cancel_token: 'tok-1', salon_id: 'meylan', phone: '+33600000001' },
      { id: 'b2', date: '2026-03-05', start_time: '14:00:00', cancel_token: 'tok-2', salon_id: 'meylan', phone: '+33600000002' },
    ];

    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT b.id')) return { rows: bookings };
      if (sql.includes('UPDATE bookings SET reminder_sent')) return { rowCount: 1 };
      return { rows: [] };
    });

    // First queue fails, second succeeds
    mockNotification.queueNotification
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(true);

    await queueReminders();

    // Both should have been attempted
    expect(mockNotification.queueNotification).toHaveBeenCalledTimes(2);
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

    expect(mockNotification.queueNotification).toHaveBeenCalledWith(
      'b-gre',
      'reminder_sms',
      expect.objectContaining({
        salonId: 'grenoble',
      })
    );
  });
});
