// ---------------------------------------------------------------------------
// BookingDetailModal
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { updateClient, getClientPhotos, uploadClientPhoto, deleteClientPhoto, sendNoShowSms } from '../../api';
import ProductPicker from './ProductPicker';
import { formatPrice, formatPhone, FALLBACK_COLOR, STATUS_LABELS } from './helpers';
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
  const queryClient = useQueryClient();
  const [subView, setSubView] = useState('main'); // 'main' | 'delete' | 'confirm-edit'
  const [notifyClient, setNotifyClient] = useState(false);
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

  // Unique service colors for the color picker
  const serviceColors = useMemo(() => {
    const seen = new Set();
    return services.filter((s) => s.color && !seen.has(s.color) && seen.add(s.color)).map((s) => s.color);
  }, [services]);

  // Reset service when barber changes and current service is unavailable
  useEffect(() => {
    if (editBarberId && filteredServices.length > 0 && !filteredServices.find((s) => s.id === editServiceId)) {
      setEditServiceId(filteredServices[0].id);
    }
  }, [editBarberId, filteredServices, editServiceId]);

  // Auto-set color + recalculate end time when service is manually changed
  const initialServiceId = useRef(booking.service_id || '');
  useEffect(() => {
    if (!editServiceId || editServiceId === initialServiceId.current) return;
    const svc = services.find((s) => s.id === editServiceId);
    if (svc?.color) setEditColor(svc.color);
    // Recalculate end time based on new service duration
    if (svc && editTime) {
      const [h, m] = editTime.split(':').map(Number);
      const duration = svc.duration_saturday && editDate ? (() => {
        const d = new Date(editDate + 'T00:00:00');
        return d.getDay() === 6 ? svc.duration_saturday : svc.duration;
      })() : svc.duration;
      const endMin = h * 60 + m + duration;
      setEditEndTime(`${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`);
    }
  }, [editServiceId, services]);

  // Auto-adjust end time when start time changes (keep service duration)
  const prevStartRef = useRef(initTime);
  useEffect(() => {
    if (editTime === prevStartRef.current) return;
    prevStartRef.current = editTime;
    const svc = services.find((s) => s.id === editServiceId);
    if (!svc || !editTime) return;
    const [h, m] = editTime.split(':').map(Number);
    const duration = svc.duration_saturday && editDate ? (() => {
      const d = new Date(editDate + 'T00:00:00');
      const dow = d.getDay();
      return dow === 6 ? svc.duration_saturday : svc.duration;
    })() : svc.duration;
    const endMin = h * 60 + m + duration;
    const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
    const endM = String(endMin % 60).padStart(2, '0');
    setEditEndTime(`${endH}:${endM}`);
  }, [editTime, editServiceId, editDate, services]);

  // Dirty detection
  const isDirty = editDate !== bookingDateStr || editTime !== initTime || editEndTime !== initEndTime || editBarberId !== (booking.barber_id || '') || editServiceId !== (booking.service_id || '') || editColor !== initColor;

  // Notes state
  const [notes, setNotes] = useState(booking?.client_notes || '');
  const [notesSaving, setNotesSaving] = useState(false);
  const notesDirty = notes !== (booking?.client_notes || '');

  // Photos state
  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [fullscreenPhoto, setFullscreenPhoto] = useState(null);
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (!booking?.client_id) return;
    setPhotosLoading(true);
    getClientPhotos(booking.client_id)
      .then(setPhotos)
      .catch(() => {})
      .finally(() => setPhotosLoading(false));
  }, [booking?.client_id]);

  async function compressPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('Image illisible'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError('');
    setPhotoUploading(true);
    try {
      const compressed = await compressPhoto(file);
      setPendingPhoto(compressed);
    } catch (err) {
      setPhotoError(err.message || 'Erreur image');
    } finally {
      setPhotoUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  async function savePendingPhoto() {
    if (!pendingPhoto) return;
    setPhotoError('');
    setPhotoUploading(true);
    try {
      await uploadClientPhoto(booking.client_id, pendingPhoto);
      const updated = await getClientPhotos(booking.client_id);
      setPhotos(updated);
      setPendingPhoto(null);
    } catch (err) {
      setPhotoError(err.message || 'Erreur upload');
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handlePhotoDelete(photoId) {
    try {
      await deleteClientPhoto(booking.client_id, photoId);
      setPhotos(prev => prev.filter(p => p.id !== photoId));
      setFullscreenPhoto(null);
    } catch { /* silent */ }
  }

  async function saveNotes() {
    if (!booking?.client_id || !notesDirty) return;
    setNotesSaving(true);
    try {
      await updateClient(booking.client_id, { notes });
      onNotesUpdated?.(booking.client_id, notes);
    } catch { /* silent */ }
    setNotesSaving(false);
  }

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

  // ---------- EDIT CONFIRMATION ----------
  if (subView === 'confirm-edit') {
    const editedBarber = barbers.find((b) => b.id === editBarberId);
    const editedService = filteredServices.find((s) => s.id === editServiceId);
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
          <div className="modal-header">
            <h3 className="modal-title" style={{ color: '#f59e0b' }}>Modifier le RDV</h3>
            <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
          </div>
          <div className="modal-body">
            <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{booking.client_first_name} {booking.client_last_name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #ccc)', marginTop: 2 }}>
                {editedService?.name || booking.service_name} — {editDate ? format(parseISO(editDate), 'EEEE d MMM', { locale: fr }) : ''} à {editTime}
              </div>
              {editedBarber && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>avec {editedBarber.name}</div>}
            </div>
            {hasEmail && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 14px', background: 'rgba(var(--overlay),0.03)', border: '1px solid rgba(var(--overlay),0.08)', borderRadius: 8 }}>
                <input type="checkbox" checked={notifyClient} onChange={(e) => setNotifyClient(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#3b82f6', cursor: 'pointer' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Prévenir le client par email</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{booking.client_email}</div>
                </div>
              </label>
            )}
            {saveError && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>{saveError}</div>
            )}
          </div>
          <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving} style={{ minWidth: 180 }}>
              {saving ? 'Enregistrement...' : 'Confirmer la modification'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSubView('main')}>Retour</button>
          </div>
        </div>
      </div>
    );
  }

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

          {/* CLIENT STATS */}
          {(booking.client_visit_count > 0 || booking.client_no_show_count > 0) && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 4,
              padding: '10px 14px',
              background: 'rgba(var(--overlay),0.03)',
              border: '1px solid rgba(var(--overlay),0.05)',
              borderRadius: 10,
            }}>
              {booking.client_visit_count > 0 && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                  padding: '3px 10px', borderRadius: 6,
                  background: 'rgba(34,197,94,0.08)',
                }}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#22c55e" strokeWidth="2"><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  {booking.client_visit_count} visite{booking.client_visit_count > 1 ? 's' : ''}
                </span>
              )}
              {booking.client_no_show_count > 0 && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, fontWeight: 700,
                  color: booking.client_no_show_count >= 2 ? '#ef4444' : '#f59e0b',
                  padding: '3px 10px', borderRadius: 6,
                  background: booking.client_no_show_count >= 2 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.08)',
                }}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                  {booking.client_no_show_count} faux plan{booking.client_no_show_count > 1 ? 's' : ''}
                </span>
              )}
              {booking.client_favourite_service && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, color: 'var(--text-muted)',
                  padding: '3px 10px', borderRadius: 6,
                  background: 'rgba(var(--overlay),0.04)',
                }}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  {booking.client_favourite_service}
                </span>
              )}
            </div>
          )}

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
                {/* Produits — vente liée au RDV */}
                {(booking.status === 'confirmed' || booking.status === 'completed') && (
                  <ProductPicker booking={booking} barberId={booking.barber_id} />
                )}

                {/* Couleur — prestations uniquement */}
                {serviceColors.length > 0 && (
                <div>
                  <label className="label" style={{ fontSize: 11, marginBottom: 6, color: 'var(--text-muted)', display: 'block' }}>Couleur</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {serviceColors.map((c) => (
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
                )}
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
            <div className="bk-section-title">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Notes client
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
            {notesDirty && (
              <button className="btn btn-primary btn-sm" onClick={saveNotes} disabled={notesSaving} style={{ marginTop: 8 }}>
                {notesSaving ? 'Sauvegarde...' : 'Enregistrer la note'}
              </button>
            )}
          </div>

          {/* PHOTOS SECTION */}
          {booking?.client_id && (
            <div className="bk-section">
              <div className="bk-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  Photos coupe
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                  {photos.length + (pendingPhoto ? 1 : 0)}/2
                </span>
              </div>

              {photosLoading ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Chargement...</div>
              ) : (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {photos.map(photo => (
                    <div key={photo.id} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(var(--overlay),0.1)', cursor: 'pointer', flexShrink: 0 }}>
                      <img
                        src={photo.photo_data}
                        alt="Coupe client"
                        onClick={() => setFullscreenPhoto(photo)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePhotoDelete(photo.id); }}
                        style={{
                          position: 'absolute', top: 3, right: 3, width: 20, height: 20,
                          borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)',
                          color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  ))}

                  {pendingPhoto && (
                    <div style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: '2px solid rgba(59,130,246,0.5)', flexShrink: 0, opacity: 0.8 }}>
                      <img src={pendingPhoto} alt="Nouvelle photo" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <button
                        onClick={() => setPendingPhoto(null)}
                        style={{
                          position: 'absolute', top: 3, right: 3, width: 20, height: 20,
                          borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)',
                          color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  )}

                  {photos.length + (pendingPhoto ? 1 : 0) < 2 && !pendingPhoto && (
                    <label style={{
                      width: 80, height: 80, borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                      border: '2px dashed rgba(var(--overlay),0.15)', display: 'flex',
                      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 4, color: 'var(--text-muted)', fontSize: 11,
                      background: photoUploading ? 'rgba(59,130,246,0.06)' : 'transparent',
                      transition: 'all 0.2s',
                    }}>
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        disabled={photoUploading}
                        style={{ display: 'none' }}
                      />
                      {photoUploading ? (
                        <span style={{ fontSize: 11 }}>Envoi...</span>
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                          <span>Ajouter</span>
                        </>
                      )}
                    </label>
                  )}
                </div>
              )}

              {photoError && (
                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{photoError}</div>
              )}
            </div>
          )}

          {/* Fullscreen photo viewer */}
          {fullscreenPhoto && (
            <div
              onClick={() => setFullscreenPhoto(null)}
              style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
                background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'zoom-out', padding: 20,
              }}
            >
              <img
                src={fullscreenPhoto.photo_data}
                alt="Photo coupe"
                style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, objectFit: 'contain' }}
              />
              <button
                onClick={(e) => { e.stopPropagation(); handlePhotoDelete(fullscreenPhoto.id); }}
                style={{
                  position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  background: 'rgba(239,68,68,0.9)', color: '#fff', fontSize: 13,
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                Supprimer la photo
              </button>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="modal-footer bk-footer-actions" style={{ gap: 8 }}>
          {isDirty && (
            <button className="btn btn-primary btn-sm btn-save" onClick={() => { setNotifyClient(false); setSubView('confirm-edit'); }} style={{ marginLeft: 'auto' }}>
              Enregistrer
            </button>
          )}
          {pendingPhoto && (
            <button className="btn btn-primary btn-sm" onClick={savePendingPhoto} disabled={photoUploading}>
              {photoUploading ? 'Envoi...' : 'Enregistrer la photo'}
            </button>
          )}
          {(booking.status === 'confirmed' || booking.status === 'completed') && (
            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--warning, #f59e0b)' }} onClick={() => onStatusChange(booking.id, 'no_show')}>Faux plan</button>
          )}
          {booking.status === 'no_show' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => onStatusChange(booking.id, 'completed')}>Faux plan payé</button>
              <button
                className="btn btn-secondary btn-sm"
                style={{ color: booking.no_show_sms_sent ? '#22c55e' : '#f59e0b' }}
                disabled={booking.no_show_sms_sent}
                onClick={async () => {
                  if (!confirm('Envoyer le SMS faux plan au client ?')) return;
                  try {
                    await sendNoShowSms(booking.id);
                    queryClient.invalidateQueries({ queryKey: ['bookings'] });
                  } catch (e) { alert(e.message); }
                }}
              >
                {booking.no_show_sms_sent ? '✓ SMS envoyé' : 'SMS faux plan'}
              </button>
            </>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => { setNotifyClient(false); setSubView('delete'); }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}
