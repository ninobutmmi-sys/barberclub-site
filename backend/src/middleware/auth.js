const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { ApiError } = require('../utils/errors');

/**
 * Middleware: Require valid JWT access token
 * Attaches decoded user info to req.user
 */
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Token d\'authentification manquant');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret);

    req.user = {
      id: decoded.id,
      type: decoded.type, // 'barber' or 'client'
      email: decoded.email,
      name: decoded.name,
      salon_id: decoded.salon_id || 'meylan',
    };

    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }
    if (error.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Session expirée, veuillez vous reconnecter'));
    }
    if (error.name === 'JsonWebTokenError') {
      return next(ApiError.unauthorized('Token invalide'));
    }
    next(ApiError.unauthorized());
  }
}

/**
 * Middleware: Require barber role (for dashboard access)
 * Must be used AFTER requireAuth
 */
function requireBarber(req, res, next) {
  if (!req.user || req.user.type !== 'barber') {
    return next(ApiError.forbidden('Accès réservé aux barbers'));
  }
  next();
}

/**
 * Middleware: Require client role
 * Must be used AFTER requireAuth
 */
function requireClient(req, res, next) {
  if (!req.user || req.user.type !== 'client') {
    return next(ApiError.forbidden('Accès réservé aux clients'));
  }
  next();
}

/**
 * Middleware: Optional auth — attaches user if token present, continues if not
 */
function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = {
      id: decoded.id,
      type: decoded.type,
      email: decoded.email,
      name: decoded.name,
      salon_id: decoded.salon_id || 'meylan',
    };
  } catch {
    // Invalid token — continue without user
  }
  next();
}

/**
 * Generate JWT access token (short-lived: 15 min)
 */
function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      type: user.type,
      email: user.email,
      name: user.name,
      salon_id: user.salon_id || 'meylan',
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn }
  );
}

/**
 * Generate JWT refresh token (long-lived: 7 days)
 */
function generateRefreshToken(user) {
  return jwt.sign(
    {
      id: user.id,
      type: user.type,
    },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );
}

module.exports = {
  requireAuth,
  requireBarber,
  requireClient,
  optionalAuth,
  generateAccessToken,
  generateRefreshToken,
};
