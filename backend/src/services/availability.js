const db = require('../config/database');
const { ApiError } = require('../utils/errors');
const {
  SLOT_INTERVAL_PUBLIC,
  SLOT_INTERVAL_ADMIN,
  ADMIN_SCHEDULE_END,
  MIN_BOOKING_LEAD_MINUTES,
} = require('../constants');

/**
 * Check if a barber has a guest assignment on a given date
 * @returns {object|null} { host_salon_id, start_time, end_time } or null
 */
async function getGuestAssignment(barberId, date, queryFn = null) {
  const fn = queryFn || db.query;
  const result = await fn(
    'SELECT host_salon_id, start_time, end_time FROM guest_assignments WHERE barber_id = $1 AND date = $2',
    [barberId, date]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Get the home salon_id for a barber
 */
async function getBarberHomeSalon(barberId) {
  const result = await db.query('SELECT salon_id FROM barbers WHERE id = $1', [barberId]);
  return result.rows[0]?.salon_id || null;
}

/**
 * Get available time slots for a barber on a specific date
 * @param {string} barberId - Barber UUID (or 'any' for all barbers)
 * @param {string} serviceId - Service UUID (to know duration)
 * @param {string} date - Date string YYYY-MM-DD
 * @returns {Array} Available slots: [{ time: "09:00", barber_id, barber_name }]
 */
async function getAvailableSlots(barberId, serviceId, date, options = {}) {
  // 1. Get service duration
  const serviceResult = await db.query(
    'SELECT duration FROM services WHERE id = $1 AND deleted_at IS NULL',
    [serviceId]
  );
  if (serviceResult.rows.length === 0) {
    return [];
  }
  const duration = serviceResult.rows[0].duration;

  // 2. Determine which barbers to check
  const salonId = options.salonId || 'meylan';
  let barberIds;
  if (barberId === 'any') {
    // Resident barbers that offer this service
    const barbersResult = await db.query(
      `SELECT b.id FROM barbers b
       JOIN barber_services bs ON b.id = bs.barber_id
       WHERE bs.service_id = $1 AND b.is_active = true AND b.deleted_at IS NULL AND b.salon_id = $2
       ORDER BY b.sort_order`,
      [serviceId, salonId]
    );
    barberIds = barbersResult.rows.map((r) => r.id);

    // Also include guest barbers that have an assignment in this salon on this date
    // and offer this service (in their home salon)
    const guestResult = await db.query(
      `SELECT DISTINCT b.id FROM barbers b
       JOIN guest_assignments ga ON b.id = ga.barber_id
       JOIN barber_services bs ON b.id = bs.barber_id
       WHERE bs.service_id = $1 AND b.is_active = true AND b.deleted_at IS NULL
         AND ga.host_salon_id = $2 AND ga.date = $3
         AND b.salon_id != $2`,
      [serviceId, salonId, date]
    );
    const guestIds = guestResult.rows.map((r) => r.id);
    // Merge without duplicates
    for (const gId of guestIds) {
      if (!barberIds.includes(gId)) barberIds.push(gId);
    }
  } else {
    barberIds = [barberId];
  }

  if (barberIds.length === 0) return [];

  // 3. Get JS day of week (0=Monday ... 6=Sunday) from date
  const dateObj = new Date(date + 'T00:00:00');
  const jsDay = dateObj.getDay(); // 0=Sunday
  const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // Convert to 0=Monday

  // 4. For each barber, compute available slots
  const allSlots = [];

  for (const bId of barberIds) {
    const slots = await getSlotsForBarber(bId, date, dayOfWeek, duration, { ...options, salonId });
    allSlots.push(...slots);
  }

  // 5. Sort by time, then by barber sort order
  allSlots.sort((a, b) => a.time.localeCompare(b.time));

  return allSlots;
}

/**
 * Get available slots for a single barber on a date
 * Now handles guest assignments:
 * - If barber is a guest in THIS salon on this date → use guest_assignment hours
 * - If barber is a resident but has a guest_assignment ELSEWHERE → return [] (absent)
 * - Otherwise → normal schedule logic
 */
async function getSlotsForBarber(barberId, date, dayOfWeek, duration, options = {}) {
  const salonId = options.salonId || 'meylan';

  // Check guest assignment for this barber on this date
  const guestAssignment = await getGuestAssignment(barberId, date);

  if (guestAssignment) {
    const homeSalon = await getBarberHomeSalon(barberId);
    if (guestAssignment.host_salon_id === salonId) {
      // Barber is a guest HERE today → use guest assignment hours
      return await generateSlots(barberId, date, guestAssignment.start_time, guestAssignment.end_time, duration, options);
    } else if (homeSalon === salonId) {
      // Barber is a resident here but is guesting ELSEWHERE → absent
      return [];
    }
    // Barber is guesting somewhere else and we're not that salon nor their home → skip
    return [];
  }

  // No guest assignment → normal schedule logic (only if barber belongs to this salon)
  const homeSalon = await getBarberHomeSalon(barberId);
  if (homeSalon !== salonId) {
    // Barber doesn't belong to this salon and has no guest assignment here today
    return [];
  }

  // Check for schedule override first
  const overrideResult = await db.query(
    `SELECT start_time, end_time, is_day_off
     FROM schedule_overrides
     WHERE barber_id = $1 AND date = $2 AND salon_id = $3`,
    [barberId, date, salonId]
  );

  let startTime, endTime, breakStart = null, breakEnd = null;

  if (overrideResult.rows.length > 0) {
    const override = overrideResult.rows[0];
    if (override.is_day_off) return []; // Day off
    startTime = override.start_time;
    endTime = override.end_time;
  } else {
    // Use default schedule
    const scheduleResult = await db.query(
      `SELECT start_time, end_time, is_working, break_start, break_end
       FROM schedules
       WHERE barber_id = $1 AND day_of_week = $2 AND salon_id = $3`,
      [barberId, dayOfWeek, salonId]
    );

    if (scheduleResult.rows.length === 0 || !scheduleResult.rows[0].is_working) {
      return []; // Not working this day
    }

    startTime = scheduleResult.rows[0].start_time;
    endTime = scheduleResult.rows[0].end_time;
    breakStart = scheduleResult.rows[0].break_start;
    breakEnd = scheduleResult.rows[0].break_end;
  }

  return await generateSlots(barberId, date, startTime, endTime, duration, { ...options, breakStart, breakEnd });
}

/**
 * Generate time slots for a barber given start/end times
 */
async function generateSlots(barberId, date, startTime, endTime, duration, options = {}) {
  // Admin can book up to ADMIN_SCHEDULE_END even if schedule ends earlier
  if (options.adminMode) {
    const endMin = timeToMinutes(endTime);
    if (endMin < timeToMinutes(ADMIN_SCHEDULE_END)) {
      endTime = ADMIN_SCHEDULE_END;
    }
  }

  // Get existing bookings for this barber on this date
  const bookingsResult = await db.query(
    `SELECT start_time, end_time FROM bookings
     WHERE barber_id = $1 AND date = $2
       AND status != 'cancelled' AND deleted_at IS NULL
     ORDER BY start_time`,
    [barberId, date]
  );

  const existingBookings = bookingsResult.rows.map((b) => ({
    start: timeToMinutes(b.start_time),
    end: timeToMinutes(b.end_time),
  }));

  // Get blocked slots for this barber on this date
  const blockedResult = await db.query(
    `SELECT start_time, end_time FROM blocked_slots
     WHERE barber_id = $1 AND date = $2
     ORDER BY start_time`,
    [barberId, date]
  );

  const blockedSlots = blockedResult.rows.map((b) => ({
    start: timeToMinutes(b.start_time),
    end: timeToMinutes(b.end_time),
  }));

  // Add recurring break as a blocked range
  if (options.breakStart && options.breakEnd) {
    blockedSlots.push({
      start: timeToMinutes(options.breakStart),
      end: timeToMinutes(options.breakEnd),
    });
  }

  // Get barber name for the response
  const barberResult = await db.query(
    'SELECT name FROM barbers WHERE id = $1',
    [barberId]
  );
  const barberName = barberResult.rows[0]?.name || '';

  // Generate all possible slots
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const slotSet = new Set(); // track unique start times
  const slots = [];

  // For today: skip slots starting within MIN_BOOKING_LEAD_MINUTES (public only)
  let minSlotStart = 0;
  if (!options.adminMode) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (date === todayStr) {
      minSlotStart = now.getHours() * 60 + now.getMinutes() + MIN_BOOKING_LEAD_MINUTES;
    }
  }

  // Helper: check if a candidate slot is valid and add it
  function tryAddSlot(slotStart) {
    if (slotStart < startMin || slotStart < minSlotStart) return;
    const slotEnd = slotStart + duration;
    if (slotEnd > endMin) return;
    if (slotSet.has(slotStart)) return;

    const overlapsBooking = existingBookings.some(
      (booking) => slotStart < booking.end && slotEnd > booking.start
    );
    const overlapsBlocked = blockedSlots.some(
      (blocked) => slotStart < blocked.end && slotEnd > blocked.start
    );

    if (!overlapsBooking && !overlapsBlocked) {
      slotSet.add(slotStart);
      slots.push({
        time: minutesToTime(slotStart),
        barber_id: barberId,
        barber_name: barberName,
      });
    }
  }

  // 1. Regular grid slots (every SLOT_INTERVAL for public, every 5min for admin)
  const step = options.adminMode ? SLOT_INTERVAL_ADMIN : SLOT_INTERVAL_PUBLIC;
  for (let slotStart = startMin; slotStart + duration <= endMin; slotStart += step) {
    tryAddSlot(slotStart);
  }

  // 2. Gap-filling: propose slots right after each booking/block ends
  if (options.adminMode) {
    // Admin: always show gap-fill slots (5min granularity)
    const allOccupied = [...existingBookings, ...blockedSlots].sort((a, b) => a.start - b.start);
    for (const occupied of allOccupied) {
      tryAddSlot(occupied.end);
    }
  } else {
    // Public: smart gap-fill — only propose an off-grid slot if the next grid slot is already taken.
    // Example: booking ends at 09:20, next grid slot 09:30 is booked → propose 09:20.
    // If 09:30 is free → don't propose 09:20 (client takes 09:30 instead, no gap).
    const allOccupied = [...existingBookings, ...blockedSlots].sort((a, b) => a.start - b.start);
    for (const occupied of allOccupied) {
      const candidate = occupied.end;
      // Skip if already on the grid (already handled above)
      if ((candidate - startMin) % SLOT_INTERVAL_PUBLIC === 0) continue;
      // Find the next grid slot after this candidate
      const nextGrid = startMin + Math.ceil((candidate - startMin) / SLOT_INTERVAL_PUBLIC) * SLOT_INTERVAL_PUBLIC;
      // Check if the next grid slot is blocked by a booking or blocked slot
      const nextGridEnd = nextGrid + duration;
      const nextGridBlocked = existingBookings.some(
        (b) => nextGrid < b.end && nextGridEnd > b.start
      ) || blockedSlots.some(
        (b) => nextGrid < b.end && nextGridEnd > b.start
      );
      if (nextGridBlocked) {
        tryAddSlot(candidate);
      }
    }
  }

  // Sort by time
  slots.sort((a, b) => a.time.localeCompare(b.time));

  return slots;
}

/**
 * Check if a specific slot is still available (used right before booking)
 * @param {string} barberId
 * @param {string} date
 * @param {string} startTime - HH:MM
 * @param {number} duration - minutes
 * @param {object} client - Database client (for transactions)
 * @returns {boolean}
 */
async function isSlotAvailable(barberId, date, startTime, duration, client = null, { isAdmin = false } = {}) {
  const queryFn = client ? client.query.bind(client) : db.query;

  const endTime = addMinutesToTime(startTime, duration);

  // Use FOR UPDATE to lock rows and prevent race conditions
  const lockQuery = client
    ? `SELECT id FROM bookings
       WHERE barber_id = $1 AND date = $2
         AND status != 'cancelled' AND deleted_at IS NULL
         AND start_time < $3 AND end_time > $4
       FOR UPDATE`
    : `SELECT id FROM bookings
       WHERE barber_id = $1 AND date = $2
         AND status != 'cancelled' AND deleted_at IS NULL
         AND start_time < $3 AND end_time > $4`;

  const result = await queryFn(lockQuery, [barberId, date, endTime, startTime]);
  if (result.rows.length > 0) return false;

  // Admin can book over blocked slots and breaks
  if (!isAdmin) {
    // Check blocked slots
    const blockedCheck = await queryFn(
      `SELECT id FROM blocked_slots
       WHERE barber_id = $1 AND date = $2
         AND start_time < $3 AND end_time > $4`,
      [barberId, date, endTime, startTime]
    );
    if (blockedCheck.rows.length > 0) return false;

    // Check recurring break from schedule
    const dateObj = new Date(date + 'T00:00:00');
    const jsDay = dateObj.getDay();
    const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1;
    const homeSalon = await getBarberHomeSalon(barberId);

    const breakCheck = await queryFn(
      `SELECT break_start, break_end FROM schedules
       WHERE barber_id = $1 AND day_of_week = $2 AND salon_id = $3
         AND break_start IS NOT NULL AND break_end IS NOT NULL`,
      [barberId, dayOfWeek, homeSalon]
    );
    if (breakCheck.rows.length > 0) {
      const brk = breakCheck.rows[0];
      const brkStart = timeToMinutes(brk.break_start);
      const brkEnd = timeToMinutes(brk.break_end);
      const slotStart = timeToMinutes(startTime);
      const slotEnd = timeToMinutes(endTime);
      if (slotStart < brkEnd && slotEnd > brkStart) return false;
    }
  }

  return true;
}

/**
 * For "any barber" mode: find the best barber for a given slot
 * Prefers the barber with fewer bookings that day (load balancing)
 * Includes guest barbers assigned to this salon on the given date
 */
async function findBestBarber(serviceId, date, startTime, duration, salonId = 'meylan', dbClient = null) {
  const queryFn = dbClient ? dbClient.query.bind(dbClient) : db.query;

  // Get resident barbers that offer this service in this salon
  const barbersResult = await queryFn(
    `SELECT b.id, b.name FROM barbers b
     JOIN barber_services bs ON b.id = bs.barber_id
     WHERE bs.service_id = $1 AND b.is_active = true AND b.deleted_at IS NULL AND b.salon_id = $2
     ORDER BY b.sort_order`,
    [serviceId, salonId]
  );

  // Get guest barbers for this date+salon that offer this service
  const guestResult = await queryFn(
    `SELECT b.id, b.name FROM barbers b
     JOIN guest_assignments ga ON b.id = ga.barber_id
     JOIN barber_services bs ON b.id = bs.barber_id
     WHERE bs.service_id = $1 AND b.is_active = true AND b.deleted_at IS NULL
       AND ga.host_salon_id = $2 AND ga.date = $3
       AND b.salon_id != $2`,
    [serviceId, salonId, date]
  );

  const allBarbers = [...barbersResult.rows];
  for (const g of guestResult.rows) {
    if (!allBarbers.find(b => b.id === g.id)) allBarbers.push(g);
  }

  const endTime = addMinutesToTime(startTime, duration);
  const dateObj = new Date(date + 'T00:00:00');
  const jsDay = dateObj.getDay();
  const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // 0=Monday

  let bestBarber = null;
  let fewestBookings = Infinity;

  for (const barber of allBarbers) {
    // Check if barber works at this time (schedule/overrides/guest assignments)
    const worksAtTime = await barberWorksAtTime(barber.id, date, dayOfWeek, startTime, endTime, salonId);
    if (!worksAtTime) continue;

    // Check if this barber is available at this time (no conflicting bookings/blocks)
    const available = await isSlotAvailable(barber.id, date, startTime, duration, dbClient);
    if (!available) continue;

    // Count their bookings for the day (load balancing)
    const countResult = await queryFn(
      `SELECT COUNT(*) as count FROM bookings
       WHERE barber_id = $1 AND date = $2
         AND status != 'cancelled' AND deleted_at IS NULL`,
      [barber.id, date]
    );

    const count = parseInt(countResult.rows[0].count, 10);
    if (count < fewestBookings) {
      fewestBookings = count;
      bestBarber = barber;
    }
  }

  return bestBarber;
}

/**
 * Check if a barber works at the given time on a given date
 * Now handles guest assignments
 */
async function barberWorksAtTime(barberId, date, dayOfWeek, startTime, endTime, salonId = null) {
  // Check guest assignment first
  const guestAssignment = await getGuestAssignment(barberId, date);
  if (guestAssignment) {
    if (salonId && guestAssignment.host_salon_id !== salonId) {
      // Barber is guesting elsewhere → not available here
      return false;
    }
    if (salonId && guestAssignment.host_salon_id === salonId) {
      // Barber is guesting here → check guest assignment hours
      return startTime >= guestAssignment.start_time.slice(0, 5) && endTime <= guestAssignment.end_time.slice(0, 5);
    }
    // No salonId context → check guest assignment hours
    return startTime >= guestAssignment.start_time.slice(0, 5) && endTime <= guestAssignment.end_time.slice(0, 5);
  }

  // No guest assignment → check if barber belongs to requested salon
  const homeSalon = salonId ? await getBarberHomeSalon(barberId) : null;
  if (salonId && homeSalon !== salonId) return false;

  // Get salon for schedule lookup (home salon of barber)
  const scheduleSalonId = salonId || await getBarberHomeSalon(barberId);

  // Check schedule override
  const overrideResult = await db.query(
    'SELECT is_day_off, start_time, end_time FROM schedule_overrides WHERE barber_id = $1 AND date = $2 AND salon_id = $3',
    [barberId, date, scheduleSalonId]
  );

  if (overrideResult.rows.length > 0) {
    const ov = overrideResult.rows[0];
    if (ov.is_day_off) return false;
    return startTime >= ov.start_time.slice(0, 5) && endTime <= ov.end_time.slice(0, 5);
  }

  // Check default schedule
  const scheduleResult = await db.query(
    'SELECT start_time, end_time, is_working FROM schedules WHERE barber_id = $1 AND day_of_week = $2 AND salon_id = $3',
    [barberId, dayOfWeek, scheduleSalonId]
  );

  if (scheduleResult.rows.length === 0 || !scheduleResult.rows[0].is_working) return false;

  const sched = scheduleResult.rows[0];
  return startTime >= sched.start_time.slice(0, 5) && endTime <= sched.end_time.slice(0, 5);
}

/**
 * Validate that a barber can accept a booking at the given date/time.
 * Checks: guest assignments, schedule overrides, default schedule, blocked slots.
 * @param {object} dbClient - pg client (inside transaction)
 * @param {string} barberId - Barber UUID
 * @param {string} date - YYYY-MM-DD
 * @param {string} startTime - HH:MM
 * @param {string} endTime - HH:MM
 * @param {string} salonId - optional salon context
 */
async function validateBarberSlot(dbClient, barberId, date, startTime, endTime, salonId = null) {
  const dateObj = new Date(date + 'T00:00:00');
  const jsDay = dateObj.getDay();
  const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // 0=Monday

  // Check guest assignment first
  const gaResult = await dbClient.query(
    'SELECT host_salon_id, start_time, end_time FROM guest_assignments WHERE barber_id = $1 AND date = $2',
    [barberId, date]
  );

  if (gaResult.rows.length > 0) {
    const ga = gaResult.rows[0];
    if (salonId && ga.host_salon_id !== salonId) {
      // Barber is guesting at a different salon → can't book here
      throw ApiError.badRequest('Ce barber est dans un autre salon ce jour');
    }
    // Validate against guest assignment hours
    if (startTime < ga.start_time.slice(0, 5) || endTime > ga.end_time.slice(0, 5)) {
      throw ApiError.badRequest('Horaire en dehors des heures de travail');
    }
  } else {
    // No guest assignment → normal schedule check
    // Check schedule override first
    const validateSalonId = salonId || await getBarberHomeSalon(barberId);
    const overrideCheck = await dbClient.query(
      'SELECT is_day_off, start_time, end_time FROM schedule_overrides WHERE barber_id = $1 AND date = $2 AND salon_id = $3',
      [barberId, date, validateSalonId]
    );

    if (overrideCheck.rows.length > 0) {
      const ov = overrideCheck.rows[0];
      if (ov.is_day_off) {
        throw ApiError.badRequest('Ce barber ne travaille pas ce jour');
      }
      if (startTime < ov.start_time.slice(0, 5) || endTime > ov.end_time.slice(0, 5)) {
        throw ApiError.badRequest('Horaire en dehors des heures de travail');
      }
    } else {
      const scheduleCheck = await dbClient.query(
        'SELECT is_working, start_time, end_time FROM schedules WHERE barber_id = $1 AND day_of_week = $2 AND salon_id = $3',
        [barberId, dayOfWeek, validateSalonId]
      );
      if (scheduleCheck.rows.length === 0 || !scheduleCheck.rows[0].is_working) {
        throw ApiError.badRequest('Ce barber ne travaille pas ce jour');
      }
      const sched = scheduleCheck.rows[0];
      if (startTime < sched.start_time.slice(0, 5) || endTime > sched.end_time.slice(0, 5)) {
        throw ApiError.badRequest('Horaire en dehors des heures de travail');
      }
    }
  }

  // Check blocked slots
  const blockedCheck = await dbClient.query(
    `SELECT id FROM blocked_slots
     WHERE barber_id = $1 AND date = $2
       AND start_time < $3 AND end_time > $4`,
    [barberId, date, endTime, startTime]
  );
  if (blockedCheck.rows.length > 0) {
    throw ApiError.badRequest('Ce créneau est bloqué');
  }

  // Check recurring break from schedule
  const breakCheck = await dbClient.query(
    `SELECT break_start, break_end FROM schedules
     WHERE barber_id = $1 AND day_of_week = $2
       AND break_start IS NOT NULL AND break_end IS NOT NULL
       AND salon_id = $3`,
    [barberId, dayOfWeek, salonId || await getBarberHomeSalon(barberId)]
  );
  if (breakCheck.rows.length > 0) {
    const brk = breakCheck.rows[0];
    if (startTime < brk.break_end.slice(0, 5) && endTime > brk.break_start.slice(0, 5)) {
      throw ApiError.badRequest('Ce créneau chevauche la pause du barber');
    }
  }
}

// ============================================
// Time helpers
// ============================================

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const str = typeof timeStr === 'string' ? timeStr : timeStr.toString();
  const [hours, minutes] = str.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutesToTime(timeStr, minutesToAdd) {
  const totalMinutes = timeToMinutes(timeStr) + minutesToAdd;
  return minutesToTime(totalMinutes);
}

module.exports = {
  getAvailableSlots,
  isSlotAvailable,
  findBestBarber,
  addMinutesToTime,
  validateBarberSlot,
};
