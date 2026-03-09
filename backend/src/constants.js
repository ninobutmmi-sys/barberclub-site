// ============================================
// BarberClub — Shared constants
// Centralizes magic numbers and config values
// used across services, routes, and middleware.
// ============================================

module.exports = {
  // --- Authentication ---
  BCRYPT_ROUNDS: 12,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_MINUTES: 15,
  RESET_TOKEN_EXPIRY_MS: 60 * 60 * 1000, // 1 hour

  // --- Booking rules ---
  MAX_BOOKING_ADVANCE_MONTHS: 6,
  CANCELLATION_DEADLINE_HOURS: 12,
  MIN_BOOKING_LEAD_MINUTES: 5, // reject bookings starting within 5 min
  SMS_CONFIRMATION_THRESHOLD_HOURS: 24, // send SMS if booking is within 24h

  // --- Recurrence ---
  MAX_RECURRENCE_OCCURRENCES: 52,

  // --- Slot intervals ---
  SLOT_INTERVAL_PUBLIC: 30, // minutes between public slots
  SLOT_INTERVAL_ADMIN: 5,  // minutes between admin slots
  ADMIN_SCHEDULE_END: '20:30', // admin can book up to this time

  // --- Rate limiting ---
  RATE_LIMIT_PUBLIC_WINDOW_MS: 60 * 1000,       // 1 minute
  RATE_LIMIT_PUBLIC_MAX: 60,
  RATE_LIMIT_AUTH_WINDOW_MS: 15 * 60 * 1000,    // 15 minutes
  RATE_LIMIT_AUTH_MAX: 10,
  RATE_LIMIT_ADMIN_WINDOW_MS: 60 * 1000,        // 1 minute
  RATE_LIMIT_ADMIN_MAX: 200,

  // --- Notification retry ---
  NOTIFICATION_RETRY_DELAYS: [5, 15, 60], // minutes: 5min, 15min, 1h
  NOTIFICATION_BATCH_SIZE: 10,
  NOTIFICATION_CLEANUP_DAYS: 30,

  // --- Brevo circuit breaker ---
  BREVO_CIRCUIT_THRESHOLD: 3,     // consecutive failures before opening
  BREVO_CIRCUIT_COOLDOWN_MS: 60000, // 60s cooldown
  BREVO_REQUEST_TIMEOUT_MS: 15000,  // 15s per request

  // --- Graceful shutdown ---
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: 10000,
};
