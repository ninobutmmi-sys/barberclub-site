/**
 * Réservation en ligne fermée pour un salon pas encore ouvert (Voiron).
 * Le drapeau salons.online_booking_open bloque les routes publiques qui
 * créent ou décalent un RDV, et rien d'autre.
 */
const request = require('supertest');
const { createTestApp } = require('../../integration/helpers/createApp');

jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../../src/services/booking', () => ({
  createBooking: jest.fn(),
  cancelBooking: jest.fn(),
  rescheduleBooking: jest.fn(),
}));
jest.mock('../../../src/services/websocket', () => ({ emitBookingCreated: jest.fn() }));
jest.mock('../../../src/middleware/rateLimiter', () => ({
  publicLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  adminLimiter: (req, res, next) => next(),
}));
jest.mock('../../../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  requireBarber: (req, res, next) => next(),
  optionalAuth: (req, res, next) => next(),
}));
jest.mock('../../../src/middleware/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const db = require('../../../src/config/database');
const bookingService = require('../../../src/services/booking');
const { logAudit } = require('../../../src/middleware/auditLog');
const { isOnlineBookingOpen, assertOnlineBookingOpen } = require('../../../src/services/salonStatus');

// Drapeau par salon, servi par le faux db.query
let flags;
db.query.mockImplementation(async (sql, params) => {
  if (sql.includes('online_booking_open FROM salons')) {
    return { rows: params[0] in flags ? [{ online_booking_open: flags[params[0]] }] : [] };
  }
  if (sql.startsWith('UPDATE salons SET online_booking_open')) {
    flags[params[1]] = params[0];
    return { rows: [{ online_booking_open: params[0] }] };
  }
  return { rows: [] };
});

function app(user) {
  return createTestApp((a) => {
    a.use('/api', require('../../../src/routes/bookings'));
    a.use('/api', require('../../../src/routes/salons').publicRouter);
    a.use('/api/admin/salon', (req, res, next) => { req.user = user; next(); }, require('../../../src/routes/salons').adminRouter);
  });
}

const futur = () => {
  const d = new Date(); d.setDate(d.getDate() + 10);
  return d.toISOString().slice(0, 10);
};
const reservation = (salon_id) => ({
  barber_id: 'b5000000-0000-0000-0000-000000000001',
  service_id: 'a0000000-0000-0000-0000-000000000001',
  date: futur(), start_time: '10:00',
  first_name: 'Jean', last_name: 'Dupont', phone: '0612345678', email: 'jean@exemple.fr',
  salon_id,
});

beforeEach(() => {
  flags = { meylan: true, grenoble: true, voiron: false };
  bookingService.createBooking.mockReset().mockResolvedValue({ id: 'bk-1' });
  logAudit.mockClear();
});

describe('salonStatus', () => {
  test('fermé : 403 avec le code booking_closed', async () => {
    await expect(assertOnlineBookingOpen('voiron')).rejects.toMatchObject({ statusCode: 403, code: 'booking_closed' });
  });
  test('ouvert : rien', async () => {
    await expect(assertOnlineBookingOpen('meylan')).resolves.toBeUndefined();
  });
  test('colonne absente (migration pas encore jouée) : ouvert', async () => {
    const q = { query: jest.fn().mockRejectedValue(Object.assign(new Error('column'), { code: '42703' })) };
    await expect(isOnlineBookingOpen('voiron', q)).resolves.toBe(true);
  });
  test('autre erreur de base : remontée, pas avalée', async () => {
    const q = { query: jest.fn().mockRejectedValue(new Error('connexion perdue')) };
    await expect(isOnlineBookingOpen('voiron', q)).rejects.toThrow('connexion perdue');
  });
});

describe('POST /api/bookings', () => {
  test('Voiron fermé : 403 booking_closed, aucun RDV créé', async () => {
    const res = await request(app()).post('/api/bookings').send(reservation('voiron'));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('booking_closed');
    expect(res.body.error).toMatch(/ouvre bientôt/);
    expect(bookingService.createBooking).not.toHaveBeenCalled();
  });
  test('Meylan ouvert : le RDV passe', async () => {
    const res = await request(app()).post('/api/bookings').send(reservation('meylan'));
    expect(res.status).toBe(201);
    expect(bookingService.createBooking).toHaveBeenCalled();
  });
  test('Voiron une fois ouvert : le RDV passe', async () => {
    flags.voiron = true;
    const res = await request(app()).post('/api/bookings').send(reservation('voiron'));
    expect(res.status).toBe(201);
  });
});

describe('POST /api/waitlist', () => {
  test('Voiron fermé : 403 booking_closed', async () => {
    const res = await request(app()).post('/api/waitlist').send({
      barber_id: 'b5000000-0000-0000-0000-000000000001',
      service_id: 'a0000000-0000-0000-0000-000000000001',
      preferred_date: futur(), client_name: 'Jean', client_phone: '0612345678', salon_id: 'voiron',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('booking_closed');
  });
});

describe('GET /api/salons/:id/status', () => {
  test('renvoie le drapeau', async () => {
    const res = await request(app()).get('/api/salons/voiron/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'voiron', online_booking_open: false });
  });
  test('salon inconnu : 404, pas de repli sur Meylan', async () => {
    const res = await request(app()).get('/api/salons/lyon/status');
    expect(res.status).toBe(404);
  });
});

describe('/api/admin/salon/online-booking', () => {
  const barbier = { id: 'b-admin', salon_id: 'voiron', email: 'barberclubvoiron@gmail.com' };

  test('GET : état du salon courant', async () => {
    const res = await request(app(barbier)).get('/api/admin/salon/online-booking');
    expect(res.body).toEqual({ id: 'voiron', online_booking_open: false });
  });
  test('PUT open=true : ouvre ce salon seulement, et le trace', async () => {
    const res = await request(app(barbier)).put('/api/admin/salon/online-booking').send({ open: true });
    expect(res.status).toBe(200);
    expect(res.body.online_booking_open).toBe(true);
    expect(flags).toEqual({ meylan: true, grenoble: true, voiron: true });
    expect(logAudit).toHaveBeenCalledWith(expect.anything(), 'open_online_booking', 'salon', null, { salon_id: 'voiron', open: true });
  });
  test('PUT avec autre chose qu\'un booléen : 400', async () => {
    const res = await request(app(barbier)).put('/api/admin/salon/online-booking').send({ open: 'oui' });
    expect(res.status).toBe(400);
    expect(flags.voiron).toBe(false);
  });
});
