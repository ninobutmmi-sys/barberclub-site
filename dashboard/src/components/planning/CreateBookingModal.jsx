// ---------------------------------------------------------------------------
// CreateBookingModal
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import { getClients, createBooking } from '../../api';
import { FALLBACK_COLOR, COLOR_PALETTE } from './helpers';
import { CloseIcon } from './Icons';

export default function CreateBookingModal({ barbers, services, onClose, onCreated, initialDate, initialTime, initialBarberId }) {
  const [barberId, setBarberId] = useState(initialBarberId || (barbers[0]?.id ?? ''));

  // Filter services by selected barber
  const filteredServices = useMemo(() => {
    if (!barberId) return services;
    return services.filter((s) => s.barbers && s.barbers.some((b) => b.id === barberId));
  }, [services, barberId]);

  const [serviceId, setServiceId] = useState(filteredServices[0]?.id ?? '');
  const [date, setDate] = useState(initialDate || format(new Date(), 'yyyy-MM-dd'));
  const [time, setTime] = useState(initialTime || '09:00');
  const selectedService = filteredServices.find((s) => s.id === serviceId) || filteredServices[0];
  const [duration, setDuration] = useState(selectedService?.duration || 30);
  const [bookingColor, setBookingColor] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Recurrence state
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState('biweekly');
  const [recurrenceEndType, setRecurrenceEndType] = useState('occurrences');
  const [recurrenceOccurrences, setRecurrenceOccurrences] = useState(6);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [recurrenceResult, setRecurrenceResult] = useState(null); // { created, skipped }

  // Client autocomplete state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const searchTimerRef = useRef(null);
  const searchWrapperRef = useRef(null);

  // Reset service when barber changes (if current service not available)
  useEffect(() => {
    if (filteredServices.length > 0 && !filteredServices.find((s) => s.id === serviceId)) {
      setServiceId(filteredServices[0].id);
    }
  }, [barberId, filteredServices]);

  // Update duration + color when service changes
  useEffect(() => {
    const svc = filteredServices.find((s) => s.id === serviceId);
    if (svc) {
      setDuration(svc.duration);
      if (!bookingColor) setBookingColor(svc.color || FALLBACK_COLOR);
    }
  }, [serviceId, filteredServices]);

  // Close search dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup timer
  useEffect(() => {
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, []);

  function handleSearchChange(e) {
    const value = e.target.value;
    setSearchQuery(value);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!value || value.trim().length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const data = await getClients({ search: value.trim(), limit: 5 });
        setSearchResults(data.clients || []);
        setSearchOpen(true);
      } catch { setSearchResults([]); }
      setSearchLoading(false);
    }, 300);
  }

  function handleSelectClient(client) {
    setSelectedClient(client);
    setFirstName(client.first_name || '');
    setLastName(client.last_name || '');
    setPhone(client.phone || '');
    setEmail(client.email || '');
    setSearchQuery('');
    setSearchResults([]);
    setSearchOpen(false);
  }

  function handleClearClient() {
    setSelectedClient(null);
    setFirstName('');
    setLastName('');
    setPhone('');
    setEmail('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        barber_id: barberId, service_id: serviceId, date, start_time: time,
        duration, first_name: firstName, last_name: lastName, phone: phone.replace(/\s/g, ''), email: email || undefined,
        color: bookingColor || undefined,
      };

      if (repeatEnabled) {
        const recurrence = { type: recurrenceType, end_type: recurrenceEndType };
        if (recurrenceEndType === 'occurrences') recurrence.occurrences = recurrenceOccurrences;
        else recurrence.end_date = recurrenceEndDate;
        payload.recurrence = recurrence;
      }

      const result = await createBooking(payload);

      if (repeatEnabled && result.created) {
        setRecurrenceResult(result);
        setSaving(false);
      } else {
        onCreated();
      }
    } catch (err) { setError(err.message); setSaving(false); }
  }

  const RECURRENCE_LABELS = { weekly: 'Toutes les semaines', biweekly: 'Toutes les 2 semaines', monthly: 'Tous les mois' };

  // Helper: format price
  const priceDisplay = selectedService ? (selectedService.price / 100).toFixed(2).replace('.', ',') + ' \u20ac' : null;

  // ---------- RECURRENCE RESULT VIEW ----------
  if (recurrenceResult) {
    const { created, skipped } = recurrenceResult;
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="bk-modal" onClick={(e) => e.stopPropagation()}>
          <div className="bk-header">
            <h3>
              <span className="bk-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              </span>
              RDV r\u00e9currents cr\u00e9\u00e9s
            </h3>
            <button className="btn-ghost" onClick={() => { setRecurrenceResult(null); onCreated(); }}><CloseIcon /></button>
          </div>

          <div style={{ padding: '0 24px 16px' }}>
            <div className="bk-client-badge" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.03))' }}>
              <div className="bk-dot" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{created.length} rendez-vous cr\u00e9\u00e9{created.length > 1 ? 's' : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{RECURRENCE_LABELS[recurrenceType]}</div>
              </div>
            </div>

            {skipped.length > 0 && (
              <div style={{ padding: '10px 14px', background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.03))', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', marginBottom: 6 }}>
                  {skipped.length} date{skipped.length > 1 ? 's' : ''} ignor\u00e9e{skipped.length > 1 ? 's' : ''} (cr\u00e9neaux d\u00e9j\u00e0 pris)
                </div>
                {skipped.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
                    {s.date} — {s.reason}
                  </div>
                ))}
              </div>
            )}

            {created.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {created.map((bk, i) => {
                  const d = typeof bk.date === 'string' ? bk.date.slice(0, 10) : bk.date;
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(var(--overlay),0.04)', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{d}</span>
                      <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 800 }}>{bk.start_time?.slice(0, 5)} - {bk.end_time?.slice(0, 5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bk-footer" style={{ justifyContent: 'flex-end' }}>
            <button className="bk-btn-create" onClick={() => { setRecurrenceResult(null); onCreated(); }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              Fermer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bk-header">
          <h3>
            <span className="bk-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </span>
            Nouveau rendez-vous
          </h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="bk-error" role="alert">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              {error}
            </div>
          )}

          {/* ---- Section RDV ---- */}
          <div className="bk-section">
            <div className="bk-section-label">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Rendez-vous
            </div>

            {/* Barber chips */}
            <div className="bk-barbers">
              {barbers.map((b) => (
                <div
                  key={b.id}
                  className={`bk-barber-chip${barberId === b.id ? ' active' : ''}`}
                  onClick={() => setBarberId(b.id)}
                >
                  <div className="bk-avatar">{b.name.charAt(0).toUpperCase()}</div>
                  {b.name}
                </div>
              ))}
            </div>

            {/* Service */}
            <div className="bk-field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Prestation
                {selectedService?.color && (
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: selectedService.color, border: '2px solid rgba(255,255,255,0.15)', flexShrink: 0 }} />
                )}
              </label>
              <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.duration}min</option>)}
              </select>
            </div>

            {/* Date / Heure / Dur\u00e9e */}
            <div className="bk-grid-3">
              <div className="bk-field">
                <label>Date</label>
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="bk-field">
                <label>Heure</label>
                <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} min="08:00" max="20:00" required />
              </div>
              <div className="bk-field">
                <label>Dur\u00e9e (min)</label>
                <input className="input" type="number" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 0)} min="5" step="5" required />
              </div>
            </div>

            {/* Color picker */}
            <div className="bk-field" style={{ marginTop: 6 }}>
              <label>Couleur</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {COLOR_PALETTE.map((c) => (
                  <div
                    key={c}
                    onClick={() => setBookingColor(c)}
                    style={{
                      width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer',
                      border: bookingColor === c ? '2px solid #fff' : '2px solid transparent',
                      boxShadow: bookingColor === c ? `0 0 0 1px ${c}` : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ---- Recurrence ---- */}
          <div style={{ padding: '0 24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0' }}>
              <div
                className={`bk-toggle ${repeatEnabled ? 'on' : 'off'}`}
                onClick={(e) => { e.preventDefault(); setRepeatEnabled(!repeatEnabled); }}
              >
                <div className="bk-knob" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>R\u00e9p\u00e9ter</span>
              {repeatEnabled && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                  ({RECURRENCE_LABELS[recurrenceType]})
                </span>
              )}
            </label>

            {repeatEnabled && (
              <div className="bk-recurrence-box" style={{ marginTop: 10 }}>
                <div className="bk-field" style={{ marginBottom: 10 }}>
                  <label>Fr\u00e9quence</label>
                  <select className="input" value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value)}>
                    <option value="weekly">Toutes les semaines</option>
                    <option value="biweekly">Toutes les 2 semaines</option>
                    <option value="monthly">Tous les mois</option>
                  </select>
                </div>
                <div className="bk-grid-2">
                  <div className="bk-field" style={{ marginBottom: 0 }}>
                    <label>Fin</label>
                    <select className="input" value={recurrenceEndType} onChange={(e) => setRecurrenceEndType(e.target.value)}>
                      <option value="occurrences">Apr\u00e8s X s\u00e9ances</option>
                      <option value="end_date">\u00c0 une date</option>
                    </select>
                  </div>
                  <div className="bk-field" style={{ marginBottom: 0 }}>
                    {recurrenceEndType === 'occurrences' ? (
                      <>
                        <label>Nb de s\u00e9ances</label>
                        <input className="input" type="number" value={recurrenceOccurrences} onChange={(e) => setRecurrenceOccurrences(Math.max(2, Math.min(52, parseInt(e.target.value) || 2)))} min="2" max="52" />
                      </>
                    ) : (
                      <>
                        <label>Date de fin</label>
                        <input className="input" type="date" value={recurrenceEndDate} onChange={(e) => setRecurrenceEndDate(e.target.value)} min={date} required={recurrenceEndType === 'end_date'} />
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bk-divider" />

          {/* ---- Section Client ---- */}
          <div className="bk-section">
            <div className="bk-section-label">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Client
            </div>

            {/* Autocomplete search */}
            {!selectedClient && (
              <div ref={searchWrapperRef} style={{ position: 'relative', marginBottom: 14 }}>
                <div className="bk-field" style={{ marginBottom: 0 }}>
                  <label>Rechercher un client existant</label>
                  <div style={{ position: 'relative' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                      className="input"
                      value={searchQuery}
                      onChange={handleSearchChange}
                      placeholder="Nom, pr\u00e9nom ou t\u00e9l\u00e9phone..."
                      onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); }}
                      style={{ paddingLeft: 32 }}
                    />
                    {searchLoading && (
                      <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
                        <div style={{ width: 14, height: 14, border: '2px solid rgba(var(--overlay),0.1)', borderTopColor: 'var(--text-secondary)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                      </div>
                    )}
                  </div>
                </div>
                {searchOpen && searchResults.length > 0 && (
                  <div className="bk-search-results">
                    {searchResults.map((c) => (
                      <div key={c.id} className="bk-search-item" onClick={() => handleSelectClient(c)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, rgba(var(--overlay),0.08), rgba(var(--overlay),0.03))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', flexShrink: 0 }}>
                            {(c.first_name || '?').charAt(0).toUpperCase()}{(c.last_name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.first_name} {c.last_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.phone}{c.email ? ` \u00b7 ${c.email}` : ''}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {searchOpen && searchQuery.trim().length >= 2 && searchResults.length === 0 && !searchLoading && (
                  <div className="bk-search-results" style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
                    Aucun client trouv\u00e9
                  </div>
                )}
              </div>
            )}

            {/* Selected client badge */}
            {selectedClient && (
              <div className="bk-client-badge">
                <div className="bk-dot" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{selectedClient.first_name} {selectedClient.last_name}</div>
                  {selectedClient.phone && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{selectedClient.phone}</div>}
                </div>
                <button type="button" onClick={handleClearClient} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px', transition: 'color 0.15s' }} onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}>&times;</button>
              </div>
            )}

            <div className="bk-grid-2">
              <div className="bk-field">
                <label>Pr\u00e9nom</label>
                <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required readOnly={!!selectedClient} style={selectedClient ? { opacity: 0.5 } : undefined} />
              </div>
              <div className="bk-field">
                <label>Nom</label>
                <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required readOnly={!!selectedClient} style={selectedClient ? { opacity: 0.5 } : undefined} />
              </div>
            </div>
            <div className="bk-grid-2">
              <div className="bk-field">
                <label>T\u00e9l\u00e9phone</label>
                <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required readOnly={!!selectedClient} style={selectedClient ? { opacity: 0.5 } : undefined} />
              </div>
              <div className="bk-field">
                <label>Email <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optionnel)</span></label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={!!selectedClient} style={selectedClient ? { opacity: 0.5 } : undefined} />
              </div>
            </div>
          </div>

          {/* ---- Footer with price + actions ---- */}
          <div className="bk-footer">
            <div>
              {priceDisplay && (
                <span className="bk-price">{priceDisplay}<small>\u00b7 {duration}min</small></span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="bk-btn-cancel" onClick={onClose}>Annuler</button>
              <button type="submit" className="bk-btn-create" disabled={saving}>
                {saving ? (
                  <>
                    <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                    Cr\u00e9ation...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    {repeatEnabled ? 'Cr\u00e9er la s\u00e9rie' : 'Cr\u00e9er le RDV'}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
