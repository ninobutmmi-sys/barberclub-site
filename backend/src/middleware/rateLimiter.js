const rateLimit = require('express-rate-limit');
const {
  RATE_LIMIT_PUBLIC_WINDOW_MS, RATE_LIMIT_PUBLIC_MAX,
  RATE_LIMIT_AUTH_WINDOW_MS, RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_ADMIN_WINDOW_MS, RATE_LIMIT_ADMIN_MAX,
} = require('../constants');

/**
 * Rate limiter for public routes (booking, barbers list, etc.)
 * 60 requests per minute per IP
 */
const publicLimiter = rateLimit({
  windowMs: RATE_LIMIT_PUBLIC_WINDOW_MS,
  max: RATE_LIMIT_PUBLIC_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes, réessayez dans quelques instants.',
  },
});

/**
 * Rate limiter for auth routes (login, register)
 * 10 attempts per 15 minutes per IP+email
 * Uses IP + target email to prevent X-Forwarded-For bypass
 */
const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_AUTH_WINDOW_MS,
  max: RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body?.email || 'unknown';
    return `${req.ip}-${email}`;
  },
  message: {
    error: 'Trop de tentatives de connexion, réessayez dans 15 minutes.',
  },
});

/**
 * Rate limiter for dashboard routes
 * 200 requests per minute per IP
 */
const adminLimiter = rateLimit({
  windowMs: RATE_LIMIT_ADMIN_WINDOW_MS,
  max: RATE_LIMIT_ADMIN_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes.',
  },
});

module.exports = { publicLimiter, authLimiter, adminLimiter };
