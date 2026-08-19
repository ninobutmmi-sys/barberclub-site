const { normalizePhone } = require('../utils/phone');

// Champs qui transportent un numéro de téléphone dans le corps des requêtes.
const CHAMPS = ['phone', 'client_phone'];

/**
 * Répare les numéros à l'entrée, avant validation et avant écriture.
 *
 * Pourquoi ici plutôt que dans chaque route : un numéro de client peut être
 * créé par au moins six chemins (réservation invité, inscription, liste
 * d'attente, création client au dashboard, création de RDV au comptoir,
 * modification de profil). Corriger route par route, c'est six occasions d'en
 * oublier une — et c'est exactement ce qui s'est passé : 410 fiches sont
 * arrivées en base avec un mobile amputé de son 0, sans qu'on sache par quelle
 * porte. Un seul point de passage ferme toutes les portes, y compris celles
 * qui n'existent pas encore.
 *
 * Le rattrapage à l'envoi (services/notification) reste en place : deux
 * couches valent mieux qu'une, et l'ancienne base contient encore des numéros
 * écrits avant ce middleware.
 */
function normalizePhoneFields(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const champ of CHAMPS) {
      if (typeof req.body[champ] === 'string') {
        req.body[champ] = normalizePhone(req.body[champ]);
      }
    }
  }
  next();
}

module.exports = { normalizePhoneFields };
