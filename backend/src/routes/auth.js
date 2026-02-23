const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { body } = require('express-validator');
const db = require('../config/database');
const config = require('../config/env');
const { handleValidation } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');
const { requireAuth, generateAccessToken, generateRefreshToken } = require('../middleware/auth');
const { ApiError } = require('../utils/errors');
const { sendResetPasswordEmail } = require('../services/notification');
const logger = require('../utils/logger');

const router = Router();

const BCRYPT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Safe table mapping (prevents SQL injection via dynamic table names)
const TABLE_MAP = { barber: 'barbers', client: 'clients' };

// ============================================
// POST /api/auth/login
// ============================================
router.post('/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
    body('password').notEmpty().withMessage('Mot de passe requis'),
    body('type').isIn(['barber', 'client']).withMessage('Type invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { email, password, type } = req.body;
      const table = TABLE_MAP[type];
      if (!table) throw ApiError.badRequest('Type invalide');

      // Find user by email
      const result = await db.query(
        `SELECT id, email, password_hash, failed_login_attempts, locked_until,
                ${type === 'barber' ? 'name, photo_url' : 'first_name || \' \' || last_name as name, NULL as photo_url'}
         FROM ${table}
         WHERE email = $1 AND deleted_at IS NULL`,
        [email]
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

      // Generate tokens
      const tokenPayload = { id: user.id, type, email: user.email, name: user.name, photo_url: user.photo_url || null };
      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      // Store refresh token in database
      const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresMs);
      await db.query(
        `INSERT INTO refresh_tokens (user_id, user_type, token, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [user.id, type, refreshToken, expiresAt]
      );

      logger.info('User logged in', { userId: user.id, type });

      res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          type,
          email: user.email,
          name: user.name,
          photo_url: user.photo_url || null,
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

      res.status(201).json({
        access_token: accessToken,
        refresh_token: refreshToken,
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
    const { refresh_token } = req.body;
    if (!refresh_token) {
      throw ApiError.badRequest('Refresh token manquant');
    }

    // Verify the token
    let decoded;
    try {
      decoded = require('jsonwebtoken').verify(refresh_token, config.jwt.refreshSecret);
    } catch {
      throw ApiError.unauthorized('Refresh token invalide ou expiré');
    }

    // Check if token exists in database
    const tokenResult = await db.query(
      `SELECT * FROM refresh_tokens
       WHERE token = $1 AND user_id = $2 AND user_type = $3 AND expires_at > NOW()`,
      [refresh_token, decoded.id, decoded.type]
    );

    if (tokenResult.rows.length === 0) {
      throw ApiError.unauthorized('Session expirée, veuillez vous reconnecter');
    }

    // Get current user info
    const table = decoded.type === 'barber' ? 'barbers' : 'clients';
    const nameCol = decoded.type === 'barber' ? 'name, photo_url' : "first_name || ' ' || last_name as name, NULL as photo_url";
    const userResult = await db.query(
      `SELECT id, email, ${nameCol} FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      throw ApiError.unauthorized('Utilisateur introuvable');
    }

    const user = userResult.rows[0];
    const tokenPayload = { id: user.id, type: decoded.type, email: user.email, name: user.name, photo_url: user.photo_url || null };

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

    res.json({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
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
    const { refresh_token } = req.body;
    if (!refresh_token) {
      throw ApiError.badRequest('Refresh token manquant');
    }

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
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { email } = req.body;

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
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.query(
        'UPDATE clients SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
        [resetToken, expiresAt, client.id]
      );

      // Build reset URL
      const resetUrl = `${config.siteUrl}/pages/meylan/reset-password.html?token=${resetToken}`;

      // Send email (async, don't block response)
      sendResetPasswordEmail({
        email: client.email,
        first_name: client.first_name,
        resetUrl,
      }).catch((err) => {
        logger.error('Failed to send reset password email', { email, error: err.message });
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

      res.json({
        message: 'Mot de passe réinitialisé avec succès',
        access_token: accessToken,
        refresh_token: refreshToken,
        user: tokenPayload,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
