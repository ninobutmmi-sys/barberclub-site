import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  useBarbers,
  useAllSchedules,
  useBarberSchedule,
  useBarberGuestDays,
  useUpdateBarber,
  useCreateBarber,
  useDeleteBarber,
  useServices,
  useBarberServices,
  useSetBarberService,
  useRemoveBarberService,
  useUpdateBarberSchedule,
  useAddBarberOverride,
  useDeleteBarberOverride,
  useAddBarberGuestDay,
  useDeleteBarberGuestDay,
  useBarberBreaks,
  useCreateBlockedSlot,
  useDeleteBlockedSlot,
  useDeleteBarberBreaksBulk,
} from '../hooks/useApi';
import { formatPrice } from '../utils/format';

/**
 * L'équipe.
 *
 * L'écran d'avant était un lanceur : quatre boutons par personne — Modifier,
 * Horaires, Pauses, Jours invite — et une carte qui ne disait rien d'autre que
 * le nom et l'e-mail. Pour savoir quand quelqu'un travaille il fallait ouvrir
 * une fenêtre, et plusieurs réglages n'étaient joignables nulle part : les
 * dates de contrat n'étaient modifiables qu'à la création, la photo se saisis-
 * sait en collant une URL, les prestations vivaient sur un autre écran.
 *
 * Ici la carte montre la semaine — c'est la seule chose qui distingue une fiche
 * de barbier d'un carnet d'adresses — et tout ce qui se modifie tient dans une
 * fiche unique à onglets, utilisable au téléphone.
 */

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAYS_COURT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DAYS_ABREGE = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

// Échelle du semainier : le salon ouvre à 9h et l'admin va jusqu'à 20h.
const AMPLITUDE_DEBUT = 8;
const AMPLITUDE_FIN = 20;

const SALON_OPTIONS = [
  { id: 'grenoble', label: 'Grenoble' },
  { id: 'meylan', label: 'Meylan' },
];

const ONGLETS = [
  { cle: 'identite', label: 'Identité' },
  { cle: 'semaine', label: 'Semaine' },
  { cle: 'absences', label: 'Absences' },
  { cle: 'prestations', label: 'Prestations' },
  { cle: 'deplacements', label: 'Déplacements' },
];

const PHOTO_MAX_MO = 2;

// ---- Icônes ----
const IcoClose = () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>;
const IcoPlus = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
const IcoTrash = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
const IcoCamera = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>;
const IcoChevron = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>;

// ---- Utilitaires ----

function formatDateFr(dateStr) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatJourCourt(dateStr) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

function hhmm(t) {
  return (t || '').slice(0, 5);
}

function enHeures(t) {
  const [h, m] = hhmm(t).split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
}

function initiale(nom = '') {
  return nom.trim().charAt(0).toUpperCase() || '?';
}

function aujourdhuiISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Sept jours normalisés à partir de ce que renvoie l'API. */
function semaineComplete(lignes = []) {
  return Array.from({ length: 7 }, (_, i) => {
    const j = lignes.find((l) => l.day_of_week === i);
    return {
      day_of_week: i,
      is_working: !!j?.is_working,
      start_time: hhmm(j?.start_time) || '09:00',
      end_time: hhmm(j?.end_time) || '19:00',
    };
  });
}

function totalHeures(semaine) {
  return semaine.reduce((h, j) => (j.is_working ? h + Math.max(0, enHeures(j.end_time) - enHeures(j.start_time)) : h), 0);
}

function resumeRepos(semaine) {
  const repos = semaine.filter((j) => !j.is_working).map((j) => DAYS_ABREGE[j.day_of_week]);
  if (repos.length === 0) return 'aucun jour de repos';
  if (repos.length === 7) return 'aucun jour travaillé';
  return `repos ${repos.join(' ')}`;
}

/** Message éphémère affiché dans une section. */
function InlineStatus({ status }) {
  if (!status) return null;
  return (
    <div className={`bb-flash ${status.type === 'error' ? 'err' : ''}`} role="status">
      {status.message}
    </div>
  );
}

