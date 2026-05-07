// ============================================
// Twilio SMS Status Callback Webhook
// ============================================
// Twilio POSTs delivery status changes here.
// Format: application/x-www-form-urlencoded
// Key fields:
//   - MessageSid          (the SID returned at send time → notification_queue.provider_message_id)
//   - MessageStatus       (queued | sending | sent | delivered | undelivered | failed)
//   - To                  (E.164 recipient)
//   - From                (sender)
//   - ErrorCode           (numeric, present on failures, e.g. 30003 = unreachable)
//   - ErrorMessage        (human readable, sometimes)
//
// Auth: query param ?token=... checked against TWILIO_WEBHOOK_SECRET
// (Twilio supports HMAC signature via X-Twilio-Signature header — we use shared secret
//  in URL for parity with Brevo webhook; can upgrade to HMAC validation later.)
//
// Idempotence: same MessageSid+Status combo logged once (UNIQUE INDEX in DB).

const express = require('express');
const db = require('../../config/database');
const logger = require('../../utils/logger');
const { notifySmsFailed } = require('../../services/push');
const { brevoEmail } = require('../../services/notification/brevo');

const router = express.Router();

// Map Twilio status → our delivery_status (same vocabulary as Brevo for consistency)
function mapStatusToDeliveryStatus(twilioStatus) {
  const s = String(twilioStatus || '').toLowerCase();
  if (s === 'delivered') return 'delivered';
  if (s === 'sent') return 'sent';
  if (s === 'queued' || s === 'accepted' || s === 'sending') return 'accepted';
  if (s === 'undelivered') return 'soft_bounce';
  if (s === 'failed') return 'rejected';
  return 'unknown';
}

function isTerminalSuccess(status) {
  return status === 'delivered';
}
function isTerminalFailure(status) {
  return status === 'rejected' || status === 'hard_bounce';
}

// Twilio sends URL-encoded form data — parser added inline for this route only
const formParser = express.urlencoded({ extended: false, limit: '50kb' });

router.post('/twilio/sms', formParser, async (req, res) => {
  const expected = process.env.TWILIO_WEBHOOK_SECRET || '';
  const provided = String(req.query.token || req.headers['x-webhook-secret'] || '');
  if (!expected || provided !== expected) {
    logger.warn('Twilio webhook rejected — invalid token', { ip: req.ip });
    return res.status(403).json({ error: 'Invalid token' });
  }

  const payload = req.body || {};
  const messageSid = payload.MessageSid || payload.SmsSid || null;
  const status = payload.MessageStatus || payload.SmsStatus || null;
  const recipient = payload.To || null;
  const errorCode = payload.ErrorCode || null;
  const errorMessage = payload.ErrorMessage || null;

  if (!messageSid || !status) {
    logger.warn('Twilio webhook payload incomplete', {
      keys: Object.keys(payload),
      payloadSample: JSON.stringify(payload).slice(0, 500),
    });
    return res.status(200).json({ ok: true, ignored: 'missing fields' });
  }

  const deliveryStatus = mapStatusToDeliveryStatus(status);

  // 1. Log event (idempotent thanks to UNIQUE INDEX MessageSid+status)
  let logged = false;
  try {
    const ins = await db.query(
      `INSERT INTO twilio_sms_events (message_sid, status, recipient, error_code, error_message, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (message_sid, status) DO NOTHING
       RETURNING id`,
      [messageSid, status, recipient, errorCode, errorMessage, payload]
    );
    logged = ins.rows.length > 0;
  } catch (err) {
    logger.error('Failed to log Twilio SMS event', { error: err.message, messageSid, status });
  }

  if (!logged) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // 2. Update notification_queue row matching this MessageSid
  try {
    const update = await db.query(
      `UPDATE notification_queue
       SET delivery_status = $1::text,
           delivery_event_at = NOW(),
           delivered_at = CASE WHEN $1::text = 'delivered' THEN NOW() ELSE delivered_at END,
           last_error = CASE WHEN $1::text IN ('rejected','soft_bounce','hard_bounce')
                            THEN COALESCE($2::text, last_error) ELSE last_error END
       WHERE provider_message_id = $3::text
       RETURNING id, salon_id, phone, booking_id, type`,
      [deliveryStatus, errorMessage || (errorCode ? `Twilio ${errorCode}` : null), messageSid]
    );

    if (update.rows.length === 0) {
      logger.debug('Twilio webhook: no matching queue row', { messageSid });
    } else {
      const row = update.rows[0];
      logger.info('Twilio SMS delivery update', {
        queueId: row.id, messageSid, status, deliveryStatus, recipient, errorCode,
      });

      // 3. Auto-blacklist on permanent failure (Twilio errors 30003=unreachable, 30004=blocked, 30005=unknown number)
      if (isTerminalFailure(deliveryStatus) && (errorCode === '30003' || errorCode === '30004' || errorCode === '30005' || errorCode === '21610')) {
        try {
          await db.query(
            `INSERT INTO sms_blacklist (phone, reason, occurrences)
             VALUES ($1, $2, 1)
             ON CONFLICT (phone) DO UPDATE
               SET last_seen_at = NOW(),
                   occurrences = sms_blacklist.occurrences + 1`,
            [recipient || row.phone, `twilio_${errorCode}`]
          );
        } catch (err) {
          logger.error('Failed to blacklist phone', { error: err.message, recipient });
        }
      }

      // 4. Alert owner on terminal failure (push + email)
      if (isTerminalFailure(deliveryStatus)) {
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

        notifySmsFailed(row.salon_id, {
          phone: recipient || row.phone,
          reason: errorMessage || `Twilio ${errorCode || status}`,
          messageId: messageSid,
          clientName,
          dateTime,
        });

        const ownerEmail = process.env.OWNER_ALERT_EMAIL || 'barberclubmeylan@gmail.com';
        const subject = `[BarberClub ${row.salon_id}] SMS non delivre (Twilio) — ${clientName || recipient}`;
        const html = `
          <h2 style="font-family:Arial">SMS rejete par Twilio/operateur</h2>
          <p><b>Salon:</b> ${row.salon_id}</p>
          <p><b>Client:</b> ${clientName || '(inconnu)'} — ${recipient || row.phone}</p>
          <p><b>RDV:</b> ${dateTime || row.type}</p>
          <p><b>Raison:</b> ${errorMessage || status} ${errorCode ? `(code Twilio ${errorCode})` : ''}</p>
          <p><b>Type notification:</b> ${row.type}</p>
          <p><b>MessageSid Twilio:</b> ${messageSid}</p>
          <hr>
          <p style="color:#888">Action recommandee : appeler ${recipient || row.phone} pour confirmer le RDV.</p>
        `;
        brevoEmail(ownerEmail, subject, html, row.salon_id, { type: 'sms_failure_alert' })
          .catch((e) => logger.error('Owner alert email failed', { error: e.message }));
      }
    }
  } catch (err) {
    logger.error('Twilio webhook update failed', { error: err.message, messageSid });
  }

  // Mark event processed
  try {
    await db.query(
      'UPDATE twilio_sms_events SET processed = true WHERE message_sid = $1 AND status = $2',
      [messageSid, status]
    );
  } catch (_) { /* silent */ }

  return res.status(200).json({ ok: true });
});

module.exports = router;
