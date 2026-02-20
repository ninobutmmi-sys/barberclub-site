const db = require('../config/database');
const logger = require('../utils/logger');

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
  let barberIds;
  if (barberId === 'any') {
    // Get all active barbers that offer this service
    const barbersResult = await db.query(
      `SELECT b.id FROM barbers b
       JOIN barber_services bs ON b.id = bs.barber_id
       WHERE bs.service_id = $1 AND b.is_active = true AND b.deleted_at IS NULL
       ORDER BY b.sort_order`,
      [serviceId]
    );
    barberIds = barbersResult.rows.map((r) => r.id);
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
    const slots = await getSlotsForBarber(bId, date, dayOfWeek, duration, options);
    allSlots.push(...slots);
  }

  // 5. Sort by time, then by barber sort order
  allSlots.sort((a, b) => a.time.localeCompare(b.time));

  return allSlots;
}

/**
 * Get available slots for a single barber on a date
 */
async function getSlotsForBarber(barberId, date, dayOfWeek, duration, options = {}) {
  // Check for schedule override first
  const overrideResult = await db.query(
    `SELECT start_time, end_time, is_day_off
     FROM schedule_overrides
     WHERE barber_id = $1 AND date = $2`,
    [barberId, date]
  );

  let startTime, endTime;

  if (overrideResult.rows.length > 0) {
    const override = overrideResult.rows[0];
    if (override.is_day_off) return []; // Day off
    startTime = override.start_time;
    endTime = override.end_time;
  } else {
    // Use default schedule
    const scheduleResult = await db.query(
      `SELECT start_time, end_time, is_working
       FROM schedules
       WHERE barber_id = $1 AND day_of_week = $2`,
      [barberId, dayOfWeek]
    );

    if (scheduleResult.rows.length === 0 || !scheduleResult.rows[0].is_working) {
      return []; // Not working this day
    }

    startTime = scheduleResult.rows[0].start_time;
    endTime = scheduleResult.rows[0].end_time;
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

  // Get barber name for the response
  const barberResult = await db.query(
    'SELECT name FROM barbers WHERE id = $1',
    [barberId]
  );
  const barberName = barberResult.rows[0]?.name || '';

  // Generate all possible slots
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const slots = [];

  // Slots every 30 min for clients (public API), every 5 min for admin
  const step = options.adminMode ? 5 : 30;
  for (let slotStart = startMin; slotStart + duration <= endMin; slotStart += step) {
    const slotEnd = slotStart + duration;

    // Check if slot overlaps with any existing booking or blocked slot
    const overlapsBooking = existingBookings.some(
      (booking) => slotStart < booking.end && slotEnd > booking.start
    );
    const overlapsBlocked = blockedSlots.some(
      (blocked) => slotStart < blocked.end && slotEnd > blocked.start
    );

    if (!overlapsBooking && !overlapsBlocked) {
      slots.push({
        time: minutesToTime(slotStart),
        barber_id: barberId,
        barber_name: barberName,
      });
    }
  }

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
async function isSlotAvailable(barberId, date, startTime, duration, client = null) {
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

  // Also check blocked slots
  const blockedCheck = await queryFn(
    `SELECT id FROM blocked_slots
     WHERE barber_id = $1 AND date = $2
       AND start_time < $3 AND end_time > $4`,
    [barberId, date, endTime, startTime]
  );
  return blockedCheck.rows.length === 0;
}

/**
 * For "any barber" mode: find the best barber for a given slot
 * Prefers the barber with fewer bookings that day (load balancing)
 */
async function findBestBarber(serviceId, date, startTime, duration) {
  // Get all barbers that offer this service
  const barbersResult = await db.query(
    `SELECT b.id, b.name FROM barbers b
     JOIN barber_services bs ON b.id = bs.barber_id
     WHERE bs.service_id = $1 AND b.is_active = true AND b.deleted_at IS NULL
     ORDER BY b.sort_order`,
    [serviceId]
  );

  const endTime = addMinutesToTime(startTime, duration);
  let bestBarber = null;
  let fewestBookings = Infinity;

  for (const barber of barbersResult.rows) {
    // Check if this barber is available at this time
    const available = await isSlotAvailable(barber.id, date, startTime, duration);
    if (!available) continue;

    // Count their bookings for the day
    const countResult = await db.query(
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
};
