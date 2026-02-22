const express = require('express');
const db = require('../../config/database');
const config = require('../../config/env');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * GET /api/admin/notifications/logs
 * Historique des notifications envoyées
 */
router.get('/logs', async (req, res) => {
  try {
    const {
      type,
      status,
      limit = 50,
      offset = 0,
      from,
      to,
    } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (type) {
      conditions.push(`nq.type = $${paramIndex++}`);
      params.push(type);
    }
    if (status) {
      conditions.push(`nq.status = $${paramIndex++}`);
      params.push(status);
    }
    if (from) {
      conditions.push(`nq.created_at >= $${paramIndex++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`nq.created_at <= $${paramIndex++}::date + interval '1 day'`);
      params.push(to);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM notification_queue nq ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    params.push(safeLimit);
    params.push(safeOffset);

    const result = await db.query(
      `SELECT nq.id, nq.type, nq.status, nq.created_at, nq.sent_at,
              nq.attempts, nq.last_error,
              c.first_name, c.last_name, c.phone, c.email
       FROM notification_queue nq
       JOIN bookings b ON nq.booking_id = b.id
       JOIN clients c ON b.client_id = c.id
       ${where}
       ORDER BY nq.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      params
    );

    res.json({ notifications: result.rows, total });
  } catch (err) {
    logger.error('Failed to fetch notification logs', { error: err.message });
    res.status(500).json({ error: 'Erreur lors de la recuperation des logs' });
  }
});

/**
 * GET /api/admin/notifications/stats
 * Stats du mois en cours
 */
router.get('/stats', async (req, res) => {
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'reminder_sms' AND status = 'sent') AS sms_sent,
         COUNT(*) FILTER (WHERE type = 'reminder_sms' AND status = 'failed') AS sms_failed,
         COUNT(*) FILTER (WHERE type IN ('confirmation_email', 'review_email') AND status = 'sent') AS emails_sent,
         COUNT(*) FILTER (WHERE type IN ('confirmation_email', 'review_email') AND status = 'failed') AS emails_failed,
         COUNT(*) FILTER (WHERE status = 'pending') AS pending
       FROM notification_queue
       WHERE created_at >= $1`,
      [monthStart.toISOString()]
    );

    const stats = result.rows[0];
    const smsSent = parseInt(stats.sms_sent, 10);

    res.json({
      sms_sent: smsSent,
      sms_failed: parseInt(stats.sms_failed, 10),
      emails_sent: parseInt(stats.emails_sent, 10),
      emails_failed: parseInt(stats.emails_failed, 10),
      pending: parseInt(stats.pending, 10),
      estimated_cost: (smsSent * 0.045).toFixed(2),
    });
  } catch (err) {
    logger.error('Failed to fetch notification stats', { error: err.message });
    res.status(500).json({ error: 'Erreur lors de la recuperation des stats' });
  }
});

/**
 * GET /api/admin/notifications/brevo-status
 * Vérifie la configuration Brevo
 */
router.get('/brevo-status', async (req, res) => {
  const configured = !!config.brevo.apiKey;
  const statusData = {
    configured,
    senderEmail: config.brevo.senderEmail,
    senderName: config.brevo.senderName,
    smsSender: config.brevo.smsSender,
  };

  if (configured) {
    try {
      const response = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': config.brevo.apiKey },
      });
      if (response.ok) {
        const account = await response.json();
        statusData.accountEmail = account.email;
        statusData.plan = account.plan?.[0]?.type || 'unknown';
        statusData.credits = account.plan?.[0]?.credits || 0;
        statusData.connected = true;
      } else {
        statusData.connected = false;
        statusData.error = 'Cle API invalide ou expirée';
      }
    } catch (err) {
      statusData.connected = false;
      statusData.error = 'Impossible de contacter Brevo';
    }
  }

  res.json(statusData);
});

module.exports = router;
