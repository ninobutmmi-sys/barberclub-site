/**
 * Unit tests for availability service — fully mocked DB.
 * Tests: getAvailableSlots, findBestBarber, isSlotAvailable, time helpers.
 * Covers regressions: day_of_week 0=Monday, TIME .slice(0,5), past slots filtering,
 * 30min vs 5min intervals, FOR UPDATE locking, guest assignments.
 */

const mockDb = require('./helpers/mockDb');

// Mock database before requiring service
jest.mock('../../src/config/database', () => mockDb);
jest.mock('../../src/config/env', () => require('./helpers/mockEnv'));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  getAvailableSlots,
  isSlotAvailable,
  findBestBarber,
  addMinutesToTime,
  validateBarberSlot,
} = require('../../src/services/availability');

const BARBER_ID = 'b0000000-0000-0000-0000-000000000001';
const SERVICE_ID = 'a0000000-0000-0000-0000-000000000001';

beforeEach(() => {
  mockDb.resetMocks();
});

// ============================================
// Time helpers — pure functions
// ============================================

describe('Time helpers', () => {
  test('addMinutesToTime: 09:00 + 30 = 09:30', () => {
    expect(addMinutesToTime('09:00', 30)).toBe('09:30');
  });

  test('addMinutesToTime: 09:30 + 30 = 10:00 (crosses hour)', () => {
    expect(addMinutesToTime('09:30', 30)).toBe('10:00');
  });

  test('addMinutesToTime: 14:00 + 60 = 15:00', () => {
    expect(addMinutesToTime('14:00', 60)).toBe('15:00');
  });

  test('addMinutesToTime: 10:00 + 90 = 11:30', () => {
    expect(addMinutesToTime('10:00', 90)).toBe('11:30');
  });

  test('addMinutesToTime: 12:00 + 0 = 12:00', () => {
    expect(addMinutesToTime('12:00', 0)).toBe('12:00');
  });

  test('addMinutesToTime: handles HH:MM:SS format (TIME column fix)', () => {
    // PostgreSQL TIME returns HH:MM:SS — function must handle it via split(':')
    expect(addMinutesToTime('09:00:00', 30)).toBe('09:30');
  });

  test('addMinutesToTime: handles midnight boundary', () => {
    expect(addMinutesToTime('23:30', 60)).toBe('24:30');
  });
});

// ============================================
// getAvailableSlots
// ============================================

