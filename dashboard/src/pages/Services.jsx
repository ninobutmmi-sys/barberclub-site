import { useState } from 'react';
import useMobile from '../hooks/useMobile';
import { useServices, useBarbers, useCreateService, useUpdateService, useDeleteService } from '../hooks/useApi';

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

import { COLOR_PALETTE } from '../utils/constants';

export default function Services() {
  const isMobile = useMobile();
  const { data: services = [], isLoading: loading, error, refetch } = useServices();
  const { data: barbers = [] } = useBarbers();
  const [modal, setModal] = useState(null);
  const deleteMutation = useDeleteService();

  async function handleDelete(id) {
    if (!confirm('Supprimer cette prestation ?')) return;
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <>
      {error && (
        <div role="alert" style={{ background: '#1c1917', border: '1px solid #dc2626', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fca5a5' }}>
          <span>{error}</span>
          <button onClick={() => refetch()} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Réessayer</button>
        </div>
      )}
      <div className="page-header">
        <h2 className="page-title">Prestations</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setModal('create')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Ajouter
        </button>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="empty-state">Chargement...</div>
        ) : isMobile ? (
          <div className="mob-card-list">
            {services.map((s) => (
              <div key={s.id} className="mob-card-item" onClick={() => setModal(s)} style={{ flexWrap: 'wrap' }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: s.color || '#22c55e', flexShrink: 0, border: '1px solid rgba(var(--overlay),0.1)' }} />
                <div className="mob-card-left">
                  <div className="mob-card-title">{s.name}</div>
                  <div className="mob-card-sub">{formatPrice(s.price)} · {s.duration} min{s.duration_saturday ? ` (sam ${s.duration_saturday})` : ''}</div>
                </div>
                <div className="mob-card-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`badge badge-${s.is_active ? 'active' : 'inactive'}`} style={{ fontSize: 9 }}>
                    {s.is_active ? 'Actif' : 'Inactif'}
                  </span>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', padding: 4 }} onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Prestation</th>
                  <th>Prix</th>
                  <th>Durée</th>
                  <th>Barbers</th>
                  <th>Statut</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 4, background: s.color || '#22c55e', flexShrink: 0, border: '1px solid rgba(var(--overlay),0.1)' }} />
                        <div>
                          {s.name}
                          {s.description && (
                            <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 1, lineHeight: 1.3 }}>{s.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>{formatPrice(s.price)}</td>
                    <td>{s.duration} min{s.duration_saturday ? ` (sam ${s.duration_saturday})` : ''}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {s.barbers?.map((b) => b.name).join(', ') || '-'}
                    </td>
                    <td>
                      <span className={`badge badge-${s.is_active ? 'active' : 'inactive'}`}>
                        {s.is_active ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setModal(s)}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(s.id)}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
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

      {modal && (
        <ServiceModal
          service={modal === 'create' ? null : modal}
          barbers={barbers}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function ServiceModal({ service, barbers, onClose }) {
  const isEdit = !!service;
  const createMutation = useCreateService();
  const updateMutation = useUpdateService();
  const [name, setName] = useState(service?.name || '');
  const [description, setDescription] = useState(service?.description || '');
  const [price, setPrice] = useState(service ? (service.price / 100).toFixed(2) : '');
  const [duration, setDuration] = useState(service?.duration || 30);
  const [durationSaturday, setDurationSaturday] = useState(service?.duration_saturday || '');
  const [color, setColor] = useState(service?.color || '#22c55e');
  const [isActive, setIsActive] = useState(service?.is_active ?? true);
  const [selectedBarbers, setSelectedBarbers] = useState(
    service?.barbers?.map((b) => b.id) || barbers.map((b) => b.id)
  );
  const [error, setError] = useState('');
  const saving = createMutation.isPending || updateMutation.isPending;

  const toggleBarber = (id) => {
    setSelectedBarbers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const body = {
      name,
      description: description || undefined,
      price: Math.round(parseFloat(price) * 100),
      duration: parseInt(duration),
      duration_saturday: durationSaturday ? parseInt(durationSaturday) : null,
      color,
      is_active: isActive,
      barber_ids: selectedBarbers,
    };

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: service.id, data: body });
      } else {
        await createMutation.mutateAsync(body);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{isEdit ? 'Modifier' : 'Nouvelle prestation'}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="form-group">
              <label className="label">Nom de la prestation</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="form-group">
              <label className="label">Description (optionnel)</label>
              <textarea
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Coupe ciseaux + tondeuse, shampoing inclus..."
                rows={2}
                style={{ resize: 'vertical', minHeight: 48, fontFamily: 'inherit' }}
              />
            </div>

            <div className="input-row">
              <div className="form-group">
                <label className="label">Prix (euros)</label>
                <input className="input" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Durée (min)</label>
                <input className="input" type="number" min="5" max="480" value={duration} onChange={(e) => setDuration(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Samedi (min)</label>
                <input className="input" type="number" min="5" max="480" value={durationSaturday} onChange={(e) => setDurationSaturday(e.target.value)} placeholder="—" />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Couleur dans le planning</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: c,
                      border: color === c ? '2px solid #fff' : '2px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.12s',
                      outline: color === c ? '2px solid rgba(var(--overlay),0.3)' : 'none',
                      outlineOffset: 1,
                    }}
                    title={c}
                  />
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="label">Barbers assignés</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {barbers.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`btn btn-sm ${selectedBarbers.includes(b.id) ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => toggleBarber(b.id)}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>

            {isEdit && (
              <div className="form-group">
                <label className="label">Statut</label>
                <button
                  type="button"
                  className={`toggle ${isActive ? 'active' : ''}`}
                  onClick={() => setIsActive(!isActive)}
                />
                <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                  {isActive ? 'Actif' : 'Inactif'}
                </span>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
