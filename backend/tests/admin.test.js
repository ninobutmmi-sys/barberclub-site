const request = require('supertest');
const { app, loginAsBarber } = require('./helpers');
const { db } = require('./setup');

let accessToken;

beforeAll(async () => {
  const auth = await loginAsBarber();
  accessToken = auth.accessToken;
});

afterAll(async () => {
  // Clean up test refresh tokens
  await db.query("DELETE FROM refresh_tokens WHERE user_type = 'barber' AND created_at > NOW() - INTERVAL '1 hour'");
  await db.pool.end();
});

describe('Admin — Auth required', () => {
  test('admin routes without token return 401', async () => {
    const res = await request(app).get('/api/admin/services');
    expect(res.status).toBe(401);
  });

  test('admin routes with invalid token return 401', async () => {
    const res = await request(app)
      .get('/api/admin/services')
      .set('Authorization', 'Bearer invalid-token-here');
    expect(res.status).toBe(401);
  });
});

describe('Admin — Services CRUD', () => {
  test('GET /admin/services returns array with auth', async () => {
    const res = await request(app)
      .get('/api/admin/services')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Each service should have expected fields
    const service = res.body[0];
    expect(service).toHaveProperty('id');
    expect(service).toHaveProperty('name');
    expect(service).toHaveProperty('price');
    expect(service).toHaveProperty('duration');
  });
});

describe('Admin — System Health', () => {
  test('GET /admin/system/health returns full status', async () => {
    const res = await request(app)
      .get('/api/admin/system/health')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('api');
    expect(res.body).toHaveProperty('database');
    expect(res.body).toHaveProperty('memory');
    expect(res.body).toHaveProperty('crons');
    expect(res.body).toHaveProperty('notifications');
    expect(res.body).toHaveProperty('queue_depth');
    expect(res.body.api.status).toBe('up');
    expect(res.body.database.status).toBe('connected');
    expect(typeof res.body.queue_depth).toBe('number');
  });
});
