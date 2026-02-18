const { Router } = require('express');
const { body } = require('express-validator');
const { handleValidation } = require('../middleware/validate');
const { requireAuth, requireClient } = require('../middleware/auth');
const { ApiError } = require('../utils/errors');
const db = require('../config/database');

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

module.exports = router;