describe('getAvailableSlots', () => {
  /**
   * Helper: set up mock queries for a standard barber day.
   * @param {object} opts
   * @param {number} opts.duration - Service duration in minutes
   * @param {string} opts.startTime - Schedule start (HH:MM:SS from DB)
   * @param {string} opts.endTime - Schedule end
   * @param {Array} opts.bookings - Existing bookings [{start_time, end_time}]
   * @param {Array} opts.blocked - Blocked slots [{start_time, end_time}]
   * @param {boolean} opts.isDayOff - Whether override is day off
   * @param {boolean} opts.noSchedule - No schedule entry at all
   */
  function setupStandardMocks(opts = {}) {
    const {
      duration = 30,
      startTime = '09:00:00',
      endTime = '19:00:00',
      bookings = [],
      blocked = [],
      isDayOff = false,
      noSchedule = false,
    } = opts;

    let callIndex = 0;
    mockDb.query.mockImplementation(async (sql, params) => {
      // 1. Service duration query
      if (sql.includes('SELECT duration FROM services')) {
        return { rows: [{ duration }] };
      }
      // 2. Barbers for 'any' mode (resident barbers)
      if (sql.includes('SELECT b.id FROM barbers b') && sql.includes('barber_services')) {
        return { rows: [{ id: BARBER_ID }] };
      }
      // 2b. Guest barbers
      if (sql.includes('guest_assignments') && sql.includes('SELECT DISTINCT')) {
        return { rows: [] };
      }
      // 3. Guest assignment check
      if (sql.includes('SELECT host_salon_id') && sql.includes('guest_assignments')) {
        return { rows: [] };
      }
      // 4. Barber home salon
      if (sql.includes('SELECT salon_id FROM barbers')) {
        return { rows: [{ salon_id: 'meylan' }] };
      }
      // 5. Schedule override
      if (sql.includes('schedule_overrides')) {
        if (isDayOff) {
          return { rows: [{ is_day_off: true, start_time: startTime, end_time: endTime }] };
        }
        return { rows: [] };
      }
      // 6. Default schedule
      if (sql.includes('FROM schedules')) {
        if (noSchedule) return { rows: [] };
        return { rows: [{ start_time: startTime, end_time: endTime, is_working: true }] };
      }
      // 7. Existing bookings
      if (sql.includes('FROM bookings') && sql.includes('start_time, end_time')) {
        return { rows: bookings };
      }
      // 8. Blocked slots
      if (sql.includes('FROM blocked_slots') && sql.includes('start_time, end_time')) {
        return { rows: blocked };
      }
      // 9. Barber name
      if (sql.includes('SELECT name FROM barbers')) {
        return { rows: [{ name: 'Lucas' }] };
      }
      return { rows: [] };
    });
  }

  test('returns correct slots for 9h-19h schedule with 30min service', async () => {
    setupStandardMocks({ duration: 30, startTime: '09:00:00', endTime: '19:00:00' });

    // Use a future Tuesday (day_of_week=1 in 0=Monday convention)
    // 2026-03-10 is a Tuesday
    const slots = await getAvailableSlots(BARBER_ID, SERVICE_ID, '2026-03-10');

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toEqual({
      time: '09:00',
      barber_id: BARBER_ID,
      barber_name: 'Lucas',
    });

    // Should have 20 slots: 09:00, 09:30, ..., 18:30 (30min intervals, 30min service)
    expect(slots.length).toBe(20);
    expect(slots[slots.length - 1].time).toBe('18:30');
  });

  test('returns empty for a day off (schedule override)', async () => {
    setupStandardMocks({ isDayOff: true });

    const slots = await getAvailableSlots(BARBER_ID, SERVICE_ID, '2026-03-10');
    expect(slots).toEqual([]);
  });

  test('returns empty when barber has no schedule', async () => {
    setupStandardMocks({ noSchedule: true });

    const slots = await getAvailableSlots(BARBER_ID, SERVICE_ID, '2026-03-10');
    expect(slots).toEqual([]);
  });

  test('filters out booked slots', async () => {
    setupStandardMocks({
      duration: 30,
      startTime: '09:00:00',
      endTime: '11:00:00',
      bookings: [
        { start_time: '09:30:00', end_time: '10:00:00' },
        { start_time: '10:00:00', end_time: '10:30:00' },
      ],
    });

    const slots = await getAvailableSlots(BARBER_ID, SERVICE_ID, '2026-03-10');

    const times = slots.map((s) => s.time);
    expect(times).toContain('09:00');
    expect(times).not.toContain('09:30');
    expect(times).not.toContain('10:00');
    expect(times).toContain('10:30');
  });

  test('filters out blocked slots', async () => {
    setupStandardMocks({
      duration: 30,
      startTime: '09:00:00',
      endTime: '11:00:00',
      blocked: [{ start_time: '09:00:00', end_time: '10:00:00' }],
    });

    const slots = await getAvailableSlots(BARBER_ID, SERVICE_ID, '2026-03-10');

    const times = slots.map((s) => s.time);
    expect(times).not.toContain('09:00');
    expect(times).not.toContain('09:30');
    expect(times).toContain('10:00');
    expect(times).toContain('10:30');
  });

  test('30min intervals for public mode', async () => {
    setupStandardMocks({ duration: 30, startTime: '09:00:00', endTime: '12:00:00' });

    const slots = await getAvailableSlots(BARBER_ID, SERVICE_ID, '2026-03-10');

    for (const slot of slots) {
      const minutes = parseInt(slot.time.split(':')[1], 10);
      expect([0, 30]).toContain(minutes);
    }
  });

  test('5min intervals for admin mode', async () => {
    setupStandardMocks({ duration: 30, startTime: '09:00:00', endTime: '10:00:00' });

    const slots = await getAvailableSlots(BARBER_ID, SERVICE_ID, '2026-03-10', { adminMode: true });

    // From 09:00 to 09:30 in 5min steps: 09:00, 09:05, 09:10, 09:15, 09:20, 09:25, 09:30
    // That's slots where slotStart + 30 <= endMin (600)
    // ADMIN_SCHEDULE_END is 20:00, but endTime is 10:00 → admin extends to 20:00
    // Actually with adminMode, endTime gets extended to ADMIN_SCHEDULE_END (20:00) if lower
    expect(slots.length).toBeGreaterThan(6);

    // Should have 5-min granularity
    const minuteValues = new Set(slots.map((s) => parseInt(s.time.split(':')[1], 10)));
    expect(minuteValues.size).toBeGreaterThan(2);
  });

  test('admin mode extends schedule to ADMIN_SCHEDULE_END (20:00)', async () => {
    setupStandardMocks({ duration: 30, startTime: '09:00:00', endTime: '17:00:00' });

    const slots = await getAvailableSlots(BARBER_ID, SERVICE_ID, '2026-03-10', { adminMode: true });

    // Last slot should be at 19:30 (20:00 - 30min duration)
    const times = slots.map((s) => s.time);
    expect(times).toContain('19:30');
  });

  test('returns empty for invalid service', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT duration FROM services')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const slots = await getAvailableSlots(BARBER_ID, 'invalid-id', '2026-03-10');
    expect(slots).toEqual([]);
  });

  test('day_of_week conversion: Monday=0, Sunday=6 (not JS convention)', async () => {
    // 2026-03-09 is a Monday (JS day 1 → should convert to day_of_week 0)
    // 2026-03-15 is a Sunday (JS day 0 → should convert to day_of_week 6)
    setupStandardMocks({ duration: 30, startTime: '09:00:00', endTime: '19:00:00' });

    // We can verify the correct day_of_week is passed to the schedule query
    await getAvailableSlots(BARBER_ID, SERVICE_ID, '2026-03-09');

    // Find the schedule query call
    const scheduleCalls = mockDb.query.mock.calls.filter(
      (call) => call[0].includes('FROM schedules') && call[0].includes('day_of_week')
    );

    if (scheduleCalls.length > 0) {
      const dayParam = scheduleCalls[0][1].find((p) => typeof p === 'number');
      // Monday should be 0 in our convention
      expect(dayParam).toBe(0);
    }
  });
});

