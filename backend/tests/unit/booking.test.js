/**
 * Unit tests for booking service — fully mocked DB + notification.
 * Tests: createBooking, cancelBooking, rescheduleBooking.
 * Covers regressions: past date rejection, 6-month limit, duplicate phone (23505),
 * 12h cancellation deadline (Paris TZ), rescheduled flag, waitlist SMS on cancel.
 */

const mockDb = require('./helpers/mockDb');
const mockNotification = require('./helpers/mockNotification');
const mockEnv = require('./helpers/mockEnv');

jest.mock('../../src/config/database', () => mockDb);
jest.mock('../../src/services/notification', () => mockNotification);
jest.mock('../../src/config/env', () => mockEnv);
jest.mock('../../src/services/push', () => ({
  notifyNewBooking: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Must require AFTER mocking
const bookingService = require('../../src/services/booking');

const BARBER_ID = 'b0000000-0000-0000-0000-000000000001';
const SERVICE_ID = 'a0000000-0000-0000-0000-000000000001';
const CLIENT_ID = 'c0000000-0000-0000-0000-000000000001';

beforeEach(() => {
  mockDb.resetMocks();
  jest.clearAllMocks();
});

// ============================================
// createBooking
// ============================================

describe('createBooking', () => {
  function setupCreateMocks(mockClient) {
    let queryCount = 0;
    mockClient.query.mockImplementation(async (sql, params) => {
      // Service lookup
      if (sql.includes('FROM services WHERE id')) {
        return { rows: [{ id: SERVICE_ID, name: 'Coupe Homme', price: 2700, duration: 30, duration_saturday: null, time_restrictions: null }] };
      }
      // Barber+service check
      if (sql.includes('SELECT b.id, b.name FROM barbers') && sql.includes('barber_services')) {
        return { rows: [{ id: BARBER_ID, name: 'Lucas' }] };
      }
      // Guest assignment check (validateBarberSlot)
      if (sql.includes('guest_assignments')) {
        return { rows: [] };
      }
      // Schedule override check (validateBarberSlot)
      if (sql.includes('schedule_overrides')) {
        return { rows: [] };
      }
      // Schedule check (validateBarberSlot)
      if (sql.includes('FROM schedules') && sql.includes('is_working')) {
        return { rows: [{ is_working: true, start_time: '09:00:00', end_time: '19:00:00' }] };
      }
      // Blocked slots check (validateBarberSlot)
      if (sql.includes('FROM blocked_slots') && !sql.includes('start_time, end_time')) {
        return { rows: [] };
      }
      // Client double-booking check
      if (sql.includes('FROM bookings') && sql.includes('client_id IN')) {
        return { rows: [] };
      }
      // isSlotAvailable — bookings
      if (sql.includes('FROM bookings') && sql.includes('start_time <')) {
        return { rows: [] };
      }
      // isSlotAvailable — blocked
      if (sql.includes('FROM blocked_slots')) {
        return { rows: [] };
      }
      // Client lookup by phone
      if (sql.includes('SELECT id FROM clients WHERE phone')) {
        return { rows: [{ id: CLIENT_ID }] };
      }
      // Client lookup by email
      if (sql.includes('SELECT id FROM clients WHERE email')) {
        return { rows: [] };
      }
      // Update client info
      if (sql.includes('UPDATE clients SET first_name')) {
        return { rows: [], rowCount: 1 };
      }
      // Client-salon link
      if (sql.includes('INSERT INTO client_salons')) {
        return { rows: [], rowCount: 1 };
      }
      // First visit check
      if (sql.includes('FROM bookings WHERE client_id') && sql.includes('LIMIT 1')) {
        return { rows: [] };
      }
      // Insert booking
      if (sql.includes('INSERT INTO bookings')) {
        return {
          rows: [{
            id: 'booking-new-1',
            client_id: CLIENT_ID,
            barber_id: BARBER_ID,
            service_id: SERVICE_ID,
            date: params[3],
            start_time: params[4],
            end_time: params[5],
            price: 2700,
            status: 'confirmed',
            cancel_token: 'test-cancel-token',
            source: params[7],
            created_at: new Date(),
            salon_id: 'meylan',
          }],
        };
      }
      // has_account check
      if (sql.includes('SELECT has_account FROM clients')) {
        return { rows: [{ has_account: false }] };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  test('creates booking successfully', async () => {
    const mockClient = mockDb.setupTransaction();
    setupCreateMocks(mockClient);

    // Mock getBookingDetails (called after transaction for notifications)
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT b.*') && sql.includes('service_name')) {
        return {
          rows: [{
            id: 'booking-new-1',
            date: '2026-04-10',
            start_time: '10:00:00',
            client_email: 'test@test.com',
            client_first_name: 'Jean',
            client_phone: '+33600000001',
            service_name: 'Coupe Homme',
            barber_name: 'Lucas',
            price: 2700,
            cancel_token: 'test-cancel-token',
          }],
        };
      }
      // Barber home salon (for availability)
      if (sql.includes('SELECT salon_id FROM barbers')) {
        return { rows: [{ salon_id: 'meylan' }] };
      }
      if (sql.includes('UPDATE bookings SET reminder_sent')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    const futureDate = '2026-04-10';
    const result = await bookingService.createBooking({
      barber_id: BARBER_ID,
      service_id: SERVICE_ID,
      date: futureDate,
      start_time: '10:00',
      first_name: 'Jean',
      last_name: 'Dupont',
      phone: '+33600000001',
      email: 'test@test.com',
      source: 'online',
    });

    expect(result.id).toBe('booking-new-1');
    expect(result.status).toBe('confirmed');
    expect(result.barber_name).toBe('Lucas');
  });

  test('rejects past dates (client booking)', async () => {
    const mockClient = mockDb.setupTransaction();
    // Service lookup should still work
    mockClient.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM services WHERE id')) {
        return { rows: [{ id: SERVICE_ID, name: 'Coupe', price: 2700, duration: 30 }] };
      }
      return { rows: [] };
    });

    await expect(
      bookingService.createBooking({
        barber_id: BARBER_ID,
        service_id: SERVICE_ID,
        date: '2020-01-01',
        start_time: '10:00',
        first_name: 'Jean',
        last_name: 'Dupont',
        phone: '+33600000001',
        source: 'online',
      })
    ).rejects.toThrow(/passé/i);
  });

  test('rejects dates > 6 months ahead (client booking)', async () => {
    const mockClient = mockDb.setupTransaction();
    mockClient.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM services WHERE id')) {
        return { rows: [{ id: SERVICE_ID, name: 'Coupe', price: 2700, duration: 30 }] };
      }
      return { rows: [] };
    });

    // Date 7 months from now
    const farDate = new Date();
    farDate.setMonth(farDate.getMonth() + 7);
    const farDateStr = `${farDate.getFullYear()}-${String(farDate.getMonth() + 1).padStart(2, '0')}-${String(farDate.getDate()).padStart(2, '0')}`;

    await expect(
      bookingService.createBooking({
        barber_id: BARBER_ID,
        service_id: SERVICE_ID,
        date: farDateStr,
        start_time: '10:00',
        first_name: 'Jean',
        last_name: 'Dupont',
        phone: '+33600000001',
        source: 'online',
      })
    ).rejects.toThrow(/6 mois/i);
  });

  test('allows past dates for admin (manual) bookings', async () => {
    const mockClient = mockDb.setupTransaction();
    setupCreateMocks(mockClient);

    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT b.*') && sql.includes('service_name')) {
        return {
          rows: [{
            id: 'booking-new-1',
            date: '2026-03-01',
            start_time: '10:00:00',
            client_email: null,
            client_phone: '+33600000001',
            service_name: 'Coupe',
            barber_name: 'Lucas',
            price: 2700,
          }],
        };
      }
      if (sql.includes('SELECT salon_id FROM barbers')) {
        return { rows: [{ salon_id: 'meylan' }] };
      }
      return { rows: [] };
    });

    // Admin (source: manual) should not reject past dates
    const result = await bookingService.createBooking({
      barber_id: BARBER_ID,
      service_id: SERVICE_ID,
      date: '2026-03-01',
      start_time: '10:00',
      first_name: 'Jean',
      last_name: 'Dupont',
      phone: '+33600000001',
      source: 'manual',
    });

    expect(result.id).toBe('booking-new-1');
  });

  test('handles duplicate phone constraint (23505 error)', async () => {
    const error = new Error('duplicate key value');
    error.code = '23505';
    error.constraint = 'clients_phone_unique';

    mockDb.transaction.mockRejectedValue(error);

    await expect(
      bookingService.createBooking({
        barber_id: BARBER_ID,
        service_id: SERVICE_ID,
        date: '2026-04-10',
        start_time: '10:00',
        first_name: 'Jean',
        last_name: 'Dupont',
        phone: '+33600000001',
        source: 'online',
      })
    ).rejects.toThrow(/existe déjà|créneau/i);
  });

  test('handles slot conflict (23505 without client constraint)', async () => {
    const error = new Error('duplicate key value');
    error.code = '23505';
    error.constraint = 'bookings_no_overlap';

    mockDb.transaction.mockRejectedValue(error);

    await expect(
      bookingService.createBooking({
        barber_id: BARBER_ID,
        service_id: SERVICE_ID,
        date: '2026-04-10',
        start_time: '10:00',
        first_name: 'Jean',
        last_name: 'Dupont',
        phone: '+33600000001',
        source: 'online',
      })
    ).rejects.toThrow(/créneau/i);
  });

  test('sends confirmation email after successful booking', async () => {
    const mockClient = mockDb.setupTransaction();
    setupCreateMocks(mockClient);

    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT b.*') && sql.includes('service_name')) {
        return {
          rows: [{
            id: 'booking-new-1',
            date: '2026-04-10',
            start_time: '10:00:00',
            client_email: 'test@test.com',
            client_first_name: 'Jean',
            client_phone: '+33600000001',
            service_name: 'Coupe',
            barber_name: 'Lucas',
            price: 2700,
            cancel_token: 'tok',
          }],
        };
      }
      if (sql.includes('SELECT salon_id FROM barbers')) {
        return { rows: [{ salon_id: 'meylan' }] };
      }
      return { rows: [] };
    });

    await bookingService.createBooking({
      barber_id: BARBER_ID,
      service_id: SERVICE_ID,
      date: '2026-04-10',
      start_time: '10:00',
      first_name: 'Jean',
      last_name: 'Dupont',
      phone: '+33600000001',
      email: 'test@test.com',
      source: 'online',
    });

    expect(mockNotification.sendConfirmationEmail).toHaveBeenCalled();
  });
});

