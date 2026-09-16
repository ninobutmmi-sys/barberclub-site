/**
 * Julien à Grenoble le jeudi : semaine type d'un invité et déplacements répétés.
 * Écrire la semaine d'un invité finissait en 500 (UNIQUE barber_id, day_of_week).
 * Les déplacements acceptent désormais une répétition hebdomadaire.
 */
const request = require('supertest');
const { createTestApp } = require('../../integration/helpers/createApp');

jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  pool: { end: jest.fn() },
  ensureConnection: jest.fn(),
}));

jest.mock('../../../src/services/notification', () => ({
  queueNotification: jest.fn().mockResolvedValue(),
}));

// logAudit enchaîne .catch() sur db.query : avec un mock nu qui renvoie
// undefined, la route partirait en 500. On le neutralise, il est testé ailleurs.
jest.mock('../../../src/middleware/auditLog', () => ({ logAudit: jest.fn() }));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const TEST_ADMIN = { id: 'admin-1', type: 'barber', salon_id: 'grenoble' };
jest.mock('../../../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = { ...TEST_ADMIN }; next(); },
  requireBarber: (req, res, next) => next(),
}));

const db = require('../../../src/config/database');
const barberRoutes = require('../../../src/routes/admin/barbers');
const { requireAuth, requireBarber } = require('../../../src/middleware/auth');

const BARBER = '32072b24-c3f7-4b03-9a6f-3a7f858d6e21';

const app = createTestApp((a) => {
  a.use('/api/admin/barbers', requireAuth, requireBarber, barberRoutes);
});

beforeEach(() => { jest.clearAllMocks(); });

describe('PUT /api/admin/barbers/:id/schedule', () => {
  it('refuse en 400, sans rien écrire, la semaine d\'un barbier invité', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // pas un barbier de Grenoble

    const res = await request(app)
      .put(`/api/admin/barbers/${BARBER}/schedule`)
      .send({ schedules: [{ day_of_week: 3, is_working: true, start_time: '09:00', end_time: '19:00' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Déplacements/);
  });
});

describe('POST /api/admin/barbers/:id/guest-days', () => {
  function transactionQuiEnregistre() {
    const client = { query: jest.fn(async (sql, params) => ({ rows: [{ date: params[2] }] })) };
    db.transaction.mockImplementation((fn) => fn(client));
    return client;
  }

  it('crée un jour par semaine jusqu\'à la date de fin incluse', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: BARBER, salon_id: 'meylan' }] });
    const client = transactionQuiEnregistre();

    const res = await request(app)
      .post(`/api/admin/barbers/${BARBER}/guest-days`)
      .send({ date: '2026-09-17', host_salon_id: 'grenoble', start_time: '09:00', end_time: '19:00', repeat_until: '2026-10-15' });

    expect(res.status).toBe(201);
    expect(client.query.mock.calls.map(([, p]) => p[2]))
      .toEqual(['2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15']);
    expect(res.body).toHaveLength(5);
  });

  it('garde la réponse d\'un seul jour sans répétition', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: BARBER, salon_id: 'meylan' }] });
    transactionQuiEnregistre();

    const res = await request(app)
      .post(`/api/admin/barbers/${BARBER}/guest-days`)
      .send({ date: '2026-09-17', host_salon_id: 'grenoble' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ date: '2026-09-17' });
  });

  it('refuse une date de fin avant la première date', async () => {
    const res = await request(app)
      .post(`/api/admin/barbers/${BARBER}/guest-days`)
      .send({ date: '2026-09-17', host_salon_id: 'grenoble', repeat_until: '2026-09-10' });

    expect(res.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('refuse plus de 52 semaines', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: BARBER, salon_id: 'meylan' }] });

    const res = await request(app)
      .post(`/api/admin/barbers/${BARBER}/guest-days`)
      .send({ date: '2026-09-17', host_salon_id: 'grenoble', repeat_until: '2028-01-01' });

    expect(res.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
