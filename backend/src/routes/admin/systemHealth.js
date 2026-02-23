const { Router } = require('express');
const db = require('../../config/database');
const config = require('../../config/env');

const router = Router();

// GET /api/admin/system/health
router.get('/health', async (req, res, next) => {
  try {
    // 1. Database health
    const dbHealth = await db.healthCheck();

    // 2. Memory usage
    const mem = process.memoryUsage();

    // 3. Cron jobs status
    const crons = req.app.cronStatus || {};

    // 4. Notification stats this month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStr = monthStart.toISOString().slice(0, 10);

    const notifStats = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE type = 'sms' AND status = 'sent')     AS sms_sent,
        COUNT(*) FILTER (WHERE type = 'sms' AND status = 'failed')   AS sms_failed,
        COUNT(*) FILTER (WHERE type = 'email' AND status = 'sent')   AS email_sent,
        COUNT(*) FILTER (WHERE type = 'email' AND status = 'failed') AS email_failed,
        COUNT(*) FILTER (WHERE status = 'pending')                   AS pending
      FROM notification_queue
      WHERE created_at >= $1
    `, [monthStr]);

    const stats = notifStats.rows[0] || {};
    const smsCost = (parseInt(stats.sms_sent || 0)) * 0.045;

    // 5. Recent failed notifications (last 10)
    const recentErrors = await db.query(`
      SELECT nq.id, nq.type, nq.status, nq.attempts, nq.last_error,
             nq.created_at, nq.next_retry_at,
             c.first_name || ' ' || c.last_name AS client_name
      FROM notification_queue nq
      LEFT JOIN bookings b ON b.id = nq.booking_id
      LEFT JOIN clients c ON c.id = b.client_id
      WHERE nq.status = 'failed'
      ORDER BY nq.created_at DESC
      LIMIT 10
    `);

    res.json({
      api: {
        status: 'up',
        uptime: process.uptime(),
        nodeVersion: process.version,
        env: config.nodeEnv,
      },
      database: {
        status: dbHealth.ok ? 'connected' : 'disconnected',
        timestamp: dbHealth.timestamp || null,
        error: dbHealth.error || null,
      },
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
        rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      },
      crons,
      notifications: {
        sms_sent: parseInt(stats.sms_sent || 0),
        sms_failed: parseInt(stats.sms_failed || 0),
        email_sent: parseInt(stats.email_sent || 0),
        email_failed: parseInt(stats.email_failed || 0),
        pending: parseInt(stats.pending || 0),
        sms_cost_estimate: Math.round(smsCost * 100) / 100,
        brevo_sender: config.brevo?.senderEmail || null,
        brevo_sms_sender: config.brevo?.smsSender || null,
      },
      recent_errors: recentErrors.rows,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
