/**
 * Integration tests — Admin system health route
 * Tests /api/admin/system/health with mocked auth and database.
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

// Disable rate limiting
jest.mock('../../src/middleware/rateLimiter', () => ({
  publicLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  adminLimiter: (req, res, next) => next(),
}));

// Mock auth middleware
const TEST_USER = { id: 'b0000000-0000-0000-0000-000000000001', salon_id: 'meylan', type: 'barber', email: 'test@test.fr', name: 'Lucas' };

jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = { ...TEST_USER }; next(); },
  requireBarber: (req, res, next) => next(),
  optionalAuth: (req, res, next) => next(),
  generateAccessToken: jest.fn(() => 'mock-access-token'),
  generateRefreshToken: jest.fn(() => 'mock-refresh-token'),
}));

const db = require('../../src/config/database');
const systemHealthRoutes = require('../../src/routes/admin/systemHealth');
const { requireAuth, requireBarber } = require('../../src/middleware/auth');

// ============================================
// Build test app
// ============================================
let app;
beforeAll(() => {
  app = createTestApp((expressApp) => {
    expressApp.use('/api/admin/system', requireAuth, requireBarber, systemHealthRoutes);
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ============================================
// GET /api/admin/system/health
// ============================================
describe('GET /api/admin/system/health', () => {
  function setupHealthMocks() {
    // healthCheck
    db.healthCheck.mockResolvedValueOnce({ ok: true, timestamp: '2026-03-04T10:00:00Z' });

    // Notification stats (filtered by salon_id)
    db.query.mockResolvedValueOnce({
      rows: [{
        sms_sent: '45',
        sms_failed: '2',
        email_sent: '120',
        email_failed: '1',
        pending: '3',
      }],
    });

    // Recent errors
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'n1', type: 'reminder_sms', status: 'failed', attempts: 3,
        last_error: 'Brevo timeout', created_at: '2026-03-04T09:00:00Z',
        next_retry_at: null, client_name: 'Jean Dupont',
      }],
    });

    // Queue depth
    db.query.mockResolvedValueOnce({ rows: [{ total: '3' }] });
  }

  it('returns health data with all sections', async () => {
    setupHealthMocks();

    const res = await request(app)
      .get('/api/admin/system/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('api');
    expect(res.body).toHaveProperty('database');
    expect(res.body).toHaveProperty('memory');
    expect(res.body).toHaveProperty('crons');
    expect(res.body).toHaveProperty('notifications');
    expect(res.body).toHaveProperty('recent_errors');
    expect(res.body).toHaveProperty('queue_depth');
  });

  it('returns correct notification stats', async () => {
    setupHealthMocks();

    const res = await request(app)
      .get('/api/admin/system/health');

    expect(res.body.notifications.sms_sent).toBe(45);
    expect(res.body.notifications.sms_failed).toBe(2);
    expect(res.body.notifications.email_sent).toBe(120);
    expect(res.body.notifications.email_failed).toBe(1);
    expect(res.body.notifications.pending).toBe(3);
    // SMS cost estimate: 45 * 0.045 = 2.025 -> rounded to 2.03
    expect(res.body.notifications.sms_cost_estimate).toBeCloseTo(2.03, 1);
  });

  it('filters notification stats by salon_id via JOIN on bookings', async () => {
    setupHealthMocks();

    await request(app).get('/api/admin/system/health');

    // Notification stats query should include salon_id
    const notifQuery = db.query.mock.calls[0][0];
    expect(notifQuery).toContain('salon_id');
    expect(db.query.mock.calls[0][1]).toContain('meylan');
  });

  it('returns database status', async () => {
    setupHealthMocks();

    const res = await request(app)
      .get('/api/admin/system/health');

    expect(res.body.database.status).toBe('connected');
    expect(res.body.database.timestamp).toBe('2026-03-04T10:00:00Z');
  });

  it('reports disconnected database', async () => {
    db.healthCheck.mockResolvedValueOnce({ ok: false, error: 'Connection refused' });
    db.query
      .mockResolvedValueOnce({ rows: [{ sms_sent: '0', sms_failed: '0', email_sent: '0', email_failed: '0', pending: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const res = await request(app)
      .get('/api/admin/system/health');

    expect(res.body.database.status).toBe('disconnected');
    expect(res.body.database.error).toBe('Connection refused');
  });

  it('returns API uptime and node version', async () => {
    setupHealthMocks();

    const res = await request(app)
      .get('/api/admin/system/health');

    expect(res.body.api.status).toBe('up');
    expect(typeof res.body.api.uptime).toBe('number');
    expect(res.body.api.nodeVersion).toMatch(/^v\d+/);
  });

  it('returns memory usage in MB', async () => {
    setupHealthMocks();

    const res = await request(app)
      .get('/api/admin/system/health');

    expect(typeof res.body.memory.heapUsedMB).toBe('number');
    expect(typeof res.body.memory.rssMB).toBe('number');
  });

  it('returns cron status from app.cronStatus', async () => {
    setupHealthMocks();

    const res = await request(app)
      .get('/api/admin/system/health');

    expect(res.body.crons).toHaveProperty('processQueue');
    expect(res.body.crons.processQueue.label).toBe('File notifications');
  });

  it('returns recent errors list', async () => {
    setupHealthMocks();

    const res = await request(app)
      .get('/api/admin/system/health');

    expect(res.body.recent_errors).toHaveLength(1);
    expect(res.body.recent_errors[0].type).toBe('reminder_sms');
    expect(res.body.recent_errors[0].client_name).toBe('Jean Dupont');
  });

  it('returns queue depth', async () => {
    setupHealthMocks();

    const res = await request(app)
      .get('/api/admin/system/health');

    expect(res.body.queue_depth).toBe(3);
  });
});
