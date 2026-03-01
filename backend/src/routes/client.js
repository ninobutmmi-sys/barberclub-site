const { Router } = require('express');
const bcrypt = require('bcrypt');
const { body } = require('express-validator');
const { handleValidation } = require('../middleware/validate');
const { requireAuth, requireClient } = require('../middleware/auth');
const { ApiError } = require('../utils/errors');
const db = require('../config/database');
const logger = require('../utils/logger');

const router = Router();

// All routes require client authentication
router.use(requireAuth, requireClient);

// ============================================
// GET /api/client/profile
// ============================================
router.get('/profile', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, first_name, last_name, phone, email, created_at
       FROM clients WHERE id = $1 AND deleted_at IS NULL`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      throw ApiError.notFound('Profil introuvable');
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// ============================================
// PUT /api/client/profile
// ============================================
router.put('/profile',
  [
    body('first_name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('last_name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { first_name, last_name, email } = req.body;
      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (first_name) { fields.push(`first_name = $${paramIndex++}`); values.push(first_name); }
      if (last_name) { fields.push(`last_name = $${paramIndex++}`); values.push(last_name); }
      if (email) { fields.push(`email = $${paramIndex++}`); values.push(email); }

      if (fields.length === 0) {
        throw ApiError.badRequest('Aucune donnée à mettre à jour');
      }

      values.push(req.user.id);
      const result = await db.query(
        `UPDATE clients SET ${fields.join(', ')} WHERE id = $${paramIndex} AND deleted_at IS NULL
         RETURNING id, first_name, last_name, phone, email`,
        values
      );

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/client/bookings
// ============================================
router.get('/bookings', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT b.id, b.date, b.start_time, b.end_time, b.status, b.price, b.cancel_token,
              s.name as service_name, s.duration as service_duration,
              br.name as barber_name, br.photo_url as barber_photo
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN barbers br ON b.barber_id = br.id
       WHERE b.client_id = $1 AND b.deleted_at IS NULL
       ORDER BY b.date DESC, b.start_time DESC`,
      [req.user.id]
    );

    // Split into upcoming and past
    const now = new Date();
    const upcoming = [];
    const past = [];

    for (const booking of result.rows) {
      const bookingDate = new Date(`${booking.date}T${booking.start_time}`);
      if (bookingDate > now && booking.status === 'confirmed') {
        upcoming.push(booking);
      } else {
        past.push(booking);
      }
    }

    res.json({ upcoming, past });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/client/export-data (RGPD Art. 20)
// ============================================
router.get('/export-data', async (req, res, next) => {
  try {
    // Profile
    const profile = await db.query(
      `SELECT first_name, last_name, phone, email, created_at
       FROM clients WHERE id = $1 AND deleted_at IS NULL`,
      [req.user.id]
    );
    if (profile.rows.length === 0) {
      throw ApiError.notFound('Profil introuvable');
    }

    // Bookings
    const bookings = await db.query(
      `SELECT b.date, b.start_time, b.end_time, b.status, b.price,
              s.name as service_name, br.name as barber_name
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN barbers br ON b.barber_id = br.id
       WHERE b.client_id = $1 AND b.deleted_at IS NULL
       ORDER BY b.date DESC`,
      [req.user.id]
    );

    // Payments
    const payments = await db.query(
      `SELECT p.amount, p.method, p.created_at
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       WHERE b.client_id = $1`,
      [req.user.id]
    );

    logger.info('Client data exported (RGPD)', { clientId: req.user.id });

    res.json({
      exported_at: new Date().toISOString(),
      profile: profile.rows[0],
      bookings: bookings.rows.map(b => ({
        ...b,
        price: b.price ? (b.price / 100).toFixed(2) + ' €' : null,
      })),
      payments: payments.rows.map(p => ({
        ...p,
        amount: p.amount ? (p.amount / 100).toFixed(2) + ' €' : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DELETE /api/client/delete-account (RGPD Art. 17)
// ============================================
router.delete('/delete-account',
  [
    body('password').notEmpty().withMessage('Mot de passe requis pour confirmer la suppression'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { password } = req.body;

      // Verify password
      const client = await db.query(
        'SELECT id, password_hash FROM clients WHERE id = $1 AND deleted_at IS NULL',
        [req.user.id]
      );
      if (client.rows.length === 0) {
        throw ApiError.notFound('Compte introuvable');
      }
      if (!client.rows[0].password_hash) {
        throw ApiError.badRequest('Ce compte n\'a pas de mot de passe configuré');
      }

      const valid = await bcrypt.compare(password, client.rows[0].password_hash);
      if (!valid) {
        throw ApiError.unauthorized('Mot de passe incorrect');
      }

      // Cancel upcoming bookings
      await db.query(
        `UPDATE bookings SET status = 'cancelled', deleted_at = NOW()
         WHERE client_id = $1 AND status = 'confirmed' AND date >= CURRENT_DATE AND deleted_at IS NULL`,
        [req.user.id]
      );

      // Soft-delete client (preserve data for legal accounting, anonymize PII)
      await db.query(
        `UPDATE clients SET
          first_name = 'Supprimé', last_name = 'RGPD',
          email = NULL, phone = 'SUPPRIME-' || id::text, password_hash = NULL,
          has_account = false, deleted_at = NOW()
         WHERE id = $1`,
        [req.user.id]
      );

      // Revoke all sessions
      await db.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1 AND user_type = $2',
        [req.user.id, 'client']
      );

      logger.info('Client account deleted (RGPD)', { clientId: req.user.id });

      res.json({ message: 'Votre compte a été supprimé. Vos données personnelles ont été anonymisées.' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
