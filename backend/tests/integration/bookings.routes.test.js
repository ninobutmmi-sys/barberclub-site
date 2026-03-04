/**
 * Integration tests — Public booking routes
 * Tests the full Express request/response cycle with mocked database.
 */
const request = require('supertest');
const { createTestApp } = require('./helpers/createApp');

// ============================================
// Mock database
// ============================================
jest.mock('../../src/config/database', () => {
  const mockQuery = jest.fn();
  return {
    query: mockQuery,
    getClient: jest.fn(),
    transaction: jest.fn(),
    healthCheck: jest.fn(),
    pool: { end: jest.fn() },
    ensureConnection: jest.fn(),
  };
});

// Mock services
jest.mock('../../src/services/booking', () => ({
  createBooking: jest.fn(),
  cancelBooking: jest.fn(),
  rescheduleBooking: jest.fn(),
  createRecurringBookings: jest.fn(),
}));

jest.mock('../../src/services/availability', () => ({
  getAvailableSlots: jest.fn(),
  addMinutesToTime: jest.fn((time, min) => {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + min;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }),
}));

jest.mock('../../src/services/notification', () => ({
  sendConfirmationEmail: jest.fn().mockResolvedValue(),
  sendCancellationEmail: jest.fn().mockResolvedValue(),
  sendRescheduleEmail: jest.fn().mockResolvedValue(),
  sendResetPasswordEmail: jest.fn().mockResolvedValue(),
  sendWaitlistSMS: jest.fn().mockResolvedValue(),
}));

// Disable rate limiting in tests
jest.mock('../../src/middleware/rateLimiter', () => ({
  publicLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  adminLimiter: (req, res, next) => next(),
}));

// Mock optionalAuth to just pass through
jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  requireBarber: (req, res, next) => next(),
  optionalAuth: (req, res, next) => next(),
  generateAccessToken: jest.fn(() => 'mock-access-token'),
  generateRefreshToken: jest.fn(() => 'mock-refresh-token'),
}));

// Mock ICS utility
jest.mock('../../src/utils/ics', () => ({
  generateICS: jest.fn(() => 'BEGIN:VCALENDAR\nEND:VCALENDAR'),
}));

const db = require('../../src/config/database');
const bookingService = require('../../src/services/booking');
const availabilityService = require('../../src/services/availability');
const bookingRoutes = require('../../src/routes/bookings');

// ============================================
// Build test app
// ============================================
let app;
beforeAll(() => {
  app = createTestApp((expressApp) => {
    expressApp.use('/api', bookingRoutes);
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ============================================
// Test data
// ============================================
const BARBER_ID = 'b0000000-0000-0000-0000-000000000001';
const SERVICE_ID = 'a0000000-0000-0000-0000-000000000001';
const BOOKING_ID = 'c0000000-0000-0000-0000-000000000001';
const CANCEL_TOKEN = 'd0000000-0000-0000-0000-000000000001';

// Future date for tests (1 month from now, on a Tuesday)
function getFutureDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  // Make sure it's a weekday
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

const FUTURE_DATE = getFutureDate();

// ============================================
// GET /api/barbers
// ============================================
describe('GET /api/barbers', () => {
  it('returns barbers for the default salon (meylan)', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          { id: BARBER_ID, name: 'Lucas', role: 'Barber', photo_url: null, is_guest: false },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // guest barbers
      .mockResolvedValueOnce({ rows: [{ barber_id: BARBER_ID, day_of_week: 0 }] }); // schedules

    const res = await request(app).get('/api/barbers');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Lucas');
    expect(res.body[0].off_days).toEqual([0]);
    expect(db.query).toHaveBeenCalledTimes(3);
    // First query should filter by salon_id = 'meylan'
    expect(db.query.mock.calls[0][1]).toEqual(['meylan']);
  });

  it('returns barbers for grenoble salon', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'g1', name: 'Tom', role: 'Barber', photo_url: null, is_guest: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/barbers?salon_id=grenoble');

    expect(res.status).toBe(200);
    expect(db.query.mock.calls[0][1]).toEqual(['grenoble']);
  });

  it('includes guest barbers with future assignments', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: BARBER_ID, name: 'Lucas', role: 'Barber', photo_url: null, is_guest: false }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'guest-1', name: 'Julien', role: 'Barber', photo_url: null, sort_order: 2, is_guest: true }],
      })
      .mockResolvedValueOnce({ rows: [] }) // schedules
      .mockResolvedValueOnce({ rows: [{ barber_id: 'guest-1', date: FUTURE_DATE }] }); // guest dates

    const res = await request(app).get('/api/barbers');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[1].is_guest).toBe(true);
    expect(res.body[1].guest_dates).toEqual([FUTURE_DATE]);
  });

  it('rejects invalid salon_id', async () => {
    const res = await request(app).get('/api/barbers?salon_id=invalid');
    expect(res.status).toBe(400);
  });
});

