import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { exportToCSV } from '../utils/csv';
import useMobile from '../hooks/useMobile';
import { formatPhoneWithFlag } from '../utils/phone';
import { useClientsPages, useClients, useAccountStats, useCreateClient } from '../hooks/useApi';
import { formatPrice, formatDateFR } from '../utils/format';

const PAGE = 50;

/* Les segments sont des filtres, pas des compteurs decoratifs : chacun
   correspond a un filtre que l'API sait appliquer, et cliquer dessus
   restreint la liste. « Sans venir depuis 3 mois » utilise inactive_weeks,
   qui existait cote serveur mais qu'aucun ecran n'exploitait. */
const SEGMENTS = [
  { key: 'all', label: 'Tous', short: 'Tous', params: {} },
  { key: 'lapsed', label: 'Sans venir depuis 3 mois', short: '3 mois+', params: { inactive_weeks: 12 } },
  { key: 'accounts', label: 'Avec un compte', short: 'Comptes', params: { has_account: 'true' } },
];

const MS_DAY = 86400000;

function parseDay(value) {
  if (!value) return null;
  const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function today0h() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/* Le temps ecoule, pas la date. Un barbier ne lit pas « 6 août 2026 », il lit
   « ça fait trois semaines ». Seules les deux situations qui demandent une
   action sont colorees ; le cas normal reste neutre, sinon la liste entiere
   clignote et plus rien ne ressort. */
function recency(lastVisit) {
  const d = parseDay(lastVisit);
  if (!d) return { text: 'Jamais', tone: 'never', title: 'Aucune visite terminée' };
  const days = Math.round((today0h() - d) / MS_DAY);
  const title = `Dernier passage le ${formatDateFR(String(lastVisit).slice(0, 10))}`;
  const tone = days > 90 ? 'late' : days > 45 ? 'warn' : 'ok';
  if (days <= 0) return { text: "Auj.", tone: 'ok', title };
  if (days < 7) return { text: `${days} j`, tone, title };
  if (days < 60) return { text: `${Math.round(days / 7)} sem`, tone, title };
  return { text: `${Math.round(days / 30)} mois`, tone, title };
}

/* Un client qui a deja un RDV pose n'est pas a relancer, meme s'il n'est pas
   venu depuis longtemps. C'est l'information qui evite l'erreur au comptoir. */
function upcoming(nextVisit) {
  const d = parseDay(nextVisit);
  if (!d) return null;
  const n = Math.round((d - today0h()) / MS_DAY);
  if (n < 0) return null;
  if (n === 0) return "RDV aujourd'hui";
  if (n === 1) return 'RDV demain';
  if (n < 14) return `RDV dans ${n} j`;
  return `RDV le ${formatDateFR(String(nextVisit).slice(0, 10))}`;
}

function initials(c) {
  const a = (c.first_name || '').trim()[0] || '';
  const b = (c.last_name || '').trim()[0] || '';
  return (a + b).toUpperCase() || '?';
}

function fullName(c) {
  return `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Sans nom';
}

/* ---------- Icones ---------- */
const IconSearch = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconClose = ({ s = 16 }) => (
  <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconDownload = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IconPlus = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconCalendar = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const IconNobody = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="17" y1="8" x2="23" y2="14" /><line x1="23" y1="8" x2="17" y2="14" />
  </svg>
);

/* ---------- Marqueurs de statut ---------- */
function Badges({ c }) {
  return (
    <>
      {c.has_account && <span className="cl-tag cl-tag-member">Membre</span>}
      {c.visit_count >= 10 && <span className="cl-tag cl-tag-vip">VIP</span>}
    </>
  );
}

function Rhythm({ c }) {
  const r = recency(c.last_visit);
  const next = upcoming(c.next_visit);
  return (
    <div className="cl-rhythm">
      <span className={`cl-since cl-since-${r.tone}`} title={r.title}>{r.text}</span>
      {next && <span className="cl-next"><IconCalendar />{next}</span>}
    </div>
  );
}

export default function Clients() {
  const navigate = useNavigate();
  const isMobile = useMobile();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('last_visit');
  const [segment, setSegment] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const debounceRef = useRef(null);
  const searchRef = useRef(null);

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), search ? 350 : 0);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const seg = SEGMENTS.find((s) => s.key === segment) || SEGMENTS[0];

  const params = useMemo(() => {
    const p = { sort, order: sort === 'name' ? 'asc' : 'desc', limit: PAGE, ...seg.params };
    if (debouncedSearch) p.search = debouncedSearch;
    return p;
  }, [sort, seg, debouncedSearch]);

  const {
    data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useClientsPages(params);

  const clients = useMemo(() => (data?.pages || []).flatMap((p) => p.clients || []), [data]);
  const total = data?.pages?.[0]?.total ?? 0;

  /* Compteurs des segments : une requete de comptage chacun (limit 1), pour que
     le chiffre affiche sur la pastille soit celui du filtre qu'elle applique. */
  // Ce comptage coute ~300 ms (NOT EXISTS sur toute la base) et ne bouge pas
  // d'une minute a l'autre : on le garde 5 minutes plutot que 30 secondes.
  const { data: lapsedCount } = useClients({ inactive_weeks: 12, limit: 1 }, { staleTime: 5 * 60_000 });
  const { data: accountStats } = useAccountStats();
  const counts = {
    all: segment === 'all' && !debouncedSearch ? total : null,
    lapsed: lapsedCount?.total ?? null,
    accounts: accountStats?.total_accounts ?? null,
  };

  function handleExportCSV() {
    if (!clients.length) return;
    exportToCSV(clients, 'clients.csv', [
      { key: 'first_name', label: 'Prenom' },
      { key: 'last_name', label: 'Nom' },
      { key: 'phone', label: 'Telephone' },
      { key: 'email', label: 'Email' },
      { key: 'visit_count', label: 'Visites' },
      { key: 'total_spent', label: 'Total depense (EUR)', transform: (v) => (v / 100).toFixed(2) },
      { key: 'last_visit', label: 'Dernier passage' },
      { key: 'next_visit', label: 'Prochain RDV' },
    ]);
  }

  const openClient = (id) => navigate(`/clients/${id}`);
  const rowKeys = (id) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openClient(id); }
  };

  return (
    <>
      {error && (
        <div className="cl-error" role="alert">
          <span>{error?.message || String(error)}</span>
          <button className="btn btn-sm" onClick={() => window.location.reload()}>Réessayer</button>
        </div>
      )}

      <div className="page-header">
        <div>
          <h2 className="page-title">Clients</h2>
          <p className="cl-subtitle">
            {total.toLocaleString('fr-FR')} {seg.key === 'accounts' ? 'comptes' : 'clients'}
            {debouncedSearch ? ` pour « ${debouncedSearch} »` : ''}
          </p>
        </div>
        <div className="cl-actions">
          {!isMobile && (
            <button
              className="btn btn-secondary"
              onClick={handleExportCSV}
              disabled={!clients.length}
              title={`Exporte les ${clients.length} clients actuellement chargés`}
            >
              <IconDownload />
              Exporter
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <IconPlus />
            {isMobile ? 'Ajouter' : 'Ajouter un client'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* La recherche est l'outil principal de cette page : on vient presque
            toujours ici pour retrouver une personne precise, pas pour parcourir
            2 500 fiches. Elle passe donc en tete, seule sur sa ligne. */}
        <div className="cl-search">
          <span className="cl-search-icon"><IconSearch /></span>
          <label className="sr-only" htmlFor="cl-q">Chercher un client</label>
          <input
            id="cl-q"
            ref={searchRef}
            className="cl-search-input"
            type="search"
            placeholder={isMobile ? 'Chercher un client' : 'Chercher un nom, un téléphone, un email'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
          {search && (
            <button className="cl-search-clear" onClick={() => { setSearch(''); searchRef.current?.focus(); }} aria-label="Effacer la recherche">
              <IconClose s={15} />
            </button>
          )}
        </div>

        <div className="cl-controls">
          <div className="cl-segments" role="group" aria-label="Filtrer les clients">
            {SEGMENTS.map((s) => (
              <button
                key={s.key}
                className={`cl-seg${segment === s.key ? ' cl-seg-on' : ''}`}
                onClick={() => setSegment(s.key)}
                aria-pressed={segment === s.key}
              >
                {isMobile ? s.short : s.label}
                {counts[s.key] != null && <span className="cl-seg-n">{counts[s.key].toLocaleString('fr-FR')}</span>}
              </button>
            ))}
          </div>

          <div className="cl-sort">
            <label className="sr-only" htmlFor="cl-sort">Trier par</label>
            <select id="cl-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="last_visit">Dernier passage</option>
              <option value="name">Nom</option>
              <option value="total_spent">Total dépensé</option>
              <option value="visit_count">Nombre de visites</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="cl-skeleton">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cl-skeleton-row" />)}
          </div>
        ) : clients.length === 0 ? (
          <div className="cl-empty">
            <IconNobody />
            {debouncedSearch ? (
              <>
                <p className="cl-empty-title">Aucun client ne correspond à « {debouncedSearch} »</p>
                <p className="cl-empty-sub">Vérifiez l&apos;orthographe, ou créez sa fiche.</p>
                <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                  <IconPlus />Ajouter ce client
                </button>
              </>
            ) : segment === 'lapsed' ? (
              <>
                <p className="cl-empty-title">Personne ne manque à l&apos;appel</p>
                <p className="cl-empty-sub">Tous les clients du salon sont passés dans les trois derniers mois.</p>
              </>
            ) : (
              <>
                <p className="cl-empty-title">Aucun client dans ce segment</p>
                <p className="cl-empty-sub">Changez de filtre pour voir le reste de la base.</p>
              </>
            )}
          </div>
        ) : isMobile ? (
          /* ---------- Mobile ---------- */
          <div className="cl-cards">
            {clients.map((c) => (
              <button key={c.id} className="cl-card" onClick={() => openClient(c.id)}>
                <span className="cl-mono" aria-hidden="true">{initials(c)}</span>
                <span className="cl-card-main">
                  <span className="cl-card-top">
                    <span className="cl-card-name">{fullName(c)}</span>
                    <Badges c={c} />
                  </span>
                  <span className="cl-card-contact">{formatPhoneWithFlag(c.phone) || 'Sans téléphone'}</span>
                  <span className="cl-card-stats">
                    <span className="cl-num">{c.visit_count}</span> visite{c.visit_count > 1 ? 's' : ''}
                    <span className="cl-dot" />
                    <span className="cl-num">{formatPrice(c.total_spent)}</span>
                  </span>
                </span>
                <Rhythm c={c} />
              </button>
            ))}
          </div>
        ) : (
          /* ---------- Desktop ---------- */
          <div className="cl-table-wrap">
            <table className="cl-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Téléphone</th>
                  <th className="cl-r">Visites</th>
                  <th className="cl-r">Total dépensé</th>
                  <th className="cl-r">Dernier passage</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Ouvrir la fiche de ${fullName(c)}`}
                    onClick={() => openClient(c.id)}
                    onKeyDown={rowKeys(c.id)}
                  >
                    <td>
                      <div className="cl-id">
                        <span className="cl-mono" aria-hidden="true">{initials(c)}</span>
                        <span className="cl-id-text">
                          <span className="cl-id-name">
                            {fullName(c)}
                            <Badges c={c} />
                          </span>
                          {c.email && <span className="cl-id-mail">{c.email}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="cl-phone">{formatPhoneWithFlag(c.phone) || <span className="cl-none">—</span>}</td>
                    <td className="cl-r"><span className="cl-num">{c.visit_count}</span></td>
                    <td className="cl-r"><span className="cl-num">{formatPrice(c.total_spent)}</span></td>
                    <td className="cl-r"><Rhythm c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {clients.length > 0 && (
          <div className="cl-more">
            {hasNextPage ? (
              <button className="cl-more-btn" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? 'Chargement…' : 'Charger plus'}
                <span className="cl-more-n">{clients.length} sur {total.toLocaleString('fr-FR')}</span>
              </button>
            ) : (
              <p className="cl-more-end">{clients.length.toLocaleString('fr-FR')} client{clients.length > 1 ? 's' : ''} affiché{clients.length > 1 ? 's' : ''}</p>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateClientModal
          initialName={debouncedSearch}
          onClose={() => setShowCreate(false)}
          onCreated={(client) => { setShowCreate(false); navigate(`/clients/${client.id}`); }}
        />
      )}
    </>
  );
}

function CreateClientModal({ onClose, onCreated, initialName = '' }) {
  // Quand on arrive ici depuis une recherche infructueuse, le nom cherche est
  // deja saisi : on ne le retape pas.
  const [first, ...rest] = initialName.trim().split(/\s+/);
  const [firstName, setFirstName] = useState(/\d|@/.test(initialName) ? '' : (first || ''));
  const [lastName, setLastName] = useState(/\d|@/.test(initialName) ? '' : rest.join(' '));
  const [phone, setPhone] = useState(/^[+\d\s.-]+$/.test(initialName.trim()) ? initialName.trim() : '');
  const [email, setEmail] = useState(initialName.includes('@') ? initialName.trim() : '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const createClient = useCreateClient();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const body = { first_name: firstName.trim(), last_name: lastName.trim() };
    if (phone.trim()) body.phone = phone.trim();
    if (email.trim()) body.email = email.trim();
    if (notes.trim()) body.notes = notes.trim();
    try {
      onCreated(await createClient.mutateAsync(body));
    } catch (err) {
      setError(err?.message || 'La fiche n’a pas pu être créée.');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3 className="modal-title">Nouveau client</h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Fermer"><IconClose s={20} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="input-row">
              <div className="form-group">
                <label className="label" htmlFor="cl-fn">Prénom</label>
                <input id="cl-fn" className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="cl-ln">Nom</label>
                <input id="cl-ln" className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
            <div className="form-group">
              <label className="label" htmlFor="cl-ph">Téléphone (optionnel)</label>
              <input id="cl-ph" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="cl-em">Email (optionnel)</label>
              <input id="cl-em" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@exemple.fr" />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="cl-no">Notes (optionnel)</label>
              <textarea id="cl-no" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ resize: 'vertical', minHeight: 48, fontFamily: 'inherit' }} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={createClient.isPending}>
              {createClient.isPending ? 'Création…' : 'Créer la fiche'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
