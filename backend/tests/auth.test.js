const request = require('supertest');
const { app, loginAsBarber, cleanupTestClients } = require('./helpers');
const { db } = require('./setup');

// Resolve barber credentials dynamically (DB may have seed or real credentials)
let BARBER_EMAIL;
let BARBER_PASSWORD;

beforeAll(async () => {
  // Check which email exists in the DB
  const check = await db.query(
    "SELECT email FROM barbers WHERE deleted_at IS NULL AND is_active = true ORDER BY sort_order LIMIT 1"
  );
  BARBER_EMAIL = check.rows[0]?.email || 'admin@admin.com';
  // Determine password based on email
  BARBER_PASSWORD = BARBER_EMAIL === 'admin@admin.com' ? 'admin' : 'Barberclot1968!';
});

afterAll(async () => {
  await cleanupTestClients();
  await db.pool.end();
});

describe('Auth — Login', () => {
  test('barber login with valid credentials returns tokens', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: BARBER_EMAIL, password: BARBER_PASSWORD, type: 'barber' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body.user.type).toBe('barber');
    expect(res.body.user.email).toBe(BARBER_EMAIL);

    // Cleanup refresh token
    await db.query('DELETE FROM refresh_tokens WHERE token = $1', [res.body.refresh_token]);
  });

  test('login with wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: BARBER_EMAIL, password: 'wrongpassword', type: 'barber' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('login with missing fields returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: BARBER_EMAIL });

    expect(res.status).toBe(400);
  });

  test('login with invalid type returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: BARBER_EMAIL, password: BARBER_PASSWORD, type: 'admin' });

    expect(res.status).toBe(400);
  });

  test('login with non-existent email returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@nowhere.com', password: 'admin', type: 'barber' });

    expect(res.status).toBe(401);
  });
});

describe('Auth — Register (client)', () => {
  test('register new client returns 201 with tokens', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        first_name: 'Test',
        last_name: 'Register',
        phone: '0612345678',
        email: 'register@test.barberclub.fr',
        password: 'TestPass123!',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body.user.type).toBe('client');
  });

  test('register with existing email (has_account=true) returns 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        first_name: 'Test',
        last_name: 'Duplicate',
        phone: '0699999999',
        email: 'register@test.barberclub.fr',
        password: 'TestPass123!',
      });

    expect(res.status).toBe(409);
  });

  test('register with short password returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        first_name: 'Test',
        last_name: 'Short',
        phone: '0611111111',
        email: 'short@test.barberclub.fr',
        password: '123',
      });

    expect(res.status).toBe(400);
  });
});

describe('Auth — Refresh & Logout', () => {
  test('refresh token returns new tokens', async () => {
    const { refreshToken } = await loginAsBarber();

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refresh_token: refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');

    // Old refresh token should be deleted from DB (rotated)
    const oldTokenCheck = await db.query(
      'SELECT 1 FROM refresh_tokens WHERE token = $1',
      [refreshToken]
    );
    expect(oldTokenCheck.rows.length).toBe(0);

    // Cleanup
    await db.query('DELETE FROM refresh_tokens WHERE token = $1', [res.body.refresh_token]);
  });

  test('logout invalidates refresh token', async () => {
    const { refreshToken } = await loginAsBarber();

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .send({ refresh_token: refreshToken });

    expect(logoutRes.status).toBe(200);

    // Trying to refresh with the old token should fail
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refresh_token: refreshToken });

    expect(refreshRes.status).toBe(401);
  });

  test('refresh without token returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
  });
});
