import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useMobile from '../hooks/useMobile';
import { useBookingsHistory, useBarbers, useAuditLog } from '../hooks/useApi';

const LIMIT = 50;

const STATUS_LABELS = {
  confirmed: 'Confirme',
  completed: 'Termine',
  no_show: 'Faux plan',
  cancelled: 'Annule',
};

const SOURCE_LABELS = {
  online: 'En ligne',
  manual: 'Manuel',
  phone: 'Tel.',
  walk_in: 'Sans RDV',
};

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20AC';
}

function formatDateFR(dateStr) {
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const months = [
    'jan', 'fev', 'mars', 'avr', 'mai', 'juin',
    'juil', 'aout', 'sept', 'oct', 'nov', 'dec',
  ];
  const d = new Date(dateStr + 'T00:00:00');
  return `${days[d.getDay()]}. ${d.getDate()} ${months[d.getMonth()]}. ${d.getFullYear()}`;
}

function formatTime(time) {
  if (!time) return '-';
  return time.slice(0, 5);
}

function toLocalDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toLocalDateStr(d);
}

function defaultTo() {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return toLocalDateStr(d);
}

// ============================================
// Audit Log Tab
// ============================================

const ACTION_LABELS = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  status: 'Statut',
  cancel: 'Annulation',
};

const ENTITY_LABELS = {
  booking: 'RDV',
  booking_group: 'Groupe RDV',
  service: 'Prestation',
  client: 'Client',
  barber: 'Barber',
  blocked_slot: 'Créneau bloqué',
  automation: 'Automation',
};

const ACTION_COLORS = {
  create: '#22c55e',
  update: '#3b82f6',
  delete: '#ef4444',
  status: '#f59e0b',
  cancel: '#ef4444',
};

function formatDatetime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function AuditDetails({ details }) {
  if (!details || Object.keys(details).length === 0) return <span style={{ color: 'var(--text-muted)' }}>&mdash;</span>;

  // Rich display for booking updates with before/after
  if (details.before && details.after) {
    const changes = [];
    const b = details.before;
    const a = details.after;
    if (b.date !== a.date) changes.push({ label: 'Date', from: b.date, to: a.date });
    if (b.start_time !== a.start_time) changes.push({ label: 'Heure', from: b.start_time, to: a.start_time });
    if (b.barber !== a.barber) changes.push({ label: 'Barber', from: b.barber, to: a.barber });
    if (b.service !== a.service) changes.push({ label: 'Presta', from: b.service, to: a.service });

    if (changes.length === 0) return <span style={{ color: 'var(--text-muted)' }}>Aucun changement visible</span>;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {details.client && <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{details.client}</div>}
        {changes.map((c, i) => (
          <div key={i} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 48 }}>{c.label}</span>
            <span style={{ color: '#ef4444', textDecoration: 'line-through' }}>{c.from}</span>
            <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
            <span style={{ color: '#22c55e', fontWeight: 600 }}>{c.to}</span>
          </div>
        ))}
      </div>
    );
  }

  // Booking creation/delete with client name
  if (details.client) {
    const parts = [details.client];
    if (details.date) parts.push(details.date);
    if (details.start_time) parts.push(details.start_time);
    if (details.status) parts.push(STATUS_LABELS[details.status] || details.status);
    if (details.count) parts.push(`${details.count} RDV`);
    return <span style={{ fontSize: 12 }}>{parts.join(' · ')}</span>;
  }

  // Fallback: JSON
  const str = JSON.stringify(details);
  return <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{str.length > 120 ? str.substring(0, 120) + '...' : str}</span>;
}

