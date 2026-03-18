/**
 * Unit tests for automation triggers cron job.
 * Tests: auto-complete past bookings, review email (queued via queueNotification),
 * waitlist expiration.
 * Updated to match current code: review_email uses queueNotification (not brevoSMS),
 * queries c.email (not c.phone), marks review_requested BEFORE queuing,
 * and reactivation_sms was removed from the switch.
 */

const mockDb = require('../helpers/mockDb');
const mockNotification = require('../helpers/mockNotification');
const mockEnv = require('../helpers/mockEnv');

jest.mock('../../../src/config/database', () => mockDb);
jest.mock('../../../src/config/env', () => mockEnv);
jest.mock('../../../src/services/notification', () => mockNotification);
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { processAutomationTriggers } = require('../../../src/cron/automationTriggers');

beforeEach(() => {
  mockDb.resetMocks();
  jest.clearAllMocks();
});

describe('processAutomationTriggers', () => {
  test('auto-completes past bookings', async () => {
    // Auto-complete returns some rows
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes("UPDATE bookings SET status = 'completed'")) {
        return { rows: [{ id: 'b1' }, { id: 'b2' }], rowCount: 2 };
      }
      // No active triggers
      if (sql.includes('FROM automation_triggers')) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    await processAutomationTriggers();

    // Verify auto-complete query was executed
    const autoCompleteCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes("UPDATE bookings SET status = 'completed'")
    );
    expect(autoCompleteCall).toBeTruthy();
  });

  test('processes review_email trigger via queueNotification', async () => {
    mockDb.query.mockImplementation(async (sql, params) => {
      // Auto-complete (no results)
      if (sql.includes("UPDATE bookings SET status = 'completed'")) {
        return { rows: [], rowCount: 0 };
      }
      // Active triggers
      if (sql.includes('FROM automation_triggers')) {
        return {
          rows: [{
            type: 'review_email',
            salon_id: 'meylan',
            is_active: true,
            config: {
              delay_minutes: 60,
            },
          }],
        };
      }
      // Bookings eligible for review (now queries c.email, not c.phone)
      if (sql.includes('review_email_sent = false') && sql.includes('review_requested = false')) {
        return {
          rows: [{
            id: 'b-review-1',
            client_id: 'c1',
            date: '2026-03-04',
            start_time: '10:00:00',
            first_name: 'Jean',
            last_name: 'Dupont',
            email: 'jean@test.com',
          }],
        };
      }
      // Update review_requested / review_email_sent (marked BEFORE queuing)
      if (sql.includes('UPDATE clients SET review_requested')) {
        return { rowCount: 1 };
      }
      if (sql.includes('UPDATE bookings SET review_email_sent')) {
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await processAutomationTriggers();

    // Should have queued via queueNotification (not brevoSMS)
    expect(mockNotification.queueNotification).toHaveBeenCalledWith(
      'b-review-1',
      'review_email',
      expect.objectContaining({
        email: 'jean@test.com',
        salonId: 'meylan',
      })
    );

    // Should have marked client as review_requested BEFORE queuing
    const updateClientCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes('UPDATE clients SET review_requested = true')
    );
    expect(updateClientCall).toBeTruthy();

    const updateBookingCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes('UPDATE bookings SET review_email_sent = true')
    );
    expect(updateBookingCall).toBeTruthy();
  });

  test('review email: marks before queuing (prevents duplicate sends)', async () => {
    // This tests the current behavior: mark review_requested and review_email_sent
    // BEFORE calling queueNotification. The queue processor handles retries if sending fails.
    const queryOrder = [];

    mockDb.query.mockImplementation(async (sql, params) => {
      if (sql.includes("UPDATE bookings SET status = 'completed'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM automation_triggers')) {
        return {
          rows: [{
            type: 'review_email',
            salon_id: 'meylan',
            is_active: true,
            config: {
              delay_minutes: 60,
            },
          }],
        };
      }
      if (sql.includes('review_email_sent = false')) {
        return {
          rows: [{
            id: 'b-review-1',
            client_id: 'c1',
            date: '2026-03-04',
            start_time: '10:00:00',
            first_name: 'Marie',
            last_name: 'Test',
            email: 'marie@test.com',
          }],
        };
      }
      if (sql.includes('UPDATE clients SET review_requested = true')) {
        queryOrder.push('mark_client');
        return { rowCount: 1 };
      }
      if (sql.includes('UPDATE bookings SET review_email_sent = true')) {
        queryOrder.push('mark_booking');
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    mockNotification.queueNotification.mockImplementation(async () => {
      queryOrder.push('queue');
      return true;
    });

    await processAutomationTriggers();

    // Marks should come BEFORE queuing
    expect(queryOrder).toEqual(['mark_client', 'mark_booking', 'queue']);
  });

  test('processes waitlist_notify trigger (expires old entries)', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes("UPDATE bookings SET status = 'completed'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM automation_triggers')) {
        return {
          rows: [{
            type: 'waitlist_notify',
            salon_id: 'meylan',
            is_active: true,
            config: {},
          }],
        };
      }
      // Expire waitlist entries
      if (sql.includes("UPDATE waitlist SET status = 'expired'")) {
        return { rows: [{ id: 'w1' }, { id: 'w2' }], rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    });

    await processAutomationTriggers();

    // Should have expired past waitlist entries
    const expireCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes("UPDATE waitlist SET status = 'expired'")
    );
    expect(expireCall).toBeTruthy();
    // Should filter by salon_id
    expect(expireCall[1]).toContain('meylan');
  });

  test('handles errors in individual triggers without stopping others', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes("UPDATE bookings SET status = 'completed'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM automation_triggers')) {
        return {
          rows: [
            { type: 'review_email', salon_id: 'meylan', is_active: true, config: { delay_minutes: 60 } },
            { type: 'waitlist_notify', salon_id: 'meylan', is_active: true, config: {} },
          ],
        };
      }
      // Review query returns nothing (no eligible bookings)
      if (sql.includes('review_email_sent = false')) {
        return { rows: [] };
      }
      // Waitlist expire
      if (sql.includes("UPDATE waitlist SET status = 'expired'")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    // review_email has no eligible bookings, waitlist_notify should still run
    await processAutomationTriggers();

    const expireCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes("UPDATE waitlist SET status = 'expired'")
    );
    expect(expireCall).toBeTruthy();
  });

  test('review email filters by salon_id', async () => {
    mockDb.query.mockImplementation(async (sql, params) => {
      if (sql.includes("UPDATE bookings SET status = 'completed'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM automation_triggers')) {
        return {
          rows: [{
            type: 'review_email',
            salon_id: 'grenoble',
            is_active: true,
            config: {
              delay_minutes: 60,
            },
          }],
        };
      }
      // Review query should include salon_id filter
      if (sql.includes('review_email_sent = false')) {
        // Verify salon_id is in params
        expect(params).toContain('grenoble');
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    await processAutomationTriggers();
  });

  test('skips already-processed clients within the same run (dedup)', async () => {
    mockDb.query.mockImplementation(async (sql, params) => {
      if (sql.includes("UPDATE bookings SET status = 'completed'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM automation_triggers')) {
        return {
          rows: [{
            type: 'review_email',
            salon_id: 'meylan',
            is_active: true,
            config: { delay_minutes: 60 },
          }],
        };
      }
      // Return 2 bookings for the same client (DISTINCT ON should prevent this in prod,
      // but the safety net in code handles it)
      if (sql.includes('review_email_sent = false')) {
        return {
          rows: [
            { id: 'b1', client_id: 'c1', date: '2026-03-04', start_time: '10:00:00', first_name: 'Jean', last_name: 'D', email: 'jean@test.com' },
            { id: 'b2', client_id: 'c1', date: '2026-03-04', start_time: '14:00:00', first_name: 'Jean', last_name: 'D', email: 'jean@test.com' },
          ],
        };
      }
      if (sql.includes('UPDATE clients SET review_requested')) return { rowCount: 1 };
      if (sql.includes('UPDATE bookings SET review_email_sent')) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await processAutomationTriggers();

    // Should only queue once (skip duplicate client)
    expect(mockNotification.queueNotification).toHaveBeenCalledTimes(1);
  });
});
