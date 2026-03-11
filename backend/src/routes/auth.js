const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { body } = require('express-validator');
const db = require('../config/database');
const config = require('../config/env');
const { handleValidation } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');
const { generateAccessToken, generateRefreshToken } = require('../middleware/auth');
const { ApiError } = require('../utils/errors');
const { sendResetPasswordEmail } = require('../services/notification');
const logger = require('../utils/logger');
const { BCRYPT_ROUNDS, MAX_LOGIN_ATTEMPTS, LOCKOUT_MINUTES, RESET_TOKEN_EXPIRY_MS } = require('../constants');

const router = Router();

const REFRESH_COOKIE_MAX_AGE = config.jwt.refreshExpiresMs;

// Safe table mapping (prevents SQL injection via dynamic table names)
const TABLE_MAP = { barber: 'barbers', client: 'clients' };

// Set refresh token as httpOnly cookie
function setRefreshTokenCookie(res, refreshToken) {
  res.cookie('bc_refresh_token', refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

// Clear refresh token cookie
function clearRefreshTokenCookie(res) {
  res.clearCookie('bc_refresh_token', {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/api/auth',
  });
}

// ============================================
// POST /api/auth/login
// ============================================
router.post('/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
    body('password').notEmpty().withMessage('Mot de passe requis'),
    body('type').isIn(['barber', 'client']).withMessage('Type invalide'),
    body('salon_id').optional().isIn(['meylan', 'grenoble']).withMessage('Salon invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { email, password, type } = req.body;
      const salonId = req.body.salon_id || 'meylan';
      const table = TABLE_MAP[type];
      if (!table) throw ApiError.badRequest('Type invalide');

      // Find user by email (barbers are salon-specific, clients are global)
      const salonFilter = type === 'barber' ? ' AND salon_id = $2' : '';
      const params = type === 'barber' ? [email, salonId] : [email];
      const result = await db.query(
        `SELECT id, email, password_hash, failed_login_attempts, locked_until,
                ${type === 'barber' ? 'name, photo_url, salon_id' : 'first_name || \' \' || last_name as name, NULL as photo_url'}
         FROM ${table}
         WHERE email = $1${salonFilter} AND deleted_at IS NULL`,
        params
      );

      if (result.rows.length === 0) {
        throw ApiError.unauthorized('Email ou mot de passe incorrect');
      }

      const user = result.rows[0];

      // Check account lockout
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
        throw ApiError.tooMany(
          `Compte temporairement verrouillé. Réessayez dans ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`
        );
      }

      // Verify password
      if (!user.password_hash) {
        throw ApiError.unauthorized('Ce compte n\'a pas de mot de passe configuré');
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);

      if (!validPassword) {
        // Increment failed attempts
        const newAttempts = (user.failed_login_attempts || 0) + 1;
        const lockUntil = newAttempts >= MAX_LOGIN_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60000)
          : null;

        await db.query(
          `UPDATE ${table} SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
          [newAttempts, lockUntil, user.id]
        );

        if (lockUntil) {
          throw ApiError.tooMany(
            `Trop de tentatives. Compte verrouillé pour ${LOCKOUT_MINUTES} minutes.`
          );
        }

        throw ApiError.unauthorized('Email ou mot de passe incorrect');
      }

      // Reset failed attempts on success
      await db.query(
        `UPDATE ${table} SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
        [user.id]
      );

      // Generate tokens (barbers carry their salon_id, clients use the requested one)
      const userSalonId = type === 'barber' ? (user.salon_id || salonId) : salonId;
      const tokenPayload = { id: user.id, type, email: user.email, name: user.name, photo_url: user.photo_url || null, salon_id: userSalonId };
      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      // Store refresh token in database (limit to 5 active sessions)
      const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresMs);
      await db.query(
        `INSERT INTO refresh_tokens (user_id, user_type, token, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [user.id, type, refreshToken, expiresAt]
      );
      // Prune oldest sessions beyond 5
      await db.query(
        `DELETE FROM refresh_tokens WHERE id IN (
           SELECT id FROM refresh_tokens
           WHERE user_id = $1 AND user_type = $2 AND expires_at > NOW()
           ORDER BY created_at DESC
           OFFSET 5
         )`,
        [user.id, type]
      );

      logger.info('User logged in', { userId: user.id, type, salonId: userSalonId });

      // Set refresh token as httpOnly cookie (dashboard uses this)
      setRefreshTokenCookie(res, refreshToken);

      res.json({
        access_token: accessToken,
        refresh_token: refreshToken, // site vitrine clients need this (no httpOnly cookie support)
        user: {
          id: user.id,
          type,
          email: user.email,
          name: user.name,
          photo_url: user.photo_url || null,
          salon_id: userSalonId,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/auth/register (client only)
// ============================================
router.post('/register',
  authLimiter,
  [
    body('first_name').trim().notEmpty().withMessage('Prénom requis').isLength({ max: 100 }),
    body('last_name').trim().notEmpty().withMessage('Nom requis').isLength({ max: 100 }),
    body('phone').trim().notEmpty().withMessage('Téléphone requis')
      .matches(/^(\+33|0)[1-9]\d{8}$/).withMessage('Numéro de téléphone français invalide'),
    body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Le mot de passe doit faire au moins 8 caractères'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { first_name, last_name, phone, email, password } = req.body;

      // Check if email already used (any account, not just has_account=true)
      const emailCheck = await db.query(
        'SELECT id, has_account FROM clients WHERE email = $1 AND deleted_at IS NULL',
        [email]
      );
      if (emailCheck.rows.length > 0 && emailCheck.rows[0].has_account) {
        throw ApiError.conflict('Un compte existe déjà avec cet email');
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // Check if client already exists by phone OR email (from previous bookings without account)
      const existingCheck = await db.query(
        'SELECT id FROM clients WHERE (phone = $1 OR email = $2) AND deleted_at IS NULL LIMIT 1',
        [phone, email]
      );

      let clientId;
      try {
        if (existingCheck.rows.length > 0) {
          // Upgrade existing client to account
          clientId = existingCheck.rows[0].id;
          await db.query(
            `UPDATE clients SET first_name = $1, last_name = $2, email = $3, phone = $4,
             password_hash = $5, has_account = true WHERE id = $6`,
            [first_name, last_name, email, phone, passwordHash, clientId]
          );
        } else {
          // Create new client with account
          const result = await db.query(
            `INSERT INTO clients (first_name, last_name, phone, email, password_hash, has_account)
             VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [first_name, last_name, phone, email, passwordHash]
          );
          clientId = result.rows[0].id;
        }
      } catch (dbErr) {
        if (dbErr.code === '23505') {
          // UNIQUE constraint violation (phone or email already taken by another client)
          throw ApiError.conflict('Ce numéro de téléphone ou email est déjà utilisé par un autre compte');
        }
        throw dbErr;
      }

      // Generate tokens
      const name = `${first_name} ${last_name}`;
      const tokenPayload = { id: clientId, type: 'client', email, name };
      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresMs);
      await db.query(
        `INSERT INTO refresh_tokens (user_id, user_type, token, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [clientId, 'client', refreshToken, expiresAt]
      );

      logger.info('Client registered', { clientId });

      setRefreshTokenCookie(res, refreshToken);

      res.status(201).json({
        access_token: accessToken,
        refresh_token: refreshToken, // site vitrine clients need this
        user: {
          id: clientId,
          type: 'client',
          email,
          name,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/auth/refresh
// ============================================
router.post('/refresh', authLimiter, async (req, res, next) => {
  try {
    // Read refresh token from httpOnly cookie first, fallback to body (site vitrine)
    const refresh_token = req.cookies?.bc_refresh_token || req.body?.refresh_token;
    if (!refresh_token) {
      throw ApiError.badRequest('Refresh token manquant');
    }

    // Verify the token
    let decoded;
    try {
      decoded = require('jsonwebtoken').verify(refresh_token, config.jwt.refreshSecret);
    } catch {
      clearRefreshTokenCookie(res);
      throw ApiError.unauthorized('Refresh token invalide ou expiré');
    }

    // Check if token exists in database
    const tokenResult = await db.query(
      `SELECT * FROM refresh_tokens
       WHERE token = $1 AND user_id = $2 AND user_type = $3 AND expires_at > NOW()`,
      [refresh_token, decoded.id, decoded.type]
    );

    if (tokenResult.rows.length === 0) {
      clearRefreshTokenCookie(res);
      throw ApiError.unauthorized('Session expirée, veuillez vous reconnecter');
    }

    // Get current user info
    const table = decoded.type === 'barber' ? 'barbers' : 'clients';
    const nameCol = decoded.type === 'barber' ? 'name, photo_url, salon_id' : "first_name || ' ' || last_name as name, NULL as photo_url";
    const userResult = await db.query(
      `SELECT id, email, ${nameCol} FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      clearRefreshTokenCookie(res);
      throw ApiError.unauthorized('Utilisateur introuvable');
    }

    const user = userResult.rows[0];
    const userSalonId = decoded.type === 'barber' ? (user.salon_id || 'meylan') : (decoded.salon_id || 'meylan');
    const tokenPayload = { id: user.id, type: decoded.type, email: user.email, name: user.name, photo_url: user.photo_url || null, salon_id: userSalonId };

    // Delete old refresh token
    await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);

    // Generate new tokens
    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);

    const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresMs);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, user_type, token, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, decoded.type, newRefreshToken, expiresAt]
    );

    // Set new refresh token cookie (rotation)
    setRefreshTokenCookie(res, newRefreshToken);

    res.json({
      access_token: newAccessToken,
      refresh_token: newRefreshToken, // site vitrine clients need this
      user: tokenPayload,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/auth/logout
// ============================================
router.post('/logout', authLimiter, async (req, res, next) => {
  try {
    // Read refresh token from httpOnly cookie first, fallback to body (site vitrine)
    const refresh_token = req.cookies?.bc_refresh_token || req.body?.refresh_token;

    if (refresh_token) {
      // Delete the refresh token (this IS the logout action)
      const result = await db.query(
        'DELETE FROM refresh_tokens WHERE token = $1 RETURNING user_id, user_type',
        [refresh_token]
      );

      if (result.rows.length > 0) {
        const { user_id, user_type } = result.rows[0];
        // Clean up expired tokens for this user
        await db.query(
          'DELETE FROM refresh_tokens WHERE user_id = $1 AND user_type = $2 AND expires_at < NOW()',
          [user_id, user_type]
        );
        logger.info('User logged out', { userId: user_id, type: user_type });
      }
    }

    // Always clear the cookie
    clearRefreshTokenCookie(res);

    res.json({ message: 'Déconnecté avec succès' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/auth/forgot-password
// ============================================
router.post('/forgot-password',
  authLimiter,
  [
    body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
    body('salon_id').optional().isIn(['meylan', 'grenoble']).withMessage('Salon invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { email } = req.body;
      const salonId = req.body.salon_id || 'meylan';

      // Always return success to prevent email enumeration
      const successMsg = 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.';

      const result = await db.query(
        'SELECT id, first_name, email FROM clients WHERE email = $1 AND has_account = true AND deleted_at IS NULL',
        [email]
      );

      if (result.rows.length === 0) {
        return res.json({ message: successMsg });
      }

      const client = result.rows[0];

      // Generate reset token (UUID)
      const resetToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

      await db.query(
        'UPDATE clients SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
        [resetToken, expiresAt, client.id]
      );

      // Build reset URL (dynamic per salon)
      const { getSalonConfig } = config;
      const salonCfg = getSalonConfig(salonId);
      const resetUrl = `${config.siteUrl}${salonCfg.bookingPath}/reset-password.html?token=${resetToken}`;

      // Send email (async, don't block response, with single retry)
      const resetEmailData = { email: client.email, first_name: client.first_name, resetUrl };
      sendResetPasswordEmail(resetEmailData).catch((err) => {
        logger.error('Reset password email failed, retrying once...', { email, error: err.message });
        sendResetPasswordEmail(resetEmailData).catch((e) => {
          logger.error('Reset password email retry failed', { email, error: e.message });
        });
      });

      logger.info('Password reset requested', { clientId: client.id });

      res.json({ message: successMsg });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/auth/reset-password
// ============================================
router.post('/reset-password',
  authLimiter,
  [
    body('token').notEmpty().withMessage('Token requis'),
    body('password').isLength({ min: 8 }).withMessage('Le mot de passe doit faire au moins 8 caractères'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { token, password } = req.body;

      const result = await db.query(
        `SELECT id, email, first_name || ' ' || last_name as name
         FROM clients
         WHERE reset_token = $1 AND reset_token_expires > NOW() AND deleted_at IS NULL`,
        [token]
      );

      if (result.rows.length === 0) {
        throw ApiError.badRequest('Lien de réinitialisation invalide ou expiré');
      }

      const client = result.rows[0];

      // Hash new password
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // Update password and clear reset token
      await db.query(
        `UPDATE clients SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL,
         failed_login_attempts = 0, locked_until = NULL WHERE id = $2`,
        [passwordHash, client.id]
      );

      // Invalidate all existing refresh tokens for this client
      await db.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1 AND user_type = $2',
        [client.id, 'client']
      );

      // Generate fresh tokens so user is logged in
      const tokenPayload = { id: client.id, type: 'client', email: client.email, name: client.name };
      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresMs);
      await db.query(
        'INSERT INTO refresh_tokens (user_id, user_type, token, expires_at) VALUES ($1, $2, $3, $4)',
        [client.id, 'client', refreshToken, expiresAt]
      );

      logger.info('Password reset completed', { clientId: client.id });

      setRefreshTokenCookie(res, refreshToken);

      res.json({
        message: 'Mot de passe réinitialisé avec succès',
        access_token: accessToken,
        refresh_token: refreshToken, // site vitrine clients need this
        user: tokenPayload,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/auth/claim-account
// Allows a guest client to set a password after booking
// Uses booking_id + cancel_token as proof of identity
// ============================================
router.post('/claim-account',
  authLimiter,
  [
    body('booking_id').notEmpty().matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).withMessage('Réservation requise'),
    body('cancel_token').notEmpty().withMessage('Token requis'),
    body('password').isLength({ min: 8 }).withMessage('Le mot de passe doit faire au moins 8 caractères'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { booking_id, cancel_token, password } = req.body;

      // 1. Verify booking + cancel_token → get client_id
      const bookingResult = await db.query(
        `SELECT b.client_id, c.has_account, c.email, c.first_name, c.last_name
         FROM bookings b
         JOIN clients c ON b.client_id = c.id
         WHERE b.id = $1 AND b.cancel_token = $2 AND b.deleted_at IS NULL AND c.deleted_at IS NULL`,
        [booking_id, cancel_token]
      );

      if (bookingResult.rows.length === 0) {
        throw ApiError.notFound('Réservation introuvable');
      }

      const { client_id, has_account, email, first_name, last_name } = bookingResult.rows[0];

      // 2. Check client doesn't already have an account
      if (has_account) {
        throw ApiError.conflict('Vous avez déjà un compte');
      }

      // 3. Hash password and activate account
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await db.query(
        'UPDATE clients SET password_hash = $1, has_account = true WHERE id = $2',
        [passwordHash, client_id]
      );

      // 4. Generate tokens (auto-login)
      const name = `${first_name} ${last_name}`;
      const tokenPayload = { id: client_id, type: 'client', email, name };
      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresMs);
      await db.query(
        'INSERT INTO refresh_tokens (user_id, user_type, token, expires_at) VALUES ($1, $2, $3, $4)',
        [client_id, 'client', refreshToken, expiresAt]
      );

      logger.info('Account claimed after booking', { clientId: client_id, bookingId: booking_id });

      setRefreshTokenCookie(res, refreshToken);

      res.status(201).json({
        access_token: accessToken,
        refresh_token: refreshToken, // site vitrine clients need this
        user: {
          id: client_id,
          type: 'client',
          email,
          name,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
