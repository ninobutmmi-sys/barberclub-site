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
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = today.substring(0, 8) + '01';

    // Today's stats
    const todayStats = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) as bookings_today,
         COALESCE(SUM(price) FILTER (WHERE status IN ('confirmed', 'completed')), 0) as revenue_today,
         COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_today
       FROM bookings
       WHERE date = $1 AND deleted_at IS NULL AND salon_id = $2`,
      [today, salonId]
    );

    // Monthly stats
    const monthStats = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) as bookings_month,
         COALESCE(SUM(price) FILTER (WHERE status IN ('confirmed', 'completed')), 0) as revenue_month
       FROM bookings
       WHERE date >= $1 AND date <= $2 AND deleted_at IS NULL AND salon_id = $3`,
      [firstOfMonth, today, salonId]
    );

    // New clients this month (clients are global but count those who booked at this salon)
    const newClients = await db.query(
      `SELECT COUNT(DISTINCT c.id) as count FROM clients c
       JOIN bookings b ON c.id = b.client_id
       WHERE c.created_at >= $1 AND c.deleted_at IS NULL AND b.salon_id = $2`,
      [firstOfMonth, salonId]
    );

    // Next bookings for each barber
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

    // Empty slots today (hours with no bookings)
    const todayBookings = await db.query(
      `SELECT barber_id, start_time, end_time
       FROM bookings
       WHERE date = $1 AND status IN ('confirmed', 'completed') AND deleted_at IS NULL AND salon_id = $2`,
      [today, salonId]
    );

    const t = todayStats.rows[0];
    const m = monthStats.rows[0];

    res.json({
      today: {
        bookings: parseInt(t.bookings_today),
        revenue: parseInt(t.revenue_today),
        cancelled: parseInt(t.cancelled_today),
      },
      month: {
        bookings: parseInt(m.bookings_month),
        revenue: parseInt(m.revenue_month),
        new_clients: parseInt(newClients.rows[0].count),
        average_basket: parseInt(m.bookings_month) > 0
          ? Math.round(parseInt(m.revenue_month) / parseInt(m.bookings_month))
          : 0,
      },
      next_bookings: nextBookings.rows,
    });
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
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { period = 'day', from, to } = req.query;
      const toDate = to || new Date().toISOString().split('T')[0];
      const fromDate = from || getDefaultFrom(period);

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

      res.json(result.rows);
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
      const toDate = to || new Date().toISOString().split('T')[0];
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
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const toDate = req.query.to || new Date().toISOString().split('T')[0];
      const fromDate = req.query.from || getDefaultFrom('month');

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

      res.json({
        heatmap: result.rows,
        best_days: bestDays.rows,
      });
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
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const toDate = req.query.to || new Date().toISOString().split('T')[0];
      const fromDate = req.query.from || getDefaultFrom('month');

      const salonId = req.user.salon_id;

      // Count active barbers
      const barbersResult = await db.query(
        'SELECT COUNT(*) as count FROM barbers WHERE is_active = true AND deleted_at IS NULL AND salon_id = $1',
        [salonId]
      );
      const barberCount = parseInt(barbersResult.rows[0].count);

      // Working hours per day: 9h-19h = 10 hours = 600 minutes
      // With 30 min average slots = ~20 slots per barber per day
      const slotsPerBarberPerDay = 20;

      // Count working days in range
      const daysResult = await db.query(
        `SELECT COUNT(DISTINCT date) as days
         FROM bookings
         WHERE date >= $1 AND date <= $2 AND deleted_at IS NULL AND salon_id = $3`,
        [fromDate, toDate, salonId]
      );
      const workingDays = Math.max(parseInt(daysResult.rows[0].days), 1);

      // Count actual bookings
      const bookingsResult = await db.query(
        `SELECT COUNT(*) as count
         FROM bookings
         WHERE date >= $1 AND date <= $2
           AND status IN ('confirmed', 'completed')
           AND deleted_at IS NULL AND salon_id = $3`,
        [fromDate, toDate, salonId]
      );

      const totalBookings = parseInt(bookingsResult.rows[0].count);
      const totalSlots = workingDays * barberCount * slotsPerBarberPerDay;
      const occupancyRate = totalSlots > 0 ? Math.round((totalBookings / totalSlots) * 100) : 0;

      res.json({
        occupancy_rate: occupancyRate,
        total_bookings: totalBookings,
        total_available_slots: totalSlots,
        working_days: workingDays,
        period: { from: fromDate, to: toDate },
      });
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
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const toDate = req.query.to || new Date().toISOString().split('T')[0];
      const fromDate = req.query.from || getDefaultFrom('month');

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

      res.json({
        services: result.rows,
        trends: trendResult.rows,
      });
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
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const toDate = req.query.to || new Date().toISOString().split('T')[0];
      const fromDate = req.query.from || getDefaultFrom('month');

      const salonId = req.user.salon_id;
      const result = await db.query(
        `SELECT br.name,
                COUNT(b.id) as booking_count,
                COALESCE(SUM(b.price), 0) as revenue,
                COUNT(DISTINCT b.client_id) as unique_clients,
                COUNT(b.id) FILTER (WHERE b.status = 'no_show') as no_shows
         FROM barbers br
         LEFT JOIN bookings b ON br.id = b.barber_id
           AND b.date >= $1 AND b.date <= $2
           AND b.deleted_at IS NULL
           AND b.status IN ('confirmed', 'completed', 'no_show')
         WHERE br.deleted_at IS NULL AND br.salon_id = $3
         GROUP BY br.id, br.name
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

      res.json({
        barbers: result.rows,
        loyalty: loyaltyResult.rows,
      });
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
         AND b.date >= CURRENT_DATE - INTERVAL '12 months'
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
         AND c.deleted_at IS NULL
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
         AND date >= CURRENT_DATE - INTERVAL '3 months'`,
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
         AND status IN ('confirmed', 'completed')
         AND deleted_at IS NULL AND salon_id = $1
       GROUP BY TO_CHAR(date, 'YYYY-MM')
       ORDER BY month`,
      [salonId]
    );

    // Current month projection
    const currentMonth = new Date().toISOString().substring(0, 7);
    const dayOfMonth = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

    const currentMonthData = await db.query(
      `SELECT COALESCE(SUM(price), 0) as revenue_so_far,
              COUNT(*) as bookings_so_far
       FROM bookings
       WHERE TO_CHAR(date, 'YYYY-MM') = $1
         AND status IN ('confirmed', 'completed')
         AND deleted_at IS NULL AND salon_id = $2`,
      [currentMonth, salonId]
    );

    // Future bookings this month
    const futureBookings = await db.query(
      `SELECT COALESCE(SUM(price), 0) as future_revenue,
              COUNT(*) as future_bookings
       FROM bookings
       WHERE TO_CHAR(date, 'YYYY-MM') = $1
         AND date > CURRENT_DATE
         AND status = 'confirmed'
         AND deleted_at IS NULL AND salon_id = $2`,
      [currentMonth, salonId]
    );

    const revenueSoFar = parseInt(currentMonthData.rows[0].revenue_so_far);
    const futureRevenue = parseInt(futureBookings.rows[0].future_revenue);
    const projected = revenueSoFar + futureRevenue +
      Math.round(((revenueSoFar / Math.max(dayOfMonth, 1)) * (daysInMonth - dayOfMonth)) * 0.5);

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

    res.json({
      monthly_revenue: monthlyRevenue.rows,
      projection: {
        month: currentMonth,
        revenue_so_far: revenueSoFar,
        future_confirmed: futureRevenue,
        projected_total: projected,
        days_elapsed: dayOfMonth,
        days_in_month: daysInMonth,
      },
      no_show_rate: noShowRate.rows,
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
    const firstOfMonth = new Date().toISOString().substring(0, 8) + '01';
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
         AND b.date >= CURRENT_DATE - INTERVAL '3 months'`,
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
         AND b.date >= CURRENT_DATE - INTERVAL '3 months'`,
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
           AND b.date >= CURRENT_DATE - INTERVAL '3 months'
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
// Helper: default "from" date based on period
// ============================================
function getDefaultFrom(period) {
  const now = new Date();
  if (period === 'month') {
    now.setMonth(now.getMonth() - 12);
  } else if (period === 'week') {
    now.setMonth(now.getMonth() - 3);
  } else {
    now.setDate(now.getDate() - 30);
  }
  return now.toISOString().split('T')[0];
}

module.exports = router;
