// ---------------------------------------------------------------------------
// BookingDetailModal
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { updateClient } from '../../api';
import { formatPrice, formatPhone, FALLBACK_COLOR, STATUS_LABELS, COLOR_PALETTE } from './helpers';
import { CloseIcon } from './Icons';

function DetailRow({ label, value, bold, valueStyle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid rgba(var(--overlay),0.05)' }}>
      <span style={{ color: 'var(--text-muted, #888)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, fontSize: 14, textAlign: 'right', ...valueStyle }}>{value}</span>
    </div>
  );
}

export { DetailRow };

export default function BookingDetailModal({ booking, barbers, services, onClose, onStatusChange, onDelete, onDeleteGroup, onReschedule, onNotesUpdated }) {
  const [subView, setSubView] = useState('main'); // 'main' | 'delete'
  const [notifyClient, setNotifyClient] = useState(booking?.status !== 'completed');
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (!booking) return null;

  const hasEmail = !!booking.client_email;
  const bookingDateStr = typeof booking.date === 'string' ? booking.date.slice(0, 10) : format(new Date(booking.date), 'yyyy-MM-dd');
  const initTime = booking.start_time?.slice(0, 5) || '09:00';
  const initColor = booking.booking_color || booking.service_color || FALLBACK_COLOR;
  const isEditable = booking.status === 'confirmed' || booking.status === 'completed';

  // Editable fields — initialized with current booking values
  const [editDate, setEditDate] = useState(bookingDateStr);
  const [editTime, setEditTime] = useState(initTime);
  const [editBarberId, setEditBarberId] = useState(booking.barber_id || '');
  const [editServiceId, setEditServiceId] = useState(booking.service_id || '');
  const initEndTime = booking.end_time?.slice(0, 5) || '';
  const [editEndTime, setEditEndTime] = useState(initEndTime);
  const [editColor, setEditColor] = useState(initColor);

  // Filter services by selected barber
  const filteredServices = useMemo(() => {
    if (!editBarberId) return services;
    return services.filter((s) => s.barbers && s.barbers.some((b) => b.id === editBarberId));
  }, [services, editBarberId]);

  // Reset service when barber changes and current service is unavailable
  useEffect(() => {
    if (editBarberId && filteredServices.length > 0 && !filteredServices.find((s) => s.id === editServiceId)) {
      setEditServiceId(filteredServices[0].id);
    }
  }, [editBarberId, filteredServices, editServiceId]);

  // Dirty detection
  const isDirty = editDate !== bookingDateStr || editTime !== initTime || editEndTime !== initEndTime || editBarberId !== (booking.barber_id || '') || editServiceId !== (booking.service_id || '') || editColor !== initColor;

  // Notes state
  const [notes, setNotes] = useState(booking?.client_notes || '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const noteTimerRef = useRef(null);

  function handleNotesChange(value) {
    setNotes(value);
    setNotesSaved(false);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(async () => {
      if (!booking?.client_id) return;
      setNotesSaving(true);
      try {
        await updateClient(booking.client_id, { notes: value });
        setNotesSaved(true);
        onNotesUpdated?.(booking.client_id, value);
        setTimeout(() => setNotesSaved(false), 2000);
      } catch {
        setNotesSaved(false);
        alert('Erreur lors de la sauvegarde des notes. Vérifiez votre connexion.');
      }
      setNotesSaving(false);
    }, 800);
  }

  useEffect(() => {
    return () => { if (noteTimerRef.current) clearTimeout(noteTimerRef.current); };
  }, []);

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(booking.id, notifyClient && hasEmail);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteGroup(futureOnly = false) {
    setDeleting(true);
    try {
      await onDeleteGroup(booking.recurrence_group_id, notifyClient && hasEmail, futureOnly);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    setSaveError('');
    setSaving(true);
    try {
      await onReschedule(booking.id, {
        date: editDate,
        start_time: editTime,
        end_time: editEndTime || undefined,
        barber_id: editBarberId,
        service_id: editServiceId,
        color: editColor || undefined,
        notify_client: notifyClient && hasEmail,
      });
    } catch (err) {
      setSaveError(err.message);
      setSaving(false);
    }
  }

  const sourceLabel = { online: 'En ligne', manual: 'Manuel', phone: 'Tél.', walk_in: 'Sans RDV' }[booking.source] || booking.source || '\u2013';

  // ---------- DELETE CONFIRMATION ----------
  if (subView === 'delete') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
          <div className="modal-header">
            <h3 className="modal-title" style={{ color: 'var(--danger, #ef4444)' }}>Supprimer le RDV</h3>
            <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
          </div>
          <div className="modal-body">
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{booking.client_first_name} {booking.client_last_name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #ccc)', marginTop: 2 }}>
                {booking.service_name} — {booking.date ? format(parseISO(bookingDateStr), 'EEEE d MMM', { locale: fr }) : ''} à {booking.start_time?.slice(0, 5)}
              </div>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary, #ccc)', marginBottom: 16 }}>
              Cette action est irréversible. Le créneau sera libéré.
            </p>
            {hasEmail && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 14px', background: 'rgba(var(--overlay),0.03)', border: '1px solid rgba(var(--overlay),0.08)', borderRadius: 8 }}>
                <input type="checkbox" checked={notifyClient} onChange={(e) => setNotifyClient(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#3b82f6', cursor: 'pointer' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Prévenir le client par email</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{booking.client_email}</div>
                </div>
              </label>
            )}
            {!hasEmail && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' }}>Pas d&apos;email — le client ne sera pas notifié.</div>
            )}
          </div>
          <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            {booking.recurrence_group_id && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', width: '100%' }}>
                <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>Ce RDV uniquement</button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDeleteGroup(true)} disabled={deleting}>Tous les futurs</button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDeleteGroup(false)} disabled={deleting}>Tout le groupe</button>
              </div>
            )}
            {!booking.recurrence_group_id && (
              <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Suppression...' : 'Confirmer la suppression'}
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => setSubView('main')}>Retour</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- UNIFIED DETAIL + EDIT VIEW ----------
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal booking-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Rendez-vous</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`badge badge-${booking.status}`}>{STATUS_LABELS[booking.status] || booking.status}</span>
            <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
          </div>
        </div>
        <div className="modal-body">
          {saveError && (
            <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', fontSize: 13, marginBottom: 4 }}>{saveError}</div>
          )}

          {/* CLIENT SECTION */}
          <div className="bk-section">
            <div className="bk-section-title">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Client
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>{booking.client_first_name} {booking.client_last_name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: 13, color: 'var(--text-secondary)' }}>
              {booking.client_phone && (
                <a href={`tel:${booking.client_phone.replace(/\s/g, '')}`} style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'inherit', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  {formatPhone(booking.client_phone)}
                </a>
              )}
              {booking.client_email && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  {booking.client_email}
                </span>
              )}
            </div>
          </div>

          {/* CRÉNEAU SECTION — editable if confirmed or completed */}
          <div className="bk-section">
            <div className="bk-section-title">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Créneau
            </div>
            {isEditable ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Date + Début + Fin — 3 colonnes */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 0.9fr', gap: 10 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="label" style={{ fontSize: 11, marginBottom: 5, color: 'var(--text-muted)' }}>Date</label>
                    <input className="input" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} required />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="label" style={{ fontSize: 11, marginBottom: 5, color: 'var(--text-muted)' }}>Début</label>
                    <input className="input" type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} min="08:00" max="20:30" step="300" required />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="label" style={{ fontSize: 11, marginBottom: 5, color: 'var(--text-muted)' }}>Fin</label>
                    <input className="input" type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} min="08:00" max="21:00" step="300" required />
                  </div>
                </div>
                {/* Barber + Prestation */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="label" style={{ fontSize: 11, marginBottom: 5, color: 'var(--text-muted)' }}>Barber</label>
                    <select className="input" value={editBarberId} onChange={(e) => setEditBarberId(e.target.value)} required>
                      {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="label" style={{ fontSize: 11, marginBottom: 5, color: 'var(--text-muted)' }}>Prestation</label>
                    <select className="input" value={editServiceId} onChange={(e) => setEditServiceId(e.target.value)} required>
                      {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
                {/* Couleur — intégrée dans créneau */}
                <div>
                  <label className="label" style={{ fontSize: 11, marginBottom: 6, color: 'var(--text-muted)', display: 'block' }}>Couleur</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {COLOR_PALETTE.map((c) => (
                      <div
                        key={c}
                        onClick={() => setEditColor(c)}
                        style={{
                          width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer',
                          border: editColor === c ? '2.5px solid #fff' : '2.5px solid transparent',
                          boxShadow: editColor === c ? `0 0 0 1.5px ${c}` : 'none',
                          transition: 'all 0.15s ease',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                <DetailRow label="Date" value={booking.date ? format(parseISO(bookingDateStr), 'EEEE d MMMM yyyy', { locale: fr }) : '\u2013'} />
                <DetailRow label="Horaire" value={`${booking.start_time?.slice(0, 5)} \u2013 ${booking.end_time?.slice(0, 5)}`} />
                <DetailRow label="Barber" value={booking.barber_name || '\u2013'} />
                <DetailRow label="Prestation" value={booking.service_name} bold />
              </div>
            )}
          </div>

          {/* INFOS SECTION */}
          <div className="bk-section">
            <div className="bk-section-title">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              Infos
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <DetailRow label="Prix" value={formatPrice(booking.price)} valueStyle={{ fontFamily: 'var(--font-display, Orbitron, monospace)', fontWeight: 800 }} />
              <DetailRow label="Source" value={sourceLabel} />
              {booking.created_at && (
                <DetailRow label="Créé le" value={format(new Date(booking.created_at), "d MMM yyyy 'à' HH:mm", { locale: fr })} />
              )}
            </div>
          </div>

          {/* NOTES SECTION */}
          <div className="bk-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="bk-section-title" style={{ marginBottom: 0 }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Notes client
              </div>
              {notesSaving && <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Sauvegarde...</span>}
              {notesSaved && <span style={{ fontSize: 10, color: '#22c55e' }}>Sauvegardé</span>}
            </div>
            <textarea
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Ex: Sabot 3mm sur les cotés, fondu bas..."
              style={{
                width: '100%', minHeight: 70, padding: '12px 14px', fontSize: 13,
                background: 'rgba(var(--overlay),0.04)', border: '1px solid rgba(var(--overlay),0.1)',
                borderRadius: 8, color: 'var(--text)', resize: 'vertical', lineHeight: 1.6,
                fontFamily: 'inherit', outline: 'none',
              }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(59,130,246,0.4)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'rgba(var(--overlay),0.1)'; }}
            />
          </div>

          {/* NOTIFICATION CHECKBOX — shown only if dirty and has email */}
          {isDirty && hasEmail && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '12px 14px', background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.12)', borderRadius: 10 }}>
              <input type="checkbox" checked={notifyClient} onChange={(e) => setNotifyClient(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#3b82f6', cursor: 'pointer' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Prévenir le client par email</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{booking.client_email}</div>
              </div>
            </label>
          )}
        </div>

        {/* FOOTER */}
        <div className="modal-footer bk-footer-actions" style={{ gap: 8 }}>
          {isDirty && (
            <button className="btn btn-primary btn-sm btn-save" onClick={handleSave} disabled={saving} style={{ marginLeft: 'auto' }}>
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          )}
          {booking.status === 'confirmed' && (
            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--warning, #f59e0b)' }} onClick={() => onStatusChange(booking.id, 'no_show')}>No-show</button>
          )}
          {booking.status === 'no_show' && (
            <button className="btn btn-primary btn-sm" onClick={() => onStatusChange(booking.id, 'confirmed')}>Re-confirmer</button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => { setNotifyClient(true); setSubView('delete'); }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}
