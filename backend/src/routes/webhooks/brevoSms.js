// ============================================
// Brevo SMS Webhook Receiver
// ============================================
// Brevo POSTs SMS delivery events here in real-time:
// - delivered  -> SMS reçu par le client (opérateur a confirmé via DLR)
// - sent       -> SMS dispatché au carrier
// - accepted   -> Carrier a accepté
// - soft_bounce / hardBounce -> Échec
// - rejected / blocked / blacklisted -> Refusé (crédits, format, blacklist)
// - replied    -> Client a répondu
//
// Auth: query param ?token=... vérifié contre BREVO_WEBHOOK_SECRET
// (Brevo ne signe pas nativement — le secret dans l'URL est la pratique standard)
//
// Idempotence: même messageId+event = ignoré (UNIQUE INDEX en BDD)

const express = require('express');
const db = require('../../config/database');
const logger = require('../../utils/logger');
const { notifySmsFailed } = require('../../services/push');
const { brevoEmail } = require('../../services/notification/brevo');

const router = express.Router();

// Map Brevo event names -> our delivery_status values
// Valid SMS events from Brevo: delivered, sent, softBounce, hardBounce, blocked, error
// (Brevo dashboard shows "Rejeté" but the API event is actually "blocked" or "error")
function mapEventToStatus(event) {
  const e = String(event || '').toLowerCase();
  if (e === 'delivered') return 'delivered';
  if (e === 'sent' || e === 'request') return 'sent';
  if (e === 'accepted') return 'accepted';
  if (e === 'soft_bounce' || e === 'softbounce') return 'soft_bounce';
  if (e === 'hard_bounce' || e === 'hardbounce') return 'hard_bounce';
  if (e === 'blocked') return 'rejected';   // crédits insuffisants, blacklist Brevo, etc.
  if (e === 'error') return 'rejected';     // erreur opérateur générique
  if (e === 'rejected') return 'rejected';  // legacy / dashboard label
  if (e === 'blacklisted') return 'blacklisted';
  if (e === 'unsubscribe' || e === 'unsubscribed') return 'unsubscribed';
  return 'unknown';
}

// Final/terminal events that need no further tracking
function isTerminalSuccess(status) {
  return status === 'delivered';
}
function isTerminalFailure(status) {
  return ['hard_bounce', 'rejected', 'blacklisted'].includes(status);
}

