/**
 * Integration tests — Admin booking routes
 * Tests /api/admin/bookings/* with mocked auth and database.
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

// Mock booking service
jest.mock('../../src/services/booking', () => ({
  createBooking: jest.fn(),
  cancelBooking: jest.fn(),
  createRecurringBookings: jest.fn(),
  updateBookingStatus: jest.fn(),
}));

// Mock availability service
jest.mock('../../src/services/availability', () => ({
  getAvailableSlots: jest.fn(),
  addMinutesToTime: jest.fn((time, min) => {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + min;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }),
}));

// Mock notifications
jest.mock('../../src/services/notification', () => ({
  sendConfirmationEmail: jest.fn().mockResolvedValue(),
  sendCancellationEmail: jest.fn().mockResolvedValue(),
  sendRescheduleEmail: jest.fn().mockResolvedValue(),
  sendResetPasswordEmail: jest.fn().mockResolvedValue(),
  sendWaitlistSMS: jest.fn().mockResolvedValue(),
  queueNotification: jest.fn().mockResolvedValue(),
  toGSM: jest.fn((s) => s),
}));

// Disable rate limiting
jest.mock('../../src/middleware/rateLimiter', () => ({
  publicLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  adminLimiter: (req, res, next) => next(),
}));

// Mock auth middleware — inject test user
const TEST_USER = { id: 'b0000000-0000-0000-0000-000000000001', salon_id: 'meylan', type: 'barber', email: 'test@test.fr', name: 'Lucas' };

jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = { ...TEST_USER }; next(); },
  requireBarber: (req, res, next) => next(),
  optionalAuth: (req, res, next) => next(),
  generateAccessToken: jest.fn(() => 'mock-access-token'),
  generateRefreshToken: jest.fn(() => 'mock-refresh-token'),
}));

const db = require('../../src/config/database');
const bookingService = require('../../src/services/booking');
const notification = require('../../src/services/notification');
const adminBookingRoutes = require('../../src/routes/admin/bookings');
const { requireAuth, requireBarber } = require('../../src/middleware/auth');

// ============================================
// Build test app
// ============================================
let app;
beforeAll(() => {
  app = createTestApp((expressApp) => {
    expressApp.use('/api/admin/bookings', requireAuth, requireBarber, adminBookingRoutes);
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
const CLIENT_ID = 'e0000000-0000-0000-0000-000000000001';

function getFutureDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
const FUTURE_DATE = getFutureDate();

const MOCK_BOOKING_ROW = {
  id: BOOKING_ID,
  date: FUTURE_DATE,
  start_time: '10:00',
  end_time: '10:30',
  status: 'confirmed',
  price: 2700,
  source: 'online',
  created_at: '2026-03-04T10:00:00Z',
  service_id: SERVICE_ID,
  is_first_visit: false,
  booking_color: null,
  recurrence_group_id: null,
  service_name: 'Coupe homme',
  service_duration: 30,
  service_color: '#3B82F6',
  barber_id: BARBER_ID,
  barber_name: 'Lucas',
  client_id: CLIENT_ID,
  client_first_name: 'Jean',
  client_last_name: 'Dupont',
  client_phone: '0612345678',
  client_email: 'jean@test.fr',
  client_notes: null,
};

// ============================================
// GET /api/admin/bookings — Planning view
// ============================================
describe('GET /api/admin/bookings', () => {
  it('returns bookings filtered by salon_id from auth user', async () => {
    db.query.mockResolvedValueOnce({ rows: [MOCK_BOOKING_ROW] });

    const res = await request(app)
      .get(`/api/admin/bookings?date=${FUTURE_DATE}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].barber_name).toBe('Lucas');
    // Verify salon_id is passed as the last parameter
    const queryParams = db.query.mock.calls[0][1];
    expect(queryParams[queryParams.length - 1]).toBe('meylan');
  });

  it('supports week view', async () => {
    db.query.mockResolvedValueOnce({ rows: [MOCK_BOOKING_ROW, MOCK_BOOKING_ROW] });

    const res = await request(app)
      .get(`/api/admin/bookings?date=${FUTURE_DATE}&view=week`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Week view uses BETWEEN with two date params
    expect(db.query.mock.calls[0][1].length).toBe(3); // monday, sunday, salonId
  });

  it('filters by barber_id', async () => {
    db.query.mockResolvedValueOnce({ rows: [MOCK_BOOKING_ROW] });

    const res = await request(app)
      .get(`/api/admin/bookings?date=${FUTURE_DATE}&barber_id=${BARBER_ID}`);

    expect(res.status).toBe(200);
    // barber_id should be in query params
    const queryParams = db.query.mock.calls[0][1];
    expect(queryParams).toContain(BARBER_ID);
  });

  it('defaults to today when no date provided', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/admin/bookings');

    expect(res.status).toBe(200);
    // First param should be today's date
    const today = new Date().toISOString().split('T')[0];
    expect(db.query.mock.calls[0][1][0]).toBe(today);
  });

  it('rejects invalid date format', async () => {
    const res = await request(app)
      .get('/api/admin/bookings?date=not-valid');

    expect(res.status).toBe(400);
  });
});

// ============================================
// GET /api/admin/bookings/history
// ============================================
describe('GET /api/admin/bookings/history', () => {
  const historyResponse = {
    bookings: [MOCK_BOOKING_ROW],
    total: 1,
    limit: 50,
    offset: 0,
  };

  it('returns paginated booking history', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })  // count
      .mockResolvedValueOnce({ rows: [MOCK_BOOKING_ROW] }); // data

    const res = await request(app)
      .get('/api/admin/bookings/history');

    expect(res.status).toBe(200);
    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(0);
  });

  it('supports sort and order params (not hardcoded DESC)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '2' }] })
      .mockResolvedValueOnce({ rows: [MOCK_BOOKING_ROW, MOCK_BOOKING_ROW] });

    const res = await request(app)
      .get('/api/admin/bookings/history?sort=price&order=asc');

    expect(res.status).toBe(200);
    // Verify the SQL includes ASC (not hardcoded DESC)
    const sqlQuery = db.query.mock.calls[1][0];
    expect(sqlQuery).toContain('ASC');
  });

  it('filters by date range', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/admin/bookings/history?from=2026-01-01&to=2026-03-01');

    expect(res.status).toBe(200);
    const queryParams = db.query.mock.calls[0][1];
    expect(queryParams).toContain('2026-01-01');
    expect(queryParams).toContain('2026-03-01');
  });

  it('filters by status', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/admin/bookings/history?status=completed');

    expect(res.status).toBe(200);
    const queryParams = db.query.mock.calls[0][1];
    expect(queryParams).toContain('completed');
  });

  it('supports search by client name/phone', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [MOCK_BOOKING_ROW] });

    const res = await request(app)
      .get('/api/admin/bookings/history?search=Dupont');

    expect(res.status).toBe(200);
    const queryParams = db.query.mock.calls[0][1];
    expect(queryParams).toContain('%dupont%');
  });

  it('filters by salon_id from auth user', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/admin/bookings/history');

    // First param should be salonId
    expect(db.query.mock.calls[0][1][0]).toBe('meylan');
  });
});

// ============================================
// POST /api/admin/bookings — Manual booking
// ============================================
describe('POST /api/admin/bookings', () => {
  const validManualBooking = {
    barber_id: BARBER_ID,
    service_id: SERVICE_ID,
    date: FUTURE_DATE,
    start_time: '14:00',
    first_name: 'Marie',
    last_name: 'Martin',
    phone: '0698765432',
  };

  it('creates a manual booking with salon_id from auth user', async () => {
    bookingService.createBooking.mockResolvedValueOnce({
      id: BOOKING_ID,
      status: 'confirmed',
    });

    const res = await request(app)
      .post('/api/admin/bookings')
      .send(validManualBooking);

    expect(res.status).toBe(201);
    expect(bookingService.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'manual',
        salon_id: 'meylan',
        first_name: 'Marie',
      })
    );
  });

  it('creates recurring bookings when recurrence is provided', async () => {
    bookingService.createRecurringBookings.mockResolvedValueOnce({
      bookings: [{ id: 'r1' }, { id: 'r2' }],
      skipped: 0,
    });

    const res = await request(app)
      .post('/api/admin/bookings')
      .send({
        ...validManualBooking,
        recurrence: { type: 'weekly', end_type: 'occurrences', occurrences: 4 },
      });

    expect(res.status).toBe(201);
    expect(bookingService.createRecurringBookings).toHaveBeenCalled();
  });

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/admin/bookings')
      .send({ barber_id: BARBER_ID });

    expect(res.status).toBe(400);
  });

  it('validates phone format', async () => {
    const res = await request(app)
      .post('/api/admin/bookings')
      .send({ ...validManualBooking, phone: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('accepts optional color', async () => {
    bookingService.createBooking.mockResolvedValueOnce({ id: BOOKING_ID, status: 'confirmed' });

    const res = await request(app)
      .post('/api/admin/bookings')
      .send({ ...validManualBooking, color: '#FF5733' });

    expect(res.status).toBe(201);
  });

  it('rejects invalid color format', async () => {
    const res = await request(app)
      .post('/api/admin/bookings')
      .send({ ...validManualBooking, color: 'red' });

    expect(res.status).toBe(400);
  });
});

// ============================================
// PUT /api/admin/bookings/:id — Modify booking
// ============================================
describe('PUT /api/admin/bookings/:id', () => {
  // Helper to setup transaction mock for PUT tests
  function setupPutTransaction(clientQueryMocks) {
    const mockClient = { query: jest.fn() };
    for (const mock of clientQueryMocks) {
      mockClient.query.mockResolvedValueOnce(mock);
    }
    db.transaction.mockImplementationOnce(async (cb) => cb(mockClient));
    return mockClient;
  }

  it('updates a booking and checks salon_id', async () => {
    const mockClient = setupPutTransaction([
      // Get current booking (FOR UPDATE)
      { rows: [{
        id: BOOKING_ID, date: FUTURE_DATE, start_time: '10:00', end_time: '10:30',
        status: 'confirmed', price: 2700, barber_id: BARBER_ID, service_id: SERVICE_ID,
        client_id: CLIENT_ID, first_name: 'Jean', last_name: 'Dupont',
        email: 'jean@test.fr', phone: '0612345678', service_name: 'Coupe homme',
        barber_name: 'Lucas', color: null,
      }] },
      // Get service duration
      { rows: [{ duration: 30, price: 2700, name: 'Coupe homme' }] },
      // Conflict check (FOR UPDATE)
      { rows: [] },
      // Blocked slots check
      { rows: [] },
      // UPDATE
      { rows: [{ id: BOOKING_ID, date: FUTURE_DATE, start_time: '11:00', end_time: '11:30' }] },
    ]);

    const res = await request(app)
      .put(`/api/admin/bookings/${BOOKING_ID}`)
      .send({ start_time: '11:00' });

    expect(res.status).toBe(200);
    // Verify salon_id was used in the initial fetch
    expect(mockClient.query.mock.calls[0][1]).toEqual([BOOKING_ID, 'meylan']);
  });

  it('returns 404 if booking not found in this salon', async () => {
    setupPutTransaction([
      { rows: [] }, // booking not found
    ]);

    const res = await request(app)
      .put(`/api/admin/bookings/${BOOKING_ID}`)
      .send({ start_time: '11:00' });

    expect(res.status).toBe(404);
  });

  it('returns 409 on time conflict', async () => {
    setupPutTransaction([
      { rows: [{
        id: BOOKING_ID, date: FUTURE_DATE, start_time: '10:00', end_time: '10:30',
        status: 'confirmed', price: 2700, barber_id: BARBER_ID, service_id: SERVICE_ID,
        client_id: CLIENT_ID, first_name: 'Jean', last_name: 'Dupont',
        email: 'jean@test.fr', phone: '0612345678', service_name: 'Coupe homme',
        barber_name: 'Lucas', color: null,
      }] },
      { rows: [{ duration: 30, price: 2700, name: 'Coupe homme' }] },
      { rows: [{ id: 'conflicting-booking' }] }, // conflict!
    ]);

    const res = await request(app)
      .put(`/api/admin/bookings/${BOOKING_ID}`)
      .send({ start_time: '11:00' });

    expect(res.status).toBe(409);
  });

  it('sends reschedule email when notify_client is true', async () => {
    setupPutTransaction([
      { rows: [{
        id: BOOKING_ID, date: FUTURE_DATE, start_time: '10:00', end_time: '10:30',
        status: 'confirmed', price: 2700, barber_id: BARBER_ID, service_id: SERVICE_ID,
        client_id: CLIENT_ID, first_name: 'Jean', last_name: 'Dupont',
        email: 'jean@test.fr', phone: '0612345678', service_name: 'Coupe homme',
        barber_name: 'Lucas', color: null,
      }] },
      { rows: [{ duration: 30, price: 2700, name: 'Coupe homme' }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: BOOKING_ID, date: FUTURE_DATE, start_time: '11:00', end_time: '11:30' }] },
    ]);

    await request(app)
      .put(`/api/admin/bookings/${BOOKING_ID}`)
      .send({ start_time: '11:00', notify_client: true });

    expect(notification.sendRescheduleEmail).toHaveBeenCalled();
  });
});

// ============================================
// PATCH /api/admin/bookings/:id/status
// ============================================
describe('PATCH /api/admin/bookings/:id/status', () => {
  it('updates booking status', async () => {
    bookingService.updateBookingStatus.mockResolvedValueOnce({
      id: BOOKING_ID,
      status: 'completed',
    });

    const res = await request(app)
      .patch(`/api/admin/bookings/${BOOKING_ID}/status`)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(bookingService.updateBookingStatus).toHaveBeenCalledWith(BOOKING_ID, 'completed', 'meylan');
  });

  it('rejects invalid status', async () => {
    const res = await request(app)
      .patch(`/api/admin/bookings/${BOOKING_ID}/status`)
      .send({ status: 'invalid_status' });

    expect(res.status).toBe(400);
  });

  it('accepts all valid statuses', async () => {
    for (const status of ['confirmed', 'completed', 'no_show']) {
      bookingService.updateBookingStatus.mockResolvedValueOnce({ id: BOOKING_ID, status });
      const res = await request(app)
        .patch(`/api/admin/bookings/${BOOKING_ID}/status`)
        .send({ status });
      expect(res.status).toBe(200);
    }
  });
});

// ============================================
// DELETE /api/admin/bookings/:id — Soft delete
// ============================================
describe('DELETE /api/admin/bookings/:id', () => {
  it('soft deletes a booking with salon_id check', async () => {
    // Info fetch before delete
    db.query.mockResolvedValueOnce({
      rows: [{
        barber_id: BARBER_ID, date: FUTURE_DATE, start_time: '10:00', price: 2700,
        service_name: 'Coupe homme', barber_name: 'Lucas',
        first_name: 'Jean', email: 'jean@test.fr',
      }],
    });
    // Soft delete
    db.query.mockResolvedValueOnce({ rows: [{ id: BOOKING_ID }] });
    // Waitlist check
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`/api/admin/bookings/${BOOKING_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('supprim');
    // Verify salon_id was included in both queries
    expect(db.query.mock.calls[0][1]).toEqual([BOOKING_ID, 'meylan']);
    expect(db.query.mock.calls[1][1]).toEqual([BOOKING_ID, 'meylan']);
  });

  it('returns 404 if booking not in this salon', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // info fetch
    db.query.mockResolvedValueOnce({ rows: [] }); // delete returns nothing

    const res = await request(app)
      .delete(`/api/admin/bookings/${BOOKING_ID}`);

    expect(res.status).toBe(404);
  });

  it('sends cancellation email when notify=true', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        barber_id: BARBER_ID, date: FUTURE_DATE, start_time: '10:00', price: 2700,
        service_name: 'Coupe homme', barber_name: 'Lucas',
        first_name: 'Jean', email: 'jean@test.fr',
      }],
    });
    db.query.mockResolvedValueOnce({ rows: [{ id: BOOKING_ID }] });
    db.query.mockResolvedValueOnce({ rows: [{ ok: true }] }); // slot-in-future guard
    db.query.mockResolvedValueOnce({ rows: [] }); // waitlist

    await request(app)
      .delete(`/api/admin/bookings/${BOOKING_ID}?notify=true`);

    expect(notification.sendCancellationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jean@test.fr',
        first_name: 'Jean',
      })
    );
  });

  it('notifies waitlist clients when a slot opens up', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        barber_id: BARBER_ID, date: FUTURE_DATE, start_time: '10:00', price: 2700,
        service_name: 'Coupe homme', barber_name: 'Lucas',
        first_name: 'Jean', email: 'jean@test.fr',
      }],
    });
    db.query.mockResolvedValueOnce({ rows: [{ id: BOOKING_ID }] });
    // Slot-in-future guard: the freed slot is still in the future
    db.query.mockResolvedValueOnce({ rows: [{ ok: true }] });
    // Waitlist entries
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'w1', client_name: 'Pierre', client_phone: '0611111111',
        barber_name: 'Lucas', service_name: 'Coupe homme',
      }],
    });
    // waitlist status update (called inside .then())
    db.query.mockResolvedValue({ rows: [] });

    await request(app)
      .delete(`/api/admin/bookings/${BOOKING_ID}`);

    // Give the async waitlist SMS time to fire
    await new Promise((r) => setTimeout(r, 50));

    expect(notification.sendWaitlistSMS).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '0611111111',
        salon_id: 'meylan',
      })
    );
  });

  it('skips waitlist SMS when the freed slot is already in the past', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        barber_id: BARBER_ID, date: FUTURE_DATE, start_time: '10:00', price: 2700,
        service_name: 'Coupe homme', barber_name: 'Lucas',
        first_name: 'Jean', email: 'jean@test.fr',
      }],
    });
    db.query.mockResolvedValueOnce({ rows: [{ id: BOOKING_ID }] });
    // Slot-in-future guard returns false (slot is past — e.g. admin cancels a no-show)
    db.query.mockResolvedValueOnce({ rows: [{ ok: false }] });
    // Any further query mock — should NOT be hit
    db.query.mockResolvedValue({ rows: [] });

    await request(app)
      .delete(`/api/admin/bookings/${BOOKING_ID}`);

    await new Promise((r) => setTimeout(r, 50));

    expect(notification.sendWaitlistSMS).not.toHaveBeenCalled();
  });

  it('validates booking id format', async () => {
    const res = await request(app)
      .delete('/api/admin/bookings/not-a-uuid');

    expect(res.status).toBe(400);
  });
});
