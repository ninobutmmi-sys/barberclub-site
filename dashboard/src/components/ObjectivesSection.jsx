import { useEffect, useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as api from '../api';

/**
 * Objectifs du mois — trophées et challenges, fusionnés dans Analytics.
 *
 * Chaque trophée est un classement de barbiers sur une mesure. La forme retenue
 * est la barre horizontale : le libellé se lit à l'endroit, la comparaison se
 * fait sur une seule dimension, et 4 à 6 barbiers tiennent sans défilement.
 *
 * Règle de couleur : la teinte suit LE BARBIER, jamais son rang. Julien garde
 * la même couleur dans les trois graphiques, ce qui permet de le suivre d'un
 * trophée à l'autre. Repeindre selon le classement rendrait les trois
 * graphiques illisibles ensemble.
 *
 * Palette : ordre catégoriel fixe, validé par scripts/validate_palette.js
 * contre les deux surfaces du dashboard. Le mode clair déclenche un
 * avertissement de contraste sur 3 teintes, levé ici par les étiquettes
 * portées sur chaque barre — l'identité ne repose jamais sur la couleur seule.
 */

// Ordre catégoriel fixe — ne jamais permuter ni recycler au-delà de 6.
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];
const SERIES_DARK  = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];

function useSeriesPalette() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute('data-theme') !== 'light'
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.getAttribute('data-theme') !== 'light')
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark ? SERIES_DARK : SERIES_LIGHT;
}

/** Montants en centimes -> « 1 240 € ». Les centimes n'apportent rien sur un total mensuel. */
function euros(cents) {
  return `${Math.round((cents || 0) / 100).toLocaleString('fr-FR')} €`;
}

/**
 * Ce que chaque trophée met sur la barre, et ce qu'il écrit à côté.
 * `bar` est la grandeur tracée, `text` la valeur lue, `meta` le contexte qui
 * évite de conclure trop vite (un gros total sur beaucoup plus de RDV).
 */
const TROPHIES = {
  meilleur_volume: {
    label: 'Chiffre d’affaires',
    hint: 'RDV honorés sur le mois',
    bar: (r) => r.total_revenue ?? r.percentage ?? 0,
    text: (r) => (r.total_revenue != null ? euros(r.total_revenue) : `${r.percentage ?? 0} %`),
    meta: (r) => (r.bookings_count != null
      ? `${r.bookings_count} RDV · panier ${euros(r.avg_ticket)}`
      : null),
    col: 'CA',
  },
  roi_des_ventes: {
    label: 'Ventes de produits',
    hint: 'RDV repartis avec un produit',
    bar: (r) => r.count ?? 0,
    text: (r) => `${r.count ?? 0}`,
    meta: (r) => (r.attach_rate != null ? `${r.attach_rate} % de ses RDV` : null),
    col: 'Ventes',
  },
  moins_faux_plans: {
    label: 'Faux plans',
    hint: 'Part des RDV où le client n’est pas venu',
    // La barre porte le TAUX, pas le compte. Sur des comptes bruts, celui qui
    // fait 130 RDV en récolte mécaniquement plus que celui qui en fait 32, et
    // trois barbiers à « 1 » donnaient trois barres pleines identiques.
    bar: tauxFauxPlans,
    sort: (a, b) => tauxFauxPlans(a) - tauxFauxPlans(b),
    text: (r) => `${fmtTaux(tauxFauxPlans(r))} %`,
    meta: (r) => `${r.no_show_count} sur ${r.no_show_count + r.completed_count} RDV`,
    // Tout le monde à zéro : des barres vides ne diraient rien, on le dit en clair.
    allZero: 'Aucun faux plan ce mois-ci, sur tout le salon.',
    col: 'Taux',
    lowerIsBetter: true,
  },
};

function tauxFauxPlans(r) {
  const total = (r.no_show_count || 0) + (r.completed_count || 0);
  return total > 0 ? ((r.no_show_count || 0) / total) * 100 : 0;
}

/** Un taux de 0,8 % ne doit pas s'afficher « 1 % » : à ces ordres de grandeur la décimale est l'information. */
function fmtTaux(n) {
  if (n === 0) return '0';
  return n < 10 ? n.toFixed(1).replace('.', ',') : String(Math.round(n));
}

