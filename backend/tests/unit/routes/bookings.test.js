/**
 * Unit tests for public booking routes — validation layer.
 * Tests: missing required fields, past date, date > 6 months.
 * Uses supertest with mocked DB (no real database connection).
 */
const request = require('supertest');
const { createTestApp } = require('../../integration/helpers/createApp');

// ============================================
// Mock database
// ============================================
jest.mock('../../../src/config/database', () => {
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

// Mock booking service — we test route-level validation + service-level error propagation
jest.mock('../../../src/services/booking', () => ({
  createBooking: jest.fn(),
  cancelBooking: jest.fn(),
  rescheduleBooking: jest.fn(),
  createRecurringBookings: jest.fn(),
}));

jest.mock('../../../src/services/availability', () => ({
  getAvailableSlots: jest.fn(),
  getMonthAvailabilitySummary: jest.fn(),
  addMinutesToTime: jest.fn((time, min) => {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + min;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }),
}));

jest.mock('../../../src/services/notification', () => ({
  sendConfirmationEmail: jest.fn().mockResolvedValue(),
  sendCancellationEmail: jest.fn().mockResolvedValue(),
  sendRescheduleEmail: jest.fn().mockResolvedValue(),
  sendResetPasswordEmail: jest.fn().mockResolvedValue(),
  sendWaitlistSMS: jest.fn().mockResolvedValue(),
}));

jest.mock('../../../src/services/websocket', () => ({
  init: jest.fn(),
  emitBookingCreated: jest.fn(),
  emitBookingUpdated: jest.fn(),
  emitBookingCancelled: jest.fn(),
  emitBookingStatusChanged: jest.fn(),
  emitBlockedSlotChanged: jest.fn(),
}));

// Disable rate limiting in tests
jest.mock('../../../src/middleware/rateLimiter', () => ({
  publicLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  adminLimiter: (req, res, next) => next(),
}));

// Mock auth — no auth required for public booking
jest.mock('../../../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  requireBarber: (req, res, next) => next(),
  optionalAuth: (req, res, next) => next(),
  generateAccessToken: jest.fn(() => 'mock-access-token'),
  generateRefreshToken: jest.fn(() => 'mock-refresh-token'),
}));

jest.mock('../../../src/utils/ics', () => ({
  generateICS: jest.fn(() => 'BEGIN:VCALENDAR\nEND:VCALENDAR'),
}));

const db = require('../../../src/config/database');
const bookingService = require('../../../src/services/booking');
const bookingRoutes = require('../../../src/routes/bookings');

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

function getValidBookingPayload(overrides = {}) {
  // Get a date 7 days from now
  const future = new Date();
  future.setDate(future.getDate() + 7);
  const dateStr = future.toISOString().slice(0, 10);

  return {
    barber_id: BARBER_ID,
    service_id: SERVICE_ID,
    date: dateStr,
    start_time: '10:00',
    first_name: 'Jean',
    last_name: 'Dupont',
    phone: '+33612345678',
    email: 'jean@test.com',
    ...overrides,
  };
}

// ============================================
// POST /api/bookings — Booking creation validation
// ============================================
describe('POST /api/bookings', () => {
  test('returns 400 when required fields are missing', async () => {
    // Send completely empty body
    const res = await request(app)
      .post('/api/bookings')
      .send({});

    expect(res.status).toBe(400);
    // Should not have called createBooking
    expect(bookingService.createBooking).not.toHaveBeenCalled();
  });

  test('returns 400 when barber_id is missing', async () => {
    const payload = getValidBookingPayload();
    delete payload.barber_id;

    const res = await request(app)
      .post('/api/bookings')
      .send(payload);

    expect(res.status).toBe(400);
    expect(bookingService.createBooking).not.toHaveBeenCalled();
  });

  test('returns 400 when service_id is missing', async () => {
    const payload = getValidBookingPayload();
    delete payload.service_id;

    const res = await request(app)
      .post('/api/bookings')
      .send(payload);

    expect(res.status).toBe(400);
    expect(bookingService.createBooking).not.toHaveBeenCalled();
  });

  test('returns 400 when date format is invalid', async () => {
    const payload = getValidBookingPayload({ date: 'not-a-date' });

    const res = await request(app)
      .post('/api/bookings')
      .send(payload);

    expect(res.status).toBe(400);
    expect(bookingService.createBooking).not.toHaveBeenCalled();
  });

  test('returns 400 when start_time format is invalid', async () => {
    const payload = getValidBookingPayload({ start_time: '25:99' });

    const res = await request(app)
      .post('/api/bookings')
      .send(payload);

    expect(res.status).toBe(400);
    expect(bookingService.createBooking).not.toHaveBeenCalled();
  });

  test('returns 400 for past date (service-level rejection)', async () => {
    const payload = getValidBookingPayload({ date: '2020-01-01' });

    // Mock createBooking to throw ApiError for past date
    const { ApiError } = require('../../../src/utils/errors');
    bookingService.createBooking.mockRejectedValueOnce(
      ApiError.badRequest('Impossible de reserver dans le passe')
    );

    const res = await request(app)
      .post('/api/bookings')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pass/i);
  });

  test('returns 400 for date > 6 months ahead (service-level rejection)', async () => {
    const farDate = new Date();
    farDate.setMonth(farDate.getMonth() + 7);
    const farDateStr = farDate.toISOString().slice(0, 10);

    const payload = getValidBookingPayload({ date: farDateStr });

    // Mock createBooking to throw ApiError for date too far
    const { ApiError } = require('../../../src/utils/errors');
    bookingService.createBooking.mockRejectedValueOnce(
      ApiError.badRequest('Impossible de reserver plus de 6 mois a l\'avance')
    );

    const res = await request(app)
      .post('/api/bookings')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 mois/i);
  });

  test('returns 201 for valid booking', async () => {
    const payload = getValidBookingPayload();

    bookingService.createBooking.mockResolvedValueOnce({
      id: 'booking-new-1',
      barber_id: BARBER_ID,
      service_id: SERVICE_ID,
      date: payload.date,
      start_time: '10:00',
      end_time: '10:30',
      price: 2700,
      status: 'confirmed',
      cancel_token: 'test-token',
    });

    const res = await request(app)
      .post('/api/bookings')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('booking-new-1');
    expect(res.body.status).toBe('confirmed');
    expect(bookingService.createBooking).toHaveBeenCalledTimes(1);
  });
});
