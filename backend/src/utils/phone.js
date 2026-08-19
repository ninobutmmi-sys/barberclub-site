// ============================================
// Téléphone — source unique de vérité
// ============================================
// Ces fonctions vivaient dans services/notification/helpers.js, donc elles ne
// s'appliquaient qu'à l'envoi. Résultat : la base accumulait des numéros faux
// que seul l'envoi rattrapait, et le dashboard affichait un drapeau russe sur
// des mobiles français. Elles sont remontées ici pour servir aussi à
// l'écriture et à l'affichage.

/**
 * Répare un mobile français amputé de son 0.
 *
 * Un client qui saisit « 6 12 34 56 78 » au lieu de « 06 12 34 56 78 » finit
 * stocké en `+612345678`, que le monde lit comme l'Australie (+61) ou la
 * Russie (+7). 410 fiches sont dans ce cas.
 *
 * Sûr : un vrai numéro étranger en +6X/+7X compte au moins 10 chiffres après
 * le « + » (+61 Australie, +7 Russie…). On ne touche qu'aux 9 chiffres
 * exactement, longueur qui ne correspond à aucun numéro international valide.
 */
function repairTruncatedFrenchMobile(cleaned) {
  return /^\+[67]\d{8}$/.test(cleaned) ? '+33' + cleaned.slice(1) : cleaned;
}

/**
 * Normalise un numéro avant écriture en base.
 *
 * VOLONTAIREMENT MINIMAL. On enlève les séparateurs et on répare les mobiles
 * amputés — rien d'autre. En particulier on NE convertit PAS `0612345678` en
 * `+33612345678` : 4 554 fiches sont stockées au format `0X`, et les
 * recherches par téléphone (inscription, création de RDV) comparent la chaîne
 * telle quelle. Normaliser le format créerait un doublon à chaque fois qu'un
 * de ces clients revient.
 */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return phone;
  return repairTruncatedFrenchMobile(phone.replace(/[\s.\-()]/g, ''));
}

/**
 * Un SMS peut-il physiquement arriver sur ce numéro ?
 *
 * Seuls les mobiles (06/07) reçoivent des SMS. Les fixes (01 à 05) sont
 * rejetés par l'opérateur — c'est l'erreur Twilio 21635 qui a produit
 * 141 échecs en boucle du 20 au 25 juillet 2026. On les envoie par email.
 */
function isFrenchMobile(phone) {
  if (!phone) return false;
  const cleaned = normalizePhone(phone);
  return /^(\+33|0033|0)[67]\d{8}$/.test(cleaned);
}

/**
 * Numéro français, mobile ou fixe. Conservé pour les usages où la
 * distinction n'a pas lieu d'être (affichage, statistiques).
 */
function isFrenchPhone(phone) {
  if (!phone) return false;
  const cleaned = normalizePhone(phone);
  return /^(\+33|0033|0)[1-9]\d{8}$/.test(cleaned);
}

/** Format E.164 attendu par les fournisseurs de SMS. */
function formatPhoneInternational(phone) {
  let cleaned = String(phone).replace(/[\s.\-()]/g, '');
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '+33' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return repairTruncatedFrenchMobile(cleaned);
}

module.exports = {
  repairTruncatedFrenchMobile,
  normalizePhone,
  isFrenchMobile,
  isFrenchPhone,
  formatPhoneInternational,
};
