// ============================================
// Reception des evenements email de Brevo
// ============================================
// Jumeau de brevoSms.js, pour le courrier. Brevo poste ici ce que devient
// chaque message une fois parti :
//   delivered              -> la boite du client l'a accepte
//   soft_bounce            -> refus temporaire (boite pleine, serveur occupe)
//   hard_bounce            -> adresse morte : ca ne partira jamais
//   blocked / invalid      -> Brevo a refuse d'envoyer (adresse sur sa liste noire)
//   spam                   -> le client l'a signale comme indesirable
//   deferred               -> remis a plus tard par le serveur d'en face
//   unsubscribed           -> desinscription
//
// Sans ce retour, la file marque « envoye » des que Brevo repond 201 et la
// suite se passe hors de notre vue : un client qui dit ne pas avoir recu sa
// confirmation ne laisse aucune trace a consulter.
//
// Authentification : en-tete X-Webhook-Secret, ou ?token= pour rester
// compatible avec la configuration du canal SMS.

const express = require('express');
const crypto = require('crypto');
const db = require('../../config/database');
const logger = require('../../utils/logger');

const router = express.Router();

function safeEqual(a, b) {
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Les noms d'evenements email de Brevo, ramenes a nos statuts.
function mapEventToStatus(event) {
  const e = String(event || '').toLowerCase().replace(/[\s-]/g, '_');
  if (e === 'delivered') return 'delivered';
  if (e === 'request' || e === 'sent') return 'sent';
  if (e === 'soft_bounce' || e === 'softbounce' || e === 'deferred') return 'soft_bounce';
  if (e === 'hard_bounce' || e === 'hardbounce') return 'hard_bounce';
  if (e === 'blocked' || e === 'invalid_email' || e === 'invalid') return 'rejected';
  if (e === 'spam' || e === 'complaint') return 'spam';
  if (e === 'unsubscribed' || e === 'unsubscribe') return 'unsubscribed';
  // opened / click : le message est forcement arrive, mais on ne veut pas
  // ecraser un statut plus precis par une ouverture tardive.
  if (e === 'opened' || e === 'unique_opened' || e === 'click') return 'opened';
  return 'unknown';
}

// Un echec dont on ne se relevera pas : l'adresse est mauvaise ou le client
// nous a signale. Ces deux-la meritent qu'on previenne.
function estEchecDefinitif(statut) {
  return statut === 'hard_bounce' || statut === 'rejected' || statut === 'spam';
}

router.post('/brevo/email', async (req, res) => {
  const attendu = process.env.BREVO_WEBHOOK_SECRET || '';
  const parEntete = String(req.headers['x-webhook-secret'] || '');
  const parUrl = String(req.query.token || '');
  const fourni = parEntete || parUrl;

  if (!attendu || !safeEqual(fourni, attendu)) {
    logger.warn('Webhook email Brevo refusé — jeton invalide', { ip: req.ip });
    return res.status(403).json({ error: 'Invalid token' });
  }

  const payload = req.body || {};
  const brut = payload['message-id'] ?? payload.messageId ?? payload.message_id ?? payload.id ?? null;
  const messageId = brut != null ? String(brut) : null;
  const event = payload.event || null;
  const destinataire = payload.email || payload.to || null;
  const sujet = payload.subject || null;
  const raison = payload.reason || payload.description || null;

  if (!messageId || !event) {
    logger.warn('Webhook email Brevo incomplet', {
      cles: Object.keys(payload),
      extrait: JSON.stringify(payload).slice(0, 400),
    });
    return res.status(200).json({ ok: true, ignored: 'missing fields' });
  }

  const statut = mapEventToStatus(event);

  // 1. Journaliser. L'index unique rend l'operation idempotente : Brevo rejoue.
  let nouveau = false;
  try {
    const ins = await db.query(
      `INSERT INTO brevo_email_events (message_id, event, recipient, subject, reason, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (message_id, event) DO NOTHING
       RETURNING id`,
      [messageId, event, destinataire, sujet, raison, payload]
    );
    nouveau = ins.rows.length > 0;
  } catch (err) {
    logger.error('Journal des evenements email : ecriture impossible', { error: err.message, messageId, event });
  }

  if (!nouveau) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // 2. Reporter sur la file. Une ouverture n'ecrase pas un statut plus precis.
  try {
    const maj = await db.query(
      `UPDATE notification_queue
       SET delivery_status = CASE
             WHEN $1::text = 'opened' AND delivery_status IS NOT NULL THEN delivery_status
             ELSE $1::text END,
           delivery_event_at = NOW(),
           delivered_at = CASE WHEN $1::text IN ('delivered', 'opened') THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
           last_error = CASE WHEN $1::text IN ('hard_bounce', 'rejected', 'soft_bounce', 'spam')
                             THEN COALESCE($2::text, last_error) ELSE last_error END
       WHERE provider_message_id = $3::text
       RETURNING id, type, salon_id, email, booking_id`,
      [statut, raison, messageId]
    );

    if (maj.rows.length === 0) {
      logger.debug('Webhook email : aucune ligne de file pour ce message', { messageId });
    } else if (estEchecDefinitif(statut)) {
      const ligne = maj.rows[0];
      logger.warn('Email non remis', {
        type: ligne.type, salon: ligne.salon_id, destinataire: destinataire || ligne.email,
        statut, raison, messageId,
      });
    }
  } catch (err) {
    logger.error('Webhook email : mise a jour de la file impossible', { error: err.message, messageId });
  }

  return res.status(200).json({ ok: true });
});

module.exports = router;
