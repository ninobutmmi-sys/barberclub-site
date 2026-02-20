import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClients } from '../api';
import { exportToCSV } from '../utils/csv';

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

export default function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('last_visit');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadData(), search ? 400 : 0);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, sort]);

  async function loadData() {
    setLoading(true);
    try {
      const params = { sort, order: 'desc', limit: 100 };
      if (search) params.search = search;
      const data = await getClients(params);
      setClients(data.clients);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
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

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Clients</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{total} clients</p>
        </div>
        <button className="btn btn-secondary" onClick={handleExportCSV} disabled={!clients.length}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Exporter CSV
        </button>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <input
            className="input"
            placeholder="Rechercher un client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 180 }}>
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
                {clients.map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {c.first_name} {c.last_name}
                        {c.visit_count >= 10 && <span className="badge-vip" style={{ marginLeft: 8 }}>VIP</span>}
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
      </div>
    </>
  );
}
