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
      channel,
      status,
      limit = 50,
      offset = 0,
      from,
      to,
    } = req.query;

    const salonId = req.user.salon_id;
    const conditions = [`nq.salon_id = $1`];
    const params = [salonId];
    let paramIndex = 2;

    if (type) {
      conditions.push(`nq.type = $${paramIndex++}`);
      params.push(type);
    }
    if (channel) {
      conditions.push(`nq.channel = $${paramIndex++}`);
      params.push(channel);
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

    const where = 'WHERE ' + conditions.join(' AND ');

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
              nq.attempts, nq.last_error, nq.channel, nq.phone AS nq_phone,
              nq.recipient_name, nq.message,
              c.first_name, c.last_name, c.phone, c.email
       FROM notification_queue nq
       LEFT JOIN bookings b ON nq.booking_id = b.id
       LEFT JOIN clients c ON b.client_id = c.id
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

    const salonId = req.user.salon_id;
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'reminder_sms' AND status = 'sent') AS sms_sent,
         COUNT(*) FILTER (WHERE type = 'reminder_sms' AND status = 'failed') AS sms_failed,
         COUNT(*) FILTER (WHERE type IN ('confirmation_email', 'review_email') AND status = 'sent') AS emails_sent,
         COUNT(*) FILTER (WHERE type IN ('confirmation_email', 'review_email') AND status = 'failed') AS emails_failed,
         COUNT(*) FILTER (WHERE status = 'pending') AS pending
       FROM notification_queue
       WHERE created_at >= $1 AND salon_id = $2`,
      [monthStart.toISOString(), salonId]
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
  const salonId = req.user.salon_id;
  const salonConfig = config.getSalonConfig(salonId);
  const brevo = salonConfig.brevo || config.brevo;
  const configured = !!brevo.apiKey;
  const statusData = {
    configured,
    senderEmail: brevo.senderEmail,
    senderName: brevo.senderName,
    smsSender: brevo.smsSender,
  };

  if (configured) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': brevo.apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        const account = await response.json();
        statusData.accountEmail = account.email;
        const plans = account.plan || [];
        const freePlan = plans.find(p => p.type === 'free');
        const smsPlan = plans.find(p => p.type === 'sms');
        statusData.plan = freePlan?.type || plans[0]?.type || 'unknown';
        statusData.emailCredits = freePlan?.credits || 0;
        statusData.smsCredits = smsPlan?.credits || 0;
        statusData.credits = smsPlan?.credits || freePlan?.credits || 0;
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

/**
 * DELETE /api/admin/notifications/failed
 * Purge toutes les notifications échouées
 */
router.delete('/failed', async (req, res) => {
  try {
    const salonId = req.user.salon_id;
    const result = await db.query(
      `DELETE FROM notification_queue WHERE status = 'failed' AND salon_id = $1`,
      [salonId]
    );
    res.json({ deleted: result.rowCount });
  } catch (err) {
    logger.error('Failed to purge failed notifications', { error: err.message });
    res.status(500).json({ error: 'Erreur lors de la purge' });
  }
});

module.exports = router;
