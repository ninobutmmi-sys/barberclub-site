const { Router } = require('express');
const { query } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const db = require('../../config/database');

const router = Router();

// ============================================
// GET /api/admin/analytics/dashboard — KPIs overview
// ============================================
router.get('/dashboard', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const { month } = req.query;

    // Use Paris timezone for "today" to avoid UTC midnight issues
    const todayResult = await db.query(`SELECT (NOW() AT TIME ZONE 'Europe/Paris')::date AS today`);
    const today = todayResult.rows[0].today;

    // Determine date range based on month param or default (current month)
    let firstOfMonth, lastOfMonth, prevFrom, prevTo, hasMonthParam = false;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      hasMonthParam = true;
      const range = getMonthRange(month);
      firstOfMonth = range.from;
      lastOfMonth = range.to;
      prevFrom = range.prevFrom;
      prevTo = range.prevTo;
    } else {
      firstOfMonth = today.substring(0, 8) + '01';
      lastOfMonth = today;
    }

    // Today's stats (always real today, regardless of month param)
    const todayStats = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) as bookings_today,
         COALESCE(SUM(price) FILTER (WHERE status IN ('confirmed', 'completed')), 0) as revenue_today,
         COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_today
       FROM bookings
       WHERE date = $1 AND deleted_at IS NULL AND salon_id = $2`,
      [today, salonId]
    );

    // Monthly stats for selected month
    const monthStats = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) as bookings_month,
         COALESCE(SUM(price) FILTER (WHERE status IN ('confirmed', 'completed')), 0) as revenue_month,
         COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_month
       FROM bookings
       WHERE date >= $1 AND date <= $2 AND deleted_at IS NULL AND salon_id = $3`,
      [firstOfMonth, lastOfMonth, salonId]
    );

    // New clients this month
    const newClients = await db.query(
      `SELECT COUNT(DISTINCT c.id) as count FROM clients c
       JOIN bookings b ON c.id = b.client_id
       WHERE c.created_at >= $1 AND c.created_at < ($2::date + INTERVAL '1 day') AND c.deleted_at IS NULL AND b.salon_id = $3`,
      [firstOfMonth, lastOfMonth, salonId]
    );

    // Next bookings for each barber (always real today)
    const nextBookings = await db.query(
      `SELECT DISTINCT ON (b.barber_id)
         b.id, b.start_time, b.end_time,
         br.name as barber_name,
         s.name as service_name,
         c.first_name || ' ' || c.last_name as client_name
       FROM bookings b
       JOIN barbers br ON b.barber_id = br.id
       JOIN services s ON b.service_id = s.id
       JOIN clients c ON b.client_id = c.id
       WHERE b.date = $1 AND b.status = 'confirmed' AND b.deleted_at IS NULL AND b.salon_id = $2
         AND b.start_time >= CURRENT_TIME
       ORDER BY b.barber_id, b.start_time`,
      [today, salonId]
    );

    // Product sales today
    const productSalesToday = await db.query(
      `SELECT COALESCE(SUM(total_price), 0) as revenue, COUNT(*) as count
       FROM product_sales WHERE sold_at >= $1::date AND sold_at < ($1::date + INTERVAL '1 day') AND salon_id = $2`,
      [today, salonId]
    );

    // Product sales this month
    const productSalesMonth = await db.query(
      `SELECT COALESCE(SUM(total_price), 0) as revenue, COUNT(*) as count
       FROM product_sales WHERE sold_at >= $1::date AND sold_at < ($2::date + INTERVAL '1 day') AND salon_id = $3`,
      [firstOfMonth, lastOfMonth, salonId]
    );

    const t = todayStats.rows[0];
    const m = monthStats.rows[0];
    const pt = productSalesToday.rows[0];
    const pm2 = productSalesMonth.rows[0];

    const response = {
      today: {
        bookings: parseInt(t.bookings_today),
        revenue: parseInt(t.revenue_today),
        cancelled: parseInt(t.cancelled_today),
        product_revenue: parseInt(pt.revenue),
        product_count: parseInt(pt.count),
      },
      month: {
        bookings: parseInt(m.bookings_month),
        revenue: parseInt(m.revenue_month),
        cancelled: parseInt(m.cancelled_month),
        new_clients: parseInt(newClients.rows[0].count),
        average_basket: parseInt(m.bookings_month) > 0
          ? Math.round(parseInt(m.revenue_month) / parseInt(m.bookings_month))
          : 0,
        product_revenue: parseInt(pm2.revenue),
        product_count: parseInt(pm2.count),
      },
      next_bookings: nextBookings.rows,
    };

    // Previous month comparison when month param is provided
    if (hasMonthParam) {
      const prevMonthStats = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) as bookings_month,
           COALESCE(SUM(price) FILTER (WHERE status IN ('confirmed', 'completed')), 0) as revenue_month,
           COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_month
         FROM bookings
         WHERE date >= $1 AND date <= $2 AND deleted_at IS NULL AND salon_id = $3`,
        [prevFrom, prevTo, salonId]
      );

      const prevNewClients = await db.query(
        `SELECT COUNT(DISTINCT c.id) as count FROM clients c
         JOIN bookings b ON c.id = b.client_id
         WHERE c.created_at >= $1 AND c.created_at < ($2::date + INTERVAL '1 day') AND c.deleted_at IS NULL AND b.salon_id = $3`,
        [prevFrom, prevTo, salonId]
      );

      const pm = prevMonthStats.rows[0];
      response.previous = {
        bookings: parseInt(pm.bookings_month),
        revenue: parseInt(pm.revenue_month),
        cancelled: parseInt(pm.cancelled_month),
        new_clients: parseInt(prevNewClients.rows[0].count),
        average_basket: parseInt(pm.bookings_month) > 0
          ? Math.round(parseInt(pm.revenue_month) / parseInt(pm.bookings_month))
          : 0,
        period: { from: prevFrom, to: prevTo },
      };
      response.month.period = { from: firstOfMonth, to: lastOfMonth };
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/analytics/revenue — Revenue over time
// ============================================
router.get('/revenue',
  [
    query('period').optional().isIn(['day', 'week', 'month']),
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('month').optional().matches(/^\d{4}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { period = 'day', month } = req.query;
      let fromDate, toDate, prevFrom, prevTo, hasMonthParam = false;

      if (month) {
        hasMonthParam = true;
        const range = getMonthRange(month);
        fromDate = range.from;
        toDate = range.to;
        prevFrom = range.prevFrom;
        prevTo = range.prevTo;
      } else {
        toDate = req.query.to || getParisTodayISO();
        fromDate = req.query.from || getDefaultFrom(period);
      }

      let groupBy, dateExpr;
      if (period === 'month') {
        dateExpr = "TO_CHAR(date, 'YYYY-MM')";
        groupBy = dateExpr;
      } else if (period === 'week') {
        dateExpr = "TO_CHAR(DATE_TRUNC('week', date), 'YYYY-MM-DD')";
        groupBy = "DATE_TRUNC('week', date)";
      } else {
        dateExpr = "TO_CHAR(date, 'YYYY-MM-DD')";
        groupBy = 'date';
      }

      const salonId = req.user.salon_id;
      const result = await db.query(
        `SELECT ${dateExpr} as period,
                COUNT(*) as booking_count,
                COALESCE(SUM(price), 0) as revenue
         FROM bookings
         WHERE date >= $1 AND date <= $2
           AND status IN ('confirmed', 'completed')
           AND deleted_at IS NULL AND salon_id = $3
         GROUP BY ${groupBy}
         ORDER BY ${groupBy}`,
        [fromDate, toDate, salonId]
      );

      const response = { data: result.rows };

      if (hasMonthParam) {
        const prevResult = await db.query(
          `SELECT ${dateExpr} as period,
                  COUNT(*) as booking_count,
                  COALESCE(SUM(price), 0) as revenue
           FROM bookings
           WHERE date >= $1 AND date <= $2
             AND status IN ('confirmed', 'completed')
             AND deleted_at IS NULL AND salon_id = $3
           GROUP BY ${groupBy}
           ORDER BY ${groupBy}`,
          [prevFrom, prevTo, salonId]
        );
        response.previous = prevResult.rows;
      }

      // Backward compatible: return array when no month param, object when month param
      res.json(hasMonthParam ? response : result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/analytics/bookings-count — Bookings over time
// ============================================
router.get('/bookings-count',
  [
    query('period').optional().isIn(['day', 'week', 'month']),
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { period = 'day', from, to } = req.query;
      const toDate = to || getParisTodayISO();
      const fromDate = from || getDefaultFrom(period);

      const dateExpr = period === 'month'
        ? "TO_CHAR(date, 'YYYY-MM')"
        : "TO_CHAR(date, 'YYYY-MM-DD')";
      const groupBy = period === 'month' ? "TO_CHAR(date, 'YYYY-MM')" : 'date';

      const salonId = req.user.salon_id;
      const result = await db.query(
        `SELECT ${dateExpr} as period,
                COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) as confirmed,
                COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
                COUNT(*) FILTER (WHERE status = 'no_show') as no_show
         FROM bookings
         WHERE date >= $1 AND date <= $2 AND deleted_at IS NULL AND salon_id = $3
         GROUP BY ${groupBy}
         ORDER BY ${groupBy}`,
        [fromDate, toDate, salonId]
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/analytics/peak-hours — Peak hours heatmap
// ============================================
router.get('/peak-hours',
  [
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('month').optional().matches(/^\d{4}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      let fromDate, toDate, prevFrom, prevTo, hasMonthParam = false;

      if (req.query.month) {
        hasMonthParam = true;
        const range = getMonthRange(req.query.month);
        fromDate = range.from;
        toDate = range.to;
        prevFrom = range.prevFrom;
        prevTo = range.prevTo;
      } else {
        toDate = req.query.to || getParisTodayISO();
        fromDate = req.query.from || getDefaultFrom('month');
      }

      // ── Taux de remplissage par creneau ──
      // Compter les RDV ne dit rien : trois RDV le mardi a 9h avec un seul
      // barbier de service, c'est plein ; trois le samedi a 11h avec quatre
      // barbiers, c'est un quart de la capacite. On compare donc les minutes
      // vendues aux minutes ouvertes, creneau par creneau.
      const remplissage = await db.query(
        `WITH jours AS (
           SELECT generate_series($1::date, $2::date, '1 day')::date AS d
         ),
         heures AS (SELECT generate_series(8, 20) AS h),
         equipe AS (
           SELECT id, contract_start, contract_end
           FROM barbers
           WHERE salon_id = $3 AND deleted_at IS NULL
             AND (is_active = true OR EXISTS (
               SELECT 1 FROM bookings b WHERE b.barber_id = barbers.id AND b.salon_id = $3
                 AND b.date >= $1::date AND b.date <= $2::date AND b.deleted_at IS NULL
                 AND b.status IN ('confirmed', 'completed')))
         ),
         ouvert_detail AS (
           -- On garde le barbier et la date : un blocage vise quelqu'un un jour
           -- precis, on ne peut pas le retrancher d'une somme deja agregee.
           SELECT e.id AS barber_id, j.d AS d, hr.h AS heure,
                  (
                    GREATEST(0, EXTRACT(EPOCH FROM (
                      LEAST(sc.end_time, make_time(hr.h + 1, 0, 0)) - GREATEST(sc.start_time, make_time(hr.h, 0, 0))
                    )) / 60)
                    -- La pause dejeuner ne se vend pas. Le CASE est
                    -- indispensable : LEAST et GREATEST ignorent les NULL, donc
                    -- sans pause enregistree ils renvoyaient les bornes de
                    -- l'heure et comptaient soixante minutes de pause pour tout
                    -- le monde — de quoi annuler exactement le temps ouvert.
                    - CASE WHEN sc.break_start IS NOT NULL AND sc.break_end IS NOT NULL
                        THEN GREATEST(0, EXTRACT(EPOCH FROM (
                          LEAST(sc.break_end, make_time(hr.h + 1, 0, 0)) - GREATEST(sc.break_start, make_time(hr.h, 0, 0))
                        )) / 60)
                        ELSE 0 END
                  )::int AS minutes
           FROM jours j
           CROSS JOIN equipe e
           CROSS JOIN heures hr
           JOIN LATERAL (
             SELECT s.start_time, s.end_time, s.break_start, s.break_end
             FROM schedules s
             WHERE s.barber_id = e.id
               AND s.day_of_week = ((EXTRACT(DOW FROM j.d)::int + 6) % 7)
               AND s.is_working = true
             LIMIT 1
           ) sc ON true
           WHERE (e.contract_start IS NULL OR j.d >= e.contract_start)
             AND (e.contract_end IS NULL OR j.d <= e.contract_end)
             AND NOT EXISTS (
               SELECT 1 FROM schedule_overrides o
               WHERE o.barber_id = e.id AND o.date = j.d AND o.is_day_off = true
             )
         ),
         blocages AS (
           -- Pauses, absences, ecole : du temps ou le barbier figure a
           -- l'horaire mais n'est pas vendable. Sans cette soustraction il
           -- gonflait la capacite et ecrasait le taux — le jeudi de Meylan
           -- tombait a 13 % parce qu'un barbier bloque 9 h-19 h comptait
           -- comme une journee entiere de disponible.
           SELECT e.id AS barber_id, bs.date AS d, hr.h AS heure,
                  SUM(GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(bs.end_time, make_time(hr.h + 1, 0, 0)) - GREATEST(bs.start_time, make_time(hr.h, 0, 0))
                  )) / 60))::int AS minutes
           FROM blocked_slots bs
           CROSS JOIN heures hr
           -- barber_id NULL = salon ferme : le blocage vaut pour tout le monde.
           JOIN equipe e ON (bs.barber_id = e.id OR bs.barber_id IS NULL)
           WHERE bs.salon_id = $3 AND bs.date >= $1::date AND bs.date <= $2::date
             AND bs.start_time < make_time(hr.h + 1, 0, 0)
             AND bs.end_time > make_time(hr.h, 0, 0)
           GROUP BY 1, 2, 3
         ),
         ouvert AS (
           SELECT ((EXTRACT(DOW FROM od.d)::int + 6) % 7) AS jour, od.heure,
                  SUM(GREATEST(0, od.minutes - COALESCE(bl.minutes, 0)))::int AS minutes
           FROM ouvert_detail od
           LEFT JOIN blocages bl
             ON bl.barber_id = od.barber_id AND bl.d = od.d AND bl.heure = od.heure
           GROUP BY 1, 2
         ),
         renforts AS (
           -- Les barbiers invites ouvrent aussi du temps : sans eux, le samedi
           -- de Meylan depassait 120 % de remplissage.
           SELECT ((EXTRACT(DOW FROM g.date)::int + 6) % 7) AS jour, hr.h AS heure,
                  SUM(GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(g.end_time, make_time(hr.h + 1, 0, 0)) - GREATEST(g.start_time, make_time(hr.h, 0, 0))
                  )) / 60))::int AS minutes
           FROM guest_assignments g
           CROSS JOIN heures hr
           WHERE g.host_salon_id = $3 AND g.date >= $1::date AND g.date <= $2::date
           GROUP BY 1, 2
         ),
         capacite AS (
           SELECT jour, heure, SUM(minutes)::int AS minutes
           FROM (SELECT * FROM ouvert UNION ALL SELECT * FROM renforts) t
           GROUP BY 1, 2
         ),
         vendu AS (
           SELECT ((EXTRACT(DOW FROM b.date)::int + 6) % 7) AS jour, hr.h AS heure,
                  SUM(GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(b.end_time, make_time(hr.h + 1, 0, 0)) - GREATEST(b.start_time, make_time(hr.h, 0, 0))
                  )) / 60))::int AS minutes,
                  COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM b.start_time) = hr.h)::int AS rdv
           FROM bookings b
           CROSS JOIN heures hr
           WHERE b.salon_id = $3 AND b.date >= $1 AND b.date <= $2
             AND b.status IN ('confirmed', 'completed') AND b.deleted_at IS NULL
             AND b.start_time < make_time(hr.h + 1, 0, 0) AND b.end_time > make_time(hr.h, 0, 0)
           GROUP BY 1, 2
         )
         SELECT o.jour, o.heure,
                -- Un creneau ou l'on a coupe plus que le planning ne prevoit a
                -- bien ete travaille : la capacite ne peut pas etre inferieure
                -- au temps vendu, sinon on affiche 129 % de remplissage.
                GREATEST(o.minutes, COALESCE(v.minutes, 0)) AS open_minutes,
                COALESCE(v.minutes, 0) AS booked_minutes,
                COALESCE(v.rdv, 0) AS bookings,
                ROUND(COALESCE(v.minutes, 0) * 100.0 / NULLIF(GREATEST(o.minutes, COALESCE(v.minutes, 0)), 0)) AS fill_rate
         FROM capacite o
         LEFT JOIN vendu v ON v.jour = o.jour AND v.heure = o.heure
         WHERE o.minutes > 0
         ORDER BY o.jour, o.heure`,
        [fromDate, toDate, salonId]
      );

      // Bookings by day of week and hour
      const result = await db.query(
        `SELECT
           EXTRACT(DOW FROM date) as day_of_week,
           EXTRACT(HOUR FROM start_time) as hour,
           COUNT(*) as count
         FROM bookings
         WHERE date >= $1 AND date <= $2
           AND status IN ('confirmed', 'completed')
           AND deleted_at IS NULL AND salon_id = $3
         GROUP BY EXTRACT(DOW FROM date), EXTRACT(HOUR FROM start_time)
         ORDER BY day_of_week, hour`,
        [fromDate, toDate, salonId]
      );

      // Best days of the week
      const bestDays = await db.query(
        `SELECT
           EXTRACT(DOW FROM date) as day_of_week,
           COUNT(*) as booking_count,
           COALESCE(SUM(price), 0) as revenue
         FROM bookings
         WHERE date >= $1 AND date <= $2
           AND status IN ('confirmed', 'completed')
           AND deleted_at IS NULL AND salon_id = $3
         GROUP BY EXTRACT(DOW FROM date)
         ORDER BY revenue DESC`,
        [fromDate, toDate, salonId]
      );

      const response = {
        heatmap: result.rows,
        best_days: bestDays.rows,
        // 0 = lundi, heure locale du salon, taux en pourcentage
        fill: remplissage.rows.map(r => ({
          day: parseInt(r.jour),
          hour: parseInt(r.heure),
          open_minutes: parseInt(r.open_minutes),
          booked_minutes: parseInt(r.booked_minutes),
          bookings: parseInt(r.bookings),
          fill_rate: r.fill_rate === null ? 0 : parseInt(r.fill_rate),
        })),
      };

      if (hasMonthParam) {
        const prevResult = await db.query(
          `SELECT
             EXTRACT(DOW FROM date) as day_of_week,
             EXTRACT(HOUR FROM start_time) as hour,
             COUNT(*) as count
           FROM bookings
           WHERE date >= $1 AND date <= $2
             AND status IN ('confirmed', 'completed')
             AND deleted_at IS NULL AND salon_id = $3
           GROUP BY EXTRACT(DOW FROM date), EXTRACT(HOUR FROM start_time)
           ORDER BY day_of_week, hour`,
          [prevFrom, prevTo, salonId]
        );

        const prevBestDays = await db.query(
          `SELECT
             EXTRACT(DOW FROM date) as day_of_week,
             COUNT(*) as booking_count,
             COALESCE(SUM(price), 0) as revenue
           FROM bookings
           WHERE date >= $1 AND date <= $2
             AND status IN ('confirmed', 'completed')
             AND deleted_at IS NULL AND salon_id = $3
           GROUP BY EXTRACT(DOW FROM date)
           ORDER BY revenue DESC`,
          [prevFrom, prevTo, salonId]
        );

        response.previous = {
          heatmap: prevResult.rows,
          best_days: prevBestDays.rows,
        };
      }

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/analytics/occupancy — Occupancy rate
// ============================================
router.get('/occupancy',
  [
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('month').optional().matches(/^\d{4}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      let fromDate, toDate, prevFrom, prevTo, hasMonthParam = false;

      if (req.query.month) {
        hasMonthParam = true;
        const range = getMonthRange(req.query.month);
        fromDate = range.from;
        toDate = range.to;
        prevFrom = range.prevFrom;
        prevTo = range.prevTo;
      } else {
        toDate = req.query.to || getParisTodayISO();
        fromDate = req.query.from || getDefaultFrom('month');
      }

      const salonId = req.user.salon_id;

      // ── Taux d'occupation ──
      // L'ancien calcul comptait « nombre de RDV / (jours x barbiers actifs x 20) ».
      // Il ignorait les horaires reels : un barbier a mi-temps pesait autant
      // qu'un plein temps, une arrivee en cours de mois comptait le mois entier
      // (Daryl commence le 2 septembre, Eddine le 15), une coupe d'une heure
      // valait autant qu'une de vingt minutes. La capacite vient maintenant des
      // horaires, et l'occupation se mesure en minutes.
      const occupancySql = `
        WITH jours AS (
          SELECT generate_series($1::date, $2::date, '1 day')::date AS d
        ),
        equipe AS (
          -- Les barbiers en poste, plus ceux qui ont reellement coupe sur la
          -- periode : la fiche de Benji est desactivee depuis fin juillet, mais
          -- ses heures de juillet font partie de la capacite de juillet. Sans
          -- elles, ses coupes gonflaient le taux — Meylan affichait 97 %.
          SELECT id, contract_start, contract_end
          FROM barbers
          WHERE salon_id = $3 AND deleted_at IS NULL
            AND (
              is_active = true
              OR EXISTS (
                SELECT 1 FROM bookings b
                WHERE b.barber_id = barbers.id AND b.salon_id = $3
                  AND b.date >= $1::date AND b.date <= $2::date
                  AND b.deleted_at IS NULL AND b.status IN ('confirmed', 'completed')
              )
            )
        ),
        blocages AS (
          -- Meme raison qu'ailleurs : une pause, une absence ou une journee
          -- d'ecole reste inscrite a l'horaire hebdomadaire. La compter comme
          -- du temps ouvert fait baisser le taux d'occupation sans qu'aucun
          -- creneau vendable ait ete perdu.
          SELECT bs.date AS d, e.id AS barber_id,
                 SUM(EXTRACT(EPOCH FROM (bs.end_time - bs.start_time)) / 60)::int AS minutes
          FROM blocked_slots bs
          -- barber_id NULL = salon ferme : le blocage vaut pour tout le monde.
          JOIN equipe e ON (bs.barber_id = e.id OR bs.barber_id IS NULL)
          WHERE bs.salon_id = $3 AND bs.date >= $1::date AND bs.date <= $2::date
          GROUP BY 1, 2
        ),
        capacite AS (
          SELECT j.d, e.id AS barber_id,
                 GREATEST(0,
                   EXTRACT(EPOCH FROM (sc.end_time - sc.start_time)) / 60
                   - COALESCE(EXTRACT(EPOCH FROM (sc.break_end - sc.break_start)) / 60, 0)
                   - COALESCE(bl.minutes, 0)
                 )::int AS minutes
          FROM jours j
          CROSS JOIN equipe e
          -- 0 = lundi en base, la ou Postgres met 0 = dimanche
          JOIN LATERAL (
            SELECT s.start_time, s.end_time, s.break_start, s.break_end
            FROM schedules s
            WHERE s.barber_id = e.id
              AND s.day_of_week = ((EXTRACT(DOW FROM j.d)::int + 6) % 7)
              AND s.is_working = true
            LIMIT 1
          ) sc ON true
          LEFT JOIN blocages bl ON bl.barber_id = e.id AND bl.d = j.d
          WHERE (e.contract_start IS NULL OR j.d >= e.contract_start)
            AND (e.contract_end IS NULL OR j.d <= e.contract_end)
            AND NOT EXISTS (
              SELECT 1 FROM schedule_overrides o
              WHERE o.barber_id = e.id AND o.date = j.d AND o.is_day_off = true
            )
        ),
        renforts AS (
          -- Les barbiers invites ajoutent leurs heures a la capacite du salon
          SELECT g.date AS d, g.barber_id,
                 (EXTRACT(EPOCH FROM (g.end_time - g.start_time)) / 60)::int AS minutes
          FROM guest_assignments g
          WHERE g.host_salon_id = $3 AND g.date >= $1::date AND g.date <= $2::date
        ),
        pris AS (
          SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0)::int AS minutes,
                 COUNT(*)::int AS rdv
          FROM bookings
          WHERE salon_id = $3 AND date >= $1::date AND date <= $2::date
            AND status IN ('confirmed', 'completed')
            AND deleted_at IS NULL
        ),
        heures_barbier AS (
          SELECT t.barber_id, SUM(t.minutes)::int AS minutes_ouvertes
          FROM (SELECT * FROM capacite UNION ALL SELECT * FROM renforts) t
          GROUP BY t.barber_id
        ),
        pris_barbier AS (
          SELECT bk.barber_id,
                 SUM(EXTRACT(EPOCH FROM (bk.end_time - bk.start_time)) / 60)::int AS minutes_prises
          FROM bookings bk
          WHERE bk.salon_id = $3 AND bk.date >= $1::date AND bk.date <= $2::date
            AND bk.status IN ('confirmed', 'completed') AND bk.deleted_at IS NULL
          GROUP BY bk.barber_id
        ),
        par_barbier AS (
          -- Regroupe par nom : les fiches en double (Benji, LOUAY/Louay) ne
          -- doivent pas faire deux lignes.
          -- Un barbier qui a coupe plus d'heures que son planning n'en prevoit
          -- (journee d'invite non saisie) a bien travaille ces heures-la : la
          -- capacite les inclut, sinon on affiche 235 % d'occupation.
          SELECT INITCAP(LOWER(br.name)) AS name,
                 GREATEST(SUM(COALESCE(h.minutes_ouvertes, 0)),
                          SUM(COALESCE(pb.minutes_prises, 0)))::int AS minutes_ouvertes,
                 SUM(COALESCE(pb.minutes_prises, 0))::int AS minutes_prises
          FROM barbers br
          LEFT JOIN heures_barbier h ON h.barber_id = br.id
          LEFT JOIN pris_barbier pb ON pb.barber_id = br.id
          WHERE h.barber_id IS NOT NULL OR pb.barber_id IS NOT NULL
          GROUP BY INITCAP(LOWER(br.name))
        )
        SELECT
          (SELECT COALESCE(SUM(minutes_ouvertes), 0) FROM par_barbier) AS minutes_ouvertes,
          (SELECT minutes FROM pris) AS minutes_prises,
          (SELECT rdv FROM pris) AS rdv,
          (SELECT COUNT(DISTINCT d) FROM capacite) AS jours_ouverts,
          (SELECT COALESCE(json_agg(json_build_object(
             'name', name,
             'open_minutes', minutes_ouvertes,
             'booked_minutes', minutes_prises,
             'occupancy_percent', CASE WHEN minutes_ouvertes > 0
                                       THEN ROUND(minutes_prises * 100.0 / minutes_ouvertes)
                                       ELSE 0 END
           ) ORDER BY minutes_prises DESC), '[]'::json) FROM par_barbier) AS barbiers`;

      const occ = await db.query(occupancySql, [fromDate, toDate, salonId]);
      const o = occ.rows[0];
      const openMinutes = parseInt(o.minutes_ouvertes) || 0;
      const bookedMinutes = parseInt(o.minutes_prises) || 0;
      const totalBookings = parseInt(o.rdv) || 0;
      const workingDays = parseInt(o.jours_ouverts) || 0;
      const occupancyRate = openMinutes > 0 ? Math.round((bookedMinutes / openMinutes) * 100) : 0;

      const response = {
        occupancy_rate: occupancyRate,
        total_bookings: totalBookings,
        booked_minutes: bookedMinutes,
        open_minutes: openMinutes,
        working_days: workingDays,
        barbers: o.barbiers || [],
        period: { from: fromDate, to: toDate },
      };

      if (hasMonthParam) {
        const prevOcc = await db.query(occupancySql, [prevFrom, prevTo, salonId]);
        const po = prevOcc.rows[0];
        const prevOpen = parseInt(po.minutes_ouvertes) || 0;
        const prevBooked = parseInt(po.minutes_prises) || 0;
        const prevTotalBookings = parseInt(po.rdv) || 0;
        const prevWorkingDays = parseInt(po.jours_ouverts) || 0;
        const prevOccupancyRate = prevOpen > 0 ? Math.round((prevBooked / prevOpen) * 100) : 0;

        response.previous = {
          occupancy_rate: prevOccupancyRate,
          total_bookings: prevTotalBookings,
          booked_minutes: prevBooked,
          open_minutes: prevOpen,
          working_days: prevWorkingDays,
          period: { from: prevFrom, to: prevTo },
        };
      }

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/analytics/services — Stats by service
// ============================================
router.get('/services',
  [
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('month').optional().matches(/^\d{4}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      let fromDate, toDate, prevFrom, prevTo, hasMonthParam = false;

      if (req.query.month) {
        hasMonthParam = true;
        const range = getMonthRange(req.query.month);
        fromDate = range.from;
        toDate = range.to;
        prevFrom = range.prevFrom;
        prevTo = range.prevTo;
      } else {
        toDate = req.query.to || getParisTodayISO();
        fromDate = req.query.from || getDefaultFrom('month');
      }

      const salonId = req.user.salon_id;
      const result = await db.query(
        `SELECT s.name,
                COUNT(b.id) as booking_count,
                COALESCE(SUM(b.price), 0) as revenue,
                ROUND(AVG(b.price)) as avg_price
         FROM services s
         LEFT JOIN bookings b ON s.id = b.service_id
           AND b.date >= $1 AND b.date <= $2
           AND b.status IN ('confirmed', 'completed')
           AND b.deleted_at IS NULL
         WHERE s.deleted_at IS NULL AND s.salon_id = $3
         GROUP BY s.id, s.name
         ORDER BY booking_count DESC`,
        [fromDate, toDate, salonId]
      );

      // Trend per service (monthly)
      const trendResult = await db.query(
        `SELECT s.name, TO_CHAR(b.date, 'YYYY-MM') as month, COUNT(*) as count
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         WHERE b.date >= $1 AND b.date <= $2
           AND b.status IN ('confirmed', 'completed')
           AND b.deleted_at IS NULL AND b.salon_id = $3
         GROUP BY s.name, TO_CHAR(b.date, 'YYYY-MM')
         ORDER BY s.name, month`,
        [fromDate, toDate, salonId]
      );

      const response = {
        services: result.rows,
        trends: trendResult.rows,
      };

      if (hasMonthParam) {
        const prevResult = await db.query(
          `SELECT s.name,
                  COUNT(b.id) as booking_count,
                  COALESCE(SUM(b.price), 0) as revenue,
                  ROUND(AVG(b.price)) as avg_price
           FROM services s
           LEFT JOIN bookings b ON s.id = b.service_id
             AND b.date >= $1 AND b.date <= $2
             AND b.status IN ('confirmed', 'completed')
             AND b.deleted_at IS NULL
           WHERE s.deleted_at IS NULL AND s.salon_id = $3
           GROUP BY s.id, s.name
           ORDER BY booking_count DESC`,
          [prevFrom, prevTo, salonId]
        );

        const prevTrendResult = await db.query(
          `SELECT s.name, TO_CHAR(b.date, 'YYYY-MM') as month, COUNT(*) as count
           FROM bookings b
           JOIN services s ON b.service_id = s.id
           WHERE b.date >= $1 AND b.date <= $2
             AND b.status IN ('confirmed', 'completed')
             AND b.deleted_at IS NULL AND b.salon_id = $3
           GROUP BY s.name, TO_CHAR(b.date, 'YYYY-MM')
           ORDER BY s.name, month`,
          [prevFrom, prevTo, salonId]
        );

        response.previous = {
          services: prevResult.rows,
          trends: prevTrendResult.rows,
        };
      }

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/analytics/barbers — Stats by barber
// ============================================
router.get('/barbers',
  [
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('month').optional().matches(/^\d{4}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      let fromDate, toDate, prevFrom, prevTo, hasMonthParam = false;

      if (req.query.month) {
        hasMonthParam = true;
        const range = getMonthRange(req.query.month);
        fromDate = range.from;
        toDate = range.to;
        prevFrom = range.prevFrom;
        prevTo = range.prevTo;
      } else {
        toDate = req.query.to || getParisTodayISO();
        fromDate = req.query.from || getDefaultFrom('month');
      }

      const salonId = req.user.salon_id;
      // On part des RDV du salon, pas de sa liste de barbiers : un barbier
      // invite venu d'un autre salon manquait au tableau, et un barbier maison
      // parti couper ailleurs y ramenait son chiffre. A Grenoble en aout, les
      // deux erreurs faisaient 506 € d'ecart avec le CA du salon.
      const result = await db.query(
        `SELECT INITCAP(LOWER(br.name)) AS name,
                COUNT(b.id) FILTER (WHERE b.status IN ('confirmed', 'completed')) as booking_count,
                COALESCE(SUM(b.price) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) as revenue,
                COUNT(DISTINCT b.client_id) FILTER (WHERE b.status IN ('confirmed', 'completed')) as unique_clients,
                COUNT(b.id) FILTER (WHERE b.status = 'no_show') as no_shows
         FROM bookings b
         JOIN barbers br ON br.id = b.barber_id
         WHERE b.salon_id = $3 AND b.date >= $1 AND b.date <= $2
           AND b.deleted_at IS NULL
           AND b.status IN ('confirmed', 'completed', 'no_show')
         GROUP BY INITCAP(LOWER(br.name))
         ORDER BY revenue DESC`,
        [fromDate, toDate, salonId]
      );

      // Loyalty rate per barber (clients who came back to same barber)
      const loyaltyResult = await db.query(
        `SELECT br.name,
                COUNT(DISTINCT b.client_id) as total_clients,
                COUNT(DISTINCT b.client_id) FILTER (
                  WHERE b.client_id IN (
                    SELECT client_id FROM bookings b2
                    WHERE b2.barber_id = br.id AND b2.status IN ('completed', 'confirmed')
                      AND b2.deleted_at IS NULL
                    GROUP BY client_id HAVING COUNT(*) > 1
                  )
                ) as returning_clients
         FROM barbers br
         LEFT JOIN bookings b ON br.id = b.barber_id
           AND b.status IN ('confirmed', 'completed')
           AND b.deleted_at IS NULL
         WHERE br.deleted_at IS NULL AND br.salon_id = $1
         GROUP BY br.id, br.name`,
        [salonId]
      );

      const response = {
        barbers: result.rows,
        loyalty: loyaltyResult.rows,
      };

      if (hasMonthParam) {
        const prevResult = await db.query(
          `SELECT INITCAP(LOWER(br.name)) AS name,
                  COUNT(b.id) FILTER (WHERE b.status IN ('confirmed', 'completed')) as booking_count,
                  COALESCE(SUM(b.price) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) as revenue,
                  COUNT(DISTINCT b.client_id) FILTER (WHERE b.status IN ('confirmed', 'completed')) as unique_clients,
                  COUNT(b.id) FILTER (WHERE b.status = 'no_show') as no_shows
           FROM bookings b
           JOIN barbers br ON br.id = b.barber_id
           WHERE b.salon_id = $3 AND b.date >= $1 AND b.date <= $2
             AND b.deleted_at IS NULL
             AND b.status IN ('confirmed', 'completed', 'no_show')
           GROUP BY INITCAP(LOWER(br.name))
           ORDER BY revenue DESC`,
          [prevFrom, prevTo, salonId]
        );

        response.previous = {
          barbers: prevResult.rows,
        };
      }

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/analytics/clients — Client stats
// ============================================
router.get('/clients', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;

    // New vs returning clients per month
    const newVsReturning = await db.query(
      `WITH first_visits AS (
         SELECT client_id, MIN(date) as first_date
         FROM bookings
         WHERE status IN ('confirmed', 'completed') AND deleted_at IS NULL AND salon_id = $1
           AND date <= (NOW() AT TIME ZONE 'Europe/Paris')::date
         GROUP BY client_id
       )
       SELECT TO_CHAR(b.date, 'YYYY-MM') as month,
              COUNT(DISTINCT b.client_id) FILTER (
                WHERE b.client_id IN (
                  SELECT fv.client_id FROM first_visits fv
                  WHERE TO_CHAR(fv.first_date, 'YYYY-MM') = TO_CHAR(b.date, 'YYYY-MM')
                )
              ) as new_clients,
              COUNT(DISTINCT b.client_id) as total_clients
       FROM bookings b
       WHERE b.status IN ('confirmed', 'completed') AND b.deleted_at IS NULL AND b.salon_id = $1
         AND b.date >= CURRENT_DATE - INTERVAL '12 months' AND b.date <= (NOW() AT TIME ZONE 'Europe/Paris')::date
       GROUP BY TO_CHAR(b.date, 'YYYY-MM')
       ORDER BY month`,
      [salonId]
    );

    // Top 10 clients by revenue
    const topClients = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.phone,
              COUNT(b.id) as visit_count,
              COALESCE(SUM(b.price), 0) as total_spent,
              MAX(b.date) as last_visit
       FROM clients c
       JOIN bookings b ON c.id = b.client_id
       WHERE b.status IN ('confirmed', 'completed') AND b.deleted_at IS NULL AND b.salon_id = $1
         AND c.deleted_at IS NULL AND b.date <= (NOW() AT TIME ZONE 'Europe/Paris')::date
       GROUP BY c.id
       ORDER BY total_spent DESC
       LIMIT 10`,
      [salonId]
    );

    // Average visit frequency (days between visits)
    const avgFrequency = await db.query(
      `WITH client_visits AS (
         SELECT client_id, date,
                LAG(date) OVER (PARTITION BY client_id ORDER BY date) as prev_date
         FROM bookings
         WHERE status IN ('confirmed', 'completed') AND deleted_at IS NULL AND salon_id = $1
           AND date <= (NOW() AT TIME ZONE 'Europe/Paris')::date
       )
       SELECT ROUND(AVG(date - prev_date)) as avg_days_between_visits
       FROM client_visits
       WHERE prev_date IS NOT NULL`,
      [salonId]
    );

    // Total active clients
    const totalActive = await db.query(
      `SELECT COUNT(DISTINCT client_id) as count
       FROM bookings
       WHERE status IN ('confirmed', 'completed') AND deleted_at IS NULL AND salon_id = $1
         AND date >= CURRENT_DATE - INTERVAL '3 months' AND date <= (NOW() AT TIME ZONE 'Europe/Paris')::date`,
      [salonId]
    );

    res.json({
      new_vs_returning: newVsReturning.rows,
      top_clients: topClients.rows,
      avg_days_between_visits: parseInt(avgFrequency.rows[0]?.avg_days_between_visits || 0),
      active_clients_3_months: parseInt(totalActive.rows[0].count),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/analytics/trends — Trends & predictions
// ============================================
router.get('/trends', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;

    // Monthly revenue for last 12 months
    const monthlyRevenue = await db.query(
      `SELECT TO_CHAR(date, 'YYYY-MM') as month,
              COALESCE(SUM(price), 0) as revenue,
              COUNT(*) as bookings
       FROM bookings
       WHERE date >= CURRENT_DATE - INTERVAL '12 months'
         AND date <= (NOW() AT TIME ZONE 'Europe/Paris')::date
         AND status IN ('confirmed', 'completed')
         AND deleted_at IS NULL AND salon_id = $1
       GROUP BY TO_CHAR(date, 'YYYY-MM')
       ORDER BY month`,
      [salonId]
    );

    // ── Projection de fin de mois ──
    // L'ancien calcul additionnait deux fois les RDV a venir : « revenue_so_far »
    // portait sur tout le mois, futur compris, puis on rajoutait le confirme.
    // Le tout etait ensuite divise par le jour du mois — le 1er, on divisait un
    // mois entier par 1 — et multiplie par les jours restants. Resultat le
    // 1er septembre : 161 000 € annonces a Meylan, dont le meilleur mois est
    // 28 000 €.
    const parisNow = getParisNow();
    const currentMonth = getParisTodayISO().substring(0, 7);
    const todayISO = getParisTodayISO();
    const dayOfMonth = parisNow.getDate();
    const daysInMonth = new Date(parisNow.getFullYear(), parisNow.getMonth() + 1, 0).getDate();
    const daysLeft = Math.max(daysInMonth - dayOfMonth, 0);

    // Encaisse : les RDV honores, du 1er a aujourd'hui.
    const doneResult = await db.query(
      `SELECT COALESCE(SUM(price), 0) AS revenue, COUNT(*) AS bookings
       FROM bookings
       WHERE TO_CHAR(date, 'YYYY-MM') = $1 AND date <= $2::date
         AND status IN ('confirmed', 'completed')
         AND deleted_at IS NULL AND salon_id = $3`,
      [currentMonth, todayISO, salonId]
    );

    // Deja au carnet : les RDV pris pour les jours qui restent.
    const bookedResult = await db.query(
      `SELECT COALESCE(SUM(price), 0) AS revenue, COUNT(*) AS bookings
       FROM bookings
       WHERE TO_CHAR(date, 'YYYY-MM') = $1 AND date > $2::date
         AND status = 'confirmed'
         AND deleted_at IS NULL AND salon_id = $3`,
      [currentMonth, todayISO, salonId]
    );

    // Rythme habituel du salon : les 90 derniers jours honores. Un debut de
    // mois ne dit rien a lui seul, la moyenne longue si.
    const paceResult = await db.query(
      `SELECT COALESCE(SUM(price), 0) AS revenue
       FROM bookings
       WHERE date >= $1::date - 90 AND date < $1::date
         AND status IN ('confirmed', 'completed')
         AND deleted_at IS NULL AND salon_id = $2`,
      [todayISO, salonId]
    );

    const revenueSoFar = parseInt(doneResult.rows[0].revenue);
    const futureRevenue = parseInt(bookedResult.rows[0].revenue);
    const paceHistory = Math.round(parseInt(paceResult.rows[0].revenue) / 90);
    const paceThisMonth = Math.round(revenueSoFar / Math.max(dayOfMonth, 1));

    // Le poids du mois en cours grimpe avec les jours ecoules : le 1er on se fie
    // a l'historique, apres dix jours au mois lui-meme.
    const w = Math.min(dayOfMonth / 10, 1);
    const dailyPace = Math.round(w * paceThisMonth + (1 - w) * paceHistory);

    // Ce qui reste a faire est estime au rythme du salon, et jamais moins que
    // ce qui est deja au carnet.
    const remaining = Math.max(dailyPace * daysLeft, futureRevenue);
    const projected = revenueSoFar + remaining;

    // No-show rate evolution
    const noShowRate = await db.query(
      `SELECT TO_CHAR(date, 'YYYY-MM') as month,
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'no_show') as no_shows,
              ROUND(COUNT(*) FILTER (WHERE status = 'no_show')::numeric / NULLIF(COUNT(*), 0) * 100, 1) as rate
       FROM bookings
       WHERE date >= CURRENT_DATE - INTERVAL '6 months'
         AND deleted_at IS NULL AND salon_id = $1
         AND status != 'cancelled'
       GROUP BY TO_CHAR(date, 'YYYY-MM')
       ORDER BY month`,
      [salonId]
    );

    // No-show cost for current month
    const noShowCurrent = await db.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(price), 0) as cost
       FROM bookings
       WHERE TO_CHAR(date, 'YYYY-MM') = $1
         AND status = 'no_show'
         AND deleted_at IS NULL AND salon_id = $2`,
      [currentMonth, salonId]
    );

    res.json({
      monthly_revenue: monthlyRevenue.rows,
      projection: {
        month: currentMonth,
        revenue_so_far: revenueSoFar,
        future_confirmed: futureRevenue,
        projected_total: projected,
        days_elapsed: dayOfMonth,
        days_in_month: daysInMonth,
        daily_pace: dailyPace,          // rythme retenu, en centimes par jour
        pace_history: paceHistory,      // moyenne des 90 derniers jours
      },
      no_show_rate: noShowRate.rows,
      no_show_current: {
        count: parseInt(noShowCurrent.rows[0].count),
        cost: parseInt(noShowCurrent.rows[0].cost),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/analytics/members — Member stats
// ============================================
router.get('/members', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;

    // Total clients vs members (scoped to clients who have bookings at this salon)
    const counts = await db.query(
      `SELECT
         COUNT(DISTINCT c.id) as total_clients,
         COUNT(DISTINCT c.id) FILTER (WHERE c.has_account = true) as total_members
       FROM clients c
       JOIN bookings b ON c.id = b.client_id
       WHERE c.deleted_at IS NULL AND b.salon_id = $1`,
      [salonId]
    );

    // New members this month
    const firstOfMonth = getParisTodayISO().substring(0, 8) + '01';
    const newMembers = await db.query(
      `SELECT COUNT(DISTINCT c.id) as count FROM clients c
       JOIN bookings b ON c.id = b.client_id
       WHERE c.has_account = true AND c.deleted_at IS NULL
         AND c.created_at >= $1 AND b.salon_id = $2`,
      [firstOfMonth, salonId]
    );

    // Revenue comparison: members vs guests (last 3 months)
    const revenueComparison = await db.query(
      `SELECT
         COALESCE(SUM(b.price) FILTER (WHERE c.has_account = true), 0) as member_revenue,
         COUNT(b.id) FILTER (WHERE c.has_account = true) as member_bookings,
         COALESCE(SUM(b.price) FILTER (WHERE c.has_account = false OR c.has_account IS NULL), 0) as guest_revenue,
         COUNT(b.id) FILTER (WHERE c.has_account = false OR c.has_account IS NULL) as guest_bookings
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       WHERE b.status IN ('confirmed', 'completed')
         AND b.deleted_at IS NULL AND b.salon_id = $1
         AND b.date >= CURRENT_DATE - INTERVAL '3 months' AND b.date <= (NOW() AT TIME ZONE 'Europe/Paris')::date`,
      [salonId]
    );

    // Average spend per visit: members vs guests
    const avgSpend = await db.query(
      `SELECT
         ROUND(AVG(b.price) FILTER (WHERE c.has_account = true)) as member_avg,
         ROUND(AVG(b.price) FILTER (WHERE c.has_account = false OR c.has_account IS NULL)) as guest_avg
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       WHERE b.status IN ('confirmed', 'completed')
         AND b.deleted_at IS NULL AND b.salon_id = $1
         AND b.date >= CURRENT_DATE - INTERVAL '3 months' AND b.date <= (NOW() AT TIME ZONE 'Europe/Paris')::date`,
      [salonId]
    );

    // Average visits per client: members vs guests (last 3 months)
    const avgVisits = await db.query(
      `SELECT
         ROUND(AVG(visit_count) FILTER (WHERE has_account = true), 1) as member_avg_visits,
         ROUND(AVG(visit_count) FILTER (WHERE has_account = false OR has_account IS NULL), 1) as guest_avg_visits
       FROM (
         SELECT c.id, c.has_account, COUNT(b.id) as visit_count
         FROM clients c
         JOIN bookings b ON c.id = b.client_id
         WHERE b.status IN ('confirmed', 'completed')
           AND b.deleted_at IS NULL AND b.salon_id = $1
           AND b.date >= CURRENT_DATE - INTERVAL '3 months' AND b.date <= (NOW() AT TIME ZONE 'Europe/Paris')::date
           AND c.deleted_at IS NULL
         GROUP BY c.id, c.has_account
       ) sub`,
      [salonId]
    );

    // Monthly member signups (last 6 months) — scoped to clients with bookings at this salon
    const monthlySignups = await db.query(
      `SELECT TO_CHAR(c.created_at, 'YYYY-MM') as month,
              COUNT(DISTINCT c.id) as signups
       FROM clients c
       JOIN bookings b ON c.id = b.client_id
       WHERE c.has_account = true AND c.deleted_at IS NULL
         AND c.created_at >= CURRENT_DATE - INTERVAL '6 months'
         AND b.salon_id = $1
       GROUP BY TO_CHAR(c.created_at, 'YYYY-MM')
       ORDER BY month`,
      [salonId]
    );

    const c = counts.rows[0];
    const r = revenueComparison.rows[0];
    const a = avgSpend.rows[0];
    const v = avgVisits.rows[0];

    res.json({
      total_clients: parseInt(c.total_clients),
      total_members: parseInt(c.total_members),
      conversion_rate: parseInt(c.total_clients) > 0
        ? Math.round((parseInt(c.total_members) / parseInt(c.total_clients)) * 100)
        : 0,
      new_members_this_month: parseInt(newMembers.rows[0].count),
      revenue: {
        member: parseInt(r.member_revenue),
        member_bookings: parseInt(r.member_bookings),
        guest: parseInt(r.guest_revenue),
        guest_bookings: parseInt(r.guest_bookings),
      },
      avg_spend: {
        member: parseInt(a.member_avg) || 0,
        guest: parseInt(a.guest_avg) || 0,
      },
      avg_visits: {
        member: parseFloat(v.member_avg_visits) || 0,
        guest: parseFloat(v.guest_avg_visits) || 0,
      },
      monthly_signups: monthlySignups.rows,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/analytics/revenue-hourly — Revenue by hour by barber
// ============================================
router.get('/revenue-hourly',
  [
    query('month').optional().matches(/^\d{4}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      let fromDate, toDate;

      if (req.query.month) {
        const range = getMonthRange(req.query.month);
        fromDate = range.from;
        toDate = range.to;
      } else {
        toDate = getParisTodayISO();
        fromDate = toDate.substring(0, 8) + '01';
      }

      const result = await db.query(
        `SELECT br.name as barber_name,
                EXTRACT(HOUR FROM b.start_time)::int as hour,
                COALESCE(SUM(b.price), 0) as revenue,
                COUNT(*) as booking_count
         FROM bookings b
         JOIN barbers br ON b.barber_id = br.id
         WHERE b.date >= $1 AND b.date <= $2
           AND b.status IN ('confirmed', 'completed')
           AND b.deleted_at IS NULL AND b.salon_id = $3
           AND br.name != 'Admin'
         GROUP BY br.name, EXTRACT(HOUR FROM b.start_time)
         ORDER BY br.name, hour`,
        [fromDate, toDate, salonId]
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// Helper: get current date/time in Paris timezone
// ============================================
function getParisNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}

function getParisTodayISO() {
  const now = getParisNow();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================
// Helper: default "from" date based on period
// ============================================
function getDefaultFrom(period) {
  const now = getParisNow();
  if (period === 'month') {
    now.setMonth(now.getMonth() - 12);
  } else if (period === 'week') {
    now.setMonth(now.getMonth() - 3);
  } else {
    now.setDate(now.getDate() - 30);
  }
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================
// Helper: derive date ranges from a YYYY-MM month string
// ============================================
function getMonthRange(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Cap 'to' at today if it's the current month
  const today = getParisTodayISO();
  const effectiveTo = to > today ? today : to;

  // Previous month
  const prevDate = new Date(y, m - 2, 1);
  const prevY = prevDate.getFullYear();
  const prevM = prevDate.getMonth() + 1;
  const prevFrom = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
  const prevLastDay = new Date(prevY, prevM, 0).getDate();
  const prevTo = `${prevY}-${String(prevM).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`;

  return { from, to: effectiveTo, prevFrom, prevTo };
}

// ============================================
// GET /api/admin/analytics/no-shows — Detailed no-show analysis
// ============================================
router.get('/no-shows', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const { month } = req.query;

    let from, to;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const range = getMonthRange(month);
      from = range.from;
      to = range.to;
    } else {
      const todayResult = await db.query(`SELECT (NOW() AT TIME ZONE 'Europe/Paris')::date AS today`);
      const today = todayResult.rows[0].today;
      from = today.substring(0, 8) + '01';
      to = today;
    }

    // 1. Overview: count, cost, rate
    const overview = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'no_show') as no_show_count,
         COALESCE(SUM(price) FILTER (WHERE status = 'no_show'), 0) as no_show_cost,
         COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed', 'no_show')) as total_bookings
       FROM bookings
       WHERE date >= $1 AND date <= $2 AND deleted_at IS NULL AND salon_id = $3`,
      [from, to, salonId]
    );

    const totalBookings = parseInt(overview.rows[0].total_bookings) || 0;
    const noShowCount = parseInt(overview.rows[0].no_show_count) || 0;
    const rate = totalBookings > 0 ? Math.round((noShowCount / totalBookings) * 1000) / 10 : 0;

    // 2. By barber
    const byBarber = await db.query(
      `SELECT br.name as barber_name,
              COUNT(b.id) as no_show_count,
              COALESCE(SUM(b.price), 0) as cost,
              COUNT(b.id)::numeric / NULLIF(
                (SELECT COUNT(*) FROM bookings b2
                 WHERE b2.barber_id = br.id AND b2.date >= $1 AND b2.date <= $2
                   AND b2.deleted_at IS NULL AND b2.salon_id = $3
                   AND b2.status IN ('confirmed','completed','no_show')), 0) * 100 as rate
       FROM bookings b
       JOIN barbers br ON b.barber_id = br.id
       WHERE b.date >= $1 AND b.date <= $2 AND b.deleted_at IS NULL
         AND b.salon_id = $3 AND b.status = 'no_show'
       GROUP BY br.id, br.name
       ORDER BY no_show_count DESC`,
      [from, to, salonId]
    );

    // 3. By service
    const byService = await db.query(
      `SELECT s.name as service_name,
              COUNT(b.id) as no_show_count,
              COALESCE(SUM(b.price), 0) as cost
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       WHERE b.date >= $1 AND b.date <= $2 AND b.deleted_at IS NULL
         AND b.salon_id = $3 AND b.status = 'no_show'
       GROUP BY s.id, s.name
       ORDER BY no_show_count DESC`,
      [from, to, salonId]
    );

    // 4. By day of week (PostgreSQL DOW: 0=Sun..6=Sat)
    const byDay = await db.query(
      `SELECT EXTRACT(DOW FROM date)::int as day_of_week,
              COUNT(*) as no_show_count
       FROM bookings
       WHERE date >= $1 AND date <= $2 AND deleted_at IS NULL
         AND salon_id = $3 AND status = 'no_show'
       GROUP BY day_of_week
       ORDER BY day_of_week`,
      [from, to, salonId]
    );

    // 5. By hour
    const byHour = await db.query(
      `SELECT EXTRACT(HOUR FROM start_time::time)::int as hour,
              COUNT(*) as no_show_count
       FROM bookings
       WHERE date >= $1 AND date <= $2 AND deleted_at IS NULL
         AND salon_id = $3 AND status = 'no_show'
       GROUP BY hour
       ORDER BY hour`,
      [from, to, salonId]
    );

    // 6. Top recidivistes (clients with most no-shows, lifetime)
    const topClients = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.phone,
              COUNT(b.id) as total_no_shows,
              COALESCE(SUM(b.price), 0) as total_cost,
              MAX(b.date) as last_no_show
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       WHERE b.deleted_at IS NULL AND b.salon_id = $1 AND b.status = 'no_show'
       GROUP BY c.id, c.first_name, c.last_name, c.phone
       HAVING COUNT(b.id) >= 2
       ORDER BY total_no_shows DESC, total_cost DESC
       LIMIT 15`,
      [salonId]
    );

    // 7. Monthly trend (last 6 months)
    const trend = await db.query(
      `SELECT TO_CHAR(date, 'YYYY-MM') as month,
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'no_show') as no_shows,
              COALESCE(SUM(price) FILTER (WHERE status = 'no_show'), 0) as cost,
              ROUND(COUNT(*) FILTER (WHERE status = 'no_show')::numeric /
                    NULLIF(COUNT(*), 0) * 100, 1) as rate
       FROM bookings
       WHERE date >= (CURRENT_DATE - INTERVAL '6 months')
         AND deleted_at IS NULL AND salon_id = $1
         AND status != 'cancelled'
       GROUP BY TO_CHAR(date, 'YYYY-MM')
       ORDER BY month`,
      [salonId]
    );

    // 8. Recent no-shows list (last 10 for the selected month)
    const recent = await db.query(
      `SELECT b.id, b.date, b.start_time, b.price,
              c.first_name as client_first_name, c.last_name as client_last_name, c.phone as client_phone,
              br.name as barber_name, s.name as service_name
       FROM bookings b
       LEFT JOIN clients c ON b.client_id = c.id
       JOIN barbers br ON b.barber_id = br.id
       JOIN services s ON b.service_id = s.id
       WHERE b.date >= $1 AND b.date <= $2 AND b.deleted_at IS NULL
         AND b.salon_id = $3 AND b.status = 'no_show'
       ORDER BY b.date DESC, b.start_time DESC
       LIMIT 10`,
      [from, to, salonId]
    );

    res.json({
      overview: {
        count: noShowCount,
        cost: parseInt(overview.rows[0].no_show_cost),
        rate,
        total_bookings: totalBookings,
      },
      by_barber: byBarber.rows.map(r => ({
        barber_name: r.barber_name,
        count: parseInt(r.no_show_count),
        cost: parseInt(r.cost),
        rate: r.rate ? Math.round(parseFloat(r.rate) * 10) / 10 : 0,
      })),
      by_service: byService.rows.map(r => ({
        service_name: r.service_name,
        count: parseInt(r.no_show_count),
        cost: parseInt(r.cost),
      })),
      by_day: byDay.rows.map(r => ({
        day_of_week: parseInt(r.day_of_week),
        count: parseInt(r.no_show_count),
      })),
      by_hour: byHour.rows.map(r => ({
        hour: parseInt(r.hour),
        count: parseInt(r.no_show_count),
      })),
      top_clients: topClients.rows.map(r => ({
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: r.phone,
        total_no_shows: parseInt(r.total_no_shows),
        total_cost: parseInt(r.total_cost),
        last_no_show: r.last_no_show,
      })),
      trend: trend.rows.map(r => ({
        month: r.month,
        total: parseInt(r.total),
        no_shows: parseInt(r.no_shows),
        cost: parseInt(r.cost),
        rate: parseFloat(r.rate) || 0,
      })),
      recent: recent.rows,
    });
  } catch (error) {
    next(error);
  }
});

// ─── Client Accounts (cross-salon) ───
router.get('/accounts', async (req, res, next) => {
  try {
    // Total accounts (global — clients are not salon-scoped)
    const totals = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE has_account = true) AS total_accounts,
        COUNT(*) AS total_clients,
        COUNT(*) FILTER (WHERE has_account = true AND created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Europe/Paris')) AS new_this_month
      FROM clients
      WHERE deleted_at IS NULL
    `);

    // Per-salon breakdown via client_salons pivot
    const perSalon = await db.query(`
      SELECT
        cs.salon_id,
        COUNT(DISTINCT cs.client_id) AS accounts
      FROM client_salons cs
      JOIN clients c ON c.id = cs.client_id
      WHERE c.has_account = true AND c.deleted_at IS NULL
      GROUP BY cs.salon_id
      ORDER BY cs.salon_id
    `);

    // Monthly trend (last 12 months)
    const trend = await db.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS accounts_created
      FROM clients
      WHERE has_account = true
        AND deleted_at IS NULL
        AND created_at >= (NOW() AT TIME ZONE 'Europe/Paris') - INTERVAL '12 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month
    `);

    // Accounts without any booking yet
    const noBooking = await db.query(`
      SELECT COUNT(*) AS count
      FROM clients c
      WHERE c.has_account = true
        AND c.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM bookings b WHERE b.client_id = c.id AND b.deleted_at IS NULL
        )
    `);

    const row = totals.rows[0];
    const salonMap = {};
    perSalon.rows.forEach(r => { salonMap[r.salon_id] = parseInt(r.accounts); });

    res.json({
      total_accounts: parseInt(row.total_accounts),
      total_clients: parseInt(row.total_clients),
      new_this_month: parseInt(row.new_this_month),
      no_booking_yet: parseInt(noBooking.rows[0].count),
      by_salon: {
        meylan: salonMap.meylan || 0,
        grenoble: salonMap.grenoble || 0,
      },
      monthly_trend: trend.rows.map(r => ({
        month: r.month,
        count: parseInt(r.accounts_created),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/analytics/one-shot
// « Premiere impression » : les clients gagnes depuis le lancement qui ne
// sont venus qu'une fois et ne sont jamais revenus, ranges par le barbier
// qui les a coupes ce jour-la.
//
// Trois filtres sans lesquels le chiffre ne veut rien dire :
//
// 1. Une personne, pas une fiche. Deux fiches au meme numero de telephone
//    comptent pour un seul client.
// 2. Les clients repris de Timify sont ecartes. Leur fiche existait avant leur
//    « premiere » visite chez nous : c'etaient deja des habitues, les compter
//    comme nouveaux gonflait le denominateur et diluait le taux.
// 3. Un client passe dans l'autre salon n'est pas perdu.
//
// Reste la regle de patience : on ne juge qu'une visite vieille d'au moins
// `delay_days`, et un client avec un RDV a venir n'est jamais compte perdu.
// ============================================
router.get('/one-shot',
  [
    query('delay_days').optional().isInt({ min: 14, max: 365 }),
    query('months').optional().custom(v => v === 'all' || /^\d{1,2}$/.test(v)),
    query('limit').optional().isInt({ min: 1, max: 2000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const delayDays = parseInt(req.query.delay_days) || 60;
      const months = req.query.months === 'all' ? null : (parseInt(req.query.months) || 12);
      const limit = parseInt(req.query.limit) || 1000;

      // Socle commun : une ligne par personne, avec tout ce qui sert a decider.
      // Les ensembles « a un RDV a venir » et « vu dans l'autre salon » sont
      // calcules une fois pour toutes : en sous-requete correlee, la requete
      // repassait sur toute la table par personne et depassait les 30 s.
      const base = `
        WITH personnes AS MATERIALIZED (
          -- Une personne = un nom complet, pas un numero de telephone.
          -- Verifie sur les donnees : six clients de Grenoble avaient deux
          -- fiches avec deux numeros differents (second telephone, faute de
          -- frappe dans le mail) — le nom, lui, etait identique. Et le
          -- telephone se partage en famille : un pere et son fils au meme
          -- numero sont deux personnes, pas une.
          -- Sans nom complet on se rabat sur le telephone, puis sur la fiche.
          SELECT c.id AS client_id,
                 COALESCE(
                   CASE WHEN coalesce(trim(c.first_name), '') <> '' AND coalesce(trim(c.last_name), '') <> ''
                        THEN 'nom:' || translate(
                               lower(trim(c.first_name) || ' ' || trim(c.last_name)),
                               'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
                   END,
                   NULLIF(regexp_replace(c.phone, '[^0-9]', '', 'g'), ''),
                   'fiche:' || c.id::text
                 ) AS personne,
                 c.created_at
          FROM clients c
          WHERE c.deleted_at IS NULL
        ),
        visites AS MATERIALIZED (
          SELECT p.personne, b.client_id, b.date, b.start_time, b.barber_id, b.service_id, b.price
          FROM bookings b
          JOIN personnes p ON p.client_id = b.client_id
          WHERE b.salon_id = $1 AND b.status = 'completed' AND b.deleted_at IS NULL
        ),
        futurs AS MATERIALIZED (
          SELECT DISTINCT p.personne
          FROM bookings fb
          JOIN personnes p ON p.client_id = fb.client_id
          WHERE fb.salon_id = $1 AND fb.status = 'confirmed' AND fb.deleted_at IS NULL
            AND fb.date >= (NOW() AT TIME ZONE 'Europe/Paris')::date
        ),
        ailleurs AS MATERIALIZED (
          SELECT DISTINCT p.personne
          FROM bookings ab
          JOIN personnes p ON p.client_id = ab.client_id
          WHERE ab.salon_id <> $1 AND ab.status = 'completed' AND ab.deleted_at IS NULL
        ),
        premiere AS (
          SELECT DISTINCT ON (v.personne)
                 v.personne, v.client_id, v.date, v.barber_id, v.service_id, v.price
          FROM visites v
          ORDER BY v.personne, v.date, v.start_time
        ),
        compte AS (
          -- Une visite = un passage au salon. Coupe et barbe le meme jour, c'est
          -- une visite : compter les RDV donnait deux visites a qui n'est venu
          -- qu'une fois, et le sortait a tort des clients perdus.
          SELECT personne, COUNT(DISTINCT date)::int AS visites FROM visites GROUP BY personne
        ),
        cohorte AS (
          SELECT f.personne, f.client_id, f.date AS premiere_visite, f.barber_id,
                 f.service_id, f.price, c.visites,
                 (fu.personne IS NOT NULL) AS rdv_futur,
                 (al.personne IS NOT NULL) AS vu_ailleurs,
                 (pe.created_at::date < f.date - 7) AS repris_de_timify
          FROM premiere f
          JOIN compte c ON c.personne = f.personne
          JOIN personnes pe ON pe.client_id = f.client_id
          LEFT JOIN futurs fu ON fu.personne = f.personne
          LEFT JOIN ailleurs al ON al.personne = f.personne
          WHERE f.date <= (NOW() AT TIME ZONE 'Europe/Paris')::date - make_interval(days => $2::int)
            AND ($3::int IS NULL OR f.date >= (NOW() AT TIME ZONE 'Europe/Paris')::date - make_interval(months => $3::int))
        ),
        juges AS (
          SELECT * FROM cohorte WHERE NOT repris_de_timify
        ),
        perdus AS (
          SELECT * FROM juges WHERE visites = 1 AND NOT rdv_futur AND NOT vu_ailleurs
        )`;

      // Un seul aller-retour : les trois resultats sortent du meme socle.
      // En trois requetes, Postgres reconstruisait les CTE a chaque fois et
      // Grenoble mettait cinq secondes a repondre.
      const result = await db.query(
        `${base},
         pending AS (
           SELECT COUNT(*)::int AS n FROM (
             SELECT personne, COUNT(DISTINCT date) v, MIN(date) d FROM visites GROUP BY personne
           ) t
           WHERE t.v = 1 AND t.d > (NOW() AT TIME ZONE 'Europe/Paris')::date - make_interval(days => $2::int)
         ),
         par_barbier AS (
           SELECT br.name AS barber_name,
                  COUNT(*)::int AS new_clients,
                  COUNT(*) FILTER (WHERE j.visites = 1 AND NOT j.rdv_futur AND NOT j.vu_ailleurs)::int AS one_shot,
                  COALESCE(SUM(j.price) FILTER (WHERE j.visites = 1 AND NOT j.rdv_futur AND NOT j.vu_ailleurs), 0)::int AS one_shot_revenue
           FROM juges j
           JOIN barbers br ON br.id = j.barber_id
           -- groupe par nom : Benji a deux fiches barbers, deux lignes seraient illisibles
           GROUP BY br.name
         ),
         liste AS (
           SELECT cl.id, cl.first_name, cl.last_name, cl.phone, cl.email,
                  p.premiere_visite AS visit_date, p.price,
                  br.name AS barber_name, s.name AS service_name,
                  ((NOW() AT TIME ZONE 'Europe/Paris')::date - p.premiere_visite)::int AS days_since
           FROM perdus p
           JOIN clients cl ON cl.id = p.client_id
           LEFT JOIN barbers br ON br.id = p.barber_id
           LEFT JOIN services s ON s.id = p.service_id
           ORDER BY p.premiere_visite DESC
           LIMIT $4
         )
         SELECT
           (SELECT COUNT(*) FROM juges)::int  AS new_clients,
           (SELECT COUNT(*) FROM perdus)::int AS one_shot,
           (SELECT COALESCE(SUM(price), 0) FROM perdus)::int AS one_shot_revenue,
           (SELECT COUNT(*) FROM cohorte WHERE repris_de_timify)::int AS excluded_imported,
           (SELECT COUNT(*) FROM juges WHERE visites = 1 AND NOT rdv_futur AND vu_ailleurs)::int AS moved_salon,
           (SELECT COUNT(*) FROM juges WHERE visites = 1 AND rdv_futur)::int AS rebooked,
           (SELECT n FROM pending) AS pending,
           (SELECT COALESCE(json_agg(par_barbier ORDER BY one_shot DESC), '[]'::json) FROM par_barbier) AS by_barber,
           (SELECT COALESCE(json_agg(liste), '[]'::json) FROM liste) AS clients`,
        [salonId, delayDays, months, limit]
      );

      const o = result.rows[0];
      const barbers = o.by_barber || [];
      const liste = o.clients || [];
      const rate = o.new_clients > 0
        ? Math.round((o.one_shot / o.new_clients) * 1000) / 10
        : 0;

      res.json({
        params: { delay_days: delayDays, months },
        overview: {
          new_clients: o.new_clients,
          one_shot: o.one_shot,
          rate,
          one_shot_revenue: o.one_shot_revenue,
          pending: o.pending,
          // Ce qui a ete mis de cote, pour que le chiffre soit verifiable
          excluded_imported: o.excluded_imported,
          moved_salon: o.moved_salon,
          rebooked: o.rebooked,
        },
        by_barber: barbers.map(r => ({
          ...r,
          rate: r.new_clients > 0 ? Math.round((r.one_shot / r.new_clients) * 1000) / 10 : 0,
        })),
        clients: liste,
        truncated: liste.length >= limit,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
