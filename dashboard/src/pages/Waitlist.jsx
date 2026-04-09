import { useState, useRef, useEffect, useCallback } from 'react';
import useMobile from '../hooks/useMobile';
import {
  useWaitlist, useWaitlistCount, useAddToWaitlist, useUpdateWaitlistEntry, useDeleteWaitlistEntry,
  useNotifyWaitlistSms, useBarbers, useServices,
} from '../hooks/useApi';
import CreateBookingModal from '../components/planning/CreateBookingModal';
import { formatPhoneWithFlag } from '../utils/phone';

// ---- Icons ----
const IconPlus = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const IconSms = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
const IconPhone = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
const IconTrash = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>;
const IconCalendar = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 13, height: 13 }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
const IconClock = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 13, height: 13 }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
const IconClipboard = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48, color: 'var(--text-muted)', marginBottom: 12 }}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>;
const IconBooking = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatSlot(start, end) {
  if (!start) return 'Toute la journée';
  return `${start.slice(0, 5)} – ${end?.slice(0, 5) || '?'}`;
}

function buildSmsPreview(entry) {
  const dateStr = new Date(entry.preferred_date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const firstName = (entry.client_name || '').split(/\s+/)[0];
  return `BarberClub - Bonne nouvelle ${firstName} ! Un creneau s'est libere le ${dateStr} avec ${entry.barber_name} pour ${entry.service_name}. Reservez vite au salon ou appelez-nous.`;
}

export default function Waitlist() {
  const isMobile = useMobile();
  const [addModal, setAddModal] = useState(false);
  const [filter, setFilter] = useState('waiting');
  const [bookingEntry, setBookingEntry] = useState(null);
  const [smsPreview, setSmsPreview] = useState(null); // entry to preview SMS for
  const [toast, setToast] = useState(null);

  const waitlistQuery = useWaitlist(filter === 'all' ? {} : { status: 'waiting' });
  const waitlistCountQuery = useWaitlistCount();
  const barbersQuery = useBarbers();
  const servicesQuery = useServices();

  const waitlist = waitlistQuery.data || [];
  const waitlistCount = waitlistCountQuery.data?.count ?? 0;
  const barbers = (barbersQuery.data || []).filter(b => b.is_active);
  const services = servicesQuery.data || [];

  const deleteMutation = useDeleteWaitlistEntry();
  const updateMutation = useUpdateWaitlistEntry();
  const notifySms = useNotifyWaitlistSms();

  const toastTimer = useRef(null);
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  async function handleDelete(id) {
    if (!confirm('Retirer de la liste d\'attente ?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      showToast('Retiré de la liste');
    } catch (err) { showToast(err.message, 'error'); }
  }

  function handleNotify(entry) {
    setSmsPreview(entry);
  }

  async function confirmSendSms() {
    if (!smsPreview) return;
    try {
      await notifySms.mutateAsync(smsPreview.id);
      showToast(`SMS envoyé à ${smsPreview.client_name}`);
    } catch (err) { showToast(err.message, 'error'); }
    setSmsPreview(null);
  }

  function handleBooked(entry) {
    setBookingEntry(entry);
  }

  async function handleBookingCreated() {
    if (bookingEntry) {
      try {
        await updateMutation.mutateAsync({ id: bookingEntry.id, data: { status: 'booked' } });
      } catch {}
    }
    setBookingEntry(null);
  }

  const statusLabel = { waiting: 'En attente', notified: 'Notifié', booked: 'Réservé', expired: 'Expiré' };
  const statusColor = { waiting: '#3b82f6', notified: '#f59e0b', booked: '#22c55e', expired: 'var(--text-muted)' };

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
          <IconPlus /> Ajouter
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
            <IconClipboard />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Aucun client en attente</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ajoutez un client quand un créneau est complet</div>
          </div>
        ) : isMobile ? (
          /* ======== MOBILE ======== */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {waitlist.map((w) => (
              <div key={w.id} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
                padding: '14px 16px', transition: 'background 0.2s',
              }}>
                {/* Header: name + status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{w.client_name}</div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                    background: `${statusColor[w.status] || 'var(--text-muted)'}20`,
                    color: statusColor[w.status] || 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>
                    {statusLabel[w.status] || w.status}
                  </span>
                </div>

                {/* Phone */}
                {w.client_phone && (
                  <a href={`tel:${w.client_phone}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none',
                    marginBottom: 10,
                  }}>
                    <IconPhone /> {formatPhoneWithFlag(w.client_phone)}
                  </a>
                )}

                {/* Details */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <IconCalendar /> {formatDate(w.preferred_date)}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <IconClock /> {formatSlot(w.preferred_time_start, w.preferred_time_end)}
                  </span>
                  {w.service_name && <span>{w.service_name}</span>}
                  {w.barber_name && <span>{w.barber_name}</span>}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {w.status === 'waiting' && (
                    <>
                      <button
                        onClick={() => handleNotify(w)}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                          background: '#3b82f6', color: '#fff', fontSize: 13, fontWeight: 600,
                          fontFamily: 'var(--font)',
                        }}
                      >
                        <IconSms /> SMS
                      </button>
                      <a
                        href={`tel:${w.client_phone}`}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                          background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontSize: 13, fontWeight: 600,
                          textDecoration: 'none', fontFamily: 'var(--font)',
                        }}
                      >
                        <IconPhone /> Appeler
                      </a>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(w.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 40, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                      flexShrink: 0,
                    }}
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ======== DESKTOP ======== */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {waitlist.map((w) => (
              <div key={w.id} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
                padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16,
                transition: 'background 0.2s',
              }}>
                {/* Status dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: statusColor[w.status] || 'var(--text-muted)',
                }} />

                {/* Client info */}
                <div style={{ minWidth: 160, flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{w.client_name}</div>
                  {w.client_phone && (
                    <a href={`tel:${w.client_phone}`} style={{
                      fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                      <IconPhone /> {formatPhoneWithFlag(w.client_phone)}
                    </a>
                  )}
                </div>

                {/* Details */}
                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <IconCalendar /> {formatDate(w.preferred_date)}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <IconClock /> {formatSlot(w.preferred_time_start, w.preferred_time_end)}
                  </span>
                  {w.service_name && <span style={{ color: 'var(--text-muted)' }}>{w.service_name}</span>}
                  {w.barber_name && <span style={{ color: 'var(--text-muted)' }}>{w.barber_name}</span>}
                </div>

                {/* Status badge */}
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, flexShrink: 0,
                  background: `${statusColor[w.status] || 'var(--text-muted)'}15`,
                  color: statusColor[w.status] || 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {statusLabel[w.status] || w.status}
                </span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {w.status === 'waiting' && (
                    <>
                      <button
                        className="btn btn-sm"
                        onClick={() => handleNotify(w)}
                        title="Envoyer SMS"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '6px 12px', fontSize: 12, fontWeight: 600,
                          background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
                          cursor: 'pointer',
                        }}
                      >
                        <IconSms /> SMS
                      </button>
                      <a
                        href={`tel:${w.client_phone}`}
                        title="Appeler"
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 34, height: 34, borderRadius: 8, textDecoration: 'none',
                          background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                        }}
                      >
                        <IconPhone />
                      </a>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleBooked(w)}
                        title="Créer réservation"
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 34, height: 34, borderRadius: 8, padding: 0,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <IconBooking />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(w.id)}
                    title="Supprimer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 34, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                    }}
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            ))}
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

      {bookingEntry && (
        <CreateBookingModal
          barbers={barbers}
          services={services}
          onClose={() => setBookingEntry(null)}
          onCreated={handleBookingCreated}
          initialDate={bookingEntry.preferred_date}
          initialTime={bookingEntry.preferred_time_start?.slice(0, 5) || '09:00'}
          initialBarberId={bookingEntry.barber_id}
          initialServiceId={bookingEntry.service_id}
          initialFirstName={bookingEntry.client_name?.split(/\s+/)[0] || ''}
          initialLastName={bookingEntry.client_name?.split(/\s+/).slice(1).join(' ') || ''}
          initialPhone={bookingEntry.client_phone}
        />
      )}

      {/* SMS Preview Modal */}
      {smsPreview && (
        <div className="modal-backdrop" onClick={() => setSmsPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3 className="modal-title">Aperçu SMS</h3>
              <button className="btn-ghost" onClick={() => setSmsPreview(null)}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Destinataire : <strong style={{ color: 'var(--text)' }}>{smsPreview.client_name}</strong> — {smsPreview.client_phone}
              </div>
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12,
                padding: 16, fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)',
                fontFamily: 'monospace', whiteSpace: 'pre-wrap',
              }}>
                {buildSmsPreview(smsPreview)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'right' }}>
                {buildSmsPreview(smsPreview).length} caractères — {buildSmsPreview(smsPreview).length <= 160 ? '1 SMS' : '2 SMS'}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setSmsPreview(null)}>Annuler</button>
              <button
                className="btn btn-sm"
                style={{ background: '#3b82f6', color: '#fff', border: 'none' }}
                onClick={confirmSendSms}
                disabled={notifySms.isPending}
              >
                {notifySms.isPending ? 'Envoi...' : 'Envoyer le SMS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
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
