import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useBookingsHistoryPages, useBarbers } from '../hooks/useApi';
import * as api from '../api';
import { formatPrice } from '../utils/format';
import { formatPhoneWithFlag } from '../utils/phone';

/**
 * Faux plans — l'ardoise du salon.
 *
 * La base contient 200 rendez-vous non honorés étalés sur cinq mois, dont 37
 * seulement ont été relancés. L'ancienne page les servait tous à l'identique,
 * cinquante par page, triés par date : impossible d'y voir ce qui reste à
 * faire. Ici la page répond à deux questions, dans cet ordre : combien reste-t-il
 * sur l'ardoise et quelle part n'a jamais été relancée, puis qui relancer en
 * premier — c'est-à-dire les plus récents, les seuls pour qui le SMS
 * « facturé au prochain passage » veut encore dire quelque chose.
 */

// L'API plafonne à 200 lignes par requête, et la fenêtre par défaut en ramène
// une centaine. Recherche, filtres et totaux sont calculés ici, sur ce qui est
// en mémoire : il faut donc que tout y soit, sinon la somme affichée ment et
// les plus anciens deviennent inatteignables. Les tranches suivantes sont
// chargées d'elles-mêmes, jusqu'à mille lignes — au-delà, à la demande.
const PLAFOND = 200;
const TRANCHES_AUTO = 5;

// `titre` nomme la période, `portee` s'insère dans une phrase.
const FENETRES = [
  { cle: '30', label: '30 j', titre: '30 derniers jours', portee: 'des 30 derniers jours', jours: 30 },
  { cle: '90', label: '90 j', titre: '90 derniers jours', portee: 'des 90 derniers jours', jours: 90 },
  { cle: '180', label: '6 mois', titre: '6 derniers mois', portee: 'des 6 derniers mois', jours: 180 },
  { cle: 'tout', label: 'Tout', titre: 'depuis le début', portee: 'depuis le début', jours: null },
];

// Trois cohortes de fraîcheur. Ce n'est pas un habillage : la fraîcheur décide
// si relancer a encore un sens, et c'est le seul ordre de priorité défendable.
const COHORTES = [
  { cle: 'semaine', titre: 'Cette semaine', max: 7 },
  { cle: 'mois', titre: 'Ce mois-ci', max: 30 },
  { cle: 'ancien', titre: 'Plus ancien', max: Infinity },
];

const IconSearch = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
const IconClose = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
const IconCheck = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
const IconSms = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
const IconArdoiseVide = () => <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoIlYA(jours) {
  const d = new Date();
  d.setDate(d.getDate() - jours);
  return isoLocal(d);
}

function ageEnJours(dateStr) {
  const jour = new Date(dateStr + 'T00:00:00');
  const auj = new Date();
  auj.setHours(0, 0, 0, 0);
  return Math.round((auj - jour) / 86400000);
}

