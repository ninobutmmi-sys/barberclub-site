/**
 * Tests for availability service — unit-level function tests.
 * Complements availability.test.js (HTTP endpoint tests) by testing
 * the internal functions: validateBarberSlot, addMinutesToTime, time helpers,
 * and slot generation with various schedule configurations.
 *
 * Uses the real database but tests the service functions directly.
 */
const request = require('supertest');
const { app, getNextWorkingDate, getLucasDayOff, createTestBooking, cleanupBooking, cleanupTestClients } = require('./helpers');
const { LUCAS_ID, JULIEN_ID, COUPE_HOMME_ID, db } = require('./setup');
const { addMinutesToTime, validateBarberSlot, getAvailableSlots, isSlotAvailable } = require('../src/services/availability');

const createdBookingIds = [];

afterAll(async () => {
  for (const id of createdBookingIds) {
    await cleanupBooking(id);
  }
  await cleanupTestClients();
  await db.pool.end();
});

// ============================================
// addMinutesToTime — pure function
// ============================================

describe('Availability — addMinutesToTime', () => {
  test('adds 30 minutes to 09:00', () => {
    expect(addMinutesToTime('09:00', 30)).toBe('09:30');
  });

  test('adds 30 minutes across hour boundary', () => {
    expect(addMinutesToTime('09:30', 30)).toBe('10:00');
  });

  test('adds 60 minutes', () => {
    expect(addMinutesToTime('14:00', 60)).toBe('15:00');
  });

  test('adds 90 minutes', () => {
    expect(addMinutesToTime('10:00', 90)).toBe('11:30');
  });

  test('adds 45 minutes', () => {
    expect(addMinutesToTime('10:15', 45)).toBe('11:00');
  });

  test('handles midnight boundary', () => {
    expect(addMinutesToTime('23:30', 60)).toBe('24:30');
  });

  test('adds 0 minutes', () => {
    expect(addMinutesToTime('12:00', 0)).toBe('12:00');
  });

  test('handles time with seconds (HH:MM:SS format)', () => {
    // The function splits on : and takes first two parts
    expect(addMinutesToTime('09:00:00', 30)).toBe('09:30');
  });
});

// ============================================
// validateBarberSlot — requires DB client
// ============================================

describe('Availability — validateBarberSlot', () => {
  test('valid slot for Lucas on working day succeeds', async () => {
    const client = await db.pool.connect();
    try {
      const date = getNextWorkingDate();
      // Lucas works 09:00-19:00 on Tue-Sat
      await expect(
        validateBarberSlot(client, LUCAS_ID, date, '10:00', '10:30')
      ).resolves.not.toThrow();
    } finally {
      client.release();
    }
  });

  test('slot on Lucas day off (Monday) throws error', async () => {
    const client = await db.pool.connect();
    try {
      const monday = getLucasDayOff();
      await expect(
        validateBarberSlot(client, LUCAS_ID, monday, '10:00', '10:30')
      ).rejects.toThrow(/travaille pas/i);
    } finally {
      client.release();
    }
  });

  test('slot outside working hours (too early) throws error', async () => {
    const client = await db.pool.connect();
    try {
      const date = getNextWorkingDate();
      await expect(
        validateBarberSlot(client, LUCAS_ID, date, '07:00', '07:30')
      ).rejects.toThrow(/heures de travail/i);
    } finally {
      client.release();
    }
  });

  test('slot outside working hours (too late) throws error', async () => {
    const client = await db.pool.connect();
    try {
      const date = getNextWorkingDate();
      // Lucas works until 19:00, so a slot ending at 19:30 is outside
      await expect(
        validateBarberSlot(client, LUCAS_ID, date, '19:00', '19:30')
      ).rejects.toThrow(/heures de travail/i);
    } finally {
      client.release();
    }
  });

  test('slot exactly at end boundary (end_time = schedule end) succeeds', async () => {
    const client = await db.pool.connect();
    try {
      const date = getNextWorkingDate();
      // Lucas works until 19:00, so a slot 18:30-19:00 should be fine
      await expect(
        validateBarberSlot(client, LUCAS_ID, date, '18:30', '19:00')
      ).resolves.not.toThrow();
    } finally {
      client.release();
    }
  });

  test('slot exactly at start boundary succeeds', async () => {
    const client = await db.pool.connect();
    try {
      const date = getNextWorkingDate();
      // Lucas starts at 09:00
      await expect(
        validateBarberSlot(client, LUCAS_ID, date, '09:00', '09:30')
      ).resolves.not.toThrow();
    } finally {
      client.release();
    }
  });
});

// ============================================
// getAvailableSlots — integration tests
// ============================================