router.post('/brevo/sms', async (req, res) => {
  const expected = process.env.BREVO_WEBHOOK_SECRET || '';
  const provided = String(req.query.token || req.headers['x-webhook-secret'] || '');
  if (!expected || provided !== expected) {
    logger.warn('Brevo webhook rejected — invalid token', { ip: req.ip });
    return res.status(403).json({ error: 'Invalid token' });
  }

  const payload = req.body || {};
  // Brevo can send messageId under several names depending on the event type
  const rawMsgId = payload.messageId
    ?? payload['message-id']
    ?? payload.message_id
    ?? payload.smsId
    ?? payload['sms-id']
    ?? payload.id
    ?? null;
  const messageId = rawMsgId != null ? String(rawMsgId) : null;
  const event = payload.event || payload.msg_status || null;
  const recipient = payload.to || payload.recipient || null;
  const description = payload.description || payload.reason || null;
  const errorCode = payload.error_code || null;

  if (!messageId || !event) {
    // Log the full payload so we can see what Brevo actually sends
    logger.warn('Brevo webhook payload incomplete', {
      keys: Object.keys(payload),
      payloadSample: JSON.stringify(payload).slice(0, 500),
    });
    return res.status(200).json({ ok: true, ignored: 'missing fields' });
  }

  const deliveryStatus = mapEventToStatus(event);

  // 1. Log event (idempotent thanks to UNIQUE INDEX message_id+event)
  let logged = false;
  try {
    const ins = await db.query(
      `INSERT INTO brevo_sms_events (message_id, event, recipient, description, error_code, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (message_id, event) DO NOTHING
       RETURNING id`,
      [messageId, event, recipient, description, errorCode, payload]
    );
    logged = ins.rows.length > 0;
  } catch (err) {
    logger.error('Failed to log Brevo SMS event', { error: err.message, messageId, event });
    // Continue anyway — try to update queue status
  }

  if (!logged) {
    // Duplicate event — already processed
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // 2. Update notification_queue row matching this messageId
  try {
    const update = await db.query(
      `UPDATE notification_queue
       SET delivery_status = $1::text,
           delivery_event_at = NOW(),
           delivered_at = CASE WHEN $1::text = 'delivered' THEN NOW() ELSE delivered_at END,
           last_error = CASE WHEN $1::text IN ('hard_bounce','rejected','blacklisted','soft_bounce')
                            THEN COALESCE($2::text, last_error) ELSE last_error END
       WHERE provider_message_id = $3::text
       RETURNING id, salon_id, phone, booking_id, type`,
      [deliveryStatus, description, messageId]
    );

    if (update.rows.length === 0) {
      logger.debug('Brevo webhook: no matching queue row', { messageId });
    } else {
      const row = update.rows[0];
      logger.info('Brevo SMS delivery update', {
        queueId: row.id, messageId, event, deliveryStatus, recipient,
      });

      // 3. Auto-blacklist on permanent failure
      if (isTerminalFailure(deliveryStatus) && (deliveryStatus === 'hard_bounce' || deliveryStatus === 'blacklisted')) {
        try {
          await db.query(
            `INSERT INTO sms_blacklist (phone, reason, occurrences)
             VALUES ($1, $2, 1)
             ON CONFLICT (phone) DO UPDATE
               SET last_seen_at = NOW(),
                   occurrences = sms_blacklist.occurrences + 1`,
            [recipient || row.phone, deliveryStatus]
          );
        } catch (err) {
          logger.error('Failed to blacklist phone', { error: err.message, recipient });
        }
      }

      // 4. Alerter Nino via push dashboard + email (pas de Discord)
      if (isTerminalFailure(deliveryStatus)) {
        // Récupère détails du booking pour message clair
        let clientName = '', dateTime = '';
        try {
          if (row.booking_id) {
            const det = await db.query(
              `SELECT c.first_name, c.last_name, b.date, b.start_time, br.name AS barber
               FROM bookings b
               LEFT JOIN clients c ON b.client_id = c.id
               LEFT JOIN barbers br ON b.barber_id = br.id
               WHERE b.id = $1`,
              [row.booking_id]
            );
            if (det.rows.length) {
              const r = det.rows[0];
              clientName = [r.first_name, r.last_name].filter(Boolean).join(' ');
              const t = (r.start_time || '').slice(0, 5);
              dateTime = `${r.date} ${t} avec ${r.barber || ''}`.trim();
            }
          }
        } catch (_) { /* silent */ }

        // Push notification → dashboard PWA (Nino's phone)
        notifySmsFailed(row.salon_id, {
          phone: recipient || row.phone,
          reason: description || event,
          messageId,
          clientName,
          dateTime,
        });

        // Email backup → propriétaire (toujours fiable car email use Brevo l'autre côté
        // et compte SMS != compte email credits)
        const ownerEmail = process.env.OWNER_ALERT_EMAIL || 'barberclubmeylan@gmail.com';
        const subject = `[BarberClub ${row.salon_id}] SMS non delivre — ${clientName || recipient}`;
        const html = `
          <h2 style="font-family:Arial">SMS rejete par Brevo/operateur</h2>
          <p><b>Salon:</b> ${row.salon_id}</p>
          <p><b>Client:</b> ${clientName || '(inconnu)'} — ${recipient || row.phone}</p>
          <p><b>RDV:</b> ${dateTime || row.type}</p>
          <p><b>Raison:</b> ${description || event}</p>
          <p><b>Type notification:</b> ${row.type}</p>
          <p><b>MessageId Brevo:</b> ${messageId}</p>
          <hr>
          <p style="color:#888">Action recommandee : appeler ${recipient || row.phone} pour confirmer le RDV.</p>
        `;
        brevoEmail(ownerEmail, subject, html, row.salon_id, { type: 'sms_failure_alert' })
          .catch((e) => logger.error('Owner alert email failed', { error: e.message }));
      }
    }
  } catch (err) {
    logger.error('Brevo webhook update failed', { error: err.message, messageId });
    // Reply 200 anyway — Brevo will retry on 5xx and we don't want loops
  }

  // Mark event processed
  try {
    await db.query(
      'UPDATE brevo_sms_events SET processed = true WHERE message_id = $1 AND event = $2',
      [messageId, event]
    );
  } catch (_) { /* silent */ }

  return res.status(200).json({ ok: true });
});

module.exports = router;
