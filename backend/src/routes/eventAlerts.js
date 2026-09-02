const express = require('express');
const publicRouter = express.Router();
const adminRouter = express.Router();
const db = require('../config/database');
const { body, validationResult } = require('express-validator');
const { publicLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { normalizeEmail } = require('../utils/email');
const { SALON_IDS } = require('../config/env');

// POST /api/event-alerts — Subscribe to an event alert (public)
publicRouter.post('/',
  publicLimiter,
  [
    // Un numero OU une adresse — les deux sont acceptes, aucun n'est obligatoire
    // seul. Le middleware normalizePhoneFields a deja repare le numero.
    body('email').optional({ values: 'falsy' }).isEmail().customSanitizer(normalizeEmail).withMessage('Email invalide'),
    body('phone').optional({ values: 'falsy' }).trim()
      .matches(/^(\+33[1-9]\d{8}|\+(?!33)\d{7,14}|0[1-9]\d{8})$/).withMessage('Numéro de téléphone invalide'),
    body('first_name').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('event_name').trim().notEmpty().isLength({ max: 100 }).withMessage('Événement requis'),
    body('salon_id').isIn(SALON_IDS).withMessage('Salon invalide'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, phone, first_name, event_name, salon_id } = req.body;
    if (!email && !phone) {
      return res.status(400).json({ error: 'Laissez un numéro ou une adresse email' });
    }

    try {
      // Deux clefs d'unicite : l'ancienne sur l'email, la nouvelle sur le
      // numero. ON CONFLICT ne sait viser qu'une contrainte a la fois, d'ou le
      // choix selon ce qui a ete laisse.
      if (phone) {
        await db.query(
          `INSERT INTO event_alerts (email, phone, first_name, event_name, salon_id)
           VALUES (NULLIF($1, ''), $2, NULLIF($3, ''), $4, $5)
           ON CONFLICT (phone, event_name, salon_id) WHERE phone IS NOT NULL
           DO UPDATE SET first_name = COALESCE(EXCLUDED.first_name, event_alerts.first_name),
                         email = COALESCE(EXCLUDED.email, event_alerts.email)`,
          [email || '', phone, first_name || '', event_name, salon_id]
        );
      } else {
        await db.query(
          `INSERT INTO event_alerts (email, first_name, event_name, salon_id)
           VALUES ($1, NULLIF($2, ''), $3, $4)
           ON CONFLICT (email, event_name, salon_id) DO NOTHING`,
          [email, first_name || '', event_name, salon_id]
        );
      }

      res.json({ success: true, message: 'Vous serez prévenu !' });
    } catch (err) {
      logger.error('Event alert subscription failed', { error: err.message, event_name });
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/admin/event-alerts — List subscribers (admin, auth handled by adminRouter middleware)
adminRouter.get('/', async (req, res) => {
  const { event_name } = req.query;
  const salon_id = req.user.salon_id;

  try {
    // Le salon du compte connecte borne toujours la lecture : ces lignes
    // portent des noms, des numeros et des adresses. `event_name` filtre a
    // l'interieur de ce perimetre, il ne le remplace jamais — sans quoi
    // n'importe quel barbier pourrait lire la liste d'un autre salon en
    // devinant un nom d'evenement.
    // (Les inscrits de Voiron enregistres sous Grenoble avant l'existence du
    // salon ont ete rattaches par la migration 081.)
    let query = `SELECT id, email, phone, first_name, event_name, salon_id, created_at, notified_at
                 FROM event_alerts WHERE salon_id = $1`;
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
