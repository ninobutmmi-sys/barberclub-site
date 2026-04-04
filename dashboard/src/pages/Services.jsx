import { useState, useEffect, useMemo } from 'react';
import useMobile from '../hooks/useMobile';
import { useServices, useBarbers, useCreateService, useUpdateService, useDeleteService, useServiceRestrictions, useUpdateServiceRestrictions } from '../hooks/useApi';
import { formatPrice } from '../utils/format';
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
                  {s.admin_only && <span className="badge" style={{ fontSize: 9, background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}>Admin</span>}
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
                      {s.admin_only && <span className="badge" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}>Admin</span>}
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

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function ServiceModal({ service, barbers, onClose }) {
  const isEdit = !!service;
  const createMutation = useCreateService();
  const updateMutation = useUpdateService();
  const restrictionsMutation = useUpdateServiceRestrictions();
  const { data: existingRestrictions } = useServiceRestrictions(isEdit ? service.id : null);
  const [name, setName] = useState(service?.name || '');
  const [description, setDescription] = useState(service?.description || '');
  const [price, setPrice] = useState(service ? (service.price / 100).toFixed(2) : '');
  const [duration, setDuration] = useState(service?.duration || 30);
  const [durationSaturday, setDurationSaturday] = useState(service?.duration_saturday || '');
  const [color, setColor] = useState(service?.color || '#22c55e');
  const [isActive, setIsActive] = useState(service?.is_active ?? true);
  const [adminOnly, setAdminOnly] = useState(service?.admin_only ?? false);
  const [selectedBarbers, setSelectedBarbers] = useState(
    service?.barbers?.map((b) => b.id) || barbers.map((b) => b.id)
  );
  const [error, setError] = useState('');
  const [showRestrictions, setShowRestrictions] = useState(false);
  const [expandedBarber, setExpandedBarber] = useState(null);
  // restrictions state: { [barberId]: { [dayOfWeek]: { enabled, start_time, end_time } } }
  const [restrictions, setRestrictions] = useState({});
  const saving = createMutation.isPending || updateMutation.isPending || restrictionsMutation.isPending;

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // Initialize restrictions from existing data
  useEffect(() => {
    if (!existingRestrictions) return;
    const state = {};
    for (const r of existingRestrictions) {
      if (!state[r.barber_id]) state[r.barber_id] = {};
      state[r.barber_id][r.day_of_week] = {
        enabled: true,
        start_time: r.start_time?.slice(0, 5) || '',
        end_time: r.end_time?.slice(0, 5) || '',
      };
    }
    setRestrictions(state);
    if (existingRestrictions.length > 0) setShowRestrictions(true);
  }, [existingRestrictions]);

  // Barbers that have restrictions configured
  const barbersWithRestrictions = useMemo(() => {
    const ids = new Set();
    for (const [bId, days] of Object.entries(restrictions)) {
      if (Object.values(days).some(d => d.enabled)) ids.add(bId);
    }
    return ids;
  }, [restrictions]);

  const toggleBarber = (id) => {
    setSelectedBarbers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const updateRestriction = (barberId, day, field, value) => {
    setRestrictions(prev => ({
      ...prev,
      [barberId]: {
        ...(prev[barberId] || {}),
        [day]: {
          ...(prev[barberId]?.[day] || { enabled: false, start_time: '', end_time: '' }),
          [field]: value,
        },
      },
    }));
  };

  const toggleAllDays = (barberId, enable) => {
    const days = {};
    for (let d = 0; d < 7; d++) {
      days[d] = enable
        ? { enabled: true, start_time: '', end_time: '' }
        : { enabled: false, start_time: '', end_time: '' };
    }
    setRestrictions(prev => ({ ...prev, [barberId]: days }));
  };

  const clearBarberRestrictions = (barberId) => {
    setRestrictions(prev => {
      const next = { ...prev };
      delete next[barberId];
      return next;
    });
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
      admin_only: adminOnly,
      barber_ids: selectedBarbers,
    };

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: service.id, data: body });
        // Save restrictions
        const restrictionRows = [];
        for (const [barberId, days] of Object.entries(restrictions)) {
          for (const [day, config] of Object.entries(days)) {
            if (!config.enabled) continue;
            restrictionRows.push({
              barber_id: barberId,
              day_of_week: parseInt(day),
              start_time: config.start_time || null,
              end_time: config.end_time || null,
            });
          }
        }
        await restrictionsMutation.mutateAsync({ id: service.id, restrictions: restrictionRows });
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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: isEdit && showRestrictions ? 580 : 480 }}>
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
                    {barbersWithRestrictions.has(b.id) && (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 4 }}>
                        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                      </svg>
                    )}
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
            <div className="form-group">
              <label className="label">Admin seulement</label>
              <button
                type="button"
                className={`toggle ${adminOnly ? 'active' : ''}`}
                onClick={() => setAdminOnly(!adminOnly)}
              />
              <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                {adminOnly ? 'Masqué côté client' : 'Visible côté client'}
              </span>
            </div>

            {/* === Restrictions Section (edit only) === */}
            {isEdit && (
              <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <button
                  type="button"
                  onClick={() => setShowRestrictions(!showRestrictions)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer',
                    padding: '4px 0', fontSize: 13, fontWeight: 600,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ transition: 'transform 0.2s', transform: showRestrictions ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  >
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                  Disponibilité par barber
                  {barbersWithRestrictions.size > 0 && (
                    <span style={{
                      fontSize: 10, background: 'var(--warning)', color: '#000',
                      borderRadius: 10, padding: '1px 7px', fontWeight: 700,
                    }}>
                      {barbersWithRestrictions.size}
                    </span>
                  )}
                </button>

                {showRestrictions && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 4px' }}>
                      Par défaut, un barber peut faire cette prestation à tout moment. Configurez des restrictions pour limiter les jours/horaires.
                    </p>
                    {barbers.filter(b => selectedBarbers.includes(b.id)).map((barber) => {
                      const isExpanded = expandedBarber === barber.id;
                      const hasRestrictions = barbersWithRestrictions.has(barber.id);
                      return (
                        <div key={barber.id} style={{
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          overflow: 'hidden',
                          background: hasRestrictions ? 'rgba(245,158,11,0.04)' : 'transparent',
                        }}>
                          <button
                            type="button"
                            onClick={() => setExpandedBarber(isExpanded ? null : barber.id)}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              width: '100%', padding: '10px 12px', background: 'none', border: 'none',
                              color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <svg
                                viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
                                style={{ transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                              >
                                <polyline points="9 18 15 12 9 6"/>
                              </svg>
                              {barber.name}
                            </span>
                            {hasRestrictions ? (
                              <span style={{ fontSize: 11, color: 'var(--warning)' }}>
                                Restreint
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Aucune restriction
                              </span>
                            )}
                          </button>
                          {isExpanded && (
                            <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', gap: 8, padding: '8px 0 4px', justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  onClick={() => toggleAllDays(barber.id, true)}
                                  style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                                >
                                  Tout cocher
                                </button>
                                <button
                                  type="button"
                                  onClick={() => clearBarberRestrictions(barber.id)}
                                  style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                                >
                                  Effacer
                                </button>
                              </div>
                              {DAY_NAMES.map((dayName, dayIdx) => {
                                const dayConfig = restrictions[barber.id]?.[dayIdx] || { enabled: false, start_time: '', end_time: '' };
                                return (
                                  <div key={dayIdx} style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '5px 0',
                                    borderBottom: dayIdx < 6 ? '1px solid rgba(var(--overlay),0.04)' : 'none',
                                  }}>
                                    <label style={{
                                      display: 'flex', alignItems: 'center', gap: 6,
                                      width: 60, fontSize: 12, cursor: 'pointer', flexShrink: 0,
                                      color: dayConfig.enabled ? 'var(--text)' : 'var(--text-muted)',
                                    }}>
                                      <input
                                        type="checkbox"
                                        checked={dayConfig.enabled}
                                        onChange={(e) => updateRestriction(barber.id, dayIdx, 'enabled', e.target.checked)}
                                        style={{ accentColor: 'var(--warning)' }}
                                      />
                                      {dayName}
                                    </label>
                                    {dayConfig.enabled && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                                        <input
                                          type="time"
                                          value={dayConfig.start_time}
                                          onChange={(e) => updateRestriction(barber.id, dayIdx, 'start_time', e.target.value)}
                                          placeholder="—"
                                          style={{
                                            background: 'var(--bg-input)', border: '1px solid var(--border)',
                                            borderRadius: 6, color: 'var(--text)', padding: '4px 6px',
                                            fontSize: 12, width: 90, fontFamily: 'inherit',
                                          }}
                                        />
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→</span>
                                        <input
                                          type="time"
                                          value={dayConfig.end_time}
                                          onChange={(e) => updateRestriction(barber.id, dayIdx, 'end_time', e.target.value)}
                                          placeholder="—"
                                          style={{
                                            background: 'var(--bg-input)', border: '1px solid var(--border)',
                                            borderRadius: 6, color: 'var(--text)', padding: '4px 6px',
                                            fontSize: 12, width: 90, fontFamily: 'inherit',
                                          }}
                                        />
                                        <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                          {dayConfig.start_time && dayConfig.end_time ? '' : '(toute la journée)'}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
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
