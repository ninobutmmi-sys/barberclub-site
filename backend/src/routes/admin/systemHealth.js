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

    const salonId = req.user.salon_id;

    const notifStats = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE nq.type LIKE '%sms' AND nq.status = 'sent')     AS sms_sent,
        COUNT(*) FILTER (WHERE nq.type LIKE '%sms' AND nq.status = 'failed')   AS sms_failed,
        COUNT(*) FILTER (WHERE nq.type LIKE '%email' AND nq.status = 'sent')   AS email_sent,
        COUNT(*) FILTER (WHERE nq.type LIKE '%email' AND nq.status = 'failed') AS email_failed,
        COUNT(*) FILTER (WHERE nq.status = 'pending')                          AS pending
      FROM notification_queue nq
      LEFT JOIN bookings b ON b.id = nq.booking_id
      WHERE nq.created_at >= $1 AND (b.salon_id = $2 OR b.salon_id IS NULL)
    `, [monthStr, salonId]);

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
      WHERE nq.status = 'failed' AND (b.salon_id = $1 OR b.salon_id IS NULL)
      ORDER BY nq.created_at DESC
      LIMIT 10
    `, [salonId]);

    // 6. Cron staleness detection (warn if a cron hasn't run in 2x its schedule)
    const STALE_THRESHOLDS = {
      processQueue: 4 * 60 * 1000,         // 4 min (schedule: */2)
      queueReminders: 25 * 60 * 60 * 1000, // 25h (schedule: daily 18h)
      cleanupNotifications: 25 * 60 * 60 * 1000,
      cleanupExpiredTokens: 25 * 60 * 60 * 1000,
      automationTriggers: 20 * 60 * 1000,  // 20 min (schedule: */10)
    };

    const cronDetails = {};
    for (const [key, info] of Object.entries(crons)) {
      const staleThreshold = STALE_THRESHOLDS[key];
      const isStale = info.lastRun && staleThreshold
        ? (Date.now() - new Date(info.lastRun).getTime()) > staleThreshold
        : false;
      cronDetails[key] = { ...info, stale: isStale };
    }

    // 7. Queue depth — pending notifications waiting to be processed
    const queueDepth = await db.query(
      `SELECT COUNT(*) as total FROM notification_queue nq
       LEFT JOIN bookings b ON b.id = nq.booking_id
       WHERE nq.status = 'pending' AND (b.salon_id = $1 OR b.salon_id IS NULL)`,
      [salonId]
    );

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
      crons: cronDetails,
      queue_depth: parseInt(queueDepth.rows[0].total || 0),
      notifications: {
        sms_sent: parseInt(stats.sms_sent || 0),
        sms_failed: parseInt(stats.sms_failed || 0),
        email_sent: parseInt(stats.email_sent || 0),
        email_failed: parseInt(stats.email_failed || 0),
        pending: parseInt(stats.pending || 0),
        sms_cost_estimate: Math.round(smsCost * 100) / 100,
        brevo_sender: config.brevo?.senderEmail || null,
        brevo_sms_sender: config.brevo?.smsSender || null,
        brevo_status: (() => { try { return require('../../services/notification').getBrevoStatus(); } catch { return null; } })(),
      },
      recent_errors: recentErrors.rows,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/system/trigger-reminders
