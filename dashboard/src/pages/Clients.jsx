import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClients } from '../api';
import { exportToCSV } from '../utils/csv';
import useMobile from '../hooks/useMobile';

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

const PAGE_SIZE = 20;

export default function Clients() {
  const navigate = useNavigate();
  const isMobile = useMobile();
  const [clients, setClients] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('last_visit');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadData(), search ? 400 : 0);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, sort]);

  async function loadData() {
    setLoading(true);
    setVisible(PAGE_SIZE);
    try {
      const params = { sort, order: 'desc', limit: 100 };
      if (search) params.search = search;
      const data = await getClients(params);
      setClients(data.clients);
      setTotal(data.total);
    } catch (err) {
      // silently handled
    }
    setLoading(false);
  }

  function handleExportCSV() {
    if (!clients.length) return;
    exportToCSV(clients, 'clients.csv', [
      { key: 'first_name', label: 'Prenom' },
      { key: 'last_name', label: 'Nom' },
      { key: 'phone', label: 'Telephone' },
      { key: 'email', label: 'Email' },
      { key: 'visit_count', label: 'Visites' },
      { key: 'total_spent', label: 'CA Total (centimes)' },
      { key: 'last_visit', label: 'Derniere visite' },
    ]);
  }

  const hasMore = clients.length > visible;
  const shown = clients.slice(0, visible);

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Clients</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{total} clients</p>
        </div>
        {!isMobile && (
          <button className="btn btn-secondary" onClick={handleExportCSV} disabled={!clients.length}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Exporter CSV
          </button>
        )}
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12, marginBottom: 20 }}>
          <input
            className="input"
            placeholder="Rechercher un client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={isMobile ? {} : { maxWidth: 320 }}
          />
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} style={isMobile ? {} : { width: 180 }}>
            <option value="last_visit">Dernière visite</option>
            <option value="name">Nom</option>
            <option value="total_spent">CA total</option>
            <option value="visit_count">Nb visites</option>
          </select>
        </div>

        {loading ? (
          <div className="empty-state">Chargement...</div>
        ) : clients.length === 0 ? (
          <div className="empty-state">Aucun client trouvé</div>
        ) : (
          <div style={{ position: 'relative' }}>
            {isMobile ? (
              /* ---- Mobile: Card list ---- */
              <div className="mob-card-list">
                {shown.map((c) => (
                  <div key={c.id} className="mob-card-item" onClick={() => navigate(`/clients/${c.id}`)}>
                    <div className="mob-card-left">
                      <div className="mob-card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {c.first_name} {c.last_name}
                        {c.has_account && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            fontSize: 9, fontWeight: 700, padding: '1px 6px',
                            background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                            borderRadius: 5, border: '1px solid rgba(34,197,94,0.2)',
                            textTransform: 'uppercase',
                          }}>
                            <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                            Membre
                          </span>
                        )}
                        {c.visit_count >= 10 && <span className="badge-vip">VIP</span>}
                      </div>
                      <div className="mob-card-sub">{c.phone}{c.email ? ` · ${c.email}` : ''}</div>
                    </div>
                    <div className="mob-card-right">
                      <div className="mob-card-value">{formatPrice(c.total_spent)}</div>
                      <div className="mob-card-meta">{c.visit_count} visites</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* ---- Desktop: Table ---- */
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Téléphone</th>
                      <th>Visites</th>
                      <th>CA Total</th>
                      <th>Dernière visite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)} style={{ cursor: 'pointer' }}>
                        <td>
                          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {c.first_name} {c.last_name}
                            {c.has_account && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                fontSize: 10, fontWeight: 700, padding: '2px 8px',
                                background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                                borderRadius: 6, border: '1px solid rgba(34,197,94,0.2)',
                                letterSpacing: '0.04em', textTransform: 'uppercase',
                              }}>
                                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                                Membre
                              </span>
                            )}
                            {c.visit_count >= 10 && <span className="badge-vip" style={{ marginLeft: 0 }}>VIP</span>}
                          </div>
                          {c.email && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.email}</div>}
                        </td>
                        <td style={{ fontSize: 13 }}>{c.phone}</td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>
                            {c.visit_count}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>
                          {formatPrice(c.total_spent)}
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {c.last_visit || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Fade overlay + Voir plus */}
            {hasMore && (
              <div style={{
                position: 'relative',
                marginTop: isMobile ? 0 : -80,
                paddingTop: isMobile ? 8 : 80,
                background: isMobile ? 'none' : 'linear-gradient(to bottom, transparent 0%, var(--bg) 70%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingBottom: 8,
                pointerEvents: 'none',
              }}>
                <button
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  style={{
                    pointerEvents: 'auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 28px',
                    background: 'linear-gradient(165deg, rgba(var(--overlay),0.07), rgba(var(--overlay),0.02))',
                    border: '1px solid rgba(var(--overlay),0.1)',
                    borderRadius: 12,
                    color: 'var(--text)',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'var(--font)',
                    cursor: 'pointer',
                    transition: 'all 0.25s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'rgba(var(--overlay),0.2)';
                    e.currentTarget.style.background = 'linear-gradient(165deg, rgba(var(--overlay),0.1), rgba(var(--overlay),0.04))';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'rgba(var(--overlay),0.1)';
                    e.currentTarget.style.background = 'linear-gradient(165deg, rgba(var(--overlay),0.07), rgba(var(--overlay),0.02))';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Voir plus</span>
                  <span style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}>
                    {visible} / {clients.length}
                  </span>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              </div>
            )}

            {/* Shown count when all visible */}
            {!hasMore && clients.length > PAGE_SIZE && (
              <div style={{
                textAlign: 'center',
                padding: '16px 0 4px',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}>
                {clients.length} clients affiches
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