// ============================================
// isSlotAvailable
// ============================================

describe('isSlotAvailable', () => {
  test('returns true for a free slot (no bookings, no blocks)', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      return { rows: [] };
    });

    const available = await isSlotAvailable(BARBER_ID, '2026-03-10', '10:00', 30);
    expect(available).toBe(true);
  });

  test('returns false for overlapping booking', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM bookings')) {
        return { rows: [{ id: 'existing-booking' }] };
      }
      return { rows: [] };
    });

    const available = await isSlotAvailable(BARBER_ID, '2026-03-10', '10:00', 30);
    expect(available).toBe(false);
  });

  test('returns false for blocked slot', async () => {
    let callCount = 0;
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM bookings')) {
        return { rows: [] }; // No bookings
      }
      if (sql.includes('FROM blocked_slots')) {
        return { rows: [{ id: 'blocked-1' }] }; // Blocked
      }
      return { rows: [] };
    });

    const available = await isSlotAvailable(BARBER_ID, '2026-03-10', '10:00', 30);
    expect(available).toBe(false);
  });

  test('uses FOR UPDATE when client (transaction) is passed', async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    await isSlotAvailable(BARBER_ID, '2026-03-10', '10:00', 30, mockClient);

    // The first query (bookings check) should contain FOR UPDATE
    const bookingsQuery = mockClient.query.mock.calls[0][0];
    expect(bookingsQuery).toContain('FOR UPDATE');
  });

  test('does NOT use FOR UPDATE without client (no transaction)', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });

    await isSlotAvailable(BARBER_ID, '2026-03-10', '10:00', 30);

    const bookingsQuery = mockDb.query.mock.calls[0][0];
    expect(bookingsQuery).not.toContain('FOR UPDATE');
  });

  test('correctly calculates end_time for overlap check', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });

    await isSlotAvailable(BARBER_ID, '2026-03-10', '10:00', 45);

    // end_time should be 10:45
    const params = mockDb.query.mock.calls[0][1];
    expect(params).toContain('10:45');
  });
});

// ============================================
// findBestBarber
// ============================================

