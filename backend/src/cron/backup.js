const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Daily backup snapshot — logs critical counters + today's bookings to Railway logs.
 * Not a pg_dump replacement, but a safety net: if Supabase data is lost,
 * the last 30 days of Railway logs contain enough to reconstruct activity.
 *
 * For full backup: run scripts/backup-db.sh manually or via local cron.
 */
async function dailyBackupSnapshot() {
  try {
    // 1. Critical counters
    const counters = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM clients WHERE deleted_at IS NULL) AS total_clients,
        (SELECT COUNT(*) FROM bookings WHERE deleted_at IS NULL) AS total_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed' AND deleted_at IS NULL) AS upcoming_bookings,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE date >= date_trunc('month', CURRENT_DATE)) AS month_revenue,
        (SELECT COUNT(*) FROM payments WHERE date >= date_trunc('month', CURRENT_DATE)) AS month_transactions
    `);

    const stats = counters.rows[0];

    // 2. Today's bookings detail
    const todayBookings = await db.query(`
      SELECT b.date, b.start_time, b.end_time, b.status, b.price,
             s.name AS service, br.name AS barber,
             c.first_name || ' ' || c.last_name AS client
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN barbers br ON b.barber_id = br.id
      JOIN clients c ON b.client_id = c.id
      WHERE b.date = CURRENT_DATE AND b.deleted_at IS NULL
      ORDER BY b.start_time
    `);

    logger.info('=== DAILY BACKUP SNAPSHOT ===', {
      date: new Date().toISOString().slice(0, 10),
      stats: {
        total_clients: parseInt(stats.total_clients),
        total_bookings: parseInt(stats.total_bookings),
        upcoming_confirmed: parseInt(stats.upcoming_bookings),
        month_revenue_cents: parseInt(stats.month_revenue),
        month_transactions: parseInt(stats.month_transactions),
      },
      today_bookings: todayBookings.rows.map((b) => ({
        time: `${b.start_time.slice(0, 5)}-${b.end_time.slice(0, 5)}`,
        service: b.service,
        barber: b.barber,
        client: b.client,
        status: b.status,
        price: b.price,
      })),
    });
  } catch (err) {
    logger.error('Daily backup snapshot failed', { error: err.message });
  }
}

module.exports = { dailyBackupSnapshot };
