import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBookingsHistory, getBarbers } from '../api';
import useMobile from '../hooks/useMobile';

const LIMIT = 50;

const STATUS_LABELS = {
  confirmed: 'Confirme',
  completed: 'Termine',
  no_show: 'Absent',
  cancelled: 'Annule',
};

const SOURCE_LABELS = {
  online: 'En ligne',
  manual: 'Manuel',
  phone: 'Tel.',
  walk_in: 'Sans RDV',
};

/**
 * Formats a price in cents to a French-formatted EUR string.
 * @param {number} cents - Price in cents
 * @returns {string} Formatted price
 */
function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20AC';
}

/**
 * Formats an ISO date string (YYYY-MM-DD) to French display format.
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date (e.g. "Lun. 18 fev. 2026")
 */
function formatDateFR(dateStr) {
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const months = [
    'jan', 'fev', 'mars', 'avr', 'mai', 'juin',
    'juil', 'aout', 'sept', 'oct', 'nov', 'dec',
  ];
  const d = new Date(dateStr + 'T00:00:00');
  return `${days[d.getDay()]}. ${d.getDate()} ${months[d.getMonth()]}. ${d.getFullYear()}`;
}

/**
 * Formats a time string (HH:MM:SS or HH:MM) to short display (HH:MM).
 * @param {string} time - Time string
 * @returns {string} Short time
 */
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

function today() {
  return toLocalDateStr();
}