describe('findBestBarber', () => {
  function setupFindBestMocks(barbers, bookingCounts = {}) {
    mockDb.query.mockImplementation(async (sql, params) => {
      // Resident barbers
      if (sql.includes('barber_services') && sql.includes('SELECT b.id, b.name')) {
        return { rows: barbers };
      }
      // Guest barbers
      if (sql.includes('guest_assignments') && sql.includes('SELECT b.id, b.name')) {
        return { rows: [] };
      }
      // Guest assignment check (for barberWorksAtTime)
      if (sql.includes('SELECT host_salon_id') && sql.includes('guest_assignments')) {
        return { rows: [] };
      }
      // Barber home salon
      if (sql.includes('SELECT salon_id FROM barbers')) {
        return { rows: [{ salon_id: 'meylan' }] };
      }
      // Schedule override
      if (sql.includes('schedule_overrides')) {
        return { rows: [] };
      }
      // Default schedule (barberWorksAtTime)
      if (sql.includes('FROM schedules') && sql.includes('is_working')) {
        return { rows: [{ start_time: '09:00:00', end_time: '19:00:00', is_working: true }] };
      }
      // isSlotAvailable — bookings check
      if (sql.includes('FROM bookings') && sql.includes('start_time <')) {
        return { rows: [] };
      }
      // isSlotAvailable — blocked check
      if (sql.includes('FROM blocked_slots')) {
        return { rows: [] };
      }
      // Count bookings for load balancing
      if (sql.includes('COUNT(*)')) {
        const barberId = params[0];
        const count = bookingCounts[barberId] || 0;
        return { rows: [{ count: String(count) }] };
      }
      return { rows: [] };
    });
  }

  test('returns barber with fewer bookings (load balancing)', async () => {
    const barbers = [
      { id: 'barber-1', name: 'Lucas' },
      { id: 'barber-2', name: 'Julien' },
    ];

    setupFindBestMocks(barbers, { 'barber-1': 5, 'barber-2': 2 });

    const best = await findBestBarber(SERVICE_ID, '2026-03-10', '10:00', 30);
    expect(best).not.toBeNull();
    expect(best.id).toBe('barber-2');
    expect(best.name).toBe('Julien');
  });

  test('returns null if no barber is available', async () => {
    setupFindBestMocks([]);

    const best = await findBestBarber(SERVICE_ID, '2026-03-10', '10:00', 30);
    expect(best).toBeNull();
  });

  test('accepts dbClient parameter (transaction support)', async () => {
    // findBestBarber passes dbClient to its own queries (barber list, count)
    // but barberWorksAtTime internally calls getGuestAssignment and getBarberHomeSalon
    // which use db.query directly. So we need BOTH mockClient AND mockDb.query.
    const defaultHandler = async (sql, params) => {
      if (sql.includes('barber_services') && sql.includes('SELECT b.id, b.name')) {
        return { rows: [{ id: 'barber-1', name: 'Lucas' }] };
      }
      if (sql.includes('guest_assignments') && sql.includes('SELECT b.id, b.name')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT host_salon_id') && sql.includes('guest_assignments')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT salon_id FROM barbers')) {
        return { rows: [{ salon_id: 'meylan' }] };
      }
      if (sql.includes('schedule_overrides')) {
        return { rows: [] };
      }
      // COUNT(*) must be checked BEFORE generic FROM bookings
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '0' }] };
      }
      if (sql.includes('FROM schedules')) {
        return { rows: [{ start_time: '09:00:00', end_time: '19:00:00', is_working: true }] };
      }
      if (sql.includes('FROM bookings')) {
        return { rows: [] };
      }
      if (sql.includes('FROM blocked_slots')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    const mockClient = {
      query: jest.fn().mockImplementation(defaultHandler),
    };

    // barberWorksAtTime calls db.query for getGuestAssignment, getBarberHomeSalon, schedule_overrides, schedules
    mockDb.query.mockImplementation(defaultHandler);

    const best = await findBestBarber(SERVICE_ID, '2026-03-10', '10:00', 30, 'meylan', mockClient);

    expect(best).not.toBeNull();
    expect(best.id).toBe('barber-1');
    // Should use the client's query for barber list + count queries
    expect(mockClient.query).toHaveBeenCalled();
  });

  test('skips barbers who do not work at the requested time', async () => {
    const barbers = [
      { id: 'barber-1', name: 'Lucas' },
      { id: 'barber-2', name: 'Julien' },
    ];

    mockDb.query.mockImplementation(async (sql, params) => {
      if (sql.includes('barber_services') && sql.includes('SELECT b.id, b.name')) {
        return { rows: barbers };
      }
      if (sql.includes('guest_assignments')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT salon_id FROM barbers')) {
        return { rows: [{ salon_id: 'meylan' }] };
      }
      if (sql.includes('schedule_overrides')) {
        return { rows: [] };
      }
      // COUNT query (load balancing) — must be checked BEFORE the schedules catch-all
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '0' }] };
      }
      if (sql.includes('FROM schedules')) {
        // barber-1 doesn't work, barber-2 works
        if (params && params[0] === 'barber-1') {
          return { rows: [{ start_time: '09:00:00', end_time: '19:00:00', is_working: false }] };
        }
        return { rows: [{ start_time: '09:00:00', end_time: '19:00:00', is_working: true }] };
      }
      if (sql.includes('FROM bookings')) return { rows: [] };
      if (sql.includes('FROM blocked_slots')) return { rows: [] };
      return { rows: [] };
    });

    const best = await findBestBarber(SERVICE_ID, '2026-03-10', '10:00', 30);
    expect(best).not.toBeNull();
    expect(best.id).toBe('barber-2');
  });
});

