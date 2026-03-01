const request = require('supertest');
const app = require('../src/index');
const { LUCAS_ID, COUPE_HOMME_ID, TEST_PHONE_PREFIX, db } = require('./setup');

let testCounter = 0;

/**
 * Login as barber — tries real credentials first, falls back to seed credentials.
 * Real DB uses barberclubmeylan@gmail.com / Barberclot1968!
 * Seed data uses admin@admin.com / admin
 * Returns { accessToken, refreshToken }
 */
async function loginAsBarber() {
  // Try real credentials first
  let res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'barberclubmeylan@gmail.com', password: 'Barberclot1968!', type: 'barber' });

  // Fallback to seed credentials
  if (res.status !== 200) {
    res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@admin.com', password: 'admin', type: 'barber' });
  }

  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return {
    accessToken: res.body.access_token,
    refreshToken: res.body.refresh_token,
  };
}

/**
 * Get next working date for Lucas (Tuesday-Saturday, 0=Mon convention)
 * Returns YYYY-MM-DD string, at least 2 days in the future
 */
function getNextWorkingDate(daysAhead = 7) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);

  // Lucas works Tue-Sat (day_of_week 1-5 in 0=Monday convention)
  // JS: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const jsDay = date.getDay();
  // Convert to 0=Monday: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
  const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1;

  // Lucas is off on 0 (Mon) and 6 (Sun)
  if (dayOfWeek === 0) date.setDate(date.getDate() + 1); // Mon → Tue
  else if (dayOfWeek === 6) date.setDate(date.getDate() + 2); // Sun → Tue

  return date.toISOString().slice(0, 10);
}

/**
 * Get a date that falls on Lucas's day off (Monday)
 */
function getLucasDayOff(daysAhead = 7) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);

  const jsDay = date.getDay();
  // Find next Monday: JS Monday = 1
  const daysUntilMonday = (8 - jsDay) % 7 || 7;
  date.setDate(date.getDate() + daysUntilMonday);

  return date.toISOString().slice(0, 10);
}

/**
 * Create a test booking via API
 * Returns the full booking response body
 */
async function createTestBooking(overrides = {}) {
  testCounter++;
  const phone = `${TEST_PHONE_PREFIX}${String(testCounter).padStart(3, '0')}`;

  const defaults = {
    barber_id: LUCAS_ID,
    service_id: COUPE_HOMME_ID,
    date: getNextWorkingDate(),
    start_time: '10:00',
    first_name: 'TestPrenom',
    last_name: 'TestNom',
    phone,
    email: `test${testCounter}@test.barberclub.fr`,
  };

  const data = { ...defaults, ...overrides };

  const res = await request(app)
    .post('/api/bookings')
    .send(data);

  if (res.status !== 201) {
    throw new Error(`Create booking failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body;
}

/**
 * Cleanup a booking and its associated client (test data only)
 */
async function cleanupBooking(bookingId) {
  try {
    // Get client_id before deleting booking
    const booking = await db.query('SELECT client_id FROM bookings WHERE id = $1', [bookingId]);
    const clientId = booking.rows[0]?.client_id;

    // Hard-delete test booking
    await db.query('DELETE FROM notification_queue WHERE booking_id = $1', [bookingId]);
    await db.query('DELETE FROM bookings WHERE id = $1', [bookingId]);

    // Only delete client if it's a test client and has no other bookings
    if (clientId) {
      const otherBookings = await db.query(
        'SELECT 1 FROM bookings WHERE client_id = $1 LIMIT 1',
        [clientId]
      );
      if (otherBookings.rows.length === 0) {
        await db.query('DELETE FROM refresh_tokens WHERE user_id = $1 AND user_type = $2', [clientId, 'client']);
        await db.query('DELETE FROM clients WHERE id = $1', [clientId]);
      }
    }
  } catch (err) {
    // Best-effort cleanup — don't fail tests
    console.warn(`Cleanup warning for booking ${bookingId}: ${err.message}`);
  }
}

/**
 * Cleanup test clients by email domain
 */
async function cleanupTestClients() {
  try {
    const testClients = await db.query(
      "SELECT id FROM clients WHERE email LIKE '%@test.barberclub.fr'"
    );
    for (const client of testClients.rows) {
      await db.query('DELETE FROM notification_queue WHERE booking_id IN (SELECT id FROM bookings WHERE client_id = $1)', [client.id]);
      await db.query('DELETE FROM bookings WHERE client_id = $1', [client.id]);
      await db.query('DELETE FROM refresh_tokens WHERE user_id = $1 AND user_type = $2', [client.id, 'client']);
      await db.query('DELETE FROM clients WHERE id = $1', [client.id]);
    }
  } catch (err) {
    console.warn(`Test client cleanup warning: ${err.message}`);
  }
}

module.exports = {
  app,
  loginAsBarber,
  getNextWorkingDate,
  getLucasDayOff,
  createTestBooking,
  cleanupBooking,
  cleanupTestClients,
};