export default function History() {
  const navigate = useNavigate();
  const isMobile = useMobile();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // -- Filters --
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [barberId, setBarberId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  // -- Data --
  const [bookings, setBookings] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [barbers, setBarbers] = useState([]);

  // -- Sort --
  const [sort, setSort] = useState('date');
  const [order, setOrder] = useState('desc');

  // -- Detail modal --
  const [selected, setSelected] = useState(null);

  // Debounce search ref
  const searchTimer = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce the search input
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 400);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Load barbers list on mount
  useEffect(() => {
    getBarbers()
      .then((data) => setBarbers(Array.isArray(data) ? data : data.barbers || []))
      .catch(() => {});
  }, []);

  // Load bookings whenever filters/pagination change
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBookingsHistory({
        from,
        to,
        barber_id: barberId,
        status,
        search: debouncedSearch,
        limit: LIMIT,
        offset: page * LIMIT,
        sort,
        order,
      });
      setBookings(data.bookings);
      setTotal(data.total);
    } catch (err) {
      setError(err.message || 'Erreur de chargement');
    }
    setLoading(false);
  }, [from, to, barberId, status, debouncedSearch, page, sort, order]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
            {total} rendez-vous
          </p>
        </div>
      </div>

      <div className="page-body">
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
                    <option value="no_show">Absent</option>
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
              <input
                type="date"
                className="input"
                value={from}
                onChange={handleFilterChange(setFrom)}
                style={{ width: 160 }}
              />
            </div>
            <div>
              <label className="label">Au</label>
              <input
                type="date"
                className="input"
                value={to}
                onChange={handleFilterChange(setTo)}
                style={{ width: 160 }}
              />
            </div>
            <div>
              <label className="label">Barber</label>
              <select
                className="input"
                value={barberId}
                onChange={handleFilterChange(setBarberId)}
                style={{ width: 180 }}
              >
                <option value="">Tous</option>
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Statut</label>
              <select
                className="input"
                value={status}
                onChange={handleFilterChange(setStatus)}
                style={{ width: 160 }}
              >
                <option value="">Tous</option>
                <option value="confirmed">Confirme</option>
                <option value="completed">Termine</option>
                <option value="no_show">Absent</option>
                <option value="cancelled">Annule</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="label">Recherche</label>
              <input
                className="input"
                placeholder="Nom, prenom ou telephone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* -- Error banner -- */}
        {error && (
          <div style={{
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
          <div className="empty-state">Aucun rendez-vous trouve</div>
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
                      <th
                        onClick={() => handleSort('date')}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        Date {renderSortIcon('date')}
                      </th>
                      <th>Heure</th>
                      <th
                        onClick={() => handleSort('client_last_name')}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        Client {renderSortIcon('client_last_name')}
                      </th>
                      <th>Prestation</th>
                      <th
                        onClick={() => handleSort('barber_name')}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        Barber {renderSortIcon('barber_name')}
                      </th>
                      <th
                        onClick={() => handleSort('price')}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        Prix {renderSortIcon('price')}
                      </th>
                      <th
                        onClick={() => handleSort('status')}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        Statut {renderSortIcon('status')}
                      </th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr
                        key={b.id}
                        onClick={() => setSelected(b)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                          {formatDateFR(b.date?.slice(0, 10))}
                        </td>
                        <td style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 800,
                          fontSize: 13,
                          whiteSpace: 'nowrap',
                        }}>
                          {formatTime(b.start_time)}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {b.client_first_name} {b.client_last_name}
                          </div>
                          {b.client_phone && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {b.client_phone}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: 13 }}>{b.service_name}</td>
                        <td style={{ fontSize: 13 }}>{b.barber_name}</td>
                        <td style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 800,
                          fontSize: 13,
                        }}>
                          {formatPrice(b.price)}
                        </td>
                        <td>
                          <span className={`badge badge-${b.status}`}>
                            {STATUS_LABELS[b.status] || b.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {SOURCE_LABELS[b.source] || b.source}
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
                <span>
                  {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} sur {total}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Precedent
                  </button>
                  {!isMobile && (
                    <>
                      {/* Page number buttons (show max 7 around current page) */}
                      {Array.from({ length: totalPages }, (_, i) => i)
                        .filter((i) => {
                          if (totalPages <= 7) return true;
                          if (i === 0 || i === totalPages - 1) return true;
                          return Math.abs(i - page) <= 2;
                        })
                        .reduce((acc, i, idx, arr) => {
                          if (idx > 0 && i - arr[idx - 1] > 1) {
                            acc.push('ellipsis-' + i);
                          }
                          acc.push(i);
                          return acc;
                        }, [])
                        .map((item) => {
                          if (typeof item === 'string') {
                            return (
                              <span
                                key={item}
                                style={{ padding: '4px 6px', color: 'var(--text-muted)' }}
                              >
                                ...
                              </span>
                            );
                          }
                          return (
                            <button
                              key={item}
                              className={`btn btn-sm ${item === page ? 'btn-primary' : 'btn-secondary'}`}
                              onClick={() => setPage(item)}
                              style={{ minWidth: 34 }}
                            >
                              {item + 1}
                            </button>
                          );
                        })}
                    </>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Suivant
                  </button>
                </div>
              </div>
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
                <DetailField
                  label="Horaire"
                  value={`${formatTime(selected.start_time)} - ${formatTime(selected.end_time)}`}
                  mono
                />
                <DetailField
                  label="Client"
                  value={`${selected.client_first_name} ${selected.client_last_name}`}
                />
                <DetailField label="Telephone" value={selected.client_phone || '-'} />
                <DetailField label="Prestation" value={selected.service_name} />
                <DetailField label="Barber" value={selected.barber_name} />
                <DetailField label="Prix" value={formatPrice(selected.price)} mono />
                <DetailField label="Source" value={SOURCE_LABELS[selected.source] || selected.source} />
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="label">Statut</span>
                  <div style={{ marginTop: 4 }}>
                    <span className={`badge badge-${selected.status}`}>
                      {STATUS_LABELS[selected.status] || selected.status}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSelected(null);
                  navigate(`/clients/${selected.client_id}`);
                }}
              >
                Voir le client
              </button>
              <button className="btn btn-primary" onClick={() => setSelected(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Renders a single detail field inside the modal.
 * @param {{ label: string, value: string, mono?: boolean }} props
 */
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
