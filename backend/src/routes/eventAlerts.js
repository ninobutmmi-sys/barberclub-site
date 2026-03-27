const express = require('express');
const publicRouter = express.Router();
const adminRouter = express.Router();
const db = require('../config/database');
const { body, validationResult } = require('express-validator');
const { publicLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

// POST /api/event-alerts — Subscribe to an event alert (public)
publicRouter.post('/',
  publicLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
    body('event_name').trim().notEmpty().isLength({ max: 100 }).withMessage('Événement requis'),
    body('salon_id').isIn(['meylan', 'grenoble']).withMessage('Salon invalide'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, event_name, salon_id } = req.body;

    try {
      await db.query(
        `INSERT INTO event_alerts (email, event_name, salon_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (email, event_name, salon_id) DO NOTHING`,
        [email, event_name, salon_id]
      );

      res.json({ success: true, message: 'Vous serez alerté !' });
    } catch (err) {
      logger.error('Event alert subscription failed', { error: err.message, email, event_name });
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/admin/event-alerts — List subscribers (admin, auth handled by adminRouter middleware)
adminRouter.get('/', async (req, res) => {
  const { event_name } = req.query;
  const salon_id = req.user.salon_id;

  try {
    let query = 'SELECT id, email, event_name, salon_id, created_at, notified_at FROM event_alerts WHERE salon_id = $1';
    const params = [salon_id];

    if (event_name) {
      params.push(event_name);
      query += ` AND event_name = $${params.length}`;
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query(query, params);
    res.json({ alerts: result.rows, total: result.rows.length });
  } catch (err) {
    logger.error('Event alerts list failed', { error: err.message });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = { publicRouter, adminRouter };
