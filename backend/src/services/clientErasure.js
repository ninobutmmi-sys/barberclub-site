// ============================================
// Effacement d'un client (RGPD art. 17)
// ============================================
// Source unique pour les deux chemins de suppression : le client depuis
// mon-compte, le salon depuis la fiche du dashboard. Chacun avait sa propre
// requête, et aucune n'effaçait tout : photos de coupe, notes, anniversaire,
// préférences et liste d'attente restaient en clair après « suppression ».
//
// Ce qui reste, volontairement :
//   - la ligne clients, anonymisée (les RDV passés et les paiements y pointent
//     et servent à la compta) ;
//   - sms_blacklist : garder le numéro d'un client qui a dit STOP est ce qui
//     garantit qu'on ne lui écrira plus.

const db = require('../config/database');
const { formatPhoneInternational } = require('../utils/phone');

/**
 * Les journaux d'envoi stockent le numéro sous plusieurs formes selon le
 * fournisseur : tel que saisi (0612…), E.164 (+33612…), sans le + (33612…).
 */
function phoneVariants(phone) {
  if (!phone) return [];
  const e164 = formatPhoneInternational(phone);
  return [...new Set([phone, e164, e164.replace(/^\+/, '')])];
}

/**
 * Efface les données personnelles d'un client, en une transaction.
 * @returns {Promise<boolean>} false si le client n'existe pas ou est déjà supprimé
 */
async function eraseClient(clientId) {
  return db.transaction(async (tx) => {
    const found = await tx.query(
      'SELECT phone, email FROM clients WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [clientId]
    );
    if (found.rows.length === 0) return false;

    const { phone, email } = found.rows[0];
    const phones = phoneVariants(phone);
    const emails = email ? [email.toLowerCase()] : [];

    // RDV à venir : annulés, pour libérer les créneaux
    await tx.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = NOW()
       WHERE client_id = $1 AND status = 'confirmed' AND date >= CURRENT_DATE AND deleted_at IS NULL`,
      [clientId]
    );

    // Messages envoyés ou en attente : ils contiennent nom, numéro, email et texte
    await tx.query(
      `DELETE FROM notification_queue
       WHERE booking_id IN (SELECT id FROM bookings WHERE client_id = $1)
          OR phone = ANY($2::text[])
          OR lower(email) = ANY($3::text[])`,
      [clientId, phones, emails]
    );

    await tx.query('DELETE FROM twilio_sms_events WHERE recipient = ANY($1::text[])', [phones]);
    await tx.query('DELETE FROM brevo_sms_events WHERE recipient = ANY($1::text[])', [phones]);
    await tx.query('DELETE FROM brevo_email_events WHERE lower(recipient) = ANY($1::text[])', [emails]);

    await tx.query('DELETE FROM client_photos WHERE client_id = $1', [clientId]);
    await tx.query(
      'DELETE FROM waitlist WHERE client_id = $1 OR client_phone = ANY($2::text[])',
      [clientId, phones]
    );
    await tx.query(
      'DELETE FROM event_alerts WHERE phone = ANY($1::text[]) OR lower(email) = ANY($2::text[])',
      [phones, emails]
    );
    await tx.query(
      `UPDATE gift_cards SET buyer_name = 'Client supprimé', buyer_client_id = NULL
       WHERE buyer_client_id = $1`,
      [clientId]
    );

    // 'DEL_' + 15 caractères : tient dans l'ancien VARCHAR(20) et reste unique
    await tx.query(
      `UPDATE clients SET
         first_name = 'Client', last_name = 'supprimé',
         phone = 'DEL_' || LEFT($1::text, 15), email = NULL,
         password_hash = NULL, has_account = false,
         reset_token = NULL, reset_token_expires = NULL,
         notes = NULL, birth_date = NULL, preferences = NULL,
         deleted_at = NOW()
       WHERE id = $1`,
      [clientId]
    );

    await tx.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1 AND user_type = $2',
      [clientId, 'client']
    );

    return true;
  });
}

module.exports = { eraseClient, phoneVariants };