describe('Availability — getAvailableSlots', () => {
  test('returns slots with correct structure', async () => {
    const date = getNextWorkingDate();
    const slots = await getAvailableSlots(LUCAS_ID, COUPE_HOMME_ID, date);

    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBeGreaterThan(0);

    const slot = slots[0];
    expect(slot).toHaveProperty('time');
    expect(slot).toHaveProperty('barber_id');
    expect(slot).toHaveProperty('barber_name');
    expect(slot.barber_id).toBe(LUCAS_ID);
  });

  test('returns empty array for day off', async () => {
    const monday = getLucasDayOff();
    const slots = await getAvailableSlots(LUCAS_ID, COUPE_HOMME_ID, monday);

    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBe(0);
  });

  test('slots are in 30-min intervals for public mode', async () => {
    const date = getNextWorkingDate();
    const slots = await getAvailableSlots(LUCAS_ID, COUPE_HOMME_ID, date);

    for (const slot of slots) {
      const minutes = parseInt(slot.time.split(':')[1], 10);
      expect([0, 30]).toContain(minutes);
    }
  });

  test('admin mode returns 5-min interval slots', async () => {
    const date = getNextWorkingDate();
    const slots = await getAvailableSlots(LUCAS_ID, COUPE_HOMME_ID, date, { adminMode: true });

    expect(slots.length).toBeGreaterThan(0);

    // Check we have 5-min intervals (not just 0 and 30)
    const minuteValues = new Set(slots.map(s => parseInt(s.time.split(':')[1], 10)));
    // Admin should have more granularity than just 0 and 30
    expect(minuteValues.size).toBeGreaterThan(2);
  });

  test('admin mode has more slots than public mode', async () => {
    const date = getNextWorkingDate();
    const publicSlots = await getAvailableSlots(LUCAS_ID, COUPE_HOMME_ID, date);
    const adminSlots = await getAvailableSlots(LUCAS_ID, COUPE_HOMME_ID, date, { adminMode: true });

    // Admin (5-min step) should always have more slots than public (30-min step)
    expect(adminSlots.length).toBeGreaterThan(publicSlots.length);
  });

  test('"any" barber returns slots from available barbers', async () => {
    const date = getNextWorkingDate();
    const slots = await getAvailableSlots('any', COUPE_HOMME_ID, date);

    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBeGreaterThan(0);
  });

  test('returns empty for invalid service ID', async () => {
    const date = getNextWorkingDate();
    const slots = await getAvailableSlots(LUCAS_ID, '00000000-0000-0000-0000-000000000099', date);

    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBe(0);
  });
});

// ============================================
// isSlotAvailable — integration tests
// ============================================

describe('Availability — isSlotAvailable', () => {
  test('returns true for a free slot', async () => {
    const date = getNextWorkingDate(20);
    const available = await isSlotAvailable(LUCAS_ID, date, '12:00', 30);
    expect(available).toBe(true);
  });

  test('returns false for a booked slot', async () => {
    const date = getNextWorkingDate(18);

    // Create a booking at 13:00
    const booking = await createTestBooking({
      date,
      start_time: '13:00',
      phone: '0600900001',
      email: 'isslot@test.barberclub.fr',
    });
    createdBookingIds.push(booking.id);

    const available = await isSlotAvailable(LUCAS_ID, date, '13:00', 30);
    expect(available).toBe(false);
  });

  test('returns true for adjacent slot (no overlap)', async () => {
    const date = getNextWorkingDate(16);

    // Book 14:00-14:30
    const booking = await createTestBooking({
      date,
      start_time: '14:00',
      phone: '0600900002',
      email: 'adjacent@test.barberclub.fr',
    });
    createdBookingIds.push(booking.id);

    // Check 14:30 — should be free (starts exactly when the other ends)
    const available = await isSlotAvailable(LUCAS_ID, date, '14:30', 30);
    expect(available).toBe(true);
  });
});

// ============================================
// API-level availability tests (supplements)
// ============================================

describe('Availability API — Additional scenarios', () => {
  test('missing barber_id defaults to "any" barber (200)', async () => {
    const res = await request(app)
      .get('/api/availability')
      .query({ service_id: COUPE_HOMME_ID, date: getNextWorkingDate() });

    // When no barber_id is provided, the API treats it as "any" barber
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('missing service_id returns 400', async () => {
    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, date: getNextWorkingDate() });

    expect(res.status).toBe(400);
  });

  test('missing date returns 400', async () => {
    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, service_id: COUPE_HOMME_ID });

    expect(res.status).toBe(400);
  });

  test('invalid date format returns 400', async () => {
    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, service_id: COUPE_HOMME_ID, date: '15/03/2026' });

    expect(res.status).toBe(400);
  });

  test('Lucas on Monday (day off) returns empty via API', async () => {
    const monday = getLucasDayOff();

    const res = await request(app)
      .get('/api/availability')
      .query({ barber_id: LUCAS_ID, service_id: COUPE_HOMME_ID, date: monday });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('non-existent barber returns empty slots', async () => {
    const date = getNextWorkingDate();

    const res = await request(app)
      .get('/api/availability')
      .query({
        barber_id: '00000000-0000-0000-0000-000000000099',
        service_id: COUPE_HOMME_ID,
        date,
      });

    // Should return 200 with empty array (no schedule for this barber)
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
