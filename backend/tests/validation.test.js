const request = require('supertest');
const { app } = require('./helpers');
const { db } = require('./setup');

afterAll(async () => {
  await db.pool.end();
});

describe('Validation — Security', () => {
  test('XSS in booking fields is not reflected raw', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        barber_id: 'b0000000-0000-0000-0000-000000000001',
        service_id: 'a0000000-0000-0000-0000-000000000001',
        date: '2099-01-01',
        start_time: '10:00',
        first_name: '<script>alert("xss")</script>',
        last_name: 'Test',
        phone: '0600800001',
        email: 'xss@test.barberclub.fr',
      });

    // Should either reject or sanitize — response body should not contain raw <script>
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('<script>');
  });

  test('SQL injection in query params is harmless', async () => {
    const res = await request(app)
      .get('/api/availability')
      .query({
        barber_id: "'; DROP TABLE bookings; --",
        service_id: 'a0000000-0000-0000-0000-000000000001',
        date: '2026-06-15',
      });

    // Should return 400 (validation rejects non-UUID) — not 500
    expect(res.status).toBe(400);
  });

  test('invalid UUID format returns 400', async () => {
    const res = await request(app)
      .get('/api/bookings/not-a-uuid')
      .query({ token: 'also-not-a-uuid' });

    expect(res.status).toBe(400);
  });
});

describe('Validation — Endpoints', () => {
  test('GET /api/health returns status', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
  });

  test('GET /api/health/ping returns pong', async () => {
    const res = await request(app).get('/api/health/ping');

    expect(res.status).toBe(200);
    expect(res.text).toBe('pong');
  });

  test('404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('rate limit headers are present', async () => {
    const res = await request(app).get('/api/barbers');

    expect(res.status).toBe(200);
    // Rate limiter should set these headers
    expect(res.headers).toHaveProperty('ratelimit-limit');
  });

  test('GET /api/barbers returns active barbers', async () => {
    const res = await request(app).get('/api/barbers');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2); // Lucas + Julien
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('off_days');
  });

  test('GET /api/services returns active services', async () => {
    const res = await request(app).get('/api/services');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('price');
    expect(res.body[0]).toHaveProperty('duration');
  });
});