function AuditTab({ isMobile }) {
  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const auditLimit = 30;

  const { data: auditData, isLoading: auditLoading } = useAuditLog({
    page: auditPage,
    limit: auditLimit,
    action: filterAction,
    entity_type: filterEntity,
  });

  const entries = auditData?.entries || [];
  const auditTotal = auditData?.total || 0;
  const totalPages = Math.ceil(auditTotal / auditLimit);

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setAuditPage(1); }} className="input" style={{ width: 'auto', minWidth: 140 }}>
          <option value="">Toutes les actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterEntity} onChange={e => { setFilterEntity(e.target.value); setAuditPage(1); }} className="input" style={{ width: 'auto', minWidth: 140 }}>
          <option value="">Tous les types</option>
          {Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {auditLoading ? (
        <div className="empty-state">Chargement...</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#a8a29e' }}>
          <p style={{ margin: 0, fontSize: 15 }}>Aucune entrée</p>
        </div>
      ) : isMobile ? (
        <div className="mob-card-list">
          {entries.map(e => (
            <div key={e.id} className="mob-card-item" style={{ cursor: 'default' }}>
              <div className="mob-card-left" style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="badge" style={{ background: ACTION_COLORS[e.action] || '#666', color: '#fff', fontSize: 9 }}>
                    {ACTION_LABELS[e.action] || e.action}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{ENTITY_LABELS[e.entity_type] || e.entity_type}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  {e.actor_name} · {formatDatetime(e.created_at)}
                </div>
                <AuditDetails details={e.details} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Utilisateur</th>
                <th>Action</th>
                <th>Type</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{formatDatetime(e.created_at)}</td>
                  <td style={{ fontSize: 13 }}>{e.actor_name}</td>
                  <td>
                    <span className="badge" style={{ background: ACTION_COLORS[e.action] || '#666', color: '#fff', fontSize: 11 }}>
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{ENTITY_LABELS[e.entity_type] || e.entity_type}</td>
                  <td style={{ maxWidth: 400 }}>
                    <AuditDetails details={e.details} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '16px 0' }}>
          <button className="btn btn-secondary btn-sm" disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)}>Précédent</button>
          <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>{auditPage} / {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={auditPage >= totalPages} onClick={() => setAuditPage(p => p + 1)}>Suivant</button>
        </div>
      )}
    </>
  );
}

// ============================================
// Main History Page
// ============================================

