const request = require('supertest');
const { app, getNextWorkingDate, getLucasDayOff, createTestBooking, cleanupBooking, cleanupTestClients } = require('./helpers');
const { LUCAS_ID, COUPE_HOMME_ID, db } = require('./setup');

const createdBookingIds = [];

afterAll(async () => {
  for (const id of createdBookingIds) {
    await cleanupBooking(id);
  }
  await cleanupTestClients();
  await db.pool.end();
});

describe('Availability — Slots', () => {
  test('returns slots for working day', async () => {
    const date = getNextWorkingDate();

    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, service_id: COUPE_HOMME_ID, date });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Each slot should have time, barber_id, barber_name
    const slot = res.body[0];
    expect(slot).toHaveProperty('time');
    expect(slot).toHaveProperty('barber_id');
    expect(slot).toHaveProperty('barber_name');
  });

  test('slots are in 30-minute intervals', async () => {
    const date = getNextWorkingDate();

    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, service_id: COUPE_HOMME_ID, date });

    expect(res.status).toBe(200);

    // All times should end in :00 or :30
    for (const slot of res.body) {
      const minutes = parseInt(slot.time.split(':')[1], 10);
      expect([0, 30]).toContain(minutes);
    }
  });

  test('booked slot is excluded from availability', async () => {
    const date = getNextWorkingDate(12);

    // Book 10:00
    const booking = await createTestBooking({
      date,
      start_time: '10:00',
      phone: '0600700001',
      email: 'exclude@test.barberclub.fr',
    });
    createdBookingIds.push(booking.id);

    // Check availability
    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, service_id: COUPE_HOMME_ID, date });

    expect(res.status).toBe(200);

    // 10:00 should NOT be in the list
    const times = res.body.map((s) => s.time);
    expect(times).not.toContain('10:00');
  });

  test('day off returns empty array', async () => {
    const monday = getLucasDayOff();

    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, service_id: COUPE_HOMME_ID, date: monday });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('"any" barber returns slots from multiple barbers', async () => {
    const date = getNextWorkingDate();

    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: 'any', service_id: COUPE_HOMME_ID, date });

    expect(res.status).toBe(200);

    // Should have slots (at least one barber works)
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('Availability — Validation', () => {
  test('past date returns 400', async () => {
    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, service_id: COUPE_HOMME_ID, date: '2020-01-01' });

    expect(res.status).toBe(400);
  });

  test('date >6 months in future returns 400', async () => {
    const farFuture = new Date();
    farFuture.setMonth(farFuture.getMonth() + 7);
    const date = farFuture.toISOString().slice(0, 10);

    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, service_id: COUPE_HOMME_ID, date });

    expect(res.status).toBe(400);
  });
});
