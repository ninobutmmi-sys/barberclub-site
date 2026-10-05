// ============================================
// Réservation en ligne ouverte ou fermée, salon par salon
// ============================================
// Un salon peut être prêt (équipe, prestations, pages) sans être ouvert :
// c'est le cas de Voiron avant son inauguration. Le drapeau
// salons.online_booking_open ferme la réservation publique (site, mon-rdv,
// app) ; les routes du dashboard ne le consultent pas.
//
// Lu à chaque requête, sans cache : l'interrupteur du dashboard doit agir
// tout de suite, et la requête porte sur la clé primaire.

const db = require('../config/database');
const logger = require('../utils/logger');
const { ApiError } = require('../utils/errors');
const config = require('../config/env');

const BOOKING_CLOSED = 'booking_closed';

/**
 * @param {string} salonId
 * @param {{ query: Function }} [q] client de transaction, sinon le pool
 * @returns {Promise<boolean>}
 */
async function isOnlineBookingOpen(salonId, q = db) {
  try {
    const r = await q.query('SELECT online_booking_open FROM salons WHERE id = $1', [salonId]);
    // Salon absent de la table : on ne bloque pas, les validations
    // (SALON_IDS) l'ont déjà refusé s'il n'existe pas vraiment.
    if (r.rows.length === 0) return true;
    return r.rows[0].online_booking_open !== false;
  } catch (err) {
    // Colonne absente : le code est déployé avant que la migration 098 ne
    // passe (elle tourne au démarrage, après l'ouverture du port). Fermer
    // tous les salons pendant ces secondes-là serait pire que de laisser
    // passer : on reste ouvert et on le note.
    if (err.code === '42703') {
      logger.warn('online_booking_open absent (migration 098 pas encore jouée)', { salonId });
      return true;
    }
    throw err;
  }
}

function closedError(salonId) {
  const nom = config.getSalonConfig(salonId).name.replace(/^BarberClub\s+/i, '');
  return new ApiError(403, `La réservation en ligne de ${nom} ouvre bientôt.`, null, BOOKING_CLOSED);
}

async function assertOnlineBookingOpen(salonId, q = db) {
  if (!(await isOnlineBookingOpen(salonId, q))) throw closedError(salonId);
}

module.exports = { isOnlineBookingOpen, assertOnlineBookingOpen, BOOKING_CLOSED };
