// ============================================
// Réservation en ligne : statut public + interrupteur du dashboard
// ============================================
// Public  GET  /api/salons/:id/status          → la page de réservation sait
//                                               si elle affiche le parcours
//                                               ou « Ouverture bientôt ».
// Admin   GET  /api/admin/salon/online-booking → état du salon courant
//         PUT  /api/admin/salon/online-booking → { open: true|false }
//
// Le salon de l'admin est req.user.salon_id, déjà résolu par le middleware
// de index.js depuis le salon_id que le dashboard injecte.

const express = require('express');
const { body } = require('express-validator');
const { handleValidation } = require('../middleware/validate');
const { publicLimiter } = require('../middleware/rateLimiter');
const { logAudit } = require('../middleware/auditLog');
const { isOnlineBookingOpen } = require('../services/salonStatus');
const { SALON_IDS } = require('../config/env');
const db = require('../config/database');
const { ApiError } = require('../utils/errors');

const publicRouter = express.Router();
const adminRouter = express.Router();

publicRouter.get('/salons/:id/status',
  publicLimiter,
  async (req, res, next) => {
    try {
      // Salon inconnu : 404, sans retomber sur Meylan comme getSalonConfig
      if (!SALON_IDS.includes(req.params.id)) throw ApiError.notFound('Salon introuvable');
      const open = await isOnlineBookingOpen(req.params.id);
      res.set('Cache-Control', 'no-store');
      res.json({ id: req.params.id, online_booking_open: open });
    } catch (err) {
      next(err);
    }
  }
);

adminRouter.get('/online-booking', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id || 'meylan';
    res.json({ id: salonId, online_booking_open: await isOnlineBookingOpen(salonId) });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/online-booking',
  [body('open').isBoolean({ strict: true }).withMessage('open doit valoir true ou false')],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id || 'meylan';
      const open = req.body.open;
      const r = await db.query(
        'UPDATE salons SET online_booking_open = $1 WHERE id = $2 RETURNING online_booking_open',
        [open, salonId]
      );
      if (r.rows.length === 0) throw ApiError.notFound('Salon introuvable');
      logAudit(req, open ? 'open_online_booking' : 'close_online_booking', 'salon', null, { salon_id: salonId, open });
      res.json({ id: salonId, online_booking_open: r.rows[0].online_booking_open });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = { publicRouter, adminRouter };