// ============================================
// cancelBooking
// ============================================

describe('cancelBooking', () => {
  function setupCancelMocks(booking) {
    const mockClient = mockDb.setupTransaction();

    mockClient.query.mockImplementation(async (sql, params) => {
      // Fetch booking with lock
      if (sql.includes('SELECT b.*') && sql.includes('FOR UPDATE')) {
        return { rows: booking ? [booking] : [] };
      }
      // Cancel update
      if (sql.includes("UPDATE bookings SET status = 'cancelled'")) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    return mockClient;
  }

  function createFutureBooking(overrides = {}) {
    // Booking 3 days from now at 10:00 → well within cancellation window
    const future = new Date();
    future.setDate(future.getDate() + 3);
    const dateStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;

    return {
      id: 'booking-1',
      barber_id: BARBER_ID,
      client_id: CLIENT_ID,
      service_id: SERVICE_ID,
      date: dateStr,
      start_time: '10:00:00',
      end_time: '10:30:00',
      status: 'confirmed',
      cancel_token: 'cancel-tok-123',
      salon_id: 'meylan',
      client_email: 'test@test.com',
      first_name: 'Jean',
      service_name: 'Coupe Homme',
      barber_name: 'Lucas',
      price: 2700,
      ...overrides,
    };
  }

  test('cancels successfully when > 12h before', async () => {
    const booking = createFutureBooking();
    setupCancelMocks(booking);

    // Mock waitlist query
    mockDb.query.mockResolvedValue({ rows: [] });

    const result = await bookingService.cancelBooking('booking-1', 'cancel-tok-123');
    expect(result.status).toBe('cancelled');
    expect(mockNotification.sendCancellationEmail).toHaveBeenCalled();
  });

  test('rejects when < 12h before (timezone-aware)', async () => {
    // Create booking happening in 2 hours
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    now.setHours(now.getHours() + 2);
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;

    const booking = createFutureBooking({ date: dateStr, start_time: timeStr });
    setupCancelMocks(booking);

    await expect(
      bookingService.cancelBooking('booking-1', 'cancel-tok-123')
    ).rejects.toThrow(/12 heures/i);
  });

  test('rejects already cancelled booking', async () => {
    const booking = createFutureBooking({ status: 'cancelled' });
    setupCancelMocks(booking);

    await expect(
      bookingService.cancelBooking('booking-1', 'cancel-tok-123')
    ).rejects.toThrow(/déjà été annulé/i);
  });

  test('rejects non-confirmed booking (e.g. completed)', async () => {
    const booking = createFutureBooking({ status: 'completed' });
    setupCancelMocks(booking);

    await expect(
      bookingService.cancelBooking('booking-1', 'cancel-tok-123')
    ).rejects.toThrow(/ne peut plus être annulé/i);
  });

  test('returns 404 for invalid cancel token', async () => {
    setupCancelMocks(null);

    await expect(
      bookingService.cancelBooking('booking-1', 'wrong-token')
    ).rejects.toThrow(/introuvable/i);
  });

  test('sends cancellation email', async () => {
    const booking = createFutureBooking();
    setupCancelMocks(booking);
    mockDb.query.mockResolvedValue({ rows: [] });

    await bookingService.cancelBooking('booking-1', 'cancel-tok-123');

    expect(mockNotification.sendCancellationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@test.com',
        first_name: 'Jean',
        service_name: 'Coupe Homme',
        barber_name: 'Lucas',
      })
    );
  });

  test('notifies waitlist after cancellation', async () => {
    const booking = createFutureBooking();
    setupCancelMocks(booking);

    // Mock waitlist query to return a waiting entry
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM waitlist')) {
        return {
          rows: [{
            id: 'wait-1',
            client_name: 'Marie',
            client_phone: '+33600000002',
            preferred_date: booking.date,
            preferred_time_start: '09:00',
            preferred_time_end: '12:00',
            barber_name: 'Lucas',
            service_name: 'Coupe Homme',
          }],
        };
      }
      // Update waitlist status
      if (sql.includes('UPDATE waitlist')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    await bookingService.cancelBooking('booking-1', 'cancel-tok-123');

    expect(mockNotification.sendWaitlistSMS).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+33600000002',
      })
    );
  });

  test('cancelBooking uses Paris timezone for deadline check', async () => {
    // This specifically tests the bug fix: using toLocaleString with Europe/Paris
    // The booking is exactly 13 hours from now in Paris time — should succeed
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const futureTime = new Date(now.getTime() + 13 * 60 * 60 * 1000);
    const dateStr = `${futureTime.getFullYear()}-${String(futureTime.getMonth() + 1).padStart(2, '0')}-${String(futureTime.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(futureTime.getHours()).padStart(2, '0')}:${String(futureTime.getMinutes()).padStart(2, '0')}:00`;

    const booking = createFutureBooking({ date: dateStr, start_time: timeStr });
    setupCancelMocks(booking);
    mockDb.query.mockResolvedValue({ rows: [] });

    // Should not throw — 13h > 12h deadline
    const result = await bookingService.cancelBooking('booking-1', 'cancel-tok-123');
    expect(result.status).toBe('cancelled');
  });
});

