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
    'SELECT name, price, duration, duration_saturday, time_restrictions FROM services WHERE id = $1 AND deleted_at IS NULL',
    [serviceId]
  );
  if (serviceResult.rows.length === 0) {
    return [];
  }

  // Check if date is Saturday (dayOfWeek 5) → use saturday-specific duration if set
  const dateObj = new Date(date + 'T00:00:00');
  const jsDay = dateObj.getDay(); // 0=Sunday
  const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // Convert to 0=Monday
  const isSaturday = dayOfWeek === 5;
  const duration = (isSaturday && serviceResult.rows[0].duration_saturday)
    ? serviceResult.rows[0].duration_saturday
    : serviceResult.rows[0].duration;

  // Check time restrictions (service available only on certain days/times)
  const timeRestrictions = serviceResult.rows[0].time_restrictions;
  let restrictionWindow = null;
  if (timeRestrictions && timeRestrictions.length > 0) {
    const restriction = timeRestrictions.find(r => r.day_of_week === dayOfWeek);
    if (!restriction) return []; // Service not available this day
    restrictionWindow = {
      start: timeToMinutes(restriction.start_time || '00:00'),
      end: timeToMinutes(restriction.end_time || '23:59'),
    };
  }

  // 2. Determine which barbers to check
  const salonId = options.salonId || 'meylan';
  let barberIds;
  if (barberId === 'any') {
    // Find all equivalent services (same name + price) to handle cases where
    // different barbers have the same service under different IDs
    const serviceName = serviceResult.rows[0].name;
    const servicePrice = serviceResult.rows[0].price;
    const equivResult = await db.query(
      `SELECT id FROM services WHERE name = $1 AND price = $2 AND deleted_at IS NULL`,
      [serviceName, servicePrice]
    );
    const equivalentServiceIds = equivResult.rows.map(r => r.id);

    // Resident barbers that offer any equivalent service
    const barbersResult = await db.query(
      `SELECT DISTINCT b.id FROM barbers b
       JOIN barber_services bs ON b.id = bs.barber_id
       WHERE bs.service_id = ANY($1) AND b.is_active = true AND b.deleted_at IS NULL AND b.salon_id = $2
       ORDER BY b.id`,
      [equivalentServiceIds, salonId]
    );
    barberIds = barbersResult.rows.map((r) => r.id);

    // Also include guest barbers that have an assignment in this salon on this date
    // and offer any equivalent service
    const guestResult = await db.query(
      `SELECT DISTINCT b.id FROM barbers b
       JOIN guest_assignments ga ON b.id = ga.barber_id
       JOIN barber_services bs ON b.id = bs.barber_id
       WHERE bs.service_id = ANY($1) AND b.is_active = true AND b.deleted_at IS NULL
         AND ga.host_salon_id = $2 AND ga.date = $3
         AND b.salon_id != $2`,
      [equivalentServiceIds, salonId, date]
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

  // 3. dayOfWeek already computed above

  // 4. For each barber, compute available slots
  const allSlots = [];

  // For time-restricted services, use service duration as slot interval for optimal packing
  const slotStep = restrictionWindow ? duration : undefined;

  // Check per-barber service restrictions (e.g. Tom can't do student cuts on Friday PM / Saturday)
  const restrictionsResult = await db.query(
    `SELECT barber_id, start_time, end_time FROM service_restrictions
     WHERE service_id = $1 AND day_of_week = $2 AND salon_id = $3`,
    [serviceId, dayOfWeek, salonId]
  );
  const barberRestrictions = {};
  for (const r of restrictionsResult.rows) {
    barberRestrictions[r.barber_id] = { start: timeToMinutes(r.start_time.slice(0, 5)), end: timeToMinutes(r.end_time.slice(0, 5)) };
  }

  for (const bId of barberIds) {
    // Skip barber entirely if restricted for the whole day
    const restriction = barberRestrictions[bId];
    if (restriction && restriction.start === 0 && restriction.end >= 1439) continue;

    const slots = await getSlotsForBarber(bId, date, dayOfWeek, duration, { ...options, salonId, slotStep });

    // Filter out restricted time windows for this barber
    if (restriction) {
      allSlots.push(...slots.filter(s => {
        const slotMin = timeToMinutes(s.time);
        return slotMin < restriction.start || slotMin >= restriction.end;
      }));
    } else {
      allSlots.push(...slots);
    }
  }

  // 5. Sort by time, then by barber sort order
  allSlots.sort((a, b) => a.time.localeCompare(b.time));

  // 6. Apply time restriction window (filter slots outside allowed hours)
  if (restrictionWindow) {
    return allSlots.filter(slot => {
      const slotStart = timeToMinutes(slot.time);
      const slotEnd = slotStart + duration;
      return slotStart >= restrictionWindow.start && slotEnd <= restrictionWindow.end;
    });
  }

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

  const allOccupied = [...existingBookings, ...blockedSlots].sort((a, b) => a.start - b.start);
  const step = options.slotStep || (options.adminMode ? SLOT_INTERVAL_ADMIN : duration);

  if (options.adminMode) {
    // Admin: 5-min grid from schedule start + gap-fill after each booking
    for (let slotStart = startMin; slotStart + duration <= endMin; slotStart += step) {
      tryAddSlot(slotStart);
    }
    for (const occupied of allOccupied) {
      tryAddSlot(occupied.end);
    }
  } else {
    // Public: gap-based generation — fill each gap from its start
    // Adapts to any mix of service durations (20min, 30min, etc.)
    // Guarantees back-to-back slots with zero small gaps

    // Merge overlapping occupied ranges
    const merged = [];
    for (const range of allOccupied) {
      if (merged.length > 0 && range.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, range.end);
      } else {
        merged.push({ start: range.start, end: range.end });
      }
    }

    // Fill each gap from its start with step = service duration
    let gapStart = startMin;
    for (const range of merged) {
      for (let s = gapStart; s + duration <= range.start; s += step) {
        tryAddSlot(s);
      }
      gapStart = Math.max(gapStart, range.end);
    }
    // Fill gap after last occupied range
    for (let s = gapStart; s + duration <= endMin; s += step) {
      tryAddSlot(s);
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

  // Find all equivalent services (same name + price) to handle cases where
  // different barbers have the same service under different IDs
  const svcResult = await queryFn(
    'SELECT name, price FROM services WHERE id = $1 AND deleted_at IS NULL',
    [serviceId]
  );
  let equivalentServiceIds = [serviceId];
  if (svcResult.rows.length > 0) {
    const equivResult = await queryFn(
      `SELECT id FROM services WHERE name = $1 AND price = $2 AND deleted_at IS NULL`,
      [svcResult.rows[0].name, svcResult.rows[0].price]
    );
    equivalentServiceIds = equivResult.rows.map(r => r.id);
  }

  // Get resident barbers that offer any equivalent service in this salon
  const barbersResult = await queryFn(
    `SELECT DISTINCT b.id, b.name, b.sort_order FROM barbers b
     JOIN barber_services bs ON b.id = bs.barber_id
     WHERE bs.service_id = ANY($1) AND b.is_active = true AND b.deleted_at IS NULL AND b.salon_id = $2
     ORDER BY b.sort_order, b.id`,
    [equivalentServiceIds, salonId]
  );

  // Get guest barbers for this date+salon that offer any equivalent service
  const guestResult = await queryFn(
    `SELECT DISTINCT b.id, b.name, b.sort_order FROM barbers b
     JOIN guest_assignments ga ON b.id = ga.barber_id
     JOIN barber_services bs ON b.id = bs.barber_id
     WHERE bs.service_id = ANY($1) AND b.is_active = true AND b.deleted_at IS NULL
       AND ga.host_salon_id = $2 AND ga.date = $3
       AND b.salon_id != $2`,
    [equivalentServiceIds, salonId, date]
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
    // Higher sort_order = preferred for "any barber" (appears to have fewer bookings)
    // Lucas sort_order=2 gets -1 advantage vs Julien sort_order=1
    const priority = barber.sort_order || 0;
    const weightedCount = count - (priority * 0.5);
    if (weightedCount < fewestBookings) {
      fewestBookings = weightedCount;
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

/**
 * Get month-level availability summary (batch — max 7 queries)
 * Returns { "YYYY-MM-DD": { total, status, alternatives? } } for each day of the month
 */
async function getMonthAvailabilitySummary(serviceId, year, month, barberId, salonId, includeAlternatives = false) {
  // 1. Get service duration
  const serviceResult = await db.query(
    'SELECT name, price, duration, duration_saturday, time_restrictions FROM services WHERE id = $1 AND deleted_at IS NULL',
    [serviceId]
  );
  if (serviceResult.rows.length === 0) return {};
  const service = serviceResult.rows[0];

  // 2. Get barber IDs
  let barberIds;
  let specificBarber = false;
  if (!barberId || barberId === 'any') {
    // Find all equivalent services (same name + price) to handle cases where
    // different barbers have the same service under different IDs
    const equivResult = await db.query(
      `SELECT id FROM services WHERE name = $1 AND price = $2 AND deleted_at IS NULL`,
      [service.name, service.price]
    );
    const equivalentServiceIds = equivResult.rows.map(r => r.id);

    const barbersResult = await db.query(
      `SELECT DISTINCT b.id, b.name, b.salon_id FROM barbers b
       JOIN barber_services bs ON b.id = bs.barber_id
       WHERE bs.service_id = ANY($1) AND b.is_active = true AND b.deleted_at IS NULL AND b.salon_id = $2
       ORDER BY b.id`,
      [equivalentServiceIds, salonId]
    );
    barberIds = barbersResult.rows.map(r => r.id);
  } else {
    barberIds = [barberId];
    specificBarber = true;
  }
  if (barberIds.length === 0) return {};

  // Date range for the month
  const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDayNum = new Date(year, month + 1, 0).getDate();
  const lastDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;

  // 3. Get all schedules for these barbers
  const schedulesResult = await db.query(
    `SELECT barber_id, day_of_week, start_time, end_time, is_working, break_start, break_end
     FROM schedules WHERE barber_id = ANY($1) AND salon_id = $2`,
    [barberIds, salonId]
  );
  const schedulesMap = {}; // { barber_id: { day_of_week: { start_time, end_time, is_working, break_start, break_end } } }
  for (const row of schedulesResult.rows) {
    if (!schedulesMap[row.barber_id]) schedulesMap[row.barber_id] = {};
    schedulesMap[row.barber_id][row.day_of_week] = row;
  }

  // 4. Get schedule overrides for the month
  const overridesResult = await db.query(
    `SELECT barber_id, date, is_day_off, start_time, end_time
     FROM schedule_overrides WHERE barber_id = ANY($1) AND date >= $2 AND date <= $3 AND salon_id = $4`,
    [barberIds, firstDay, lastDay, salonId]
  );
  const overridesMap = {}; // { barber_id: { "YYYY-MM-DD": { is_day_off, start_time, end_time } } }
  for (const row of overridesResult.rows) {
    if (!overridesMap[row.barber_id]) overridesMap[row.barber_id] = {};
    overridesMap[row.barber_id][row.date] = row;
  }

  // 5. Get guest assignments for the month
  const guestResult = await db.query(
    `SELECT barber_id, date, host_salon_id, start_time, end_time
     FROM guest_assignments WHERE date >= $1 AND date <= $2
       AND (barber_id = ANY($3) OR host_salon_id = $4)`,
    [firstDay, lastDay, barberIds, salonId]
  );
  const guestMap = {}; // { barber_id: { "YYYY-MM-DD": { host_salon_id, start_time, end_time } } }
  for (const row of guestResult.rows) {
    if (!guestMap[row.barber_id]) guestMap[row.barber_id] = {};
    guestMap[row.barber_id][row.date] = row;
  }

  // Also collect guest barbers visiting this salon (for alternatives)
  const guestVisitors = {};
  for (const row of guestResult.rows) {
    if (row.host_salon_id === salonId && !barberIds.includes(row.barber_id)) {
      if (!guestVisitors[row.date]) guestVisitors[row.date] = [];
      guestVisitors[row.date].push(row);
    }
  }

  // 6. Get ALL bookings for these barbers for the month
  const bookingsResult = await db.query(
    `SELECT barber_id, date, start_time, end_time
     FROM bookings WHERE barber_id = ANY($1) AND date >= $2 AND date <= $3
       AND status != 'cancelled' AND deleted_at IS NULL
     ORDER BY start_time`,
    [barberIds, firstDay, lastDay]
  );
  const bookingsMap = {}; // { barber_id: { "YYYY-MM-DD": [{ start, end }] } }
  for (const row of bookingsResult.rows) {
    if (!bookingsMap[row.barber_id]) bookingsMap[row.barber_id] = {};
    if (!bookingsMap[row.barber_id][row.date]) bookingsMap[row.barber_id][row.date] = [];
    bookingsMap[row.barber_id][row.date].push({
      start: timeToMinutes(row.start_time),
      end: timeToMinutes(row.end_time),
    });
  }

  // 7. Get ALL blocked slots for the month
  const blockedResult = await db.query(
    `SELECT barber_id, date, start_time, end_time
     FROM blocked_slots WHERE barber_id = ANY($1) AND date >= $2 AND date <= $3
     ORDER BY start_time`,
    [barberIds, firstDay, lastDay]
  );
  const blockedMap = {}; // { barber_id: { "YYYY-MM-DD": [{ start, end }] } }
  for (const row of blockedResult.rows) {
    if (!blockedMap[row.barber_id]) blockedMap[row.barber_id] = {};
    if (!blockedMap[row.barber_id][row.date]) blockedMap[row.barber_id][row.date] = [];
    blockedMap[row.barber_id][row.date].push({
      start: timeToMinutes(row.start_time),
      end: timeToMinutes(row.end_time),
    });
  }

  // For alternatives: get all barbers in this salon (not just selected)
  let altBarbers = [];
  if (includeAlternatives && specificBarber) {
    // Find equivalent services for alternative barber lookup
    const altEquivResult = await db.query(
      `SELECT id FROM services WHERE name = $1 AND price = $2 AND deleted_at IS NULL`,
      [service.name, service.price]
    );
    const altEquivIds = altEquivResult.rows.map(r => r.id);

    const altResult = await db.query(
      `SELECT DISTINCT b.id, b.name FROM barbers b
       JOIN barber_services bs ON b.id = bs.barber_id
       WHERE bs.service_id = ANY($1) AND b.is_active = true AND b.deleted_at IS NULL
         AND b.salon_id = $2 AND b.id != $3
       ORDER BY b.id`,
      [altEquivIds, salonId, barberId]
    );
    altBarbers = altResult.rows;

    // Pre-fetch data for alternative barbers too
    const altIds = altBarbers.map(b => b.id);
    if (altIds.length > 0) {
      const altSched = await db.query(
        `SELECT barber_id, day_of_week, start_time, end_time, is_working, break_start, break_end
         FROM schedules WHERE barber_id = ANY($1) AND salon_id = $2`,
        [altIds, salonId]
      );
      for (const row of altSched.rows) {
        if (!schedulesMap[row.barber_id]) schedulesMap[row.barber_id] = {};
        schedulesMap[row.barber_id][row.day_of_week] = row;
      }
      const altOverrides = await db.query(
        `SELECT barber_id, date, is_day_off, start_time, end_time
         FROM schedule_overrides WHERE barber_id = ANY($1) AND date >= $2 AND date <= $3 AND salon_id = $4`,
        [altIds, firstDay, lastDay, salonId]
      );
      for (const row of altOverrides.rows) {
        if (!overridesMap[row.barber_id]) overridesMap[row.barber_id] = {};
        overridesMap[row.barber_id][row.date] = row;
      }
      const altBookings = await db.query(
        `SELECT barber_id, date, start_time, end_time
         FROM bookings WHERE barber_id = ANY($1) AND date >= $2 AND date <= $3
           AND status != 'cancelled' AND deleted_at IS NULL ORDER BY start_time`,
        [altIds, firstDay, lastDay]
      );
      for (const row of altBookings.rows) {
        if (!bookingsMap[row.barber_id]) bookingsMap[row.barber_id] = {};
        if (!bookingsMap[row.barber_id][row.date]) bookingsMap[row.barber_id][row.date] = [];
        bookingsMap[row.barber_id][row.date].push({
          start: timeToMinutes(row.start_time),
          end: timeToMinutes(row.end_time),
        });
      }
      const altBlocked = await db.query(
        `SELECT barber_id, date, start_time, end_time
         FROM blocked_slots WHERE barber_id = ANY($1) AND date >= $2 AND date <= $3 ORDER BY start_time`,
        [altIds, firstDay, lastDay]
      );
      for (const row of altBlocked.rows) {
        if (!blockedMap[row.barber_id]) blockedMap[row.barber_id] = {};
        if (!blockedMap[row.barber_id][row.date]) blockedMap[row.barber_id][row.date] = [];
        blockedMap[row.barber_id][row.date].push({
          start: timeToMinutes(row.start_time),
          end: timeToMinutes(row.end_time),
        });
      }
      const altGuest = await db.query(
        `SELECT barber_id, date, host_salon_id, start_time, end_time
         FROM guest_assignments WHERE barber_id = ANY($1) AND date >= $2 AND date <= $3`,
        [altIds, firstDay, lastDay]
      );
      for (const row of altGuest.rows) {
        if (!guestMap[row.barber_id]) guestMap[row.barber_id] = {};
        guestMap[row.barber_id][row.date] = row;
      }
    }
  }

  // Now calculate availability for each date
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const result = {};

  for (let d = 1; d <= lastDayNum; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(year, month, d);
    dateObj.setHours(0, 0, 0, 0);
    const jsDay = dateObj.getDay();
    const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // 0=Monday
    const isSaturday = dayOfWeek === 5;

    // Skip past dates
    if (dateStr < todayStr) continue;

    const duration = (isSaturday && service.duration_saturday)
      ? service.duration_saturday
      : service.duration;

    // Check time restrictions
    const timeRestrictions = service.time_restrictions;
    let restrictionWindow = null;
    if (timeRestrictions && timeRestrictions.length > 0) {
      const restriction = timeRestrictions.find(r => r.day_of_week === dayOfWeek);
      if (!restriction) {
        result[dateStr] = { total: 0, status: 'full' };
        continue;
      }
      restrictionWindow = {
        start: timeToMinutes(restriction.start_time || '00:00'),
        end: timeToMinutes(restriction.end_time || '23:59'),
      };
    }

    // Min slot start for today
    const minSlotStart = dateStr === todayStr ? nowMinutes + MIN_BOOKING_LEAD_MINUTES : 0;

    let totalSlots = 0;

    for (const bId of barberIds) {
      const count = countSlotsForBarber(bId, dateStr, dayOfWeek, duration, minSlotStart,
        schedulesMap, overridesMap, guestMap, bookingsMap, blockedMap, salonId, restrictionWindow);
      totalSlots += count;
    }

    const entry = {
      total: totalSlots,
      status: totalSlots >= 4 ? 'available' : totalSlots > 0 ? 'low' : 'full',
    };

    // Alternatives when full and specific barber
    if (entry.status === 'full' && includeAlternatives && specificBarber && altBarbers.length > 0) {
      const alternatives = [];
      for (const alt of altBarbers) {
        const altCount = countSlotsForBarber(alt.id, dateStr, dayOfWeek, duration, minSlotStart,
          schedulesMap, overridesMap, guestMap, bookingsMap, blockedMap, salonId, restrictionWindow);
        if (altCount > 0) {
          const sampleTimes = getSampleTimesForBarber(alt.id, dateStr, dayOfWeek, duration, minSlotStart,
            schedulesMap, overridesMap, guestMap, bookingsMap, blockedMap, salonId, restrictionWindow, 3);
          alternatives.push({
            barber_id: alt.id,
            barber_name: alt.name,
            slot_count: altCount,
            sample_times: sampleTimes,
          });
        }
      }
      if (alternatives.length > 0) {
        entry.alternatives = alternatives;
      }
    }

    result[dateStr] = entry;
  }

  return result;
}

/**
 * Count available slots for a barber on a date using pre-fetched data (no DB queries)
 */
function countSlotsForBarber(barberId, dateStr, dayOfWeek, duration, minSlotStart,
  schedulesMap, overridesMap, guestMap, bookingsMap, blockedMap, salonId, restrictionWindow) {
  const times = getWorkingHours(barberId, dateStr, dayOfWeek, schedulesMap, overridesMap, guestMap, salonId);
  if (!times) return 0;

  const { startMin, endMin, blockedRanges } = times;
  const existingBookings = (bookingsMap[barberId] && bookingsMap[barberId][dateStr]) || [];
  const blockedSlots = (blockedMap[barberId] && blockedMap[barberId][dateStr]) || [];
  const allBlocked = [...blockedSlots, ...blockedRanges];

  let count = 0;
  const slotSet = new Set();
  const step = duration; // Use service duration as step (matches generateSlots)

  function tryCount(s) {
    if (s < minSlotStart || slotSet.has(s)) return;
    if (restrictionWindow && (s < restrictionWindow.start || s + duration > restrictionWindow.end)) return;
    const e = s + duration;
    if (e > endMin) return;
    const overlapsBooking = existingBookings.some(b => s < b.end && e > b.start);
    const overlapsBlocked = allBlocked.some(b => s < b.end && e > b.start);
    if (!overlapsBooking && !overlapsBlocked) { slotSet.add(s); count++; }
  }

  // Grid slots
  for (let slotStart = startMin; slotStart + duration <= endMin; slotStart += step) {
    tryCount(slotStart);
  }
  // Gap-fill: right after occupied blocks
  const allOccupied = [...existingBookings, ...allBlocked].sort((a, b) => a.start - b.start);
  for (const occ of allOccupied) { tryCount(occ.end); }

  // Remove grid slots that would create gaps after gap-fill slots
  for (const occ of allOccupied) {
    if (slotSet.has(occ.end) && (occ.end - startMin) % step !== 0) {
      for (const s of [...slotSet]) {
        if (s !== occ.end && occ.end < s && s - occ.end < step) {
          slotSet.delete(s);
          count--;
        }
      }
    }
  }

  return count;
}

/**
 * Get sample times for a barber (for alternatives display)
 */
function getSampleTimesForBarber(barberId, dateStr, dayOfWeek, duration, minSlotStart,
  schedulesMap, overridesMap, guestMap, bookingsMap, blockedMap, salonId, restrictionWindow, max) {
  const times = getWorkingHours(barberId, dateStr, dayOfWeek, schedulesMap, overridesMap, guestMap, salonId);
  if (!times) return [];

  const { startMin, endMin, blockedRanges } = times;
  const existingBookings = (bookingsMap[barberId] && bookingsMap[barberId][dateStr]) || [];
  const blockedSlots = (blockedMap[barberId] && blockedMap[barberId][dateStr]) || [];
  const allBlocked = [...blockedSlots, ...blockedRanges];

  const samples = [];
  const slotSet = new Set();
  const step = duration;

  function trySample(s) {
    if (samples.length >= max || s < minSlotStart || slotSet.has(s)) return;
    if (restrictionWindow && (s < restrictionWindow.start || s + duration > restrictionWindow.end)) return;
    const e = s + duration;
    if (e > endMin) return;
    const overlapsBooking = existingBookings.some(b => s < b.end && e > b.start);
    const overlapsBlocked = allBlocked.some(b => s < b.end && e > b.start);
    if (!overlapsBooking && !overlapsBlocked) { slotSet.add(s); samples.push(minutesToTime(s)); }
  }

  for (let slotStart = startMin; slotStart + duration <= endMin && samples.length < max; slotStart += step) {
    trySample(slotStart);
  }
  const allOccupied = [...existingBookings, ...allBlocked].sort((a, b) => a.start - b.start);
  for (const occ of allOccupied) { trySample(occ.end); }

  // Remove grid slots that would create gaps after gap-fill slots
  const gfTimes = [];
  for (const occ of allOccupied) {
    if (slotSet.has(occ.end) && (occ.end - startMin) % step !== 0) {
      gfTimes.push(occ.end);
    }
  }
  if (gfTimes.length > 0) {
    return samples.filter(s => {
      const m = timeToMinutes(s);
      return !gfTimes.some(gf => gf < m && m - gf < step);
    }).sort();
  }
  samples.sort();
  return samples;
}

/**
 * Get working hours for a barber on a date using pre-fetched data
 * Returns { startMin, endMin, blockedRanges } or null if not working
 */
function getWorkingHours(barberId, dateStr, dayOfWeek, schedulesMap, overridesMap, guestMap, salonId) {
  // Check guest assignment
  const guest = guestMap[barberId] && guestMap[barberId][dateStr];
  if (guest) {
    if (guest.host_salon_id === salonId) {
      return {
        startMin: timeToMinutes(guest.start_time),
        endMin: timeToMinutes(guest.end_time),
        blockedRanges: [],
      };
    }
    // Guest elsewhere → not available
    return null;
  }

  // Check override
  const override = overridesMap[barberId] && overridesMap[barberId][dateStr];
  if (override) {
    if (override.is_day_off) return null;
    return {
      startMin: timeToMinutes(override.start_time),
      endMin: timeToMinutes(override.end_time),
      blockedRanges: [],
    };
  }

  // Default schedule
  const sched = schedulesMap[barberId] && schedulesMap[barberId][dayOfWeek];
  if (!sched || !sched.is_working) return null;

  const blockedRanges = [];
  if (sched.break_start && sched.break_end) {
    blockedRanges.push({
      start: timeToMinutes(sched.break_start),
      end: timeToMinutes(sched.break_end),
    });
  }

  return {
    startMin: timeToMinutes(sched.start_time),
    endMin: timeToMinutes(sched.end_time),
    blockedRanges,
  };
}

module.exports = {
  getAvailableSlots,
  isSlotAvailable,
  findBestBarber,
  addMinutesToTime,
  validateBarberSlot,
  getMonthAvailabilitySummary,
};