// ============================================
// GET /api/services
// ============================================
describe('GET /api/services', () => {
  it('returns all services for default salon', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: SERVICE_ID, name: 'Coupe homme', price: 2700, duration: 30 },
        { id: 'a0000000-0000-0000-0000-000000000002', name: 'Barbe', price: 1500, duration: 20 },
      ],
    });

    const res = await request(app).get('/api/services');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].price).toBe(2700); // centimes
  });

  it('filters services by barber_id', async () => {
    // First call: check barber's home salon
    db.query.mockResolvedValueOnce({ rows: [{ salon_id: 'meylan' }] });
    // Second call: get filtered services
    db.query.mockResolvedValueOnce({
      rows: [{ id: SERVICE_ID, name: 'Coupe homme', price: 2700, duration: 30 }],
    });

    const res = await request(app).get(`/api/services?barber_id=${BARBER_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('returns all services when barber_id is "any"', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: SERVICE_ID, name: 'Coupe homme', price: 2700, duration: 30 }],
    });

    const res = await request(app).get('/api/services?barber_id=any');

    expect(res.status).toBe(200);
    // Should use the "all services" query, not the barber-specific one
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid barber_id format', async () => {
    const res = await request(app).get('/api/services?barber_id=not-a-uuid');
    expect(res.status).toBe(400);
  });
});

// ============================================
// GET /api/availability
// ============================================
describe('GET /api/availability', () => {
  it('returns available slots', async () => {
    availabilityService.getAvailableSlots.mockResolvedValueOnce([
      { barber_id: BARBER_ID, barber_name: 'Lucas', start_time: '10:00', end_time: '10:30' },
      { barber_id: BARBER_ID, barber_name: 'Lucas', start_time: '10:30', end_time: '11:00' },
    ]);

    const res = await request(app)
      .get(`/api/availability?service_id=${SERVICE_ID}&date=${FUTURE_DATE}&barber_id=${BARBER_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(availabilityService.getAvailableSlots).toHaveBeenCalledWith(
      BARBER_ID, SERVICE_ID, FUTURE_DATE, { salonId: 'meylan' }
    );
  });

  it('validates date format (rejects invalid)', async () => {
    const res = await request(app)
      .get(`/api/availability?service_id=${SERVICE_ID}&date=invalid-date`);

    expect(res.status).toBe(400);
  });

  it('rejects past dates', async () => {
    const res = await request(app)
      .get(`/api/availability?service_id=${SERVICE_ID}&date=2020-01-01`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('futur');
  });

  it('rejects dates more than 6 months in the future', async () => {
    const farFuture = new Date();
    farFuture.setMonth(farFuture.getMonth() + 7);
    const farDate = farFuture.toISOString().split('T')[0];

    const res = await request(app)
      .get(`/api/availability?service_id=${SERVICE_ID}&date=${farDate}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('6 mois');
  });

  it('requires service_id', async () => {
    const res = await request(app)
      .get(`/api/availability?date=${FUTURE_DATE}`);

    expect(res.status).toBe(400);
  });

  it('defaults barber_id to "any" when not provided', async () => {
    availabilityService.getAvailableSlots.mockResolvedValueOnce([]);

    await request(app)
      .get(`/api/availability?service_id=${SERVICE_ID}&date=${FUTURE_DATE}`);

    expect(availabilityService.getAvailableSlots).toHaveBeenCalledWith(
      'any', SERVICE_ID, FUTURE_DATE, { salonId: 'meylan' }
    );
  });
});

// ============================================
// POST /api/bookings
// ============================================
describe('POST /api/bookings', () => {
  const validBooking = {
    barber_id: BARBER_ID,
    service_id: SERVICE_ID,
    date: FUTURE_DATE,
    start_time: '10:00',
    first_name: 'Jean',
    last_name: 'Dupont',
    phone: '0612345678',
    email: 'jean@test.fr',
  };

  it('creates a booking successfully', async () => {
    bookingService.createBooking.mockResolvedValueOnce({
      id: BOOKING_ID,
      ...validBooking,
      status: 'confirmed',
      cancel_token: CANCEL_TOKEN,
    });

    const res = await request(app)
      .post('/api/bookings')
      .send(validBooking);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(BOOKING_ID);
    expect(bookingService.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        barber_id: BARBER_ID,
        source: 'online',
        salon_id: 'meylan',
      })
    );
  });

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ barber_id: BARBER_ID });

    expect(res.status).toBe(400);
  });

  it('validates phone format (french numbers only)', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ ...validBooking, phone: '123' });

    expect(res.status).toBe(400);
  });

  it('validates start_time format', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ ...validBooking, start_time: '25:00' });

    expect(res.status).toBe(400);
  });

  it('validates date format', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ ...validBooking, date: 'not-a-date' });

    expect(res.status).toBe(400);
  });

  it('returns 409 on booking conflict', async () => {
    const { ApiError } = require('../../src/utils/errors');
    bookingService.createBooking.mockRejectedValueOnce(
      ApiError.conflict('Ce creneau vient d\'etre pris')
    );

    const res = await request(app)
      .post('/api/bookings')
      .send(validBooking);

    expect(res.status).toBe(409);
  });

  it('uses salon_id from body when provided', async () => {
    bookingService.createBooking.mockResolvedValueOnce({ id: BOOKING_ID, status: 'confirmed' });

    await request(app)
      .post('/api/bookings')
      .send({ ...validBooking, salon_id: 'grenoble' });

    expect(bookingService.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ salon_id: 'grenoble' })
    );
  });

  it('requires email for guest bookings (no auth)', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ ...validBooking, email: '' });

    expect(res.status).toBe(400);
  });
});

// ============================================
// POST /api/bookings/:id/cancel
// ============================================
describe('POST /api/bookings/:id/cancel', () => {
  it('cancels a booking with valid token', async () => {
    bookingService.cancelBooking.mockResolvedValueOnce({
      id: BOOKING_ID,
      status: 'cancelled',
    });

    const res = await request(app)
      .post(`/api/bookings/${BOOKING_ID}/cancel`)
      .send({ token: CANCEL_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('annul');
    expect(bookingService.cancelBooking).toHaveBeenCalledWith(BOOKING_ID, CANCEL_TOKEN);
  });

  it('validates token format', async () => {
    const res = await request(app)
      .post(`/api/bookings/${BOOKING_ID}/cancel`)
      .send({ token: 'invalid-token' });

    expect(res.status).toBe(400);
  });

  it('validates booking id format', async () => {
    const res = await request(app)
      .post('/api/bookings/not-a-uuid/cancel')
      .send({ token: CANCEL_TOKEN });

    expect(res.status).toBe(400);
  });

  it('returns 404 when booking not found', async () => {
    const { ApiError } = require('../../src/utils/errors');
    bookingService.cancelBooking.mockRejectedValueOnce(
      ApiError.notFound('Rendez-vous introuvable')
    );

    const res = await request(app)
      .post(`/api/bookings/${BOOKING_ID}/cancel`)
      .send({ token: CANCEL_TOKEN });

    expect(res.status).toBe(404);
  });
});

// ============================================
// POST /api/waitlist
// ============================================
describe('POST /api/waitlist', () => {
  const validWaitlist = {
    barber_id: BARBER_ID,
    service_id: SERVICE_ID,
    preferred_date: FUTURE_DATE,
    client_name: 'Jean Dupont',
    client_phone: '0612345678',
  };

  it('creates a waitlist entry', async () => {
    // Check for duplicate
    db.query.mockResolvedValueOnce({ rows: [] });
    // INSERT
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'w1', status: 'waiting', created_at: '2026-03-04T10:00:00Z' }],
    });

    const res = await request(app)
      .post('/api/waitlist')
      .send(validWaitlist);

    expect(res.status).toBe(201);
    expect(res.body.waitlist_id).toBe('w1');
    expect(res.body.message).toContain('SMS');
  });

  it('rejects duplicate waitlist entry (same phone + barber + date)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

    const res = await request(app)
      .post('/api/waitlist')
      .send(validWaitlist);

    expect(res.status).toBe(409);
  });

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/waitlist')
      .send({ barber_id: BARBER_ID });

    expect(res.status).toBe(400);
  });

  it('requires name and phone for guest users', async () => {
    const res = await request(app)
      .post('/api/waitlist')
      .send({
        barber_id: BARBER_ID,
        service_id: SERVICE_ID,
        preferred_date: FUTURE_DATE,
        // missing client_name and client_phone
      });

    expect(res.status).toBe(400);
  });

  it('rejects past dates', async () => {
    // Date validation happens BEFORE db.query, so no mock needed
    const res = await request(app)
      .post('/api/waitlist')
      .send({ ...validWaitlist, preferred_date: '2020-01-01' });

    expect(res.status).toBe(400);
  });

  it('accepts optional time window', async () => {
    // Duplicate check
    db.query.mockResolvedValueOnce({ rows: [] });
    // INSERT
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'w2', status: 'waiting', created_at: '2026-03-04T10:00:00Z' }],
    });

    const res = await request(app)
      .post('/api/waitlist')
      .send({
        barber_id: BARBER_ID,
        service_id: SERVICE_ID,
        preferred_date: FUTURE_DATE,
        client_name: 'Pierre Martin',
        client_phone: '0699887766',
        preferred_time_start: '09:00',
        preferred_time_end: '12:00',
      });

    expect(res.status).toBe(201);
  });
});

// ============================================
// GET /api/bookings/:id (with cancel token)
// ============================================
describe('GET /api/bookings/:id', () => {
  it('returns booking details with valid token', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: BOOKING_ID,
        date: FUTURE_DATE,
        start_time: '10:00',
        end_time: '10:30',
        status: 'confirmed',
        price: 2700,
        cancel_token: CANCEL_TOKEN,
        barber_id: BARBER_ID,
        service_id: SERVICE_ID,
        service_name: 'Coupe homme',
        service_duration: 30,
        barber_name: 'Lucas',
        barber_photo: null,
      }],
    });

    const res = await request(app)
      .get(`/api/bookings/${BOOKING_ID}?token=${CANCEL_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(BOOKING_ID);
    expect(res.body.barber_name).toBe('Lucas');
  });

  it('returns 404 with invalid token', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/bookings/${BOOKING_ID}?token=${CANCEL_TOKEN}`);

    expect(res.status).toBe(404);
  });

  it('validates id format', async () => {
    const res = await request(app)
      .get('/api/bookings/invalid?token=' + CANCEL_TOKEN);

    expect(res.status).toBe(400);
  });
});
