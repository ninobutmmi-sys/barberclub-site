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

describe('Bookings — Create', () => {
  test('create booking returns 201 with all fields', async () => {
    const date = getNextWorkingDate();
    const res = await request(app)
      .post('/api/bookings')
      .send({
        barber_id: LUCAS_ID,
        service_id: COUPE_HOMME_ID,
        date,
        start_time: '11:00',
        first_name: 'BookTest',
        last_name: 'Create',
        phone: '0600100001',
        email: 'create@test.barberclub.fr',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('cancel_token');
    expect(res.body.barber_id).toBe(LUCAS_ID);
    expect(res.body.service_id).toBe(COUPE_HOMME_ID);
    expect(res.body.date).toBe(date);
    expect(res.body.start_time).toMatch(/^11:00/);
    expect(res.body.price).toBe(2700);
    expect(res.body.status).toBe('confirmed');

    createdBookingIds.push(res.body.id);
  });

  test('double-booking same barber/date/time returns 409', async () => {
    const date = getNextWorkingDate(10);

    // First booking
    const first = await request(app)
      .post('/api/bookings')
      .send({
        barber_id: LUCAS_ID,
        service_id: COUPE_HOMME_ID,
        date,
        start_time: '14:00',
        first_name: 'Double',
        last_name: 'First',
        phone: '0600200001',
        email: 'double1@test.barberclub.fr',
      });

    expect(first.status).toBe(201);
    createdBookingIds.push(first.body.id);

    // Second booking same slot, different client
    const second = await request(app)
      .post('/api/bookings')
      .send({
        barber_id: LUCAS_ID,
        service_id: COUPE_HOMME_ID,
        date,
        start_time: '14:00',
        first_name: 'Double',
        last_name: 'Second',
        phone: '0600200002',
        email: 'double2@test.barberclub.fr',
      });

    expect(second.status).toBe(409);
  });

  test('booking on Lucas day off (Monday) returns 400', async () => {
    const monday = getLucasDayOff();

    const res = await request(app)
      .post('/api/bookings')
      .send({
        barber_id: LUCAS_ID,
        service_id: COUPE_HOMME_ID,
        date: monday,
        start_time: '10:00',
        first_name: 'DayOff',
        last_name: 'Test',
        phone: '0600300001',
        email: 'dayoff@test.barberclub.fr',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/travaille pas/i);
  });

  test('booking outside working hours returns 400', async () => {
    const date = getNextWorkingDate();

    const res = await request(app)
      .post('/api/bookings')
      .send({
        barber_id: LUCAS_ID,
        service_id: COUPE_HOMME_ID,
        date,
        start_time: '07:00',
        first_name: 'Early',
        last_name: 'Bird',
        phone: '0600400001',
        email: 'early@test.barberclub.fr',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/heures de travail/i);
  });

  test('booking with missing client info returns 400', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        barber_id: LUCAS_ID,
        service_id: COUPE_HOMME_ID,
        date: getNextWorkingDate(),
        start_time: '10:00',
        // Missing first_name, last_name, phone, email
      });

    expect(res.status).toBe(400);
  });
});

describe('Bookings — Retrieve & Cancel', () => {
  test('retrieve booking by id + cancel_token', async () => {
    const booking = await createTestBooking({
      start_time: '15:00',
      phone: '0600500001',
      email: 'retrieve@test.barberclub.fr',
    });
    createdBookingIds.push(booking.id);

    const res = await request(app)
      .get(`/api/bookings/${booking.id}`)
      .query({ token: booking.cancel_token });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(booking.id);
    expect(res.body).toHaveProperty('service_name');
    expect(res.body).toHaveProperty('barber_name');
  });

  test('retrieve with wrong token returns 404', async () => {
    const booking = await createTestBooking({
      start_time: '15:30',
      phone: '0600500002',
      email: 'wrongtoken@test.barberclub.fr',
    });
    createdBookingIds.push(booking.id);

    const res = await request(app)
      .get(`/api/bookings/${booking.id}`)
      .query({ token: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
  });

  test('cancel booking with valid token', async () => {
    // Create booking far enough in future (>12h)
    const date = getNextWorkingDate(14);
    const booking = await createTestBooking({
      date,
      start_time: '16:00',
      phone: '0600600001',
      email: 'cancel@test.barberclub.fr',
    });
    createdBookingIds.push(booking.id);

    const res = await request(app)
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ token: booking.cancel_token });

    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');
  });
});
