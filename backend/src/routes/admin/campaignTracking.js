const { Router } = require('express');
const { body, param } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const logger = require('../../utils/logger');
const crypto = require('crypto');

const router = Router();
const trackRouter = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/campaigns — List all campaigns with stats
// ============================================
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, type, name, tracking_code, message_preview, recipients_count,
              cost_cents, clicks, bookings_generated, revenue_generated,
              sent_at, created_at
       FROM campaigns
       ORDER BY sent_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/admin/campaigns — Create a campaign record
// ============================================
router.post('/',
  [
    body('type').isIn(['sms', 'email']).withMessage('Type invalide (sms ou email)'),
    body('name').trim().notEmpty().withMessage('Nom requis').isLength({ max: 255 }),
    body('message_preview').optional({ values: 'falsy' }).trim().isLength({ max: 5000 }),
    body('recipients_count').isInt({ min: 0 }).withMessage('Nombre de destinataires invalide'),
    body('cost_cents').isInt({ min: 0 }).withMessage('Co\u00fbt invalide (en centimes)'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { type, name, message_preview, recipients_count, cost_cents } = req.body;
      const tracking_code = crypto.randomBytes(4).toString('hex');

      const result = await db.query(
        `INSERT INTO campaigns (type, name, tracking_code, message_preview, recipients_count, cost_cents, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [type, name, tracking_code, message_preview || null, recipients_count, cost_cents]
      );

      logger.info('Campaign created', { id: result.rows[0].id, type, name, tracking_code });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/campaigns/:id — Single campaign details
// ============================================
router.get('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT id, type, name, tracking_code, message_preview, recipients_count,
                cost_cents, clicks, bookings_generated, revenue_generated,
                sent_at, created_at
         FROM campaigns
         WHERE id = $1`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Campagne introuvable');
      }

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/campaigns/:id/roi — Campaign ROI calculation
// ============================================
router.get('/:id/roi',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Fetch the campaign
      const campaignResult = await db.query(
        'SELECT id, clicks, cost_cents FROM campaigns WHERE id = $1',
        [id]
      );

      if (campaignResult.rows.length === 0) {
        throw ApiError.notFound('Campagne introuvable');
      }

      const campaign = campaignResult.rows[0];

      // Count bookings and sum revenue from bookings linked to this campaign
      const bookingsResult = await db.query(
        `SELECT COUNT(*)::int AS bookings_count,
                COALESCE(SUM(price), 0)::int AS revenue_cents
         FROM bookings
         WHERE campaign_id = $1 AND deleted_at IS NULL`,
        [id]
      );

      const { bookings_count, revenue_cents } = bookingsResult.rows[0];
      const cost_cents = campaign.cost_cents || 0;

      // ROI = ((revenue - cost) / cost) * 100, or 0 if cost is 0
      const roi_percent = cost_cents > 0
        ? Math.round(((revenue_cents - cost_cents) / cost_cents) * 10000) / 100
        : 0;

      // Update campaign with latest calculated values
      await db.query(
        `UPDATE campaigns SET bookings_generated = $1, revenue_generated = $2 WHERE id = $3`,
        [bookings_count, revenue_cents, id]
      );

      res.json({
        clicks: campaign.clicks || 0,
        bookings_count,
        revenue_cents,
        cost_cents,
        roi_percent,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUBLIC: GET /t/:tracking_code — Track click and redirect
// ============================================
trackRouter.get('/t/:tracking_code', async (req, res, next) => {
  try {
    const { tracking_code } = req.params;

    // Find campaign by tracking code
    const campaignResult = await db.query(
      'SELECT id FROM campaigns WHERE tracking_code = $1',
      [tracking_code]
    );

    if (campaignResult.rows.length === 0) {
      logger.warn('Click on unknown tracking code', { tracking_code });
      // Still redirect to booking page even if campaign not found
      return res.redirect(302, `https://barberclub-grenoble.fr/pages/meylan/reserver.html?ref=${tracking_code}`);
    }

    const campaign_id = campaignResult.rows[0].id;
    const ip_address = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
    const user_agent = req.headers['user-agent'] || null;

    // Increment clicks and record click details in parallel
    await Promise.all([
      db.query(
        'UPDATE campaigns SET clicks = clicks + 1 WHERE id = $1',
        [campaign_id]
      ),
      db.query(
        `INSERT INTO campaign_clicks (campaign_id, clicked_at, ip_address, user_agent)
         VALUES ($1, NOW(), $2, $3)`,
        [campaign_id, ip_address, user_agent]
      ),
    ]);

    logger.info('Campaign click tracked', { campaign_id, tracking_code });

    res.redirect(302, `https://barberclub-grenoble.fr/pages/meylan/reserver.html?ref=${tracking_code}`);
  } catch (error) {
    // On error, still redirect so the user experience is not broken
    logger.error('Error tracking campaign click', { error: error.message, tracking_code: req.params.tracking_code });
    res.redirect(302, `https://barberclub-grenoble.fr/pages/meylan/reserver.html?ref=${req.params.tracking_code}`);
  }
});

module.exports = { adminRouter: router, publicRouter: trackRouter };
