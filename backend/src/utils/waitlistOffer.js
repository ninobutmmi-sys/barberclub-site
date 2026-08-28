const crypto = require('crypto');

/**
 * Lien court pour le SMS de liste d'attente.
 *
 * POURQUOI SI COURT — le SMS doit tenir sous 155 caractères pour rester à un
 * seul crédit. Le message porte déjà la date, l'heure et le barbier ; il ne
 * reste qu'une poignée de caractères pour le lien. Un code de 6 caractères
 * donne 56 milliards de combinaisons, largement assez pour des offres qui
 * vivent quelques heures.
 *
 * Alphabet sans O/0, I/l/1 : ces codes finissent lus à voix haute au comptoir.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genererCode(longueur = 6) {
  const octets = crypto.randomBytes(longueur);
  let code = '';
  for (let i = 0; i < longueur; i++) code += ALPHABET[octets[i] % ALPHABET.length];
  return code;
}

/** L'URL complète envoyée par SMS. */
function lienOffre(siteUrl, code) {
  return `${siteUrl.replace(/\/$/, '')}/r/w/${code}`;
}

module.exports = { genererCode, lienOffre };
