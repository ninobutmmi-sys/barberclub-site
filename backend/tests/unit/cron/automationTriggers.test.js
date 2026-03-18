/**
 * Unit tests for automation triggers cron job.
 * Tests: auto-complete past bookings, review SMS (marks only on success),
 * reactivation SMS, waitlist expiration.
 * Covers bug 10 fix: review_email_sent only marked on SMS success, not failure.
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

  test('processes review_email trigger', async () => {
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
              message: 'Merci {prenom} ! Ton avis : {lien_avis}',
              google_review_url: 'https://g.page/r/test',
            },
          }],
        };
      }
      // Bookings eligible for review
      if (sql.includes('review_email_sent = false') && sql.includes('review_requested = false')) {
        return {
          rows: [{
            id: 'b-review-1',
            client_id: 'c1',
            date: '2026-03-04',
            start_time: '10:00:00',
            first_name: 'Jean',
            last_name: 'Dupont',
            phone: '+33600000001',
          }],
        };
      }
      // Update review_requested / review_email_sent
      if (sql.includes('UPDATE clients SET review_requested')) {
        return { rowCount: 1 };
      }
      if (sql.includes('UPDATE bookings SET review_email_sent')) {
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await processAutomationTriggers();

    // Should have called brevoSMS for the review SMS
    expect(mockNotification.brevoSMS).toHaveBeenCalled();

    // Should have marked client as review_requested and booking as review_email_sent
    const updateClientCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes('UPDATE clients SET review_requested = true')
    );
    expect(updateClientCall).toBeTruthy();

    const updateBookingCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes('UPDATE bookings SET review_email_sent = true')
    );
    expect(updateBookingCall).toBeTruthy();
  });

  test('review SMS: does NOT mark booking on failure (bug 10 fix)', async () => {
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
              message: 'Merci {prenom} !',
              google_review_url: 'https://g.page/r/test',
            },
          }],
        };
      }
      if (sql.includes('review_email_sent = false')) {
        return {
          rows: [{
            id: 'b-review-fail',
            client_id: 'c-fail',
            date: '2026-03-04',
            start_time: '10:00:00',
            first_name: 'Marie',
            last_name: 'Test',
            phone: '+33600000005',
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    // Mock Brevo SMS FAILURE
    mockNotification.brevoSMS.mockRejectedValueOnce(new Error('Brevo SMS API error 500'));

    await processAutomationTriggers();

    // Should NOT have marked review_requested on the client
    const updateClientCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes('UPDATE clients SET review_requested = true')
    );
    expect(updateClientCall).toBeUndefined();

    // Should NOT have marked review_email_sent on the booking
    const updateBookingCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes('UPDATE bookings SET review_email_sent = true')
    );
    expect(updateBookingCall).toBeUndefined();
  });

  test('processes reactivation_sms trigger', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes("UPDATE bookings SET status = 'completed'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM automation_triggers')) {
        return {
          rows: [{
            type: 'reactivation_sms',
            salon_id: 'meylan',
            is_active: true,
            config: {
              inactive_days: 45,
              message: 'Salut {prenom} ! Reviens : {lien_reservation}',
            },
          }],
        };
      }
      // Inactive clients
      if (sql.includes('HAVING COUNT') && sql.includes('reactivation_sms_sent_at')) {
        return {
          rows: [{
            id: 'c-inactive',
            first_name: 'Pierre',
            last_name: 'Martin',
            phone: '+33600000010',
            last_visit: '2026-01-15',
          }],
        };
      }
      // Update reactivation_sms_sent_at
      if (sql.includes('UPDATE clients SET reactivation_sms_sent_at')) {
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await processAutomationTriggers();

    // Should have sent SMS via brevoSMS
    expect(mockNotification.brevoSMS).toHaveBeenCalled();

    // Should have updated reactivation_sms_sent_at
    const updateCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes('UPDATE clients SET reactivation_sms_sent_at')
    );
    expect(updateCall).toBeTruthy();
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
            { type: 'review_email', salon_id: 'meylan', is_active: true, config: { message: '' } },
            { type: 'waitlist_notify', salon_id: 'meylan', is_active: true, config: {} },
          ],
        };
      }
      // Waitlist expire
      if (sql.includes("UPDATE waitlist SET status = 'expired'")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    // review_email has empty message so it returns early
    // waitlist_notify should still run
    await processAutomationTriggers();

    const expireCall = mockDb.query.mock.calls.find((c) =>
      c[0].includes("UPDATE waitlist SET status = 'expired'")
    );
    expect(expireCall).toBeTruthy();
  });

  test('review SMS filters by salon_id', async () => {
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
              message: 'Merci {prenom}',
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
});
