import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClients } from '../api';

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

  useEffect(() => { loadData(); }, [search, sort]);

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

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Clients</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{total} clients</p>
        </div>
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
                      <div style={{ fontWeight: 600 }}>{c.first_name} {c.last_name}</div>
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
