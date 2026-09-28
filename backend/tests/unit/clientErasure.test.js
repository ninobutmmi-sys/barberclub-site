/**
 * Unit tests for client erasure (RGPD art. 17) — fully mocked DB.
 * Regressions: photos, notes, birth date, preferences and waitlist used to
 * survive a deletion.
 */

const mockDb = require('./helpers/mockDb');

jest.mock('../../src/config/database', () => mockDb);

const { eraseClient, phoneVariants } = require('../../src/services/clientErasure');

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000001';

function sqlOf(tx) {
  return tx.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' '));
}

describe('phoneVariants', () => {
  test('covers stored, E.164 and bare formats', () => {
    expect(phoneVariants('0612345678')).toEqual(['0612345678', '+33612345678', '33612345678']);
  });

  test('no phone, no variant', () => {
    expect(phoneVariants(null)).toEqual([]);
  });
});

describe('eraseClient', () => {
  beforeEach(() => mockDb.resetMocks());

  test('returns false when the client is missing or already deleted', async () => {
    const tx = mockDb.setupTransaction();
    tx.query.mockResolvedValueOnce({ rows: [] });

    await expect(eraseClient(CLIENT_ID)).resolves.toBe(false);
    expect(tx.query).toHaveBeenCalledTimes(1);
  });

  test('erases every trace of personal data', async () => {
    const tx = mockDb.setupTransaction();
    tx.query
      .mockResolvedValueOnce({ rows: [{ phone: '0612345678', email: 'Jean@Mail.fr' }] })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(eraseClient(CLIENT_ID)).resolves.toBe(true);

    const sql = sqlOf(tx);
    const has = (fragment) => sql.some((s) => s.includes(fragment));

    expect(has("UPDATE bookings SET status = 'cancelled'")).toBe(true);
    expect(has('DELETE FROM notification_queue')).toBe(true);
    expect(has('DELETE FROM twilio_sms_events')).toBe(true);
    expect(has('DELETE FROM brevo_sms_events')).toBe(true);
    expect(has('DELETE FROM brevo_email_events')).toBe(true);
    expect(has('DELETE FROM client_photos')).toBe(true);
    expect(has('DELETE FROM waitlist')).toBe(true);
    expect(has('DELETE FROM event_alerts')).toBe(true);
    expect(has('UPDATE gift_cards')).toBe(true);
    expect(has('DELETE FROM refresh_tokens')).toBe(true);

    const anonymize = sql.find((s) => s.startsWith('UPDATE clients SET'));
    for (const col of ['email = NULL', 'password_hash = NULL', 'notes = NULL', 'birth_date = NULL', 'preferences = NULL', 'deleted_at = NOW()']) {
      expect(anonymize).toContain(col);
    }
  });

  test('matches logs on every phone format and a lower-cased email', async () => {
    const tx = mockDb.setupTransaction();
    tx.query
      .mockResolvedValueOnce({ rows: [{ phone: '0612345678', email: 'Jean@Mail.fr' }] })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    await eraseClient(CLIENT_ID);

    const queueCall = tx.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM notification_queue'));
    expect(queueCall[1]).toEqual([CLIENT_ID, ['0612345678', '+33612345678', '33612345678'], ['jean@mail.fr']]);
  });

  test('does not touch the SMS blacklist', async () => {
    const tx = mockDb.setupTransaction();
    tx.query
      .mockResolvedValueOnce({ rows: [{ phone: '0612345678', email: null }] })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    await eraseClient(CLIENT_ID);

    expect(sqlOf(tx).some((s) => s.includes('sms_blacklist'))).toBe(false);
  });
});