// ============================================
// rescheduleBooking
// ============================================

describe('rescheduleBooking', () => {
  function setupRescheduleMocks(booking) {
    const mockClient = mockDb.setupTransaction();

    mockClient.query.mockImplementation(async (sql, params) => {
      // Fetch booking with lock
      if (sql.includes('SELECT b.*') && sql.includes('FOR UPDATE')) {
        return { rows: booking ? [booking] : [] };
      }
      // Guest assignments (validateBarberSlot)
      if (sql.includes('guest_assignments')) {
        return { rows: [] };
      }
      // Schedule overrides (validateBarberSlot)
      if (sql.includes('schedule_overrides')) {
        return { rows: [] };
      }
      // Schedules break check (validateBarberSlot) — must be before general schedules
      if (sql.includes('FROM schedules') && sql.includes('break_start IS NOT NULL')) {
        return { rows: [] };
      }
      // Schedules (validateBarberSlot)
      if (sql.includes('FROM schedules')) {
        return { rows: [{ is_working: true, start_time: '09:00:00', end_time: '19:00:00', break_start: null, break_end: null }] };
      }
      // Blocked slots (validateBarberSlot)
      if (sql.includes('blocked_slots')) {
        return { rows: [] };
      }
      // Conflict check (other bookings)
      if (sql.includes('FROM bookings') && sql.includes('FOR UPDATE') && sql.includes('id !=')) {
        return { rows: [] };
      }
      // Update booking
      if (sql.includes('UPDATE bookings') && sql.includes('SET date')) {
        return {
          rows: [{
            id: booking?.id || 'booking-1',
            date: params[0],
            start_time: params[1],
            end_time: params[2],
            status: 'confirmed',
            cancel_token: booking?.cancel_token || 'tok',
          }],
        };
      }
      return { rows: [] };
    });

    return mockClient;
  }

  function createConfirmedBooking(overrides = {}) {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const dateStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;

    return {
      id: 'booking-1',
      barber_id: BARBER_ID,
      client_id: CLIENT_ID,
      service_id: SERVICE_ID,
      date: dateStr,
      start_time: '10:00:00',
      end_time: '10:30:00',
      service_duration: 30,
      service_duration_saturday: null,
      service_name: 'Coupe Homme',
      service_price: 2700,
      barber_name: 'Lucas',
      first_name: 'Jean',
      last_name: 'Dupont',
      phone: '+33600000001',
      email: 'test@test.com',
      status: 'confirmed',
      cancel_token: 'cancel-tok-123',
      rescheduled: false,
      salon_id: 'meylan',
      ...overrides,
    };
  }

  test('reschedules successfully', async () => {
    const booking = createConfirmedBooking();
    setupRescheduleMocks(booking);

    // Mock for getBarberHomeSalon (called by validateBarberSlot)
    mockDb.query.mockResolvedValue({ rows: [{ salon_id: 'meylan' }] });

    const newDate = new Date();
    newDate.setDate(newDate.getDate() + 10);
    const newDateStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;

    const result = await bookingService.rescheduleBooking('booking-1', 'cancel-tok-123', newDateStr, '14:00');

    expect(result.id).toBe('booking-1');
    expect(result.date).toBe(newDateStr);
    expect(result.start_time).toBe('14:00');
    expect(mockNotification.sendRescheduleEmail).toHaveBeenCalled();
  });

  test('rejects second reschedule (rescheduled flag)', async () => {
    const booking = createConfirmedBooking({ rescheduled: true });
    setupRescheduleMocks(booking);

    await expect(
      bookingService.rescheduleBooking('booking-1', 'cancel-tok-123', '2026-04-15', '14:00')
    ).rejects.toThrow(/déjà été décalé/i);
  });

  test('rejects when < 12h before original booking', async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    now.setHours(now.getHours() + 2);
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;

    const booking = createConfirmedBooking({ date: dateStr, start_time: timeStr });
    setupRescheduleMocks(booking);

    await expect(
      bookingService.rescheduleBooking('booking-1', 'cancel-tok-123', '2026-05-01', '14:00')
    ).rejects.toThrow(/12 heures/i);
  });

  test('rejects rescheduling to past date', async () => {
    const booking = createConfirmedBooking();
    setupRescheduleMocks(booking);
    mockDb.query.mockResolvedValue({ rows: [{ salon_id: 'meylan' }] });

    await expect(
      bookingService.rescheduleBooking('booking-1', 'cancel-tok-123', '2020-01-01', '14:00')
    ).rejects.toThrow(/passé/i);
  });

  test('rejects rescheduling to > 6 months ahead', async () => {
    const booking = createConfirmedBooking();
    setupRescheduleMocks(booking);
    mockDb.query.mockResolvedValue({ rows: [{ salon_id: 'meylan' }] });

    const farDate = new Date();
    farDate.setMonth(farDate.getMonth() + 7);
    const farDateStr = `${farDate.getFullYear()}-${String(farDate.getMonth() + 1).padStart(2, '0')}-${String(farDate.getDate()).padStart(2, '0')}`;

    await expect(
      bookingService.rescheduleBooking('booking-1', 'cancel-tok-123', farDateStr, '14:00')
    ).rejects.toThrow(/6 mois/i);
  });

  test('rejects non-confirmed booking', async () => {
    const booking = createConfirmedBooking({ status: 'completed' });
    setupRescheduleMocks(booking);

    await expect(
      bookingService.rescheduleBooking('booking-1', 'cancel-tok-123', '2026-04-15', '14:00')
    ).rejects.toThrow(/ne peut plus être modifié/i);
  });

  test('rescheduleBooking uses Paris timezone for deadline check', async () => {
    // 13 hours from now in Paris time — should succeed
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const futureTime = new Date(now.getTime() + 13 * 60 * 60 * 1000);
    const dateStr = `${futureTime.getFullYear()}-${String(futureTime.getMonth() + 1).padStart(2, '0')}-${String(futureTime.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(futureTime.getHours()).padStart(2, '0')}:${String(futureTime.getMinutes()).padStart(2, '0')}:00`;

    const booking = createConfirmedBooking({ date: dateStr, start_time: timeStr });
    setupRescheduleMocks(booking);
    mockDb.query.mockResolvedValue({ rows: [{ salon_id: 'meylan' }] });

    const newDate = new Date();
    newDate.setDate(newDate.getDate() + 14);
    const newDateStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;

    const result = await bookingService.rescheduleBooking('booking-1', 'cancel-tok-123', newDateStr, '15:00');
    expect(result.id).toBe('booking-1');
  });
});

