import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useMobile from '../hooks/useMobile';
import { useClient, useUpdateClient, useDeleteClient } from '../hooks/useApi';

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMobile = useMobile();
  const { data: client, isLoading: loading, error, refetch } = useClient(id);
  const updateMutation = useUpdateClient();
  const deleteMutation = useDeleteClient();

  const [editNotes, setEditNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [toast, setToast] = useState(null);
  const saving = updateMutation.isPending;

  // Sync notes when client data loads
  useEffect(() => {
    if (client) setNotes(client.notes || '');
  }, [client]);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function saveNotes() {
    try {
      await updateMutation.mutateAsync({ id, data: { notes } });
      setEditNotes(false);
      showToast('Notes enregistrees avec succes');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDelete() {
    if (!confirm('Supprimer ce client (RGPD) ? Cette action est irréversible.')) return;
    try {
      await deleteMutation.mutateAsync(id);
      navigate('/clients');
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div className="page-body"><div className="empty-state">Chargement...</div></div>;
  if (!client && !error) return <div className="page-body"><div className="empty-state">Client introuvable</div></div>;

  return (
    <>
      {error && (
        <div role="alert" style={{ background: '#1c1917', border: '1px solid #dc2626', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fca5a5' }}>
          <span>{error}</span>
          <button onClick={() => refetch()} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Réessayer</button>
        </div>
      )}
      {client && <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/clients')}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div style={{ minWidth: 0 }}>
            <h2 className="page-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {client.first_name} {client.last_name}
              {client.visit_count >= 10 && <span className="badge-vip" style={{ marginLeft: 10, verticalAlign: 'middle' }}>VIP</span>}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{client.phone}</p>
          </div>
        </div>
        {isMobile ? (
          <button className="btn btn-danger btn-sm" onClick={handleDelete} title="Supprimer (RGPD)" style={{ padding: 8 }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        ) : (
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>
            Supprimer (RGPD)
          </button>
        )}
      </div>

      <div className="page-body">
        {/* Stats cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard label="Visites" value={client.visit_count} />
          <StatCard label="CA Total" value={formatPrice(client.total_spent)} />
          <StatCard label="Faux plans" value={client.no_show_count} danger={client.no_show_count > 0} />
          <StatCard label="Annulations" value={client.cancelled_count} />
          <StatCard label="Service favori" value={client.favourite_service || '-'} small />
          <StatCard label="Barber favori" value={client.favourite_barber || '-'} small />
        </div>

        {/* Notes */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label className="label" style={{ margin: 0 }}>Notes internes</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {editNotes ? (
                <>
                  <button className="btn btn-primary btn-sm" onClick={saveNotes} disabled={saving}>
                    {saving ? 'Sauvegarde...' : 'Enregistrer'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditNotes(false); setNotes(client.notes || ''); }} disabled={saving}>
                    Annuler
                  </button>
                </>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={() => setEditNotes(true)}>Modifier</button>
              )}
            </div>
          </div>
          {editNotes ? (
            <textarea
              className="input"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ajouter une note (ex: prefere degrade haut, allergie produit X...)"
              style={{ resize: 'vertical' }}
            />
          ) : (
            <p style={{ fontSize: 13, color: notes ? 'var(--text-secondary)' : 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
              {notes || 'Aucune note'}
            </p>
          )}
        </div>

        {/* Booking history */}
        <label className="label" style={{ marginBottom: 12 }}>Historique des rendez-vous</label>
        {client.bookings?.length === 0 ? (
          <div className="empty-state">Aucun rendez-vous</div>
        ) : isMobile ? (
          /* ---- Mobile: Card list ---- */
          <div className="mob-card-list">
            {client.bookings?.map((b) => (
              <div key={b.id} className="mob-card-item" style={{ cursor: 'default' }}>
                <div className="mob-card-left">
                  <div className="mob-card-title">{b.date} · {b.start_time?.slice(0, 5)}</div>
                  <div className="mob-card-sub">{b.service_name} — {b.barber_name}</div>
                </div>
                <div className="mob-card-right">
                  <div className="mob-card-value">{formatPrice(b.price)}</div>
                  <div style={{ marginTop: 2 }}><span className={`badge badge-${b.status}`} style={{ fontSize: 9 }}>{b.status}</span></div>
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
                  <th>Date</th>
                  <th>Horaire</th>
                  <th>Prestation</th>
                  <th>Barber</th>
                  <th>Prix</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {client.bookings?.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{b.date}</td>
                    <td style={{ fontSize: 13 }}>{b.start_time?.slice(0, 5)} - {b.end_time?.slice(0, 5)}</td>
                    <td style={{ fontSize: 13 }}>{b.service_name}</td>
                    <td style={{ fontSize: 13 }}>{b.barber_name}</td>
                    <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12 }}>{formatPrice(b.price)}</td>
                    <td><span className={`badge badge-${b.status}`}>{b.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
      )}
    </>
  );
}

function StatCard({ label, value, danger, small }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontFamily: small ? 'var(--font)' : 'var(--font-display)',
        fontSize: small ? 13 : 20,
        fontWeight: small ? 600 : 800,
        color: danger ? 'var(--danger)' : 'var(--text)',
      }}>
        {value}
      </div>
    </div>
  );
}
