/**
 * Prestations d'un barbier — routes admin.
 * Couvre la garde salon et la règle « durée = défaut => on ne stocke rien »,
 * les deux endroits où une erreur passerait inaperçue en production.
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

const TEST_ADMIN = { id: 'admin-1', type: 'barber', salon_id: 'meylan' };
jest.mock('../../../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = { ...TEST_ADMIN }; next(); },
  requireBarber: (req, res, next) => next(),
}));

const db = require('../../../src/config/database');
const barberRoutes = require('../../../src/routes/admin/barbers');
const { requireAuth, requireBarber } = require('../../../src/middleware/auth');

const BARBER = '32072b24-c3f7-4b03-9a6f-3a7f858d6e21';
const SERVICE = 'a0000000-0000-0000-0000-000000000003';

const app = createTestApp((a) => {
  a.use('/api/admin/barbers', requireAuth, requireBarber, barberRoutes);
});

beforeEach(() => { jest.clearAllMocks(); });

describe('PUT /api/admin/barbers/:id/services/:serviceId', () => {
  it('refuse une prestation qui appartient à un autre salon', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // la requête filtre sur salon_id

    const res = await request(app)
      .put(`/api/admin/barbers/${BARBER}/services/${SERVICE}`)
      .send({ custom_duration: 40 });

    expect(res.status).toBe(404);
    // Rien ne doit être écrit si le salon ne correspond pas
    const ecriture = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO barber_services'));
    expect(ecriture).toBeUndefined();
  });

  it('enregistre la durée personnalisée quand elle diffère du défaut', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: SERVICE, duration: 30, duration_saturday: null }] }); // service
    db.query.mockResolvedValueOnce({ rows: [{ id: BARBER }] });                // barbier
    db.query.mockResolvedValueOnce({ rows: [] });                              // upsert

    const res = await request(app)
      .put(`/api/admin/barbers/${BARBER}/services/${SERVICE}`)
      .send({ custom_duration: 40 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ custom_duration: 40, effective_duration: 40, assigned: true });
    const upsert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO barber_services'));
    expect(upsert[1]).toEqual([BARBER, SERVICE, 40]);
  });

  it('ne stocke rien quand la durée demandée est déjà celle de la prestation', async () => {
    // Sinon le barbier serait figé et ne suivrait plus la prestation si sa
    // durée change — c'est le choix fait dans les migrations 062 et 064.
    db.query.mockResolvedValueOnce({ rows: [{ id: SERVICE, duration: 30, duration_saturday: null }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: BARBER }] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/admin/barbers/${BARBER}/services/${SERVICE}`)
      .send({ custom_duration: 30 });

    expect(res.status).toBe(200);
    expect(res.body.custom_duration).toBeNull();
    expect(res.body.effective_duration).toBe(30);
    const upsert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO barber_services'));
    expect(upsert[1]).toEqual([BARBER, SERVICE, null]);
  });

  it("garde l'exception quand la prestation a une durée du samedi différente", async () => {
    // La résolution réelle est custom_duration > duration_saturday > duration.
    // Effacer l'exception ferait basculer les samedis sur 20 sans qu'on puisse
    // les fixer à 30 — c'est le piège relevé en revue de code.
    db.query.mockResolvedValueOnce({ rows: [{ id: SERVICE, duration: 30, duration_saturday: 20 }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: BARBER }] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/admin/barbers/${BARBER}/services/${SERVICE}`)
      .send({ custom_duration: 30 });

    expect(res.status).toBe(200);
    expect(res.body.custom_duration).toBe(30);
    const upsert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO barber_services'));
    expect(upsert[1]).toEqual([BARBER, SERVICE, 30]);
  });

  it('efface bien l\'exception quand la durée du samedi est la même', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: SERVICE, duration: 30, duration_saturday: 30 }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: BARBER }] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/admin/barbers/${BARBER}/services/${SERVICE}`)
      .send({ custom_duration: 30 });

    expect(res.body.custom_duration).toBeNull();
  });

  it('assigne sans durée particulière quand le corps est vide', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: SERVICE, duration: 30, duration_saturday: null }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: BARBER }] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/admin/barbers/${BARBER}/services/${SERVICE}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.custom_duration).toBeNull();
  });

  it('refuse une durée hors bornes', async () => {
    const res = await request(app)
      .put(`/api/admin/barbers/${BARBER}/services/${SERVICE}`)
      .send({ custom_duration: 600 });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/barbers/:id/services/:serviceId', () => {
  it("refuse de retirer une prestation d'un autre salon", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).delete(`/api/admin/barbers/${BARBER}/services/${SERVICE}`);

    expect(res.status).toBe(404);
    expect(db.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM barber_services'))).toBeUndefined();
  });

  it('retire le lien quand la prestation est bien du salon', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: SERVICE }] });
    db.query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app).delete(`/api/admin/barbers/${BARBER}/services/${SERVICE}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ assigned: false });
    const del = db.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM barber_services'));
    expect(del[1]).toEqual([BARBER, SERVICE]);
  });
});

describe('GET /api/admin/barbers/:id/services', () => {
  it('renvoie tout le catalogue du salon avec la durée effective', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: BARBER }] }); // existence du barbier
    db.query.mockResolvedValueOnce({
      rows: [
        { id: SERVICE, name: 'Coupe + Barbe', assigned: true, custom_duration: 40, default_duration: 30, effective_duration: 40 },
        { id: 'autre', name: 'Barbe Uniquement', assigned: false, custom_duration: null, default_duration: 20, effective_duration: 20 },
      ],
    });

    const res = await request(app).get(`/api/admin/barbers/${BARBER}/services`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Le catalogue complet, y compris ce que le barbier ne fait pas :
    // l'écran doit permettre de le lui ajouter.
    expect(res.body.filter((s) => !s.assigned)).toHaveLength(1);
    expect(db.query.mock.calls[1][1]).toEqual(['meylan', BARBER]);
  });
});
