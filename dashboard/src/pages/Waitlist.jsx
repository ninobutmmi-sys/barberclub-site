import { useState } from 'react';
import useMobile from '../hooks/useMobile';
import {
  useWaitlist, useWaitlistCount, useAddToWaitlist, useUpdateWaitlistEntry, useDeleteWaitlistEntry,
  useBarbers, useServices,
} from '../hooks/useApi';

export default function Waitlist() {
  const isMobile = useMobile();
  const [addModal, setAddModal] = useState(false);
  const [filter, setFilter] = useState('waiting'); // waiting | all

  const waitlistQuery = useWaitlist(filter === 'all' ? {} : { status: 'waiting' });
  const waitlistCountQuery = useWaitlistCount();
  const barbersQuery = useBarbers();
  const servicesQuery = useServices();

  const waitlist = waitlistQuery.data || [];
  const waitlistCount = waitlistCountQuery.data?.count ?? 0;
  const barbers = barbersQuery.data || [];
  const services = servicesQuery.data || [];

  const deleteMutation = useDeleteWaitlistEntry();
  const updateMutation = useUpdateWaitlistEntry();

  async function handleDelete(id) {
    if (!confirm('Retirer de la liste d\'attente ?')) return;
    try { await deleteMutation.mutateAsync(id); } catch (err) { alert(err.message); }
  }

  async function handleNotify(entry) {
    try { await updateMutation.mutateAsync({ id: entry.id, data: { status: 'notified' } }); } catch (err) { alert(err.message); }
  }

  async function handleBooked(entry) {
    try { await updateMutation.mutateAsync({ id: entry.id, data: { status: 'booked' } }); } catch (err) { alert(err.message); }
  }

  const statusLabel = { waiting: 'En attente', notified: 'Notifié', booked: 'Réservé', expired: 'Expiré' };
  const statusClass = { waiting: 'active', notified: 'inactive', booked: 'active', expired: 'inactive' };

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Liste d'attente</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {waitlistCount} client{waitlistCount !== 1 ? 's' : ''} en attente
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setAddModal(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Ajouter
        </button>
      </div>

      <div className="page-body">
        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            { key: 'waiting', label: 'En attente' },
            { key: 'all', label: 'Tous' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 12 }}
            >
              {f.label}
              {f.key === 'waiting' && waitlistCount > 0 && (
                <span style={{ marginLeft: 6, background: filter === f.key ? 'rgba(255,255,255,0.2)' : '#3b82f6', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
                  {waitlistCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {waitlistQuery.isLoading ? (
          <div className="empty-state">Chargement...</div>
        ) : waitlist.length === 0 ? (
          <div className="empty-state" style={{ padding: 60 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48, color: 'var(--text-muted)', marginBottom: 12 }}>
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Aucun client en attente</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ajoutez un client quand un créneau est complet</div>
          </div>
        ) : isMobile ? (
          /* ---- Mobile cards ---- */
          <div className="mob-card-list">
            {waitlist.map((w) => (
              <div key={w.id} className="mob-card-item" style={{ flexWrap: 'wrap' }}>
                <div className="mob-card-left">
                  <div className="mob-card-title">{w.client_name}</div>
                  <div className="mob-card-sub">
                    {new Date(w.preferred_date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {w.preferred_time_start ? ` · ${w.preferred_time_start.slice(0, 5)}` : ''} — {w.service_name || '–'}
                  </div>
                  {w.barber_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{w.barber_name}</div>}
                </div>
                <div className="mob-card-right" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`badge badge-${statusClass[w.status] || 'inactive'}`} style={{ fontSize: 9 }}>
                    {statusLabel[w.status] || w.status}
                  </span>
                  {w.status === 'waiting' && (
                    <>
                      <button className="btn btn-primary btn-sm" style={{ fontSize: 10, padding: '3px 8px' }} onClick={(e) => { e.stopPropagation(); handleNotify(w); }}>Notifier</button>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '3px 8px' }} onClick={(e) => { e.stopPropagation(); handleBooked(w); }}>Réservé</button>
                    </>
                  )}
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', padding: 4 }} onClick={(e) => { e.stopPropagation(); handleDelete(w.id); }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ---- Desktop table ---- */
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Téléphone</th>
                  <th>Barber souhaité</th>
                  <th>Prestation</th>
                  <th>Date souhaitée</th>
                  <th>Créneau</th>
                  <th>Statut</th>
                  <th style={{ width: 160 }}></th>
                </tr>
              </thead>
              <tbody>
                {waitlist.map((w) => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 600 }}>{w.client_name}</td>
                    <td style={{ fontSize: 12 }}>{w.client_phone}</td>
                    <td style={{ fontSize: 12 }}>{w.barber_name || '–'}</td>
                    <td style={{ fontSize: 12 }}>{w.service_name || '–'}</td>
                    <td style={{ fontSize: 12 }}>
                      {new Date(w.preferred_date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {w.preferred_time_start ? `${w.preferred_time_start.slice(0, 5)} – ${w.preferred_time_end?.slice(0, 5) || '?'}` : 'Toute la journée'}
                    </td>
                    <td>
                      <span className={`badge badge-${statusClass[w.status] || 'inactive'}`}>
                        {statusLabel[w.status] || w.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {w.status === 'waiting' && (
                          <>
                            <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleNotify(w)}>
                              Notifier
                            </button>
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleBooked(w)}>
                              Réservé
                            </button>
                          </>
                        )}
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(w.id)}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addModal && (
        <AddWaitlistModal
          barbers={barbers}
          services={services}
          onClose={() => setAddModal(false)}
        />
      )}
    </>
  );
}

function AddWaitlistModal({ barbers, services, onClose }) {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [barberId, setBarberId] = useState(barbers[0]?.id || '');
  const [serviceId, setServiceId] = useState(services[0]?.id || '');
  const [date, setDate] = useState('');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [error, setError] = useState('');
  const mutation = useAddToWaitlist();
  const saving = mutation.isPending;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await mutation.mutateAsync({
        client_name: clientName,
        client_phone: clientPhone,
        barber_id: barberId,
        service_id: serviceId,
        preferred_date: date,
        preferred_time_start: timeStart || undefined,
        preferred_time_end: timeEnd || undefined,
      });
      onClose();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3 className="modal-title">Ajouter en liste d'attente</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="input-row">
              <div className="form-group">
                <label className="label">Nom du client</label>
                <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Téléphone</label>
                <input className="input" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} required placeholder="06..." />
              </div>
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Barber souhaité</label>
                <select className="input" value={barberId} onChange={(e) => setBarberId(e.target.value)} required>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Prestation</label>
                <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Date souhaitée</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Créneau début (optionnel)</label>
                <input className="input" type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} min="09:00" max="19:00" />
              </div>
              <div className="form-group">
                <label className="label">Créneau fin (optionnel)</label>
                <input className="input" type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} min="09:00" max="19:00" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Ajout...' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
