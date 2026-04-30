/**
 * Tasks service — recurrence calculation.
 *
 * Recurrence config shapes:
 *   { unit: 'day',   interval: N }
 *   { unit: 'week',  interval: N, days_of_week: [0..6]  } (0=Mon, 6=Sun)
 *   { unit: 'month', interval: N, day_of_month: 1..31 | 'last' }
 */

const VALID_UNITS = ['day', 'week', 'month'];

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function validateRecurrenceConfig(cfg) {
  if (!isPlainObject(cfg)) return 'recurrence_config must be an object';
  if (!VALID_UNITS.includes(cfg.unit)) return `unit must be one of ${VALID_UNITS.join(', ')}`;
  if (!Number.isInteger(cfg.interval) || cfg.interval < 1 || cfg.interval > 365) {
    return 'interval must be an integer between 1 and 365';
  }
  if (cfg.unit === 'week') {
    if (!Array.isArray(cfg.days_of_week) || cfg.days_of_week.length === 0) {
      return 'days_of_week required for weekly recurrence (array of 0..6)';
    }
    for (const d of cfg.days_of_week) {
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        return 'days_of_week values must be integers 0..6';
      }
    }
  }
  if (cfg.unit === 'month') {
    const d = cfg.day_of_month;
    if (d !== 'last' && (!Number.isInteger(d) || d < 1 || d > 31)) {
      return "day_of_month must be 1..31 or 'last'";
    }
  }
  return null;
}

/**
 * Last day of the given month (1..31).
 * Uses day=0 of next month trick.
 */
function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Convert a JS Date or ISO date string to a Date at midnight UTC representing
 * the local date. We work in date-only space, no time component.
 */
function toDateOnly(input) {
  if (input instanceof Date) {
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  }
  if (typeof input === 'string') {
    const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) throw new Error(`Invalid date string: ${input}`);
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  throw new Error(`Invalid date input: ${input}`);
}

function formatDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute the next due date for a recurring task.
 *
 * @param {object} config recurrence_config
 * @param {Date|string} fromDate reference (typically the just-completed occurrence
 *                               date, or task creation date for first-time calc)
 * @returns {string} ISO date string YYYY-MM-DD
 */
function computeNextDueDate(config, fromDate) {
  const err = validateRecurrenceConfig(config);
  if (err) throw new Error(`Invalid recurrence_config: ${err}`);

  const from = toDateOnly(fromDate);
  const interval = config.interval;

  if (config.unit === 'day') {
    const next = new Date(from);
    next.setUTCDate(next.getUTCDate() + interval);
    return formatDate(next);
  }

  if (config.unit === 'week') {
    // days_of_week values: 0=Mon..6=Sun. JS getUTCDay() is 0=Sun..6=Sat.
    // Convert: jsDay -> ourDay = (jsDay + 6) % 7
    const sortedDays = [...config.days_of_week].sort((a, b) => a - b);
    // Search forward day by day for the next matching day,
    // starting at fromDate + 1 day. If we'd cross over a week boundary
    // and interval > 1, we need to skip (interval-1) extra weeks.
    let cursor = new Date(from);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    for (let i = 0; i < 366 * 4; i++) {
      const ourDay = (cursor.getUTCDay() + 6) % 7;
      if (sortedDays.includes(ourDay)) {
        // For interval > 1, ensure we're at least interval-1 weeks past `from`
        if (interval === 1) return formatDate(cursor);
        const weeksDiff = Math.floor((cursor - from) / (7 * 86400000));
        if (weeksDiff >= interval - 1) return formatDate(cursor);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    throw new Error('Could not compute next weekly occurrence');
  }

  if (config.unit === 'month') {
    const y = from.getUTCFullYear();
    const m = from.getUTCMonth();
    const targetMonth = m + interval;
    const ty = y + Math.floor(targetMonth / 12);
    const tm = ((targetMonth % 12) + 12) % 12;
    let day;
    if (config.day_of_month === 'last') {
      day = lastDayOfMonth(ty, tm);
    } else {
      const requested = config.day_of_month;
      const maxDay = lastDayOfMonth(ty, tm);
      day = Math.min(requested, maxDay);
    }
    return formatDate(new Date(Date.UTC(ty, tm, day)));
  }

  throw new Error(`Unsupported recurrence unit: ${config.unit}`);
}

/**
 * Human-readable label for a recurrence config (for tooltips).
 */
function formatRecurrenceLabel(config) {
  if (!config) return '';
  const { unit, interval } = config;
  if (unit === 'day') {
    return interval === 1 ? 'Tous les jours' : `Tous les ${interval} jours`;
  }
  if (unit === 'week') {
    const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const days = (config.days_of_week || []).map((d) => dayNames[d]).join(', ');
    return interval === 1 ? `Chaque semaine (${days})` : `Toutes les ${interval} semaines (${days})`;
  }
  if (unit === 'month') {
    const dom = config.day_of_month === 'last' ? 'dernier jour' : `le ${config.day_of_month}`;
    return interval === 1 ? `Chaque mois, ${dom}` : `Tous les ${interval} mois, ${dom}`;
  }
  return '';
}

module.exports = {
  computeNextDueDate,
  validateRecurrenceConfig,
  formatRecurrenceLabel,
};