// ============================================
// updateBookingStatus
// ============================================

describe('updateBookingStatus', () => {
  test('updates to completed', async () => {
    mockDb.query.mockResolvedValue({
      rows: [{ id: 'booking-1', status: 'completed' }],
    });

    const result = await bookingService.updateBookingStatus('booking-1', 'completed');
    expect(result.status).toBe('completed');
  });

  test('updates to no_show', async () => {
    mockDb.query.mockResolvedValue({
      rows: [{ id: 'booking-1', status: 'no_show' }],
    });

    const result = await bookingService.updateBookingStatus('booking-1', 'no_show');
    expect(result.status).toBe('no_show');
  });

  test('rejects invalid status', async () => {
    await expect(
      bookingService.updateBookingStatus('booking-1', 'invalid')
    ).rejects.toThrow(/invalide/i);
  });

  test('throws 404 for non-existent booking', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });

    await expect(
      bookingService.updateBookingStatus('nonexistent', 'completed')
    ).rejects.toThrow(/introuvable/i);
  });
});

// ============================================
// getBookingDetails
// ============================================

describe('getBookingDetails', () => {
  test('returns booking with all related data', async () => {
    mockDb.query.mockResolvedValue({
      rows: [{
        id: 'booking-1',
        date: '2026-04-10',
        start_time: '10:00:00',
        end_time: '10:30:00',
        service_name: 'Coupe Homme',
        service_duration: 30,
        barber_name: 'Lucas',
        client_first_name: 'Jean',
        client_last_name: 'Dupont',
        client_phone: '+33600000001',
        client_email: 'test@test.com',
      }],
    });

    const result = await bookingService.getBookingDetails('booking-1');
    expect(result).not.toBeNull();
    expect(result.service_name).toBe('Coupe Homme');
    expect(result.barber_name).toBe('Lucas');
    expect(result.client_first_name).toBe('Jean');
  });

  test('returns null for non-existent booking', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });

    const result = await bookingService.getBookingDetails('nonexistent');
    expect(result).toBeNull();
  });
});