function libelleJour(dateStr) {
  return new Date(dateStr + 'T00:00:00')
    .toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function libelleAge(j) {
  if (j <= 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  if (j < 7) return `il y a ${j} j`;
  if (j < 31) return `il y a ${Math.floor(j / 7)} sem.`;
  return `il y a ${Math.floor(j / 30)} mois`;
}

function heure(t) {
  return t ? t.slice(0, 5) : '';
}

/**
 * Le texte exact envoyé par le backend (routes/admin/bookings.js, no-show-sms).
 * Recopié ici pour montrer au barbier ce que le client va lire avant qu'il
 * n'appuie : c'est un SMS payant et définitif. À garder synchronisé.
 */
function apercuSms(b) {
  const date = new Date(b.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  return `BarberClub - RDV non honore du ${date}. Prestation facturee a 100% au prochain passage. Erreur? Contactez votre salon.`;
}

export default function FauxPlans() {
  const queryClient = useQueryClient();
  const [fenetreCle, setFenetreCle] = useState('90');
  const [recherche, setRecherche] = useState('');
  const [barbierFiltre, setBarbierFiltre] = useState('');
  const [segment, setSegment] = useState(null); // null | 'a-relancer' | 'relances'
  const [enCours, setEnCours] = useState({});   // id -> 'sms' | 'regle'
  const [sortants, setSortants] = useState({}); // id -> 'anim' | 'off'
  // Le SMS part dans une file que le cron vide toutes les deux minutes, et
  // no_show_sms_sent ne bascule qu'une fois parti pour de bon. Sans cette
  // trace locale, la ligne resterait rouge et le bouton cliquable après un
  // envoi réussi — avec, à la clé, un deuxième envoi qui ne partira jamais.
  const [relancesLocales, setRelancesLocales] = useState(() => new Set());
  const [apercu, setApercu] = useState(null);   // rendez-vous dont on prépare le SMS
  const [envoiSms, setEnvoiSms] = useState(false);
  const [toast, setToast] = useState(null);

  const fenetre = FENETRES.find((f) => f.cle === fenetreCle) || FENETRES[1];

  const minuteurs = useRef([]);
  const toastTimer = useRef(null);
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    minuteurs.current.forEach(clearTimeout);
  }, []);

  const { data: barbiersData = [] } = useBarbers();
  const barbiers = useMemo(() => barbiersData.filter((b) => b.is_active), [barbiersData]);

  const params = useMemo(() => ({
    status: 'no_show',
    limit: PLAFOND,
    sort: 'date',
    order: 'desc',
    ...(fenetre.jours ? { from: isoIlYA(fenetre.jours) } : {}),
  }), [fenetre]);

  const {
    data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useBookingsHistoryPages(params);

  const tranches = useMemo(() => data?.pages || [], [data]);
  const brut = useMemo(() => tranches.flatMap((p) => p.bookings || []), [tranches]);
  const total = tranches[0]?.total || 0;

  // Les tranches suivantes s'enchaînent seules : tant qu'il en manque, aucun
  // chiffre de la page n'est exact.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && tranches.length < TRANCHES_AUTO) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, tranches.length, fetchNextPage]);

  const complet = !hasNextPage;

  // Un SMS tout juste envoyé compte comme une relance immédiatement, partout :
  // liseré, bouton, jauge et segments.
  const lignes = useMemo(() => (
    relancesLocales.size === 0
      ? brut
      : brut.map((b) => (
        !b.no_show_sms_sent && relancesLocales.has(b.id) ? { ...b, no_show_sms_sent: true } : b
      ))
  ), [brut, relancesLocales]);

  // Récidive : comptée sur la fenêtre chargée, avant tout filtre. Quelqu'un qui
  // pose trois lapins n'est pas le même problème qu'un oubli isolé.
  const recidive = useMemo(() => {
    const m = new Map();
    for (const b of lignes) m.set(b.client_id, (m.get(b.client_id) || 0) + 1);
    return m;
  }, [lignes]);

  const q = recherche.trim().toLowerCase();
  // Les numéros sont stockés en E.164 (+33612…) mais affichés espacés juste à
  // côté du champ : on compare chiffre à chiffre, sinon taper « 06 12 » ne
  // trouve jamais rien.
  const qChiffres = q.replace(/\D/g, '');
  const filtres = useMemo(() => lignes.filter((b) => {
    if (barbierFiltre && b.barber_id !== barbierFiltre) return false;
    if (!q) return true;
    const nom = `${b.client_first_name || ''} ${b.client_last_name || ''}`.toLowerCase();
    if (nom.includes(q)) return true;
    if (!qChiffres) return false;
    const tel = (b.client_phone || '').replace(/\D/g, '');
    // « 0612… » saisi contre « 33612… » stocké : on tolère le zéro initial.
    return tel.includes(qChiffres) || tel.includes(qChiffres.replace(/^0/, ''));
  }), [lignes, barbierFiltre, q, qChiffres]);

  // L'ardoise décrit la fenêtre telle que filtrée par barbier et recherche,
  // mais pas par segment : les deux segments sont justement sa décomposition.
  const ardoise = useMemo(() => {
    const clients = new Set();
    let du = 0, duRelance = 0, nRelance = 0;
    for (const b of filtres) {
      const prix = b.price || 0;
      du += prix;
      clients.add(b.client_id);
      if (b.no_show_sms_sent) { duRelance += prix; nRelance += 1; }
    }
    return {
      du,
      clients: clients.size,
      n: filtres.length,
      relance: { montant: duRelance, n: nRelance },
      aRelancer: { montant: du - duRelance, n: filtres.length - nRelance },
    };
  }, [filtres]);

  const visibles = useMemo(() => filtres.filter((b) => {
    if (sortants[b.id] === 'off') return false;
    if (segment === 'a-relancer') return !b.no_show_sms_sent;
    if (segment === 'relances') return !!b.no_show_sms_sent;
    return true;
  }), [filtres, segment, sortants]);

  const groupes = useMemo(() => {
    const g = COHORTES.map((c) => ({ ...c, lignes: [] }));
    for (const b of visibles) {
      const j = ageEnJours(b.date);
      (g.find((c) => j <= c.max) || g[g.length - 1]).lignes.push(b);
    }
    return g.filter((c) => c.lignes.length > 0);
  }, [visibles]);

  const partARelancer = ardoise.du > 0 ? (ardoise.aRelancer.montant / ardoise.du) * 100 : 0;

  const marquerRegle = useCallback(async (b) => {
    setEnCours((e) => ({ ...e, [b.id]: 'regle' }));
    try {
      await api.updateBookingStatus(b.id, 'completed');
      setSortants((s) => ({ ...s, [b.id]: 'anim' }));
      showToast(`${b.client_first_name || 'Client'} — ${formatPrice(b.price || 0)} réglés`);
      minuteurs.current.push(setTimeout(async () => {
        setSortants((s) => ({ ...s, [b.id]: 'off' }));
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
        // On attend le rechargement avant d'oublier la ligne : elle n'y est
        // plus, donc rien ne réapparaît. Garder « off » indéfiniment aurait
        // masqué le rendez-vous s'il repassait en faux plan ailleurs.
        await queryClient.invalidateQueries({ queryKey: ['bookingsHistory'] });
        setSortants((s) => { const n = { ...s }; delete n[b.id]; return n; });
      }, 620));
    } catch (err) {
      showToast(err.message || 'Impossible de régulariser ce faux plan', 'error');
    } finally {
      setEnCours((e) => { const n = { ...e }; delete n[b.id]; return n; });
    }
  }, [queryClient, showToast]);

  const envoyerSms = useCallback(async () => {
    if (!apercu) return;
    setEnvoiSms(true);
    try {
      await api.sendNoShowSms(apercu.id);
      setRelancesLocales((s) => new Set(s).add(apercu.id));
      showToast(`SMS en route vers ${apercu.client_first_name || 'ce client'}`);
      setApercu(null);
    } catch (err) {
      showToast(err.message || "Échec de l'envoi", 'error');
    } finally {
      setEnvoiSms(false);
    }
  }, [apercu, showToast]);

  const filtreActif = Boolean(q || barbierFiltre || segment);

  return (
    <>
      <div className="page-header fx-header">
        <div>
          <h2 className="page-title">Faux plans</h2>
          <p className="fx-sous">Les rendez-vous non honorés, et ce qu'ils ont laissé sur l'ardoise.</p>
        </div>
        <div className="fx-fenetres" role="group" aria-label="Période">
          {FENETRES.map((f) => (
            <button
              key={f.cle}
              type="button"
              className={`fx-fenetre ${fenetreCle === f.cle ? 'on' : ''}`}
              onClick={() => setFenetreCle(f.cle)}
              aria-pressed={fenetreCle === f.cle}
              title={`Faux plans ${f.portee}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body">
        {error && <div className="fx-alerte" role="alert">{error.message}</div>}

        {/* ── L'ardoise ──
            Un seul objet donne la somme due, sa décomposition et le filtre :
            la part rouge est ce qui n'a jamais été relancé. */}
        <section className="fx-ardoise" aria-label="Ardoise du salon">
          <div className="fx-ardoise-haut">
            <div>
              {/* Tant que tout n'est pas chargé, le total est un sous-total et
                  le dit — c'est le plus gros chiffre de la page. */}
              <span className="fx-ardoise-label">
                Ardoise · {fenetre.titre}{!complet && ' · partielle'}
              </span>
              <p className="fx-somme">{formatPrice(ardoise.du)}</p>
            </div>
            <p className="fx-ardoise-compte">
              {ardoise.n} faux plan{ardoise.n !== 1 ? 's' : ''}
              <span> · {ardoise.clients} client{ardoise.clients !== 1 ? 's' : ''}</span>
            </p>
          </div>

          <div
            className="fx-jauge"
            role="img"
            aria-label={`${Math.round(partARelancer)} % de la somme n'a pas encore été relancée`}
          >
            <span className="fx-jauge-du" style={{ width: `${partARelancer}%` }} />
          </div>

          <div className="fx-legende">
            <button
              type="button"
              className={`fx-seg du ${segment === 'a-relancer' ? 'on' : ''}`}
              onClick={() => setSegment(segment === 'a-relancer' ? null : 'a-relancer')}
              aria-pressed={segment === 'a-relancer'}
            >
              <i /> À relancer
              <b>{formatPrice(ardoise.aRelancer.montant)}</b>
              <em>{ardoise.aRelancer.n}</em>
            </button>
            <button
              type="button"
              className={`fx-seg relance ${segment === 'relances' ? 'on' : ''}`}
              onClick={() => setSegment(segment === 'relances' ? null : 'relances')}
              aria-pressed={segment === 'relances'}
            >
              <i /> Relancés
              <b>{formatPrice(ardoise.relance.montant)}</b>
              <em>{ardoise.relance.n}</em>
            </button>
          </div>
        </section>

        {/* ── Recherche et barbier ── */}
        <div className="fx-outils">
          <div className="fx-search">
            <span className="fx-search-ico"><IconSearch /></span>
            <input
              type="search"
              className="input"
              placeholder="Nom ou téléphone…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              aria-label="Rechercher un client"
            />
            {recherche && (
              <button type="button" className="fx-search-clear" onClick={() => setRecherche('')} aria-label="Effacer la recherche">
                <IconClose />
              </button>
            )}
          </div>
          <select
            className="input fx-select"
            value={barbierFiltre}
            onChange={(e) => setBarbierFiltre(e.target.value)}
            aria-label="Filtrer par barbier"
          >
            <option value="">Tous les barbiers</option>
            {barbiers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        {!complet && !isLoading && (
          <p className="fx-tronque">
            {isFetchingNextPage
              ? `${brut.length} faux plans chargés sur ${total}…`
              : (
                <>
                  {brut.length} sur {total} chargés.{' '}
                  <button type="button" className="fx-lien-btn" onClick={() => fetchNextPage()}>
                    Charger la suite
                  </button>
                </>
              )}
          </p>
        )}

        {/* Une requête qui échoue laisse la liste vide : sans ce garde-fou,
            l'écran annonçait « tous les rendez-vous ont été honorés ». */}
        {isLoading ? (
          <div className="fx-squelette" aria-busy="true" aria-label="Chargement">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="fx-skel-ligne" />)}
          </div>
        ) : error ? null : visibles.length === 0 ? (
          <div className="empty-state fx-vide">
            <IconArdoiseVide />
            {filtreActif ? (
              <>
                <p className="fx-vide-titre">Aucun faux plan ne correspond</p>
                <p>
                  {segment || barbierFiltre
                    ? 'Effacez les filtres, ou élargissez la période.'
                    : 'Vérifiez l’orthographe, ou élargissez la période.'}
                </p>
              </>
            ) : (
              <>
                <p className="fx-vide-titre">L'ardoise est vide</p>
                <p>Tous les rendez-vous {fenetre.portee} ont été honorés.</p>
              </>
            )}
          </div>
        ) : (
          groupes.map((g) => (
            <section key={g.cle} className={`fx-cohorte ${g.cle}`}>
              <h3 className="fx-cohorte-titre">
                {g.titre}<span>{g.lignes.length}</span>
              </h3>
              <ul className="fx-list">
                {g.lignes.map((b) => (
                  <Ligne
                    key={b.id}
                    b={b}
                    ancien={g.cle === 'ancien'}
                    recidives={recidive.get(b.client_id) || 1}
                    etat={enCours[b.id]}
                    sortant={sortants[b.id] === 'anim'}
                    onSms={() => setApercu(b)}
                    onRegle={() => marquerRegle(b)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* ── Aperçu du SMS ──
          Un SMS coûte et ne se rattrape pas : on montre le texte exact. */}
      {apercu && (
        <div className="modal-backdrop" onClick={() => setApercu(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Relancer par SMS"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 430 }}
          >
            <div className="modal-header">
              <h3 className="modal-title">Relancer par SMS</h3>
              <button className="btn-ghost" onClick={() => setApercu(null)} aria-label="Fermer">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="fx-modal-dest">
                Pour <strong>{apercu.client_first_name} {apercu.client_last_name}</strong> — {formatPhoneWithFlag(apercu.client_phone)}
              </p>
              <div className="fx-modal-sms">{apercuSms(apercu)}</div>
              <p className="fx-modal-compte">
                {apercuSms(apercu).length} caractères — {apercuSms(apercu).length <= 160 ? '1 SMS' : '2 SMS'}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setApercu(null)}>Annuler</button>
              <button className="btn btn-primary btn-sm" onClick={envoyerSms} disabled={envoiSms}>
                {envoiSms ? 'Envoi…' : 'Envoyer le SMS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`} role="status">{toast.message}</div>
        </div>
      )}
    </>
  );
}

/**
 * Une ligne d'ardoise. Même balisage au téléphone et sur l'écran : c'est la
 * grille qui se replie. L'ancienne page maintenait deux rendus séparés, et
 * seule la version bureau avait fini par recevoir le téléphone du client.
 */
function Ligne({ b, ancien, recidives, etat, sortant, onSms, onRegle }) {
  const age = ageEnJours(b.date);
  const relance = !!b.no_show_sms_sent;
  const sansTel = !b.client_phone;

  return (
    <li className={`fx-row${relance ? ' relance' : ''}${ancien ? ' ancien' : ''}${sortant ? ' sortie' : ''}`}>
      <div className="fx-quand">
        <span className="fx-jour">{libelleJour(b.date)}</span>
        <span className="fx-heure">{heure(b.start_time)} · {libelleAge(age)}</span>
      </div>

      <div className="fx-qui">
        <Link className="fx-nom" to={`/clients/${b.client_id}`} title={`Ouvrir la fiche de ${b.client_first_name || ''} ${b.client_last_name || ''}`}>
          {b.client_first_name} {b.client_last_name}
        </Link>
        {/* Un compte, pas un rang : le même client porte le même badge sur
            chacune de ses lignes, y compris la plus ancienne. « 3ᵉ » y
            affirmait le contraire. */}
        {recidives > 1 && (
          <span
            className={`fx-recidive${recidives >= 3 ? ' fort' : ''}`}
            title={`${recidives} faux plans sur la période affichée`}
          >
            ×{recidives}
          </span>
        )}
        {b.client_phone && (
          <a className="fx-tel" href={`tel:${b.client_phone}`}>{formatPhoneWithFlag(b.client_phone)}</a>
        )}
      </div>

      <div className="fx-quoi">
        <span className="fx-presta">{b.service_name || '—'}</span>
        <span className="fx-barbier">{b.barber_name || '—'}</span>
      </div>

      <p className="fx-montant">{formatPrice(b.price || 0)}</p>

      <div className="fx-actions">
        <button
          type="button"
          className={`fx-btn sms${relance ? ' fait' : ''}`}
          onClick={onSms}
          disabled={relance || sansTel}
          title={relance ? 'SMS déjà envoyé' : sansTel ? 'Pas de téléphone pour ce client' : 'Voir et envoyer le SMS de relance'}
        >
          {relance ? <><IconCheck /> Relancé</> : <><IconSms /> Relancer</>}
        </button>
        <button
          type="button"
          className="fx-btn regle"
          onClick={onRegle}
          disabled={etat === 'regle'}
          title="Le client a réglé : sortir de l'ardoise"
        >
          {etat === 'regle' ? <span className="fx-spin" /> : <><IconCheck /> Réglé</>}
        </button>
      </div>
    </li>
  );
}
