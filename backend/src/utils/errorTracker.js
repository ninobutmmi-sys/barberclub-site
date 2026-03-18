/**
 * In-memory error tracker for structured error monitoring.
 * Stores the last N errors and maintains counters by route and status code.
 * Resets on server restart (intentional — no persistence needed).
 */

const MAX_ERRORS = 50;

// Circular buffer of recent errors (most recent first)
const recentErrors = [];

// Counters: { '/api/bookings': 3, '/api/auth/login': 1, ... }
const countsByRoute = {};

// Counters: { 400: 5, 500: 2, ... }
const countsByStatus = {};

// Total error count since startup
let totalCount = 0;

/**
 * Record an error occurrence.
 * @param {Object} opts
 * @param {string} opts.method - HTTP method
 * @param {string} opts.path - Request path (originalUrl)
 * @param {number} opts.status - HTTP status code sent to client
 * @param {string} opts.message - Error message
 * @param {string} [opts.stack] - Stack trace (only stored in dev)
 * @param {string} [opts.type] - Error type/name (e.g. 'ApiError', 'TypeError')
 * @param {Object} [opts.user] - User info if authenticated { id, type, salon_id }
 */
function trackError({ method, path, status, message, stack, type, user }) {
  const entry = {
    timestamp: new Date().toISOString(),
    method,
    path,
    status,
    message,
    type: type || 'Error',
  };

  if (stack) {
    entry.stack = stack;
  }

  if (user) {
    entry.user = {
      id: user.id,
      type: user.type || (user.is_barber !== undefined ? 'barber' : 'client'),
      salon_id: user.salon_id,
    };
  }

  // Push to front, keep max size
  recentErrors.unshift(entry);
  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.pop();
  }

  // Increment route counter (strip query params for grouping)
  const routeKey = `${method} ${path.split('?')[0]}`;
  countsByRoute[routeKey] = (countsByRoute[routeKey] || 0) + 1;

  // Increment status counter
  countsByStatus[status] = (countsByStatus[status] || 0) + 1;

  totalCount++;
}

/**
 * Get error tracking summary for the admin endpoint.
 */
function getErrorSummary() {
  // Sort route counts descending
  const byRoute = Object.entries(countsByRoute)
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count);

  // Sort status counts descending
  const byStatus = Object.entries(countsByStatus)
    .map(([status, count]) => ({ status: parseInt(status), count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: totalCount,
    since: startedAt,
    recent: recentErrors,
    by_route: byRoute,
    by_status: byStatus,
  };
}

const startedAt = new Date().toISOString();

module.exports = { trackError, getErrorSummary };
