import { useState, useEffect, useCallback } from 'react';
import { getAuditLog } from '../api';

const ACTION_LABELS = {
  create: 'Creation',
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
  blocked_slot: 'Creneau bloque',
  automation: 'Automation',
};

const ACTION_COLORS = {
  create: '#22c55e',
  update: '#3b82f6',
  delete: '#ef4444',
  status: '#f59e0b',
  cancel: '#ef4444',
};

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function AuditLog({ embedded } = {}) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const limit = 30;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAuditLog({ page, limit, action: filterAction, entity_type: filterEntity });
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, filterAction, filterEntity]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / limit);

  return (
    <>
      {!embedded && (
        <div className="page-header">
          <div>
            <h2 className="page-title">Journal d'activite</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>Historique des actions admin ({total} entrees)</p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1); }} className="input" style={{ width: 'auto', minWidth: 140 }}>
          <option value="">Toutes les actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterEntity} onChange={e => { setFilterEntity(e.target.value); setPage(1); }} className="input" style={{ width: 'auto', minWidth: 140 }}>
          <option value="">Tous les types</option>
          {Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Utilisateur</th>
                <th>Action</th>
                <th>Type</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Chargement...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Aucune entree</td></tr>
              ) : entries.map(e => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{formatDate(e.created_at)}</td>
                  <td>{e.actor_name}</td>
                  <td>
                    <span className="badge" style={{ background: ACTION_COLORS[e.action] || '#666', color: '#fff', fontSize: 11 }}>
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td>{ENTITY_LABELS[e.entity_type] || e.entity_type}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.details && Object.keys(e.details).length > 0
                      ? JSON.stringify(e.details).substring(0, 100)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '16px 0' }}>
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: '6px 14px', fontSize: 13 }}>Precedent</button>
            <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>{page} / {totalPages}</span>
            <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: '6px 14px', fontSize: 13 }}>Suivant</button>
          </div>
        )}
      </div>
    </>
  );
}