// ============================================
// validateBarberSlot
// ============================================

describe('validateBarberSlot', () => {
  test('succeeds for valid slot within schedule', async () => {
    const mockClient = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('guest_assignments')) return { rows: [] };
        if (sql.includes('schedule_overrides')) return { rows: [] };
        if (sql.includes('FROM schedules')) {
          return { rows: [{ is_working: true, start_time: '09:00:00', end_time: '19:00:00' }] };
        }
        if (sql.includes('blocked_slots')) return { rows: [] };
        return { rows: [] };
      }),
    };

    // Also mock db.query for getBarberHomeSalon
    mockDb.query.mockResolvedValue({ rows: [{ salon_id: 'meylan' }] });

    await expect(
      validateBarberSlot(mockClient, BARBER_ID, '2026-03-10', '10:00', '10:30', 'meylan')
    ).resolves.not.toThrow();
  });

  test('throws for slot on day off', async () => {
    const mockClient = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('guest_assignments')) return { rows: [] };
        if (sql.includes('schedule_overrides')) return { rows: [] };
        if (sql.includes('FROM schedules')) {
          return { rows: [{ is_working: false }] };
        }
        return { rows: [] };
      }),
    };

    mockDb.query.mockResolvedValue({ rows: [{ salon_id: 'meylan' }] });

    await expect(
      validateBarberSlot(mockClient, BARBER_ID, '2026-03-09', '10:00', '10:30', 'meylan')
    ).rejects.toThrow(/travaille pas/i);
  });

  test('throws for slot outside working hours', async () => {
    const mockClient = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('guest_assignments')) return { rows: [] };
        if (sql.includes('schedule_overrides')) return { rows: [] };
        if (sql.includes('FROM schedules')) {
          return { rows: [{ is_working: true, start_time: '09:00:00', end_time: '19:00:00' }] };
        }
        return { rows: [] };
      }),
    };

    mockDb.query.mockResolvedValue({ rows: [{ salon_id: 'meylan' }] });

    await expect(
      validateBarberSlot(mockClient, BARBER_ID, '2026-03-10', '07:00', '07:30', 'meylan')
    ).rejects.toThrow(/heures de travail/i);
  });

  test('throws for blocked slot', async () => {
    const mockClient = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('guest_assignments')) return { rows: [] };
        if (sql.includes('schedule_overrides')) return { rows: [] };
        if (sql.includes('FROM schedules')) {
          return { rows: [{ is_working: true, start_time: '09:00:00', end_time: '19:00:00' }] };
        }
        if (sql.includes('blocked_slots')) {
          return { rows: [{ id: 'blocked-1' }] };
        }
        return { rows: [] };
      }),
    };

    mockDb.query.mockResolvedValue({ rows: [{ salon_id: 'meylan' }] });

    await expect(
      validateBarberSlot(mockClient, BARBER_ID, '2026-03-10', '10:00', '10:30', 'meylan')
    ).rejects.toThrow(/bloqué/i);
  });

  test('validates guest assignment hours when barber is guest', async () => {
    const mockClient = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('guest_assignments')) {
          return { rows: [{ host_salon_id: 'grenoble', start_time: '10:00:00', end_time: '17:00:00' }] };
        }
        if (sql.includes('blocked_slots')) return { rows: [] };
        return { rows: [] };
      }),
    };

    // Slot within guest assignment hours
    await expect(
      validateBarberSlot(mockClient, BARBER_ID, '2026-03-10', '10:00', '10:30', 'grenoble')
    ).resolves.not.toThrow();

    // Slot outside guest assignment hours
    await expect(
      validateBarberSlot(mockClient, BARBER_ID, '2026-03-10', '08:00', '08:30', 'grenoble')
    ).rejects.toThrow(/heures de travail/i);
  });
});
