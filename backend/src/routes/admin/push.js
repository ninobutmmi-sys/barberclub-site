const { Router } = require('express');
const { body } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const db = require('../../config/database');
const config = require('../../config/env');

const router = Router();

// ============================================
// GET /api/admin/push/vapid-key — Public VAPID key for client-side subscription
// ============================================
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: config.vapid.publicKey });
});

// ============================================
// POST /api/admin/push/subscribe — Register push subscription
// ============================================
router.post('/subscribe',
  [
    body('endpoint').isURL().withMessage('Endpoint invalide'),
    body('keys.p256dh').notEmpty().withMessage('Cle p256dh requise'),
    body('keys.auth').notEmpty().withMessage('Cle auth requise'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { endpoint, keys } = req.body;
      const userId = req.user.id;
      const salonId = req.user.salon_id;

      await db.query(
        `INSERT INTO push_subscriptions (user_id, salon_id, endpoint, keys_p256dh, keys_auth)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET
           user_id = $1, salon_id = $2, keys_p256dh = $4, keys_auth = $5`,
        [userId, salonId, endpoint, keys.p256dh, keys.auth]
      );

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/push/unsubscribe — Remove push subscription
// ============================================
router.post('/unsubscribe',
  [body('endpoint').isURL().withMessage('Endpoint invalide')],
  handleValidation,
  async (req, res, next) => {
    try {
      await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [req.body.endpoint]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
