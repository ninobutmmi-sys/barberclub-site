/**
 * Normalisation des adresses email.
 *
 * POURQUOI CE FICHIER EXISTE — `.normalizeEmail()` d'express-validator
 * supprime les points des adresses Gmail par défaut (`gmail_remove_dots`) :
 *
 *     jean.dupont@gmail.com  ->  jeandupont@gmail.com
 *
 * La base stocke l'adresse telle que le client l'a donnée, avec ses points.
 * La comparaison `email = $1` ne trouvait donc rien pour toute adresse Gmail
 * pointée : 91 comptes ne pouvaient ni se connecter ni réinitialiser leur mot
 * de passe, et le formulaire répondait « un lien a été envoyé » sans rien
 * envoyer. Constaté en production le 2026-08-26.
 *
 * On se contente désormais de couper les espaces et de passer en minuscules.
 * Les requêtes comparent sur `LOWER(email)` pour rattraper les 56 fiches
 * importées avec des majuscules.
 */
function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

module.exports = { normalizeEmail };