// Manually trigger SMS reminders. Accepts optional { date } body param.
// Without date: runs normal cron (next 24h). With date: sends for that specific date.
router.post('/trigger-reminders', async (req, res, next) => {
  try {
    const { getSalonConfig } = require('../../config/env');
    const { getBrevoConfig, queueNotification, formatDateFR, formatTime } = require('../../services/notification');
    const brevoGre = getBrevoConfig('grenoble');

    const targetDate = req.body.date; // optional: '2026-03-18' to force-send for a specific date

    if (targetDate) {
      // Force-send reminders for a specific date (catches missed reminders)
      const bookings = await db.query(
        `SELECT b.id, b.date, b.start_time, b.cancel_token, b.salon_id,
                c.phone
         FROM bookings b
         JOIN clients c ON b.client_id = c.id
         WHERE b.date = $1
           AND b.status = 'confirmed'
           AND (b.reminder_sent = false OR b.reminder_sent IS NULL)
           AND b.deleted_at IS NULL
           AND c.phone IS NOT NULL
           AND (b.date::text || ' ' || b.start_time::text)::timestamp
               > (NOW() AT TIME ZONE 'Europe/Paris')`,
        [targetDate]
      );

      let queued = 0;
      for (const booking of bookings.rows) {
        const salonId = booking.salon_id || 'meylan';
        const salon = getSalonConfig(salonId);
        const apiUrl = config.apiUrl || 'https://barberclub-grenoble.fr';
        const rdvUrl = `${apiUrl}/r/rdv/${booking.id}/${booking.cancel_token}`;
        const timeFormatted = formatTime(booking.start_time);
        const dateFR = formatDateFR(typeof booking.date === 'string' ? booking.date.slice(0, 10) : booking.date);
        const message = `${salon.name} - Rappel\n\nVotre RDV le ${dateFR} a ${timeFormatted} au ${salon.address}.\n\nGerer votre RDV : ${rdvUrl}`;

        try {
          await db.query('UPDATE bookings SET reminder_sent = true WHERE id = $1', [booking.id]);
          await queueNotification(booking.id, 'reminder_sms', {
            phone: booking.phone,
            message,
            salonId,
          });
          queued++;
        } catch (err) {
          await db.query('UPDATE bookings SET reminder_sent = false WHERE id = $1', [booking.id]).catch(() => {});
        }
      }

      return res.json({
        ok: true,
        mode: 'force-date',
        targetDate,
        found: bookings.rows.length,
        queued,
        bySalon: {
          meylan: bookings.rows.filter(r => (r.salon_id || 'meylan') === 'meylan').length,
          grenoble: bookings.rows.filter(r => r.salon_id === 'grenoble').length,
        },
      });
    }

    // Default: run normal cron (next 24h window)
    const check = await db.query(
      `SELECT b.id, b.salon_id, b.reminder_sent, c.phone
       FROM bookings b JOIN clients c ON b.client_id = c.id
       WHERE b.status = 'confirmed'
       AND (b.reminder_sent = false OR b.reminder_sent IS NULL)
       AND b.deleted_at IS NULL AND c.phone IS NOT NULL
       AND (b.date::text || ' ' || b.start_time::text)::timestamp
           BETWEEN (NOW() AT TIME ZONE 'Europe/Paris')
               AND (NOW() AT TIME ZONE 'Europe/Paris') + INTERVAL '24 hours'`
    );

    const { queueReminders } = require('../../cron/reminders');
    await queueReminders();

    res.json({
      ok: true,
      mode: 'next-24h',
      pendingReminders: check.rows.length,
      bySalon: {
        meylan: check.rows.filter(r => (r.salon_id || 'meylan') === 'meylan').length,
        grenoble: check.rows.filter(r => r.salon_id === 'grenoble').length,
      },
      grenobleKeySet: !!grenobleConf.brevo?.apiKey,
      grenobleKeyPrefix: (brevoGre.apiKey || '').slice(0, 12) + '...',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/system/merge-services — one-time migration
router.post('/merge-services', async (req, res, next) => {
  try {
    const keepId = 'a1000000-0000-0000-0000-000000000007'; // 20min
    const removeId = 'a1000000-0000-0000-0000-000000000001'; // 30min duplicate

    // Reassign bookings
    const bk = await db.query('UPDATE bookings SET service_id = $1 WHERE service_id = $2', [keepId, removeId]);
    // Reassign waitlist entries
    const wl = await db.query('UPDATE waitlist SET service_id = $1 WHERE service_id = $2', [keepId, removeId]);
    // Remove barber_services
    const bs = await db.query('DELETE FROM barber_services WHERE service_id = $1', [removeId]);
    // Delete duplicate service
    const sv = await db.query('DELETE FROM services WHERE id = $1', [removeId]);

    res.json({ ok: true, bookingsReassigned: bk.rowCount, waitlistReassigned: wl.rowCount, barberServicesRemoved: bs.rowCount, serviceDeleted: sv.rowCount });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/system/fix-notif-status — one-time fix
router.post('/fix-notif-status', async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE notification_queue SET status = 'sent', sent_at = NOW()
       WHERE status = 'failed' AND type = 'review_email'
       AND phone IN ('+33779065078', '0779065078', '+33632740039', '0632740039')
       AND created_at >= '2026-03-12'`
    );
    res.json({ ok: true, updated: result.rowCount });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/system/requeue-failed — re-queue today's failed notifs
router.post('/requeue-failed', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const result = await db.query(
      `UPDATE notification_queue nq
       SET status = 'pending', attempts = 0, last_error = NULL, next_retry_at = NOW()
       FROM bookings b
       WHERE nq.booking_id = b.id
         AND b.salon_id = $1
         AND nq.status = 'failed'
         AND nq.created_at >= CURRENT_DATE
       RETURNING nq.id, nq.type`,
      [salonId]
    );
    res.json({ requeued: result.rowCount, details: result.rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
