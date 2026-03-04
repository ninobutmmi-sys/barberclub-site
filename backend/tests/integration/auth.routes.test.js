/**
 * Integration tests — Auth routes
 * Tests /api/auth/* with mocked database and bcrypt behavior.
 */
const request = require('supertest');
const bcrypt = require('bcrypt');
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

// Mock notification
jest.mock('../../src/services/notification', () => ({
  sendConfirmationEmail: jest.fn().mockResolvedValue(),
  sendCancellationEmail: jest.fn().mockResolvedValue(),
  sendRescheduleEmail: jest.fn().mockResolvedValue(),
  sendResetPasswordEmail: jest.fn().mockResolvedValue(),
  sendWaitlistSMS: jest.fn().mockResolvedValue(),
}));

// Disable rate limiting
jest.mock('../../src/middleware/rateLimiter', () => ({
  publicLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  adminLimiter: (req, res, next) => next(),
}));

const db = require('../../src/config/database');
const authRoutes = require('../../src/routes/auth');

// ============================================
// Build test app
// ============================================
let app;
// Pre-hash a password for mock responses
let HASHED_PASSWORD;

beforeAll(async () => {
  HASHED_PASSWORD = await bcrypt.hash('Barberclot1968!', 4); // Low rounds for speed in tests

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
const CLIENT_ID = 'e0000000-0000-0000-0000-000000000001';

// ============================================
// POST /api/auth/login — Barber login
// ============================================
describe('POST /api/auth/login', () => {
  it('logs in a barber successfully', async () => {
    // SELECT barber by email + salon
    db.query.mockResolvedValueOnce({
      rows: [{
        id: BARBER_ID,
        email: 'barberclubmeylan@gmail.com',
        password_hash: HASHED_PASSWORD,
        failed_login_attempts: 0,
        locked_until: null,
        name: 'Lucas',
        photo_url: null,
        salon_id: 'meylan',
      }],
    });
    // Reset failed attempts
    db.query.mockResolvedValueOnce({ rows: [] });
    // Store refresh token
    db.query.mockResolvedValueOnce({ rows: [] });

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
    expect(res.body.user.type).toBe('barber');
    expect(res.body.user.salon_id).toBe('meylan');
    expect(res.body.user.name).toBe('Lucas');
  });

  it('returns 401 on wrong password', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: BARBER_ID,
        email: 'barberclubmeylan@gmail.com',
        password_hash: HASHED_PASSWORD,
        failed_login_attempts: 0,
        locked_until: null,
        name: 'Lucas',
        photo_url: null,
        salon_id: 'meylan',
      }],
    });
    // Increment failed attempts
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'barberclubmeylan@gmail.com',
        password: 'wrong-password',
        type: 'barber',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('incorrect');
  });

  it('returns 401 when email not found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nonexistent@test.fr',
        password: 'password123',
        type: 'barber',
      });

    expect(res.status).toBe(401);
  });

  it('locks account after max failed attempts', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: BARBER_ID,
        email: 'barberclubmeylan@gmail.com',
        password_hash: HASHED_PASSWORD,
        failed_login_attempts: 4, // Already 4 failed, this is the 5th
        locked_until: null,
        name: 'Lucas',
        photo_url: null,
        salon_id: 'meylan',
      }],
    });
    // Update with lock
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'barberclubmeylan@gmail.com',
        password: 'wrong-password',
        type: 'barber',
      });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('verrouill');
  });

  it('rejects locked account even with correct password', async () => {
    const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    db.query.mockResolvedValueOnce({
      rows: [{
        id: BARBER_ID,
        email: 'barberclubmeylan@gmail.com',
        password_hash: HASHED_PASSWORD,
        failed_login_attempts: 5,
        locked_until: lockUntil,
        name: 'Lucas',
        photo_url: null,
        salon_id: 'meylan',
      }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'barberclubmeylan@gmail.com',
        password: 'Barberclot1968!',
        type: 'barber',
      });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('verrouill');
  });

  it('validates email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'not-an-email',
        password: 'password',
        type: 'barber',
      });

    expect(res.status).toBe(400);
  });

  it('validates type field', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@test.fr',
        password: 'password',
        type: 'admin', // invalid
      });

    expect(res.status).toBe(400);
  });

  it('rejects account with no password_hash', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: CLIENT_ID,
        email: 'nopwd@test.fr',
        password_hash: null,
        failed_login_attempts: 0,
        locked_until: null,
        name: 'No Password',
        photo_url: null,
      }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nopwd@test.fr',
        password: 'whatever',
        type: 'client',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('mot de passe');
  });
});

