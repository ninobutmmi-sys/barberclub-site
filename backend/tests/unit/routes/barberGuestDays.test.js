/**
 * Julien à Grenoble tous les jeudis : semaine type d'un invité et jours fixes.
 * Écrire la semaine d'un invité finissait en 500 (UNIQUE barber_id, day_of_week).
 * Un jour fixe crée la règle et génère ses dates dans la même transaction.
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
    expect(res.body.error).toMatch(/Autre salon/);
  });
});

function transactionAvec(repondre) {
  const client = { query: jest.fn(repondre) };
  db.transaction.mockImplementation((fn) => fn(client));
  return client;
}

describe('POST /api/admin/barbers/:id/guest-weekly', () => {
  const JEUDI_GRENOBLE = { day_of_week: 3, host_salon_id: 'grenoble', start_time: '09:00', end_time: '19:00' };

  it('enregistre la règle, aligne les dates à venir et génère les suivantes', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ salon_id: 'meylan' }] });
    const client = transactionAvec(async (sql) => (
      sql.includes('INSERT INTO guest_weekly')
        ? { rows: [{ id: 'r1', ...JEUDI_GRENOBLE }] }
        : { rows: [], rowCount: 26 }
    ));

    const res = await request(app).post(`/api/admin/barbers/${BARBER}/guest-weekly`).send(JEUDI_GRENOBLE);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'r1', day_of_week: 3, host_salon_id: 'grenoble' });
    const sqls = client.query.mock.calls.map(([sql]) => sql);
    expect(sqls[0]).toContain('INSERT INTO guest_weekly');
    expect(sqls[1]).toContain('UPDATE guest_assignments');
    expect(sqls[2]).toContain('INSERT INTO guest_assignments');
    expect(client.query.mock.calls[2][1]).toEqual(['r1']); // seulement cette règle
    expect(sqls[3]).toContain('UPDATE guest_weekly SET generated_until');
  });

  it('refuse un jour fixe dans le salon du barbier', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ salon_id: 'grenoble' }] });

    const res = await request(app).post(`/api/admin/barbers/${BARBER}/guest-weekly`).send(JEUDI_GRENOBLE);

    expect(res.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('refuse une fin avant le début', async () => {
    const res = await request(app)
      .post(`/api/admin/barbers/${BARBER}/guest-weekly`)
      .send({ ...JEUDI_GRENOBLE, start_time: '19:00', end_time: '09:00' });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/barbers/guest-weekly/:id', () => {
  const RULE = 'b1000000-0000-0000-0000-000000000001';

  it('retire la règle et ses dates à partir de demain', async () => {
    const client = transactionAvec(async (sql) => (
      sql.includes('DELETE FROM guest_weekly')
        ? { rows: [{ barber_id: BARBER, host_salon_id: 'grenoble', day_of_week: 3 }] }
        : { rows: [] }
    ));

    const res = await request(app).delete(`/api/admin/barbers/guest-weekly/${RULE}`);

    expect(res.status).toBe(200);
    const [sql, params] = client.query.mock.calls[1];
    expect(sql).toContain('DELETE FROM guest_assignments');
    expect(sql).toContain('date > CURRENT_DATE');
    expect(params).toEqual([BARBER, 'grenoble', 3]);
  });

  it('404 si la règle n\'est pas visible depuis ce salon', async () => {
    const client = transactionAvec(async () => ({ rows: [] }));

    const res = await request(app).delete(`/api/admin/barbers/guest-weekly/${RULE}`);

    expect(res.status).toBe(404);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
