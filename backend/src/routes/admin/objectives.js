const { Router } = require('express');
const { query, body, param } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const logger = require('../../utils/logger');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/objectives/monthly — Auto trophies for a month
// ?month=YYYY-MM
// ============================================
router.get('/monthly',
  [
    query('month').matches(/^\d{4}-\d{2}$/).withMessage('Format mois invalide (YYYY-MM)'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { month } = req.query;
      const startDate = `${month}-01`;
      const endDate = `${month}-01`;

      // Get all active barbers for this salon (residents + guests who worked this month)
      const barbersResult = await db.query(
        `SELECT id, name FROM barbers
         WHERE salon_id = $1 AND is_active = true
         ORDER BY name`,
        [salonId]
      );
      const barbers = barbersResult.rows;

      // --- Trophy 1: "Meilleur volume" (revenue ranking) ---
      const revenueResult = await db.query(
        `SELECT b.barber_id, br.name as barber_name,
                COALESCE(SUM(b.price), 0) as total_revenue
         FROM bookings b
         JOIN barbers br ON b.barber_id = br.id
         WHERE b.status = 'completed'
           AND b.date >= $1::date
           AND b.date < ($2::date + INTERVAL '1 month')
           AND b.deleted_at IS NULL
           AND b.salon_id = $3
         GROUP BY b.barber_id, br.name
         ORDER BY total_revenue DESC`,
        [startDate, endDate, salonId]
      );

      const topRevenue = revenueResult.rows.length > 0
        ? parseInt(revenueResult.rows[0].total_revenue, 10)
        : 0;

      const revenueRanking = revenueResult.rows.map((row, i) => ({
        barber_id: row.barber_id,
        barber_name: row.barber_name,
        rank: i + 1,
        percentage: topRevenue > 0
          ? Math.round((parseInt(row.total_revenue, 10) / topRevenue) * 100)
          : 0,
      }));

      // --- Trophy 2: "Roi des ventes" (bookings with product sold) ---
      const productSalesResult = await db.query(
        `SELECT ps.sold_by as barber_id, br.name as barber_name,
                COUNT(DISTINCT ps.booking_id) as bookings_with_sale
         FROM product_sales ps
         JOIN barbers br ON ps.sold_by = br.id
         WHERE ps.sold_by IS NOT NULL
           AND ps.booking_id IS NOT NULL
           AND ps.sold_at >= $1::date
           AND ps.sold_at < ($2::date + INTERVAL '1 month')
           AND ps.salon_id = $3
         GROUP BY ps.sold_by, br.name
         ORDER BY bookings_with_sale DESC`,
        [startDate, endDate, salonId]
      );

      const salesRanking = productSalesResult.rows.map((row, i) => ({
        barber_id: row.barber_id,
        barber_name: row.barber_name,
        rank: i + 1,
        count: parseInt(row.bookings_with_sale, 10),
      }));

      // --- Trophy 3: "Moins de faux plans" (fewest no-shows ranking) ---
      const noShowRankResult = await db.query(
        `SELECT br.id as barber_id, br.name as barber_name,
                COUNT(*) FILTER (WHERE b.status = 'no_show') as no_show_count,
                COUNT(*) FILTER (WHERE b.status = 'completed') as completed_count
         FROM barbers br
         LEFT JOIN bookings b ON b.barber_id = br.id
           AND b.date >= $1::date
           AND b.date < ($2::date + INTERVAL '1 month')
           AND b.deleted_at IS NULL
           AND b.salon_id = $3
         WHERE br.salon_id = $3 AND br.is_active = true
         GROUP BY br.id, br.name
         HAVING COUNT(*) FILTER (WHERE b.status = 'completed') > 0
         ORDER BY no_show_count ASC, completed_count DESC`,
        [startDate, endDate, salonId]
      );

      const maxNoShows = noShowRankResult.rows.length > 0
        ? Math.max(...noShowRankResult.rows.map(r => parseInt(r.no_show_count, 10)), 1)
        : 1;

      const noShowRanking = noShowRankResult.rows.map((row, i) => {
        const count = parseInt(row.no_show_count, 10);
        return {
          barber_id: row.barber_id,
          barber_name: row.barber_name,
          rank: i + 1,
          no_show_count: count,
          completed_count: parseInt(row.completed_count, 10),
          // Inverse percentage: 0 no-shows = 100%, max no-shows = low %
          percentage: Math.round(((maxNoShows - count) / maxNoShows) * 100),
          display_value: count === 0 ? '✓ 0' : `${count}`,
        };
      });

      res.json({
        month,
        salon_id: salonId,
        barbers: barbers.map(b => ({ id: b.id, name: b.name })),
        trophies: {
          meilleur_volume: {
            title: 'Meilleur volume',
            ranking: revenueRanking,
          },
          roi_des_ventes: {
            title: 'Roi des ventes',
            ranking: salesRanking,
          },
          moins_faux_plans: {
            title: 'Moins de faux plans',
            ranking: noShowRanking,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/objectives/challenges — Active challenges
// ============================================
router.get('/challenges', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;

    const result = await db.query(
      `SELECT c.id, c.title, c.target_value, c.metric_type,
              c.start_date, c.end_date, c.is_active, c.created_at,
              b.name as created_by_name
       FROM challenges c
       LEFT JOIN barbers b ON c.created_by = b.id
       WHERE c.salon_id = $1 AND c.is_active = true
       ORDER BY c.end_date ASC`,
      [salonId]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/admin/objectives/challenges — Create challenge
// ============================================
router.post('/challenges',
  [
    body('title').trim().notEmpty().withMessage('Titre requis').isLength({ max: 200 }),
    body('target_value').isInt({ min: 1 }).withMessage('Objectif requis (entier positif)'),
    body('metric_type').isIn(['products_sold', 'bookings_count', 'custom']).withMessage('Type invalide'),
    body('start_date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date début invalide'),
    body('end_date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date fin invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { title, target_value, metric_type, start_date, end_date } = req.body;

      if (end_date <= start_date) {
        return next(ApiError.badRequest('La date de fin doit être après la date de début'));
      }

      const result = await db.query(
        `INSERT INTO challenges (salon_id, title, target_value, metric_type, start_date, end_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [salonId, title, target_value, metric_type, start_date, end_date, req.user.id]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/objectives/challenges/:id
// ============================================
router.delete('/challenges/:id',
  [
    param('id').matches(uuidRegex).withMessage('ID invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;

      const result = await db.query(
        `DELETE FROM challenges WHERE id = $1 AND salon_id = $2 RETURNING id`,
        [req.params.id, salonId]
      );

      if (result.rows.length === 0) {
        return next(ApiError.notFound('Challenge introuvable'));
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/objectives/challenges/:id/progress
// ============================================
router.get('/challenges/:id/progress',
  [
    param('id').matches(uuidRegex).withMessage('ID invalide'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;

      // Fetch the challenge
      const challengeResult = await db.query(
        `SELECT * FROM challenges WHERE id = $1 AND salon_id = $2`,
        [req.params.id, salonId]
      );

      if (challengeResult.rows.length === 0) {
        return next(ApiError.notFound('Challenge introuvable'));
      }

      const challenge = challengeResult.rows[0];
      let progress = [];

      if (challenge.metric_type === 'products_sold') {
        const result = await db.query(
          `SELECT ps.sold_by as barber_id, br.name as barber_name,
                  COUNT(*) as current_value
           FROM product_sales ps
           JOIN barbers br ON ps.sold_by = br.id
           WHERE ps.sold_by IS NOT NULL
             AND ps.sold_at >= $1::date
             AND ps.sold_at < ($2::date + INTERVAL '1 day')
             AND ps.salon_id = $3
           GROUP BY ps.sold_by, br.name
           ORDER BY current_value DESC`,
          [challenge.start_date, challenge.end_date, salonId]
        );
        progress = result.rows;

      } else if (challenge.metric_type === 'bookings_count') {
        const result = await db.query(
          `SELECT b.barber_id, br.name as barber_name,
                  COUNT(*) as current_value
           FROM bookings b
           JOIN barbers br ON b.barber_id = br.id
           WHERE b.status = 'completed'
             AND b.date >= $1::date
             AND b.date <= $2::date
             AND b.deleted_at IS NULL
             AND b.salon_id = $3
           GROUP BY b.barber_id, br.name
           ORDER BY current_value DESC`,
          [challenge.start_date, challenge.end_date, salonId]
        );
        progress = result.rows;
      }
      // metric_type === 'custom' returns empty progress (tracked manually)

      const barberProgress = progress.map(row => ({
        barber_id: row.barber_id,
        barber_name: row.barber_name,
        current_value: parseInt(row.current_value, 10),
        target_value: challenge.target_value,
        percentage: Math.min(100, Math.round((parseInt(row.current_value, 10) / challenge.target_value) * 100)),
      }));

      res.json({
        challenge: {
          id: challenge.id,
          title: challenge.title,
          target_value: challenge.target_value,
          metric_type: challenge.metric_type,
          start_date: challenge.start_date,
          end_date: challenge.end_date,
        },
        progress: barberProgress,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