// ============================================
// POST /api/auth/register — Client registration
// ============================================
describe('POST /api/auth/register', () => {
  const validRegistration = {
    first_name: 'Marie',
    last_name: 'Dupont',
    phone: '0612345678',
    email: 'marie@test.fr',
    password: 'SecurePass123!',
  };

  it('creates a new client account', async () => {
    // Check email uniqueness
    db.query.mockResolvedValueOnce({ rows: [] });
    // Check existing by phone/email
    db.query.mockResolvedValueOnce({ rows: [] });
    // INSERT new client
    db.query.mockResolvedValueOnce({ rows: [{ id: CLIENT_ID }] });
    // Store refresh token
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/register')
      .send(validRegistration);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body.user.type).toBe('client');
    expect(res.body.user.email).toBe('marie@test.fr');
    expect(res.body.user.name).toBe('Marie Dupont');
  });

  it('upgrades existing guest client to account', async () => {
    // Email check: no account yet
    db.query.mockResolvedValueOnce({ rows: [{ id: CLIENT_ID, has_account: false }] });
    // Existing phone/email match
    db.query.mockResolvedValueOnce({ rows: [{ id: CLIENT_ID }] });
    // UPDATE existing client
    db.query.mockResolvedValueOnce({ rows: [] });
    // Store refresh token
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/register')
      .send(validRegistration);

    expect(res.status).toBe(201);
    // Verify UPDATE was called (not INSERT)
    const updateCall = db.query.mock.calls[2][0];
    expect(updateCall).toContain('UPDATE clients');
  });

  it('rejects duplicate email with existing account', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: CLIENT_ID, has_account: true }] });

    const res = await request(app)
      .post('/api/auth/register')
      .send(validRegistration);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('existe');
  });

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.fr' });

    expect(res.status).toBe(400);
  });

  it('validates phone format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validRegistration, phone: '123' });

    expect(res.status).toBe(400);
  });

  it('enforces minimum password length', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validRegistration, password: 'short' });

    expect(res.status).toBe(400);
  });
});

// ============================================
// POST /api/auth/refresh
// ============================================
describe('POST /api/auth/refresh', () => {
  it('refreshes tokens when valid refresh token provided in body', async () => {
    // We need a real JWT to pass verification
    const jwt = require('jsonwebtoken');
    const config = require('../../src/config/env');
    const refreshToken = jwt.sign(
      { id: BARBER_ID, type: 'barber' },
      config.jwt.refreshSecret,
      { expiresIn: '90d' }
    );

    // Token exists in DB
    db.query.mockResolvedValueOnce({ rows: [{ token: refreshToken, user_id: BARBER_ID, user_type: 'barber' }] });
    // Get user info
    db.query.mockResolvedValueOnce({
      rows: [{ id: BARBER_ID, email: 'test@test.fr', name: 'Lucas', photo_url: null, salon_id: 'meylan' }],
    });
    // Delete old token
    db.query.mockResolvedValueOnce({ rows: [] });
    // Insert new token
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refresh_token: refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body.user.salon_id).toBe('meylan');
  });

  it('returns 400 when no refresh token provided', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('manquant');
  });

  it('returns 401 for invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refresh_token: 'invalid-jwt-token' });

    expect(res.status).toBe(401);
  });

  it('returns 401 when token not found in database', async () => {
    const jwt = require('jsonwebtoken');
    const config = require('../../src/config/env');
    const refreshToken = jwt.sign(
      { id: BARBER_ID, type: 'barber' },
      config.jwt.refreshSecret,
      { expiresIn: '90d' }
    );

    // Token NOT in DB
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refresh_token: refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('expir');
  });
});

// ============================================
// POST /api/auth/logout
// ============================================
describe('POST /api/auth/logout', () => {
  it('logs out successfully with refresh token', async () => {
    // Delete refresh token
    db.query.mockResolvedValueOnce({ rows: [{ user_id: BARBER_ID, user_type: 'barber' }] });
    // Cleanup expired tokens
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refresh_token: 'some-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('connect');
  });

  it('succeeds even without refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .send({});

    expect(res.status).toBe(200);
  });
});

// ============================================
// POST /api/auth/forgot-password
// ============================================
describe('POST /api/auth/forgot-password', () => {
  it('returns success message regardless of email existence (prevents enumeration)', async () => {
    // Client not found
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nonexistent@test.fr' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('lien');
  });

  it('sends reset email when client exists', async () => {
    const notification = require('../../src/services/notification');

    db.query.mockResolvedValueOnce({
      rows: [{ id: CLIENT_ID, first_name: 'Marie', email: 'marie@test.fr' }],
    });
    // Store reset token
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'marie@test.fr' });

    expect(res.status).toBe(200);
    expect(notification.sendResetPasswordEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'marie@test.fr',
        first_name: 'Marie',
      })
    );
  });

  it('validates email format', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });
});

// ============================================
// POST /api/auth/reset-password
// ============================================
describe('POST /api/auth/reset-password', () => {
  it('resets password with valid token', async () => {
    // Find client by reset token
    db.query.mockResolvedValueOnce({
      rows: [{ id: CLIENT_ID, email: 'marie@test.fr', name: 'Marie Dupont' }],
    });
    // Update password
    db.query.mockResolvedValueOnce({ rows: [] });
    // Delete old refresh tokens
    db.query.mockResolvedValueOnce({ rows: [] });
    // Store new refresh token
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token: 'valid-reset-token',
        password: 'NewSecurePass123!',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body.message).toContain('initialis');
  });

  it('rejects expired or invalid reset token', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token: 'expired-token',
        password: 'NewSecurePass123!',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('expir');
  });

  it('enforces minimum password length', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token: 'any-token',
        password: 'short',
      });

    expect(res.status).toBe(400);
  });
});
