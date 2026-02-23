const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for public routes (booking, barbers list, etc.)
 * 60 requests per minute per IP
 */
const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
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
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes.',
  },
});

module.exports = { publicLimiter, authLimiter, adminLimiter };
