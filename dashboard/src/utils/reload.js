// ============================================
// Onglet resté ouvert, déploiement entre-temps
// ============================================
// Le dashboard découpe ses pages en fichiers dont le nom porte une empreinte,
// et un déploiement les renomme. Un onglet laissé ouvert garde en mémoire les
// anciens noms : au premier clic vers une page pas encore chargée, l'import
// échoue et l'écran d'erreur remplace le planning — en plein service.
//
// On recharge, ce qui va chercher le nouveau nom. Le garde-fou est un
// horodatage plutôt qu'un simple drapeau : un échec qui suit de près un
// rechargement signifie que le rechargement n'a rien arrangé (réseau coupé,
// fichier réellement absent), et là il vaut mieux laisser l'écran d'erreur
// faire son travail que boucler indéfiniment.

const CLE = 'bc_reload_chunk';
const DELAI_ANTI_BOUCLE_MS = 10_000;

/** Le message ressemble-t-il à un module introuvable ? */
export function estChunkManquant(erreur) {
  const m = String(erreur?.message || erreur || '');
  return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i.test(m);
}

/**
 * Recharge la page, au plus une fois par fenêtre de dix secondes.
 * @returns {boolean} true si le rechargement est lancé — l'appelant peut alors
 *   s'abstenir d'afficher une erreur, la page va disparaître.
 */
export function rechargerUneFois() {
  let dernier = 0;
  try {
    dernier = Number(sessionStorage.getItem(CLE) || 0);
  } catch { /* navigation privée : on tente quand même */ }

  if (Date.now() - dernier < DELAI_ANTI_BOUCLE_MS) return false;

  try {
    sessionStorage.setItem(CLE, String(Date.now()));
  } catch { /* ignore */ }

  window.location.reload();
  return true;
}
