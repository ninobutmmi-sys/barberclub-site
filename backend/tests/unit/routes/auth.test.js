/**
 * Unit tests for auth routes — login validation.
 * Tests: wrong password returns 401, wrong type returns 401.
 * Uses supertest with mocked DB (no real database connection).
 */
const request = require('supertest');
const bcrypt = require('bcrypt');
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

// Mock notification
jest.mock('../../../src/services/notification', () => ({
  sendConfirmationEmail: jest.fn().mockResolvedValue(),
  sendCancellationEmail: jest.fn().mockResolvedValue(),
  sendRescheduleEmail: jest.fn().mockResolvedValue(),
  sendResetPasswordEmail: jest.fn().mockResolvedValue(),
  sendWaitlistSMS: jest.fn().mockResolvedValue(),
}));

// Disable rate limiting
jest.mock('../../../src/middleware/rateLimiter', () => ({
  publicLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  adminLimiter: (req, res, next) => next(),
}));

const db = require('../../../src/config/database');
const authRoutes = require('../../../src/routes/auth');

// ============================================
// Build test app
// ============================================
let app;
let HASHED_PASSWORD;

beforeAll(async () => {
  HASHED_PASSWORD = await bcrypt.hash('Barberclot1968!', 4); // Low rounds for speed

  app = createTestApp((expressApp) => {
    expressApp.use('/api/auth', authRoutes);
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ============================================
// Test data
// ============================================
const BARBER_ID = 'b0000000-0000-0000-0000-000000000001';

// ============================================
// POST /api/auth/login
// ============================================
describe('POST /api/auth/login', () => {
  test('returns 401 with wrong password', async () => {
    // Mock: find user by email → returns barber with valid hash
    db.query
      .mockResolvedValueOnce({
        rows: [{
          id: BARBER_ID,
          email: 'barberclubmeylan@gmail.com',
          password_hash: HASHED_PASSWORD,
          failed_login_attempts: 0,
          locked_until: null,
          name: 'Admin',
          photo_url: null,
          salon_id: 'meylan',
        }],
      })
      // Mock: increment failed_login_attempts
      .mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'barberclubmeylan@gmail.com',
        password: 'WrongPassword123!',
        type: 'barber',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('returns 401 with wrong type (user not found in table)', async () => {
    // Mock: find user by email in clients table → not found
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'barberclubmeylan@gmail.com',
        password: 'Barberclot1968!',
        type: 'client', // Using barber email as client type
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('returns 400 with invalid type', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'barberclubmeylan@gmail.com',
        password: 'Barberclot1968!',
        type: 'admin', // Invalid type
      });

    expect(res.status).toBe(400);
  });

  test('returns 400 with missing email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        password: 'Barberclot1968!',
        type: 'barber',
      });

    expect(res.status).toBe(400);
  });

  test('returns 200 with correct credentials', async () => {
    // Mock: find barber by email
    db.query
      .mockResolvedValueOnce({
        rows: [{
          id: BARBER_ID,
          email: 'barberclubmeylan@gmail.com',
          password_hash: HASHED_PASSWORD,
          failed_login_attempts: 0,
          locked_until: null,
          name: 'Admin',
          photo_url: null,
          salon_id: 'meylan',
        }],
      })
      // Mock: reset failed attempts
      .mockResolvedValueOnce({ rowCount: 1 })
      // Mock: insert refresh token
      .mockResolvedValueOnce({ rowCount: 1 })
      // Mock: prune old sessions
      .mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'barberclubmeylan@gmail.com',
        password: 'Barberclot1968!',
        type: 'barber',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('barberclubmeylan@gmail.com');
  });
});