function TrophyChart({ trophyKey, trophy, colorOf }) {
  const meta = TROPHIES[trophyKey] || {
    label: trophy.title, hint: '', bar: (r) => r.percentage ?? 0,
    text: (r) => String(r.display_value ?? r.percentage ?? 0), meta: () => null, col: 'Valeur',
  };
  // Certains trophées se classent sur une mesure que le back ne connaît pas
  // (le taux de faux plans, pas leur nombre) : ils fournissent leur tri.
  const rows = (trophy.ranking || []).slice().sort(meta.sort || ((a, b) => a.rank - b.rank));
  const max = Math.max(...rows.map(meta.bar), 0);

  const head = (
    <figcaption className="obj-chart-head">
      <span className="obj-chart-title">
        {meta.label}
        {/* Sans ça, la barre la plus longue se lit comme le podium. */}
        {meta.lowerIsBetter && <span className="obj-chart-tag">moins = mieux</span>}
      </span>
      <span className="obj-chart-hint">{meta.hint}</span>
    </figcaption>
  );

  if (!rows.length) {
    return <figure className="obj-chart">{head}<p className="obj-empty">Aucune donnée ce mois-ci.</p></figure>;
  }
  if (max === 0 && meta.allZero) {
    return <figure className="obj-chart">{head}<p className="obj-empty">{meta.allZero}</p></figure>;
  }

  return (
    <figure className="obj-chart">
      {head}

      <ul className="obj-bars">
        {rows.map((r, i) => {
          const n = meta.bar(r);
          // 2 % de plancher : une barre nulle doit rester une marque visible,
          // sinon la ligne se lit comme « pas de donnée ».
          const pct = max > 0 ? Math.max(n > 0 ? 2 : 0, (n / max) * 100) : 0;
          const sub = meta.meta(r);
          return (
            <li key={r.barber_id} className={`obj-bar-row ${i === 0 ? 'lead' : ''}`}>
              <span className="obj-bar-name" title={r.barber_name}>{r.barber_name}</span>
              <span className="obj-bar-track">
                <span
                  className="obj-bar-fill"
                  style={{ width: `${pct}%`, background: colorOf(r.barber_id) }}
                />
              </span>
              <span className="obj-bar-value">{meta.text(r)}</span>
              {sub && <span className="obj-bar-meta">{sub}</span>}
            </li>
          );
        })}
      </ul>

      {/* Vue tabulaire : exigée dès qu'une teinte passe sous 3:1 en mode clair. */}
      <details className="obj-table-toggle">
        <summary>Voir en tableau</summary>
        <table className="obj-table">
          <thead><tr><th>#</th><th>Barbier</th><th>{meta.col}</th><th>Détail</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.barber_id}>
                <td>{i + 1}</td>
                <td>{r.barber_name}</td>
                <td>{meta.text(r)}</td>
                <td>{meta.meta(r) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * Un challenge est un objectif chiffré, atteint barbier par barbier. La
 * progression vient d'un appel séparé : le back la recalcule sur la période du
 * challenge, qui ne suit pas le mois affiché.
 */
function ChallengeCard({ challenge, colorOf, onDelete }) {
  const [progress, setProgress] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (challenge.metric_type === 'custom') return;
    let annule = false;
    api.getChallengeProgress(challenge.id)
      .then((p) => { if (!annule) setProgress(p); })
      .catch(() => { if (!annule) setFailed(true); });
    return () => { annule = true; };
  }, [challenge.id, challenge.metric_type]);

  const target = Number(challenge.target_value) || 0;
  const rows = progress?.progress || [];
  const atteint = rows.filter((r) => r.current_value >= target).length;
  const fin = challenge.end_date
    ? format(new Date(`${challenge.end_date}T00:00:00`), 'd MMM', { locale: fr })
    : null;

  return (
    <article className="obj-challenge">
      <header className="obj-challenge-head">
        <div>
          <span className="obj-challenge-title">{challenge.title}</span>
          <span className="obj-challenge-sub">
            Objectif {target}{fin && <> · jusqu’au {fin}</>}
            {rows.length > 0 && <> · {atteint}/{rows.length} l’ont atteint</>}
          </span>
        </div>
        <button
          className="obj-challenge-del"
          onClick={() => onDelete(challenge.id)}
          aria-label={`Supprimer le challenge ${challenge.title}`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
        </button>
      </header>

      {challenge.metric_type === 'custom' ? (
        <p className="obj-empty">Suivi manuel — aucune mesure automatique pour ce type.</p>
      ) : failed ? (
        <p className="obj-empty" role="alert">Progression indisponible.</p>
      ) : !progress ? (
        <p className="obj-empty">Chargement de la progression...</p>
      ) : rows.length === 0 ? (
        <p className="obj-empty">Personne n’a encore marqué de point.</p>
      ) : (
        <ul className="obj-bars">
          {rows.map((r) => {
            // L'échelle est l'objectif, pas le meilleur : c'est ce que la barre
            // doit répondre — « où en est-il par rapport à la cible ».
            const pct = target > 0 ? Math.min(100, (r.current_value / target) * 100) : 0;
            const done = r.current_value >= target;
            return (
              <li key={r.barber_id} className={`obj-bar-row ${done ? 'lead' : ''}`}>
                <span className="obj-bar-name" title={r.barber_name}>{r.barber_name}</span>
                <span className="obj-bar-track">
                  <span
                    className="obj-bar-fill"
                    style={{ width: `${Math.max(pct > 0 ? 2 : 0, pct)}%`, background: colorOf(r.barber_id) }}
                  />
                </span>
                <span className="obj-bar-value">
                  {r.current_value}<span className="obj-bar-unit"> / {target}</span>
                </span>
                {done && <span className="obj-bar-meta done">objectif atteint</span>}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

export default function ObjectivesSection({ monthStr, monthLabel }) {
  const palette = useSeriesPalette();
  const [data, setData] = useState(null);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    let annule = false;
    setLoading(true); setError('');
    Promise.all([
      api.getMonthlyObjectives(monthStr).catch(() => null),
      api.getChallenges().catch(() => []),
    ]).then(([obj, chal]) => {
      if (annule) return;
      if (!obj) setError('Objectifs indisponibles pour ce mois.');
      setData(obj);
      setChallenges(Array.isArray(chal) ? chal : chal?.challenges || []);
    }).finally(() => { if (!annule) setLoading(false); });
    return () => { annule = true; };
  }, [monthStr]);

  // La couleur est attachée au barbier, pas à sa position : on fige
  // l'association sur la liste des barbiers du salon, ordre renvoyé par l'API.
  //
  // Les classements contiennent aussi les barbiers partis (Benji a fait du
  // chiffre en juillet mais n'est plus actif) : sans eux dans la table, leur
  // barre sortait en gris et cassait la lecture d'un graphique à l'autre.
  const colorOf = useMemo(() => {
    const noms = new Map();
    (data?.barbers || []).forEach((b) => noms.set(b.id, b.name));
    const extras = [];
    Object.values(data?.trophies || {}).forEach((t) =>
      (t.ranking || []).forEach((r) => {
        if (!noms.has(r.barber_id) && !extras.some((e) => e.id === r.barber_id)) {
          extras.push({ id: r.barber_id, name: r.barber_name });
        }
      })
    );
    // Tri par nom pour que l'ordre ne dépende pas du trophée où on l'a croisé.
    extras.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const ids = [...noms.keys(), ...extras.map((e) => e.id)];
    const map = new Map(ids.map((id, i) => [id, palette[i % palette.length]]));
    return (id) => map.get(id) || 'var(--text-muted)';
  }, [data, palette]);

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Supprimer ce challenge ?')) return;
    try {
      await api.deleteChallenge(id);
      setChallenges((prev) => prev.filter((c) => c.id !== id));
    } catch (e) { alert(e.message); }
  }, []);

  const trophies = data?.trophies ? Object.entries(data.trophies) : [];

  return (
    <section className="obj-section">
      {error && <p className="obj-empty" role="alert">{error}</p>}

      {loading ? (
        <div className="obj-charts">
          {[0, 1, 2].map((i) => <div key={i} className="obj-chart obj-skeleton" />)}
        </div>
      ) : (
        <>
          <div className="obj-charts">
            {trophies.map(([key, t]) => (
              <TrophyChart key={key} trophyKey={key} trophy={t} colorOf={colorOf} />
            ))}
          </div>

          <div className="obj-sub-row">
            <h4 className="obj-sub">Challenges</h4>
            <button className="btn btn-secondary btn-sm print-hide" onClick={() => setShowCreate(true)} style={{ gap: 6 }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nouveau
            </button>
          </div>

          {challenges.length === 0 ? (
            <p className="obj-empty">Aucun challenge en cours.</p>
          ) : (
            <div className="obj-challenges">
              {challenges.map((c) => (
                <ChallengeCard key={c.id} challenge={c} colorOf={colorOf} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </>
      )}

      <p className="obj-note">
        Classements sur {monthLabel}. Une couleur = un barbier, la même dans les trois graphiques.
      </p>

      {showCreate && (
        <CreateChallengeModal
          onClose={() => setShowCreate(false)}
          onCreated={(c) => { setChallenges((prev) => [...prev, c]); setShowCreate(false); }}
        />
      )}
    </section>
  );
}

function CreateChallengeModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [metric, setMetric] = useState('products_sold');
  const [endDate, setEndDate] = useState(
    format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'yyyy-MM-dd')
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      onCreated(await api.createChallenge({
        title,
        target_value: parseInt(target, 10),
        metric_type: metric,
        start_date: format(new Date(), 'yyyy-MM-dd'),
        end_date: endDate,
      }));
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3 className="modal-title">Nouveau challenge</h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Fermer">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-group">
              <label className="label" htmlFor="ch-title">Titre du challenge</label>
              <input id="ch-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Ex : vendre 20 cires" />
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label" htmlFor="ch-target">Objectif (nombre)</label>
                <input id="ch-target" className="input" type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} required placeholder="15" />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="ch-metric">Type</label>
                <select id="ch-metric" className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
                  <option value="products_sold">Produits vendus</option>
                  <option value="bookings_count">Nombre de RDV</option>
                  <option value="custom">Personnalisé</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label" htmlFor="ch-end">Date de fin</label>
              <input id="ch-end" className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Création...' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
