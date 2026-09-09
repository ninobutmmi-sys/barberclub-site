// ============================================
// École — les apprentis et leurs jours de cours
//
// L'alternance vit dans les blocages du planning : un jour de cours est un
// blocage « À l'école », levable d'un clic et infranchissable pour un client.
// Cette page ne stocke rien de son côté, elle rassemble.
// ============================================

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSchool } from '../hooks/useApi';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const JOURS_COURT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** 2026-09-15 -> 15/09 */
function jourMois(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** 2026-09-15 -> lundi 15 septembre */
function dateLongue(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Comme dateLongue, mais avec l'annee — les formations se terminent toutes
 * l'annee suivante, et « mardi 25 mai » sans millesime se lit comme un passe.
 */
function dateLongueAnnee(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Nombre de jours calendaires entre deux dates ISO. */
function ecartJours(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}

/** « dans 3 jours », « demain », « aujourd'hui ». */
function delai(today, iso) {
  const n = ecartJours(today, iso);
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n < 7) return `dans ${n} jours`;
  const s = Math.round(n / 7);
  return s === 1 ? 'dans une semaine' : `dans ${s} semaines`;
}

/** Les N prochains jours à partir d'aujourd'hui, en ISO. */
function prochainsJours(today, n) {
  const out = [];
  const d = new Date(`${today}T12:00:00`);
  for (let i = 0; i < n; i++) {
    out.push(new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

// ============================================

export default function Ecole() {
  const [semaines, setSemaines] = useState(4);
  const { data, isLoading, error, refetch } = useSchool(semaines);

  const today = data?.today;
  const apprentis = data?.apprentis || [];
  const conflits = data?.conflits || [];

  const bande = useMemo(() => (today ? prochainsJours(today, semaines * 7) : []), [today, semaines]);

  const enCours = apprentis.filter((a) => a.en_cours_aujourdhui);

  if (error) {
    return (
      <div className="page-body">
        <div className="bb-flash err" role="alert">
          {String(error.message || error)}
          <button className="bb-lien" onClick={() => refetch()}>Réessayer</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">École</h2>
          <p className="bb-sous">
            {isLoading
              ? 'Chargement…'
              : apprentis.length === 0
                ? 'Aucun apprenti — les jours de cours se posent depuis le planning, motif « À l’école »'
                : `${apprentis.length} apprenti${apprentis.length > 1 ? 's' : ''}${
                    enCours.length
                      ? ` · ${enCours.map((a) => a.name).join(', ')} en cours aujourd’hui`
                      : ' · personne en cours aujourd’hui'
                  }`}
          </p>
        </div>
        <div className="ec-zoom" role="group" aria-label="Profondeur du calendrier">
          {[2, 4, 8].map((n) => (
            <button
              key={n}
              type="button"
              className={`btn btn-sm ${semaines === n ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSemaines(n)}
            >
              {n} sem.
            </button>
          ))}
        </div>
      </div>

      <div className="page-body">
        {/* Le filet de sécurité : un RDV pris sur une journée de cours. Ça ne
            devrait jamais arriver — le blocage l'empêche — mais un cours ajouté
            après coup peut recouvrir un rendez-vous déjà pris. */}
        {conflits.length > 0 && (
          <section className="ec-alerte" role="alert">
            <h3>
              {conflits.length} rendez-vous {conflits.length > 1 ? 'tombent' : 'tombe'} sur une journée de cours
            </h3>
            <ul>
              {conflits.map((c, i) => (
                <li key={i}>
                  <strong>{c.barber_name}</strong> · {dateLongue(c.date)} à {c.start_time}
                  {c.first_name ? ` — ${c.first_name} ${c.last_name || ''}`.trimEnd() : ''}
                </li>
              ))}
            </ul>
            <p>À déplacer depuis le planning, ou lever le blocage si le cours est annulé.</p>
          </section>
        )}

        {isLoading ? (
          <div className="bb-grille">
            {Array.from({ length: 3 }, (_, i) => <div key={i} className="bb-skel" />)}
          </div>
        ) : apprentis.length === 0 ? (
          <div className="empty-state">
            Personne n’a de journée de cours enregistrée.<br />
            Depuis le <Link to="/planning">planning</Link>, bouton <strong>Bloquer</strong>,
            choisissez le motif <strong>À l’école</strong> et cochez <strong>Répéter</strong>.
          </div>
        ) : (
          <>
            {/* La bande : une ligne par apprenti, une case par jour. La question
                du quotidien — « qui est là jeudi ? » — se lit d'un coup d'œil. */}
            <section className="ec-bande-bloc">
              <div className="ec-bande-entete" style={{ gridTemplateColumns: `140px repeat(${bande.length}, 1fr)` }}>
                <span />
                {bande.map((d) => {
                  const dow = (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
                  return (
                    <span key={d} className={`ec-jour-tete${d === today ? ' today' : ''}${dow >= 5 ? ' we' : ''}`}>
                      <em>{JOURS_COURT[dow]}</em>
                      <b>{d.slice(8, 10)}</b>
                    </span>
                  );
                })}
              </div>
              {apprentis.map((a) => {
                const set = new Set(a.calendrier.map((j) => j.date));
                return (
                  <div key={a.barber_id} className="ec-bande-ligne" style={{ gridTemplateColumns: `140px repeat(${bande.length}, 1fr)` }}>
                    <span className="ec-bande-nom">{a.name}</span>
                    {bande.map((d) => {
                      const ecole = set.has(d);
                      const dow = (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
                      return (
                        <span
                          key={d}
                          className={`ec-case${ecole ? ' ecole' : ''}${dow >= 5 ? ' we' : ''}${d === today ? ' today' : ''}`}
                          title={`${a.name} — ${dateLongue(d)} : ${ecole ? 'à l’école' : 'au salon'}`}
                        />
                      );
                    })}
                  </div>
                );
              })}
              <p className="ec-legende">
                <span className="ec-case ecole" /> à l’école · <span className="ec-case" /> au salon
              </p>
            </section>

            <div className="bb-grille">
              {apprentis.map((a) => (
                <article key={a.barber_id} className="bb-carte ec-carte">
                  <div className="bb-carte-haut">
                    {a.photo_url
                      ? <img className="bb-photo" src={a.photo_url} alt="" />
                      : <span className="bb-photo bb-photo-vide">{a.name.slice(0, 1).toUpperCase()}</span>}
                    <div className="bb-ident">
                      <span className="bb-nom">{a.name}</span>
                      <span className="bb-role">
                        {a.habituels.length
                          ? a.habituels.map((d) => JOURS[d]).join(' et ')
                          : 'rythme irrégulier'}
                      </span>
                    </div>
                    {a.en_cours_aujourdhui && <span className="bb-tag ec-tag-jour">En cours</span>}
                  </div>

                  <dl className="ec-faits">
                    <div>
                      <dt>Prochaine</dt>
                      <dd>{jourMois(a.prochaine)} <em>{delai(today, a.prochaine)}</em></dd>
                    </div>
                    <div>
                      <dt>Restantes</dt>
                      <dd>{a.restantes} journée{a.restantes > 1 ? 's' : ''}</dd>
                    </div>
                    <div>
                      <dt>Fin de formation</dt>
                      <dd>{dateLongueAnnee(a.derniere)}</dd>
                    </div>
                  </dl>

                  <Link className="bb-lien" to="/planning">Voir au planning</Link>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