export default function History() {
  const navigate = useNavigate();
  const isMobile = useMobile();
  const [tab, setTab] = useState('bookings'); // 'bookings' | 'journal'
  const [filtersOpen, setFiltersOpen] = useState(false);

  // -- Filters --
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [barberId, setBarberId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  // -- Data --
  const [page, setPage] = useState(0);
  const { data: barbers = [] } = useBarbers();

  // -- Sort --
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState('desc');

  // -- Detail modal --
  const [selected, setSelected] = useState(null);

  // Debounce search
  const searchTimer = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 400);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const historyParams = {
    from, to, barber_id: barberId, status, search: debouncedSearch,
    limit: LIMIT, offset: page * LIMIT, sort, order,
  };
  const { data: historyData, isLoading: loading, error } = useBookingsHistory(historyParams, { enabled: tab === 'bookings' });
  const bookings = historyData?.bookings || [];
  const total = historyData?.total || 0;

  // Reset page when filters change (except search, handled above)
  function handleFilterChange(setter) {
    return (e) => {
      setter(e.target.value);
      setPage(0);
    };
  }

  // Column sort handler
  function handleSort(col) {
    if (sort === col) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(col);
      setOrder('desc');
    }
    setPage(0);
  }

  function renderSortIcon(col) {
    if (sort !== col) return null;
    return (
      <span style={{ marginLeft: 4, fontSize: 10 }}>
        {order === 'asc' ? '\u25B2' : '\u25BC'}
      </span>
    );
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <>
      {/* -- Page header -- */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Historique</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {tab === 'bookings' ? `${total} rendez-vous` : 'Journal des modifications'}
          </p>
        </div>
      </div>

      <div className="page-body">
        {/* -- Tabs -- */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(var(--overlay),0.04)', borderRadius: 8, padding: 3, width: 'fit-content' }}>
          {[
            { key: 'bookings', label: 'Rendez-vous' },
            { key: 'journal', label: 'Journal' },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 700,
              background: tab === t.key ? 'rgba(var(--overlay),0.12)' : 'transparent',
              color: tab === t.key ? 'var(--text)' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}>{t.label}</button>
          ))}
        </div>

        {/* ===== JOURNAL TAB ===== */}
        {tab === 'journal' && <AuditTab isMobile={isMobile} />}

        {/* ===== BOOKINGS TAB ===== */}
        {tab === 'bookings' && (
          <>
            {/* -- Filters bar -- */}
            {isMobile ? (
              <>
                <button
                  className={`mob-filters-toggle${filtersOpen ? ' open' : ''}`}
                  onClick={() => setFiltersOpen(v => !v)}
                  style={{ marginBottom: filtersOpen ? 12 : 20 }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                  Filtres
                </button>
                {filtersOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                    <div>
                      <label className="label">Du</label>
                      <input type="date" className="input" value={from} onChange={handleFilterChange(setFrom)} style={{ width: '100%' }} />
                    </div>
                    <div>
                      <label className="label">Au</label>
                      <input type="date" className="input" value={to} onChange={handleFilterChange(setTo)} style={{ width: '100%' }} />
                    </div>
                    <div>
                      <label className="label">Barber</label>
                      <select className="input" value={barberId} onChange={handleFilterChange(setBarberId)} style={{ width: '100%' }}>
                        <option value="">Tous</option>
                        {barbers.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Statut</label>
                      <select className="input" value={status} onChange={handleFilterChange(setStatus)} style={{ width: '100%' }}>
                        <option value="">Tous</option>
                        <option value="confirmed">Confirme</option>
                        <option value="completed">Termine</option>
                        <option value="no_show">Faux plan</option>
                        <option value="cancelled">Annule</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Recherche</label>
                      <input className="input" placeholder="Nom, prenom ou telephone..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%' }} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{
                display: 'flex',
                gap: 12,
                marginBottom: 20,
                flexWrap: 'wrap',
                alignItems: 'flex-end',
              }}>
                <div>
                  <label className="label">Du</label>
                  <input type="date" className="input" value={from} onChange={handleFilterChange(setFrom)} style={{ width: 160 }} />
                </div>
                <div>
                  <label className="label">Au</label>
                  <input type="date" className="input" value={to} onChange={handleFilterChange(setTo)} style={{ width: 160 }} />
                </div>
                <div>
                  <label className="label">Barber</label>
                  <select className="input" value={barberId} onChange={handleFilterChange(setBarberId)} style={{ width: 180 }}>
                    <option value="">Tous</option>
                    {barbers.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="label">Statut</label>
                  <select className="input" value={status} onChange={handleFilterChange(setStatus)} style={{ width: 160 }}>
                    <option value="">Tous</option>
                    <option value="confirmed">Confirme</option>
                    <option value="completed">Termine</option>
                    <option value="no_show">Faux plan</option>
                    <option value="cancelled">Annule</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="label">Recherche</label>
                  <input className="input" placeholder="Nom, prenom ou telephone..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
            )}

            {/* -- Error banner -- */}
            {error && (
              <div role="alert" style={{
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 16px',
                fontSize: 13,
                color: 'var(--danger)',
                marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            {/* -- Table -- */}
            {loading ? (
              <div className="empty-state">Chargement...</div>
            ) : bookings.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#a8a29e' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <p style={{ margin: 0, fontSize: 15 }}>Aucun historique pour cette période</p>
              </div>
            ) : (
              <>
                {isMobile ? (
                  <div className="mob-card-list">
                    {bookings.map((b) => (
                      <div key={b.id} className="mob-card-item" onClick={() => setSelected(b)}>
                        <div className="mob-card-left">
                          <div className="mob-card-title">{b.client_first_name} {b.client_last_name}</div>
                          <div className="mob-card-sub">{formatDateFR(b.date?.slice(0, 10))} · {formatTime(b.start_time)} — {b.service_name}</div>
                        </div>
                        <div className="mob-card-right">
                          <div className="mob-card-value">{formatPrice(b.price)}</div>
                          <div style={{ marginTop: 2 }}><span className={`badge badge-${b.status}`} style={{ fontSize: 9 }}>{STATUS_LABELS[b.status] || b.status}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th onClick={() => handleSort('date')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            Date {renderSortIcon('date')}
                          </th>
                          <th>Heure</th>
                          <th onClick={() => handleSort('client_last_name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            Client {renderSortIcon('client_last_name')}
                          </th>
                          <th>Prestation</th>
                          <th onClick={() => handleSort('barber_name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            Barber {renderSortIcon('barber_name')}
                          </th>
                          <th onClick={() => handleSort('price')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            Prix {renderSortIcon('price')}
                          </th>
                          <th onClick={() => handleSort('status')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            Statut {renderSortIcon('status')}
                          </th>
                          <th>Source</th>
                          <th onClick={() => handleSort('created_at')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            Réservé le {renderSortIcon('created_at')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {bookings.map((b) => (
                          <tr key={b.id} onClick={() => setSelected(b)} style={{ cursor: 'pointer' }}>
                            <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{formatDateFR(b.date?.slice(0, 10))}</td>
                            <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' }}>{formatTime(b.start_time)}</td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{b.client_first_name} {b.client_last_name}</div>
                              {b.client_phone && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.client_phone}</div>}
                            </td>
                            <td style={{ fontSize: 13 }}>{b.service_name}</td>
                            <td style={{ fontSize: 13 }}>{b.barber_name}</td>
                            <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>{formatPrice(b.price)}</td>
                            <td><span className={`badge badge-${b.status}`}>{STATUS_LABELS[b.status] || b.status}</span></td>
                            <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{SOURCE_LABELS[b.source] || b.source}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              {b.created_at ? (() => {
                                const d = new Date(b.created_at);
                                return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                              })() : '\u2013'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* -- Pagination -- */}
                {totalPages > 1 && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 20,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                  }}>
                    <span>{page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} sur {total}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Precedent</button>
                      {!isMobile && (
                        <>
                          {Array.from({ length: totalPages }, (_, i) => i)
                            .filter((i) => {
                              if (totalPages <= 7) return true;
                              if (i === 0 || i === totalPages - 1) return true;
                              return Math.abs(i - page) <= 2;
                            })
                            .reduce((acc, i, idx, arr) => {
                              if (idx > 0 && i - arr[idx - 1] > 1) acc.push('ellipsis-' + i);
                              acc.push(i);
                              return acc;
                            }, [])
                            .map((item) => {
                              if (typeof item === 'string') {
                                return <span key={item} style={{ padding: '4px 6px', color: 'var(--text-muted)' }}>...</span>;
                              }
                              return (
                                <button key={item} className={`btn btn-sm ${item === page ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPage(item)} style={{ minWidth: 34 }}>{item + 1}</button>
                              );
                            })}
                        </>
                      )}
                      <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Suivant</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* -- Detail modal -- */}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3 className="modal-title">Detail du RDV</h3>
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
                <DetailField label="Date" value={formatDateFR(selected.date?.slice(0, 10))} />
                <DetailField label="Horaire" value={`${formatTime(selected.start_time)} - ${formatTime(selected.end_time)}`} mono />
                <DetailField label="Client" value={`${selected.client_first_name} ${selected.client_last_name}`} />
                <DetailField label="Telephone" value={selected.client_phone || '-'} />
                <DetailField label="Prestation" value={selected.service_name} />
                <DetailField label="Barber" value={selected.barber_name} />
                <DetailField label="Prix" value={formatPrice(selected.price)} mono />
                <DetailField label="Source" value={SOURCE_LABELS[selected.source] || selected.source} />
                {selected.created_at && (
                  <DetailField label="Créé le" value={(() => {
                    const d = new Date(selected.created_at);
                    return `${formatDateFR(d.toISOString().slice(0, 10))} à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                  })()} />
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="label">Statut</span>
                  <div style={{ marginTop: 4 }}>
                    <span className={`badge badge-${selected.status}`}>{STATUS_LABELS[selected.status] || selected.status}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setSelected(null); navigate(`/clients/${selected.client_id}`); }}>Voir le client</button>
              <button className="btn btn-primary" onClick={() => setSelected(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DetailField({ label, value, mono }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div style={{
        marginTop: 4,
        fontSize: 14,
        fontWeight: 600,
        fontFamily: mono ? 'var(--font-display)' : 'inherit',
      }}>
        {value}
      </div>
    </div>
  );
}