function useFlash() {
  const [status, setStatus] = useState(null);
  const timer = useRef(null);
  const flash = useCallback((type, message) => {
    setStatus({ type, message });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [status, flash];
}

// ============================================
// Page — l'équipe
// ============================================

export default function Barbers() {
  const { data: barbers = [], isLoading, error, refetch } = useBarbers();
  const { data: horaires = [] } = useAllSchedules();
  const [fiche, setFiche] = useState(null);       // { id, onglet }
  const [showCreate, setShowCreate] = useState(false);

  // Une seule requête pour toute l'équipe, redécoupée par personne.
  const semaines = useMemo(() => {
    const m = new Map();
    for (const l of horaires) {
      if (!m.has(l.barber_id)) m.set(l.barber_id, []);
      m.get(l.barber_id).push(l);
    }
    const out = new Map();
    for (const [id, lignes] of m) out.set(id, semaineComplete(lignes));
    return out;
  }, [horaires]);

  const actifs = barbers.filter((b) => b.is_active);
  const inactifs = barbers.filter((b) => !b.is_active);

  const barberOuvert = fiche ? barbers.find((b) => b.id === fiche.id) : null;
  // La fiche se referme d'elle-même si la personne disparaît (suppression).
  useEffect(() => {
    if (fiche && !isLoading && barbers.length > 0 && !barbers.some((b) => b.id === fiche.id)) setFiche(null);
  }, [fiche, barbers, isLoading]);

  return (
    <>
      <div className="page-header bb-header">
        <div>
          <h2 className="page-title">Équipe</h2>
          <p className="bb-sous">
            {isLoading
              ? 'Chargement…'
              : `${actifs.length} en poste${inactifs.length ? ` · ${inactifs.length} désactivé${inactifs.length > 1 ? 's' : ''}` : ''}`}
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          <IcoPlus /> Ajouter
        </button>
      </div>

      <div className="page-body">
        {error && (
          <div className="bb-flash err" role="alert">
            {String(error.message || error)}
            <button className="bb-lien" onClick={() => refetch()}>Réessayer</button>
          </div>
        )}

        {isLoading ? (
          <div className="bb-grille">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="bb-skel" />)}
          </div>
        ) : (
          <>
            <ul className="bb-grille">
              {actifs.map((b) => (
                <CarteBarbier key={b.id} barber={b} semaine={semaines.get(b.id)} onOuvrir={(onglet) => setFiche({ id: b.id, onglet })} />
              ))}
              <li>
                <button type="button" className="bb-ajout" onClick={() => setShowCreate(true)}>
                  <span className="bb-ajout-rond"><IcoPlus /></span>
                  Ajouter un barbier
                </button>
              </li>
            </ul>

            {inactifs.length > 0 && (
              <>
                {/* Le compte technique « Admin » et les anciens vivent ici :
                    ils ne sont pas réservables et n'ont rien à faire au milieu
                    de l'équipe en poste. */}
                <h3 className="bb-groupe">Désactivés<span>{inactifs.length}</span></h3>
                <ul className="bb-grille">
                  {inactifs.map((b) => (
                    <CarteBarbier key={b.id} barber={b} semaine={semaines.get(b.id)} onOuvrir={(onglet) => setFiche({ id: b.id, onglet })} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {barberOuvert && (
        <FicheBarbier
          barber={barberOuvert}
          ongletInitial={fiche.onglet}
          onClose={() => setFiche(null)}
        />
      )}

      {showCreate && <CreateBarberModal onClose={() => setShowCreate(false)} />}
    </>
  );
}

// ============================================
// Carte — une personne, sa semaine
// ============================================

function CarteBarbier({ barber, semaine, onOuvrir }) {
  const updateBarber = useUpdateBarber();
  const heures = semaine ? totalHeures(semaine) : null;

  return (
    <li className={`bb-carte${barber.is_active ? '' : ' off'}`}>
      <div className="bb-carte-haut">
        {barber.photo_url
          ? <img className="bb-photo" src={barber.photo_url} alt="" />
          : <span className="bb-photo bb-photo-vide">{initiale(barber.name)}</span>}

        <div className="bb-ident">
          <button type="button" className="bb-nom" onClick={() => onOuvrir('identite')}>
            {barber.name}
          </button>
          <span className="bb-role">{barber.role || 'Barbier'}</span>
        </div>

        {/* L'interrupteur reste sur la carte : couper quelqu'un du planning
            est le geste le plus fréquent, il ne mérite pas d'ouvrir une fiche. */}
        <button
          type="button"
          className={`toggle ${barber.is_active ? 'active' : ''}`}
          onClick={() => updateBarber.mutate({ id: barber.id, data: { is_active: !barber.is_active } })}
          aria-label={barber.is_active ? `Désactiver ${barber.name}` : `Activer ${barber.name}`}
          aria-pressed={barber.is_active}
          title={barber.is_active ? 'Réservable — cliquer pour désactiver' : 'Non réservable — cliquer pour activer'}
        />
      </div>

      <div className="bb-etiquettes">
        {barber.is_guest && <span className="bb-tag invite">Invité</span>}
        {barber.contract_end && (
          <span className="bb-tag cdd">
            Contrat jusqu’au {barber.contract_end.slice(8, 10)}/{barber.contract_end.slice(5, 7)}
          </span>
        )}
      </div>

      <Semainier semaine={semaine} />

      <p className="bb-resume">
        {semaine
          ? <><strong>{heures % 1 === 0 ? heures : heures.toFixed(1).replace('.', ',')} h</strong> par semaine · {resumeRepos(semaine)}</>
          : 'Semaine non renseignée'}
      </p>

      <div className="bb-raccourcis">
        <button type="button" onClick={() => onOuvrir('semaine')}>Semaine</button>
        <button type="button" onClick={() => onOuvrir('absences')}>Absences</button>
        <button type="button" onClick={() => onOuvrir('prestations')}>Prestations</button>
      </div>
    </li>
  );
}

/**
 * Le semainier : sept colonnes de 8h à 20h, la barre couvre l'amplitude
 * travaillée. C'est ce qui remplace le bouton « Horaires » — on lit d'un coup
 * qu'un tel commence à 13h le mercredi et ne travaille pas le samedi.
 */
function Semainier({ semaine }) {
  // Tout le monde travaille à peu près 9h–19h : à l'œil, sept barres presque
  // pleines se ressemblent. Ce qui mérite d'être lu, c'est l'écart — le jour
  // qui commence plus tard, celui qui finit plus tôt. On chiffre donc les
  // seuls jours qui sortent de l'horaire habituel de la personne.
  const habituel = useMemo(() => {
    if (!semaine) return null;
    const compte = new Map();
    for (const j of semaine) {
      if (!j.is_working) continue;
      const cle = `${j.start_time}|${j.end_time}`;
      compte.set(cle, (compte.get(cle) || 0) + 1);
    }
    let gagnant = null, max = 0;
    for (const [cle, n] of compte) if (n > max) { max = n; gagnant = cle; }
    return gagnant;
  }, [semaine]);

  if (!semaine) return <div className="bb-semainier bb-semainier-vide" aria-hidden="true" />;
  const total = AMPLITUDE_FIN - AMPLITUDE_DEBUT;

  return (
    <div className="bb-semainier">
      {semaine.map((j) => {
        const debut = Math.max(AMPLITUDE_DEBUT, enHeures(j.start_time));
        const fin = Math.min(AMPLITUDE_FIN, enHeures(j.end_time));
        const haut = ((debut - AMPLITUDE_DEBUT) / total) * 100;
        const hauteur = Math.max(0, ((fin - debut) / total) * 100);
        const [hDebut, hFin] = (habituel || '|').split('|');
        const ecart = j.is_working && habituel && `${j.start_time}|${j.end_time}` !== habituel;
        const marque = !ecart ? null
          : j.start_time !== hDebut ? `${j.start_time.slice(0, 2)}h`
            : j.end_time !== hFin ? `→${j.end_time.slice(0, 2)}h` : null;
        return (
          <div key={j.day_of_week} className={`bb-jour${j.is_working ? '' : ' repos'}`}>
            <span
              className="bb-piste"
              title={j.is_working
                ? `${DAYS[j.day_of_week]} ${j.start_time}–${j.end_time}`
                : `${DAYS[j.day_of_week]} : repos`}
            >
              {j.is_working && <i style={{ top: `${haut}%`, height: `${hauteur}%` }} />}
            </span>
            <span className="bb-jour-lettre">{DAYS_COURT[j.day_of_week]}</span>
            {marque && <span className="bb-jour-ecart">{marque}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Fiche — tout ce qui se modifie, au même endroit
// ============================================

function FicheBarbier({ barber, ongletInitial, onClose }) {
  const [onglet, setOnglet] = useState(ongletInitial || 'identite');

  // Échap ferme la fiche : sur un panneau plein écran c'est la sortie attendue.
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="bb-fiche-fond" onClick={onClose}>
      <aside
        className="bb-fiche"
        role="dialog"
        aria-modal="true"
        aria-label={`Fiche de ${barber.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bb-fiche-haut">
          <button type="button" className="bb-retour" onClick={onClose} aria-label="Fermer la fiche">
            <IcoChevron />
          </button>
          {barber.photo_url
            ? <img className="bb-photo sm" src={barber.photo_url} alt="" />
            : <span className="bb-photo sm bb-photo-vide">{initiale(barber.name)}</span>}
          <div className="bb-fiche-ident">
            <h2>{barber.name}</h2>
            <p>{barber.role || 'Barbier'} · {barber.is_active ? 'réservable' : 'non réservable'}</p>
          </div>
          <button type="button" className="bb-fermer" onClick={onClose} aria-label="Fermer la fiche">
            <IcoClose />
          </button>
        </header>

        <nav className="bb-onglets" aria-label="Sections de la fiche">
          {ONGLETS.map((o) => (
            <button
              key={o.cle}
              type="button"
              className={onglet === o.cle ? 'on' : ''}
              onClick={() => setOnglet(o.cle)}
              aria-current={onglet === o.cle ? 'true' : undefined}
            >
              {o.label}
            </button>
          ))}
        </nav>

        <div className="bb-fiche-corps">
          {onglet === 'identite' && <SectionIdentite barber={barber} onClose={onClose} />}
          {onglet === 'semaine' && <SectionSemaine barber={barber} />}
          {onglet === 'absences' && <SectionAbsences barber={barber} />}
          {onglet === 'prestations' && <SectionPrestations barber={barber} />}
          {onglet === 'deplacements' && <SectionDeplacements barber={barber} />}
        </div>
      </aside>
    </div>
  );
}

// ============================================
// Identité — nom, photo, contrat, priorité, suppression
// ============================================

function SectionIdentite({ barber, onClose }) {
  const mutation = useUpdateBarber();
  const [status, flash] = useFlash();
  const [nom, setNom] = useState(barber.name);
  const [role, setRole] = useState(barber.role || '');
  const [email, setEmail] = useState(barber.email || '');
  const [photo, setPhoto] = useState(barber.photo_url || '');
  const [actif, setActif] = useState(barber.is_active);
  const [debut, setDebut] = useState(barber.contract_start ? barber.contract_start.slice(0, 10) : '');
  const [fin, setFin] = useState(barber.contract_end ? barber.contract_end.slice(0, 10) : '');
  const [showDelete, setShowDelete] = useState(false);
  const fichier = useRef(null);

  const choisirPhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > PHOTO_MAX_MO * 1024 * 1024) { flash('error', `Photo trop lourde (max ${PHOTO_MAX_MO} Mo)`); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { flash('error', 'Format accepté : JPEG, PNG ou WebP'); return; }
    const lecteur = new FileReader();
    lecteur.onload = () => setPhoto(lecteur.result);
    lecteur.readAsDataURL(f);
  };

  const enregistrer = async (e) => {
    e.preventDefault();
    if (fin && debut && fin < debut) { flash('error', 'La fin du contrat précède son début'); return; }
    try {
      const data = {
        name: nom.trim(),
        role: role.trim(),
        photo_url: photo || null,
        is_active: actif,
        contract_start: debut || null,
        contract_end: fin || null,
      };
      // L'adresse sert d'identifiant : on ne l'envoie que si elle a bougé.
      if (email.trim() && email.trim() !== barber.email) data.email = email.trim();
      await mutation.mutateAsync({ id: barber.id, data });
      flash('success', 'Fiche enregistrée');
    } catch (err) {
      flash('error', err.message);
    }
  };

  const changerPriorite = async (delta) => {
    const valeur = Math.max(0, (barber.sort_order || 0) + delta);
    try {
      await mutation.mutateAsync({ id: barber.id, data: { sort_order: valeur } });
      flash('success', `Priorité : ${valeur}`);
    } catch (err) {
      flash('error', err.message);
    }
  };

  return (
    <form onSubmit={enregistrer}>
      <InlineStatus status={status} />

      <div className="bb-photo-champ">
        {photo
          ? <img className="bb-photo lg" src={photo} alt="" />
          : <span className="bb-photo lg bb-photo-vide">{initiale(nom)}</span>}
        <div>
          {/* Coller une URL était impossible depuis un téléphone. */}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fichier.current?.click()}>
            <IcoCamera /> {photo ? 'Changer la photo' : 'Ajouter une photo'}
          </button>
          {photo && (
            <button type="button" className="bb-lien" onClick={() => setPhoto('')}>Retirer</button>
          )}
          <p className="bb-aide">JPEG, PNG ou WebP — {PHOTO_MAX_MO} Mo maximum.</p>
        </div>
        <input ref={fichier} type="file" accept="image/jpeg,image/png,image/webp" onChange={choisirPhoto} hidden />
      </div>

      <div className="form-group">
        <label className="label" htmlFor="bb-nom">Nom</label>
        <input id="bb-nom" className="input" value={nom} onChange={(e) => setNom(e.target.value)} required />
      </div>

      <div className="form-group">
        <label className="label" htmlFor="bb-role">Rôle</label>
        <input id="bb-role" className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Barbier" />
        <p className="bb-aide">Affiché sous son nom sur le site et dans le planning.</p>
      </div>

      <div className="form-group">
        <label className="label" htmlFor="bb-email">Adresse e-mail</label>
        <input id="bb-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="bb-aide">Sert d’identifiant de connexion. Celle du compte avec lequel vous êtes connecté ne peut pas être changée ici.</p>
      </div>

      <h3 className="bb-titre-bloc">Contrat</h3>
      <div className="bb-duo">
        <div className="form-group">
          <label className="label" htmlFor="bb-debut">Début</label>
          <input id="bb-debut" className="input" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="label" htmlFor="bb-fin">Fin</label>
          <input id="bb-fin" className="input" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
      </div>
      <p className="bb-aide">
        Laisser vide pour un contrat permanent. Sinon, il n’est réservable qu’entre ces deux dates.
      </p>

      <h3 className="bb-titre-bloc">Réservable</h3>
      <div className="bb-ligne-reglage">
        <div>
          <div className="bb-reglage-nom">{actif ? 'Visible à la réservation' : 'Retiré de la réservation'}</div>
          <p className="bb-aide">Un barbier désactivé garde ses rendez-vous passés mais n’apparaît plus aux clients.</p>
        </div>
        <button
          type="button"
          className={`toggle ${actif ? 'active' : ''}`}
          onClick={() => setActif(!actif)}
          aria-pressed={actif}
          aria-label="Réservable"
        />
      </div>

      <h3 className="bb-titre-bloc">Priorité « peu importe »</h3>
      <div className="bb-ligne-reglage">
        <div>
          <div className="bb-reglage-nom">Niveau {barber.sort_order || 0}</div>
          <p className="bb-aide">
            Quand le client ne choisit pas de barbier, le plus haut niveau passe devant. À égalité, c’est celui
            qui a le moins de rendez-vous ce jour-là.
          </p>
        </div>
        <div className="bb-stepper">
          <button type="button" onClick={() => changerPriorite(-1)} disabled={(barber.sort_order || 0) <= 0} aria-label="Baisser la priorité">−</button>
          <button type="button" onClick={() => changerPriorite(1)} aria-label="Monter la priorité">+</button>
        </div>
      </div>

      <div className="bb-actions-collees">
        <button type="submit" className="btn btn-primary btn-sm" disabled={mutation.isPending}>
          {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>

      <h3 className="bb-titre-bloc danger">Zone de danger</h3>
      <div className="bb-danger">
        <div>
          <div className="bb-reglage-nom">Supprimer {barber.name}</div>
          <p className="bb-aide">Ses rendez-vous à venir seront annulés et les clients prévenus. L’historique est conservé.</p>
        </div>
        <button type="button" className="btn btn-sm bb-btn-danger" onClick={() => setShowDelete(true)}>Supprimer</button>
      </div>

      {showDelete && (
        <DeleteBarberDialog
          barber={barber}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { setShowDelete(false); onClose(); }}
        />
      )}
    </form>
  );
}

// ============================================
// Semaine type
// ============================================

function SectionSemaine({ barber }) {
  const { data: brut, isLoading } = useBarberSchedule(barber.id);
  const save = useUpdateBarberSchedule();
  const [status, flash] = useFlash();
  const [semaine, setSemaine] = useState(null);
  const [reference, setReference] = useState(null);

  useEffect(() => {
    if (!brut) return;
    const s = semaineComplete(brut.weekly || []);
    setSemaine(s);
    setReference(JSON.stringify(s));
  }, [brut]);

  const modifie = semaine && reference !== null && JSON.stringify(semaine) !== reference;

  const majJour = (i, champ, valeur) => {
    setSemaine((prev) => prev.map((j, idx) => (idx === i ? { ...j, [champ]: valeur } : j)));
  };

  const enregistrer = async () => {
    try {
      await save.mutateAsync({ id: barber.id, schedules: semaine });
      setReference(JSON.stringify(semaine));
      flash('success', 'Semaine enregistrée');
    } catch (err) {
      flash('error', err.message);
    }
  };

  if (isLoading || !semaine) return <div className="empty-state">Chargement…</div>;

  const heures = totalHeures(semaine);

  return (
    <>
      <InlineStatus status={status} />
      <p className="bb-intro">
        La semaine qui se répète. Pour un jour précis — congé, horaire exceptionnel — passez par
        <strong> Absences</strong>.
      </p>

      <ul className="bb-jours">
        {semaine.map((j, i) => (
          <li key={i} className={`bb-jour-ligne${j.is_working ? ' on' : ''}`}>
            <button
              type="button"
              className={`toggle ${j.is_working ? 'active' : ''}`}
              onClick={() => majJour(i, 'is_working', !j.is_working)}
              aria-label={`${DAYS[i]} travaillé`}
              aria-pressed={j.is_working}
            />
            <span className="bb-jour-nom">{DAYS[i]}</span>
            {j.is_working ? (
              <span className="bb-heures">
                <input className="input" type="time" value={j.start_time} onChange={(e) => majJour(i, 'start_time', e.target.value)} aria-label={`Début ${DAYS[i]}`} />
                <em>à</em>
                <input className="input" type="time" value={j.end_time} onChange={(e) => majJour(i, 'end_time', e.target.value)} aria-label={`Fin ${DAYS[i]}`} />
              </span>
            ) : (
              <span className="bb-repos">Repos</span>
            )}
          </li>
        ))}
      </ul>

      <p className="bb-total">
        {heures % 1 === 0 ? heures : heures.toFixed(1).replace('.', ',')} h par semaine
      </p>

      <div className="bb-actions-collees">
        <button className="btn btn-primary btn-sm" onClick={enregistrer} disabled={save.isPending || !modifie}>
          {save.isPending ? 'Enregistrement…' : modifie ? 'Enregistrer la semaine' : 'À jour'}
        </button>
      </div>
    </>
  );
}

// ============================================
// Absences — congés ponctuels et pauses qui reviennent
// ============================================

function SectionAbsences({ barber }) {
  const { data: brut, isLoading } = useBarberSchedule(barber.id);
  const { data: pauses = [], isLoading: chargePauses } = useBarberBreaks(barber.id);
  const addOverride = useAddBarberOverride();
  const delOverride = useDeleteBarberOverride();
  const addPause = useCreateBlockedSlot();
  const delPause = useDeleteBlockedSlot();
  const delPauses = useDeleteBarberBreaksBulk();
  const [status, flash] = useFlash();

  const overrides = brut?.overrides || [];
  const [form, setForm] = useState(null); // null | 'exception' | 'pause'

  // Exception
  const [mode, setMode] = useState('off'); // off | custom | unblock
  const [date, setDate] = useState('');
  const [debut, setDebut] = useState('09:00');
  const [fin, setFin] = useState('19:00');
  const [motif, setMotif] = useState('');

  // Pause récurrente
  const [pDebut, setPDebut] = useState('13:00');
  const [pFin, setPFin] = useState('14:00');
  const [pMotif, setPMotif] = useState('Pause déjeuner');
  const [pDate, setPDate] = useState(aujourdhuiISO);
  const [pRecurrence, setPRecurrence] = useState('weekly');
  const [pOccurrences, setPOccurrences] = useState(52);

  // Les pauses arrivent une par date : on les regroupe par motif et horaire,
  // sinon « Pause déjeuner » s'affiche cinquante-deux fois.
  const groupes = useMemo(() => {
    const m = new Map();
    for (const p of pauses) {
      const cle = `${p.reason || 'Sans motif'}|${hhmm(p.start_time)}-${hhmm(p.end_time)}`;
      if (!m.has(cle)) m.set(cle, { motif: p.reason || 'Sans motif', debut: hhmm(p.start_time), fin: hhmm(p.end_time), slots: [] });
      m.get(cle).slots.push(p);
    }
    return [...m.values()].sort((a, b) => a.slots[0].date.localeCompare(b.slots[0].date));
  }, [pauses]);

  async function ajouterException(e) {
    e.preventDefault();
    const estOff = mode === 'off';
    try {
      await addOverride.mutateAsync({
        id: barber.id,
        data: {
          date,
          is_day_off: estOff,
          start_time: estOff ? undefined : debut,
          end_time: estOff ? undefined : fin,
          reason: motif || (mode === 'unblock' ? 'Ouverture exceptionnelle' : undefined),
        },
      });
      setDate(''); setMotif(''); setMode('off'); setForm(null);
      flash('success', estOff ? 'Congé ajouté' : 'Exception ajoutée');
    } catch (err) {
      flash('error', err.message);
    }
  }

  async function ajouterPause(e) {
    e.preventDefault();
    if (pDebut >= pFin) { flash('error', 'La pause finit avant de commencer'); return; }
    try {
      const payload = {
        barber_id: barber.id,
        date: pDate,
        start_time: pDebut,
        end_time: pFin,
        type: 'break',
        reason: pMotif || undefined,
      };
      if (pRecurrence !== 'none') {
        payload.recurrence = { type: pRecurrence, end_type: 'occurrences', occurrences: parseInt(pOccurrences, 10) || 52 };
      }
      await addPause.mutateAsync(payload);
      setForm(null);
      flash('success', 'Pause enregistrée');
    } catch (err) {
      flash('error', err.message);
    }
  }

  async function supprimerException(id) {
    try {
      await delOverride.mutateAsync(id);
      flash('success', 'Exception supprimée');
    } catch (err) { flash('error', err.message); }
  }

  async function supprimerGroupe(g) {
    if (!window.confirm(`Supprimer les ${g.slots.length} pauses « ${g.motif} » ?`)) return;
    try {
      await delPauses.mutateAsync({ barberId: barber.id, reason: g.motif !== 'Sans motif' ? g.motif : undefined });
      flash('success', `${g.slots.length} pauses supprimées`);
    } catch (err) { flash('error', err.message); }
  }

  if (isLoading || chargePauses) return <div className="empty-state">Chargement…</div>;

  return (
    <>
      <InlineStatus status={status} />
      <p className="bb-intro">
        {/* Ces deux listes répondaient à la même question depuis deux fenêtres
            différentes : quand n'est-il pas disponible ? */}
        Tout ce qui retire {barber.name} du planning : les jours à part, et les pauses qui reviennent chaque semaine.
      </p>

      <h3 className="bb-titre-bloc">Jours à part<span className="bb-compte">{overrides.length}</span></h3>
      {overrides.length === 0 ? (
        <p className="bb-vide">Aucun congé ni horaire exceptionnel prévu.</p>
      ) : (
        <ul className="bb-liste">
          {overrides.map((ov) => (
            <li key={ov.id} className={`bb-item ${ov.is_day_off ? 'conge' : 'special'}`}>
              <div>
                <div className="bb-item-titre">{formatDateFr(ov.date)}</div>
                <div className="bb-item-meta">
                  <span className="bb-tag">{ov.is_day_off ? 'Congé' : 'Horaire à part'}</span>
                  {!ov.is_day_off && ov.start_time && <span>{hhmm(ov.start_time)}–{hhmm(ov.end_time)}</span>}
                  {ov.reason && <span>{ov.reason}</span>}
                </div>
              </div>
              <button type="button" className="bb-supprimer" onClick={() => supprimerException(ov.id)} aria-label="Supprimer">
                <IcoTrash />
              </button>
            </li>
          ))}
        </ul>
      )}

      {form === 'exception' ? (
        <form className="bb-form" onSubmit={ajouterException}>
          <div className="form-group">
            <span className="label">Type</span>
            <div className="bb-choix">
              {[
                { cle: 'off', label: 'Congé' },
                { cle: 'custom', label: 'Horaire à part' },
                { cle: 'unblock', label: 'Ouvrir un jour de repos' },
              ].map((t) => (
                <button key={t.cle} type="button" className={mode === t.cle ? 'on' : ''} onClick={() => setMode(t.cle)} aria-pressed={mode === t.cle}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="label" htmlFor="bb-ov-date">Date</label>
            <input id="bb-ov-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          {mode !== 'off' && (
            <div className="form-group">
              <span className="label">Horaires ce jour-là</span>
              <div className="bb-heures">
                <input className="input" type="time" value={debut} onChange={(e) => setDebut(e.target.value)} required aria-label="Début" />
                <em>à</em>
                <input className="input" type="time" value={fin} onChange={(e) => setFin(e.target.value)} required aria-label="Fin" />
              </div>
            </div>
          )}
          <div className="form-group">
            <label className="label" htmlFor="bb-ov-motif">Motif</label>
            <input
              id="bb-ov-motif"
              className="input"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder={mode === 'off' ? 'Vacances, rendez-vous médical…' : 'Ouverture exceptionnelle…'}
            />
          </div>
          <div className="bb-form-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(null)}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={addOverride.isPending}>
              {addOverride.isPending ? '…' : 'Ajouter'}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="bb-ajout-ligne" onClick={() => setForm('exception')}>
          <IcoPlus /> Ajouter un jour à part
        </button>
      )}

      <h3 className="bb-titre-bloc">Pauses récurrentes<span className="bb-compte">{groupes.length}</span></h3>
      {groupes.length === 0 ? (
        <p className="bb-vide">Aucune pause programmée.</p>
      ) : (
        <ul className="bb-liste">
          {groupes.map((g, i) => (
            <li key={i} className="bb-item pause">
              <div>
                <div className="bb-item-titre">{g.motif}</div>
                <div className="bb-item-meta">
                  <span>{g.debut}–{g.fin}</span>
                  <span>{g.slots.length} date{g.slots.length > 1 ? 's' : ''}</span>
                </div>
                <div className="bb-dates">
                  {g.slots.slice(0, 6).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      title="Supprimer cette date"
                      onClick={async () => {
                        try { await delPause.mutateAsync(s.id); flash('success', 'Pause supprimée'); }
                        catch (err) { flash('error', err.message); }
                      }}
                    >
                      {formatJourCourt(s.date)}
                    </button>
                  ))}
                  {g.slots.length > 6 && <span className="bb-dates-reste">+{g.slots.length - 6}</span>}
                </div>
              </div>
              <button type="button" className="bb-supprimer" onClick={() => supprimerGroupe(g)} aria-label="Tout supprimer">
                <IcoTrash />
              </button>
            </li>
          ))}
        </ul>
      )}

      {form === 'pause' ? (
        <form className="bb-form" onSubmit={ajouterPause}>
          <div className="form-group">
            <label className="label" htmlFor="bb-p-motif">Motif</label>
            <input id="bb-p-motif" className="input" value={pMotif} onChange={(e) => setPMotif(e.target.value)} placeholder="Pause déjeuner" />
          </div>
          <div className="form-group">
            <span className="label">Horaires</span>
            <div className="bb-heures">
              <input className="input" type="time" value={pDebut} onChange={(e) => setPDebut(e.target.value)} aria-label="Début de la pause" />
              <em>à</em>
              <input className="input" type="time" value={pFin} onChange={(e) => setPFin(e.target.value)} aria-label="Fin de la pause" />
            </div>
          </div>
          <div className="bb-duo">
            <div className="form-group">
              <label className="label" htmlFor="bb-p-date">À partir du</label>
              <input id="bb-p-date" className="input" type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="bb-p-rec">Répétition</label>
              <select id="bb-p-rec" className="input" value={pRecurrence} onChange={(e) => setPRecurrence(e.target.value)}>
                <option value="none">Une seule fois</option>
                <option value="weekly">Chaque semaine</option>
                <option value="biweekly">Une semaine sur deux</option>
              </select>
            </div>
          </div>
          {pRecurrence !== 'none' && (
            <div className="form-group">
              <label className="label" htmlFor="bb-p-occ">Nombre de semaines</label>
              <input id="bb-p-occ" className="input" type="number" min="2" max="52" value={pOccurrences} onChange={(e) => setPOccurrences(e.target.value)} />
            </div>
          )}
          <div className="bb-form-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(null)}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={addPause.isPending}>
              {addPause.isPending ? '…' : pRecurrence === 'none' ? 'Ajouter la pause' : `Ajouter ${pOccurrences} pauses`}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="bb-ajout-ligne" onClick={() => setForm('pause')}>
          <IcoPlus /> Ajouter une pause
        </button>
      )}
    </>
  );
}

// ============================================
// Prestations — ce qu'il fait, et en combien de temps
// ============================================

function SectionPrestations({ barber }) {
  const { data: lignes = [], isLoading } = useBarberServices(barber.id);
  const [status, flash] = useFlash();

  if (isLoading) return <div className="empty-state">Chargement…</div>;

  const assignees = lignes.filter((l) => l.assigned).length;
  const perso = lignes.filter((l) => l.assigned && l.custom_duration != null).length;

  return (
    <>
      <InlineStatus status={status} />
      <p className="bb-intro">
        {assignees} prestation{assignees > 1 ? 's' : ''} sur {lignes.length}
        {perso > 0 && <> · {perso} avec une durée qui lui est propre</>}.
      </p>
      <ul className="bb-liste">
        {lignes.map((l) => (
          <LignePrestation key={l.id} ligne={l} barberId={barber.id} onFlash={flash} />
        ))}
      </ul>
    </>
  );
}

function LignePrestation({ ligne, barberId, onFlash }) {
  const set = useSetBarberService();
  const retirer = useRemoveBarberService();
  const [duree, setDuree] = useState(ligne.effective_duration);

  useEffect(() => { setDuree(ligne.effective_duration); }, [ligne.effective_duration]);

  const basculer = async () => {
    try {
      if (ligne.assigned) {
        await retirer.mutateAsync({ id: barberId, serviceId: ligne.id });
        onFlash('success', `${ligne.name} retirée`);
      } else {
        await set.mutateAsync({ id: barberId, serviceId: ligne.id, customDuration: null });
        onFlash('success', `${ligne.name} ajoutée`);
      }
    } catch (err) { onFlash('error', err.message); }
  };

  const changerDuree = async (valeur) => {
    const v = Math.min(240, Math.max(5, valeur));
    setDuree(v);
    try {
      // Ramenée à la durée du catalogue, on n'enregistre pas d'exception :
      // le barbier suivra la prestation si sa durée change plus tard.
      await set.mutateAsync({ id: barberId, serviceId: ligne.id, customDuration: v === ligne.default_duration ? null : v });
    } catch (err) {
      setDuree(ligne.effective_duration);
      onFlash('error', err.message);
    }
  };

  const surMesure = ligne.assigned && ligne.custom_duration != null;

  return (
    <li className={`bb-presta${ligne.assigned ? ' on' : ''}`}>
      <span className="bb-presta-pastille" style={{ background: ligne.color || 'var(--text-muted)' }} aria-hidden="true" />
      <div className="bb-presta-ident">
        <span className="bb-presta-nom">{ligne.name}</span>
        <span className="bb-presta-prix">{formatPrice(ligne.price || 0)}</span>
      </div>

      {ligne.assigned && (
        <div className="bb-presta-duree">
          <button type="button" onClick={() => changerDuree(duree - 5)} aria-label={`Réduire la durée de ${ligne.name}`}>−</button>
          <span className={surMesure ? 'perso' : ''}>{duree} min</span>
          <button type="button" onClick={() => changerDuree(duree + 5)} aria-label={`Augmenter la durée de ${ligne.name}`}>+</button>
        </div>
      )}

      <button
        type="button"
        className={`toggle ${ligne.assigned ? 'active' : ''}`}
        onClick={basculer}
        aria-pressed={ligne.assigned}
        aria-label={`${ligne.name} assurée`}
      />

      {surMesure && (
        <button type="button" className="bb-lien bb-presta-reset" onClick={() => changerDuree(ligne.default_duration)}>
          Revenir à {ligne.default_duration} min
        </button>
      )}
    </li>
  );
}

// ============================================
// Déplacements — jours travaillés dans l'autre salon
// ============================================

function SectionDeplacements({ barber }) {
  const { data: brut, isLoading } = useBarberGuestDays(barber.id);
  const ajouter = useAddBarberGuestDay();
  const supprimer = useDeleteBarberGuestDay();
  const [status, flash] = useFlash();
  const jours = Array.isArray(brut) ? brut : [];

  const destinations = SALON_OPTIONS.filter((s) => s.id !== barber.salon_id);
  const [form, setForm] = useState(false);
  const [salon, setSalon] = useState(destinations[0]?.id || '');
  const [date, setDate] = useState('');
  const [debut, setDebut] = useState('09:00');
  const [fin, setFin] = useState('19:00');

  async function handleAjout(e) {
    e.preventDefault();
    try {
      await ajouter.mutateAsync({ id: barber.id, data: { date, host_salon_id: salon, start_time: debut, end_time: fin } });
      setDate(''); setForm(false);
      flash('success', 'Déplacement enregistré');
    } catch (err) { flash('error', err.message); }
  }

  if (isLoading) return <div className="empty-state">Chargement…</div>;

  return (
    <>
      <InlineStatus status={status} />
      <p className="bb-intro">
        Les jours où {barber.name} travaille dans l’autre salon. Il y devient réservable, et disparaît d’ici
        automatiquement.
      </p>

      {jours.length === 0 ? (
        <p className="bb-vide">Aucun déplacement prévu.</p>
      ) : (
        <ul className="bb-liste">
          {jours.map((g) => (
            <li key={g.id} className="bb-item invite">
              <div>
                <div className="bb-item-titre">{formatDateFr(g.date)}</div>
                <div className="bb-item-meta">
                  <span className="bb-tag invite">{g.host_salon_id === 'grenoble' ? 'Grenoble' : 'Meylan'}</span>
                  <span>{hhmm(g.start_time) || '09:00'}–{hhmm(g.end_time) || '19:00'}</span>
                </div>
              </div>
              <button
                type="button"
                className="bb-supprimer"
                aria-label="Supprimer"
                onClick={async () => {
                  if (!window.confirm('Supprimer ce déplacement ?')) return;
                  try { await supprimer.mutateAsync(g.id); flash('success', 'Déplacement supprimé'); }
                  catch (err) { flash('error', err.message); }
                }}
              >
                <IcoTrash />
              </button>
            </li>
          ))}
        </ul>
      )}

      {form ? (
        <form className="bb-form" onSubmit={handleAjout}>
          <div className="form-group">
            <label className="label" htmlFor="bb-gd-salon">Salon</label>
            <select id="bb-gd-salon" className="input" value={salon} onChange={(e) => setSalon(e.target.value)} required>
              {destinations.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label" htmlFor="bb-gd-date">Date</label>
            <input id="bb-gd-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="form-group">
            <span className="label">Horaires sur place</span>
            <div className="bb-heures">
              <input className="input" type="time" value={debut} onChange={(e) => setDebut(e.target.value)} required aria-label="Début" />
              <em>à</em>
              <input className="input" type="time" value={fin} onChange={(e) => setFin(e.target.value)} required aria-label="Fin" />
            </div>
          </div>
          <div className="bb-form-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={ajouter.isPending}>
              {ajouter.isPending ? '…' : 'Ajouter'}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="bb-ajout-ligne" onClick={() => setForm(true)} disabled={destinations.length === 0}>
          <IcoPlus /> Ajouter un déplacement
        </button>
      )}
    </>
  );
}

// ============================================
// Suppression
// ============================================

function DeleteBarberDialog({ barber, onClose, onDeleted }) {
  const mutation = useDeleteBarber();
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState('');
  const correspond = saisie.trim().toLowerCase() === barber.name.toLowerCase();

  const supprimer = async () => {
    try {
      await mutation.mutateAsync(barber.id);
      onDeleted();
    } catch (err) {
      setErreur(err.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Supprimer ${barber.name}`} style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Supprimer {barber.name} ?</h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Fermer"><IcoClose /></button>
        </div>
        <div className="modal-body">
          {erreur && <div className="bb-flash err" role="alert">{erreur}</div>}
          <p className="bb-aide" style={{ marginBottom: 14 }}>
            Ses rendez-vous à venir seront annulés et les clients prévenus. L’historique est conservé.
            Cette action ne s’annule pas.
          </p>
          <label className="label" htmlFor="bb-confirm">
            Écrivez <strong>{barber.name}</strong> pour confirmer
          </label>
          <input
            id="bb-confirm"
            className="input"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder={barber.name}
            autoFocus
            autoComplete="off"
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
          <button className="btn btn-sm bb-btn-danger" disabled={!correspond || mutation.isPending} onClick={supprimer}>
            {mutation.isPending ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Création — un barbier complet en un passage
// ============================================

function CreateBarberModal({ onClose }) {
  const createMutation = useCreateBarber();
  const { data: services = [] } = useServices();
  const [status, flash] = useFlash();
  const [nom, setNom] = useState('');
  const [role, setRole] = useState('Barbier');
  const [email, setEmail] = useState('');
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');
  const [photo, setPhoto] = useState(null);
  const [semaine, setSemaine] = useState(
    DAYS.map((_, i) => ({ day_of_week: i, is_working: i < 6, start_time: '09:00', end_time: '19:00' }))
  );
  const [choisies, setChoisies] = useState(() => new Set());
  const fichier = useRef(null);

  const actives = useMemo(() => services.filter((s) => s.is_active !== false), [services]);
  useEffect(() => {
    // Un barbier qui n'assure rien n'est réservable nulle part : tout est coché
    // par défaut, à décocher au besoin.
    if (actives.length > 0) setChoisies((prev) => (prev.size === 0 ? new Set(actives.map((s) => s.id)) : prev));
  }, [actives]);

  const choisirPhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > PHOTO_MAX_MO * 1024 * 1024) { flash('error', `Photo trop lourde (max ${PHOTO_MAX_MO} Mo)`); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { flash('error', 'Format accepté : JPEG, PNG ou WebP'); return; }
    const lecteur = new FileReader();
    lecteur.onload = () => setPhoto(lecteur.result);
    lecteur.readAsDataURL(f);
  };

  const creer = async (e) => {
    e.preventDefault();
    if (fin && debut && fin < debut) { flash('error', 'La fin du contrat précède son début'); return; }
    try {
      await createMutation.mutateAsync({
        name: nom.trim(),
        role: role.trim() || 'Barbier',
        email: email.trim() || undefined,
        photo_url: photo || undefined,
        schedules: semaine,
        service_ids: [...choisies],
        contract_start: debut || undefined,
        contract_end: fin || undefined,
      });
      onClose();
    } catch (err) {
      flash('error', err.message);
    }
  };

  const majJour = (i, champ, valeur) => setSemaine((prev) => prev.map((j, idx) => (idx === i ? { ...j, [champ]: valeur } : j)));

  return (
    <div className="bb-fiche-fond" onClick={onClose}>
      <aside className="bb-fiche" role="dialog" aria-modal="true" aria-label="Nouveau barbier" onClick={(e) => e.stopPropagation()}>
        <header className="bb-fiche-haut">
          <button type="button" className="bb-retour" onClick={onClose} aria-label="Fermer"><IcoChevron /></button>
          <div className="bb-fiche-ident">
            <h2>Nouveau barbier</h2>
            <p>Il sera créé désactivé — à activer quand il commence.</p>
          </div>
          <button type="button" className="bb-fermer" onClick={onClose} aria-label="Fermer"><IcoClose /></button>
        </header>

        <form className="bb-fiche-corps" onSubmit={creer}>
          <InlineStatus status={status} />

          <div className="bb-photo-champ">
            {photo
              ? <img className="bb-photo lg" src={photo} alt="" />
              : <span className="bb-photo lg bb-photo-vide">{initiale(nom)}</span>}
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fichier.current?.click()}>
                <IcoCamera /> {photo ? 'Changer la photo' : 'Ajouter une photo'}
              </button>
              <p className="bb-aide">JPEG, PNG ou WebP — {PHOTO_MAX_MO} Mo maximum.</p>
            </div>
            <input ref={fichier} type="file" accept="image/jpeg,image/png,image/webp" onChange={choisirPhoto} hidden />
          </div>

          <div className="form-group">
            <label className="label" htmlFor="bb-c-nom">Nom</label>
            <input id="bb-c-nom" className="input" value={nom} onChange={(e) => setNom(e.target.value)} required autoFocus />
          </div>
          <div className="bb-duo">
            <div className="form-group">
              <label className="label" htmlFor="bb-c-role">Rôle</label>
              <input id="bb-c-role" className="input" value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="bb-c-email">E-mail</label>
              <input id="bb-c-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Généré depuis le nom" />
            </div>
          </div>

          <h3 className="bb-titre-bloc">Contrat</h3>
          <div className="bb-duo">
            <div className="form-group">
              <label className="label" htmlFor="bb-c-debut">Début</label>
              <input id="bb-c-debut" className="input" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="bb-c-fin">Fin</label>
              <input id="bb-c-fin" className="input" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
            </div>
          </div>
          <p className="bb-aide">Laisser vide pour un contrat permanent.</p>

          <h3 className="bb-titre-bloc">Semaine type</h3>
          <ul className="bb-jours">
            {semaine.map((j, i) => (
              <li key={i} className={`bb-jour-ligne${j.is_working ? ' on' : ''}`}>
                <button
                  type="button"
                  className={`toggle ${j.is_working ? 'active' : ''}`}
                  onClick={() => majJour(i, 'is_working', !j.is_working)}
                  aria-pressed={j.is_working}
                  aria-label={`${DAYS[i]} travaillé`}
                />
                <span className="bb-jour-nom">{DAYS[i]}</span>
                {j.is_working ? (
                  <span className="bb-heures">
                    <input className="input" type="time" value={j.start_time} onChange={(e) => majJour(i, 'start_time', e.target.value)} aria-label={`Début ${DAYS[i]}`} />
                    <em>à</em>
                    <input className="input" type="time" value={j.end_time} onChange={(e) => majJour(i, 'end_time', e.target.value)} aria-label={`Fin ${DAYS[i]}`} />
                  </span>
                ) : <span className="bb-repos">Repos</span>}
              </li>
            ))}
          </ul>

          <h3 className="bb-titre-bloc">Prestations<span className="bb-compte">{choisies.size}/{actives.length}</span></h3>
          <div className="bb-pastilles">
            {actives.map((s) => (
              <button
                key={s.id}
                type="button"
                className={choisies.has(s.id) ? 'on' : ''}
                aria-pressed={choisies.has(s.id)}
                onClick={() => setChoisies((prev) => {
                  const n = new Set(prev);
                  if (n.has(s.id)) n.delete(s.id); else n.add(s.id);
                  return n;
                })}
              >
                {s.name}
              </button>
            ))}
          </div>

          <div className="bb-actions-collees">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!nom.trim() || createMutation.isPending}>
              {createMutation.isPending ? 'Création…' : 'Créer le barbier'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
