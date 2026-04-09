import { useState, useCallback, useRef, useEffect } from 'react';
import useMobile from '../hooks/useMobile';
import {
  useBarbers,
  useBarberSchedule,
  useBarberGuestDays,
  useUpdateBarber,
  useCreateBarber,
  useDeleteBarber,
  useServices,
  useUpdateBarberSchedule,
  useAddBarberOverride,
  useDeleteBarberOverride,
  useAddBarberGuestDay,
  useDeleteBarberGuestDay,
} from '../hooks/useApi';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/**
 * Format an ISO date string (YYYY-MM-DD) into a French readable date.
 * @param {string} dateStr - e.g. "2026-03-14"
 * @returns {string} e.g. "Sam. 14 mars 2026"
 */
function formatDateFr(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Inline toast-style status message shown inside a modal.
 * Auto-clears after a timeout.
 */
function InlineStatus({ status }) {
  if (!status) return null;
  const isError = status.type === 'error';
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        marginBottom: 16,
        background: isError ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
        border: `1px solid ${isError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
        color: isError ? 'var(--danger)' : 'var(--success)',
      }}
    >
      {status.message}
    </div>
  );
}

// ============================================
// Main Page
// ============================================

export default function Barbers() {
  const isMobile = useMobile();
  const updateBarber = useUpdateBarber();
  const { data: barbers = [], isLoading: loading, error, refetch } = useBarbers();
  const [editBarber, setEditBarber] = useState(null);
  const [scheduleBarber, setScheduleBarber] = useState(null);
  const [guestBarber, setGuestBarber] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      {error && (
        <div role="alert" style={{ background: '#1c1917', border: '1px solid #dc2626', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fca5a5' }}>
          <span>{error}</span>
          <button onClick={() => refetch()} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Réessayer</button>
        </div>
      )}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <h2 className="page-title" style={{ margin: 0 }}>Barbers</h2>
          {!loading && (
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
              {barbers.length} barbers · {barbers.filter(b => b.is_active).length} actifs
            </span>
          )}
        </div>
        <button
          className="btn btn-sm"
          style={{ background: 'var(--success)', color: '#000', fontWeight: 700, border: 'none' }}
          onClick={() => setShowCreate(true)}
        >
          + Ajouter
        </button>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="empty-state">Chargement...</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {barbers.map((b) => (
              <div className="card" key={b.id} style={!b.is_active ? { opacity: 0.45 } : undefined}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    marginBottom: 16,
                  }}
                >
                  {b.photo_url ? (
                    <img
                      src={b.photo_url}
                      alt={b.name}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: '2px solid var(--border)',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        background: 'rgba(var(--overlay),0.06)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 18,
                        border: '2px solid var(--border)',
                      }}
                    >
                      {b.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 15,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {b.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {b.role || 'Barber'}
                    </div>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexDirection: 'column', alignItems: 'flex-end' }}>
                    <button
                      className={`toggle ${b.is_active ? 'active' : ''}`}
                      onClick={() => updateBarber.mutateAsync({ id: b.id, data: { is_active: !b.is_active } })}
                    />
                    {b.is_guest && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#3b82f6', background: 'rgba(59,130,246,0.12)', padding: '1px 8px', borderRadius: 10 }}>
                        Invite
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginBottom: 16,
                  }}
                >
                  {b.email}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => setEditBarber(b)}
                  >
                    Modifier
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => setScheduleBarber(b)}
                  >
                    Horaires
                  </button>
                  {!b.is_guest && (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1, minWidth: 'fit-content' }}
                      onClick={() => setGuestBarber(b)}
                    >
                      Jours invite
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="barber-ghost-card" onClick={() => setShowCreate(true)}>
              <div className="ghost-icon">+</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Ajouter un barber</div>
            </div>
          </div>
        )}
      </div>

      {editBarber && (
        <EditBarberModal
          barber={editBarber}
          onClose={() => setEditBarber(null)}
        />
      )}

      {scheduleBarber && (
        <ScheduleModal
          barber={scheduleBarber}
          onClose={() => setScheduleBarber(null)}
        />
      )}

      {guestBarber && (
        <GuestDaysModal
          barber={guestBarber}
          onClose={() => setGuestBarber(null)}
        />
      )}

      {showCreate && (
        <CreateBarberModal onClose={() => setShowCreate(false)} />
      )}
    </>
  );
}

// ============================================
// Create Barber Modal (placeholder — Task 7)
// ============================================

function CreateBarberModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Nouveau barber</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="empty-state">A venir...</div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Edit Barber Modal (unchanged)
// ============================================

function EditBarberModal({ barber, onClose }) {
  const mutation = useUpdateBarber();
  const [name, setName] = useState(barber.name);
  const [role, setRole] = useState(barber.role || '');
  const [photoUrl, setPhotoUrl] = useState(barber.photo_url || '');
  const [isActive, setIsActive] = useState(barber.is_active);
  const saving = mutation.isPending;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await mutation.mutateAsync({ id: barber.id, data: { name, role, photo_url: photoUrl || null, is_active: isActive } });
      onClose();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Modifier {barber.name}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="label">Nom</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="label">Role</label>
              <input
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Barber"
              />
            </div>
            <div className="form-group">
              <label className="label">Photo URL</label>
              <input
                className="input"
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="/barbers/photo.jpg"
              />
              {photoUrl && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img
                    src={photoUrl}
                    alt={name}
                    style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Apercu</span>
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="label">Statut</label>
              <button
                type="button"
                className={`toggle ${isActive ? 'active' : ''}`}
                onClick={() => setIsActive(!isActive)}
              />
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                }}
              >
                {isActive ? 'Actif' : 'Inactif'}
              </span>
            </div>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={saving}
            >
              {saving ? '...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// Schedule & Overrides Modal
// ============================================

function ScheduleModal({ barber, onClose }) {
  const { data: rawSchedule, isLoading: loading } = useBarberSchedule(barber.id);
  const saveMutation = useUpdateBarberSchedule();
  const addOverrideMutation = useAddBarberOverride();
  const deleteOverrideMutation = useDeleteBarberOverride();

  // Local editable copy of the schedule
  const [schedule, setSchedule] = useState(null);
  const [status, setStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('schedule');
  const [ovDate, setOvDate] = useState('');
  const [ovIsDayOff, setOvIsDayOff] = useState(true);
  const [ovStartTime, setOvStartTime] = useState('09:00');
  const [ovEndTime, setOvEndTime] = useState('19:00');
  const [ovReason, setOvReason] = useState('');
  const [showOverrideForm, setShowOverrideForm] = useState(false);

  const saving = saveMutation.isPending;
  const addingOverride = addOverrideMutation.isPending;
  const overrides = rawSchedule?.overrides || [];

  // Initialize local schedule from query data
  if (rawSchedule && !schedule) {
    const sched = Array.from({ length: 7 }, (_, i) => {
      const existing = rawSchedule.weekly?.find((w) => w.day_of_week === i);
      if (existing) {
        return {
          ...existing,
          start_time: (existing.start_time || '09:00').slice(0, 5),
          end_time: (existing.end_time || '19:00').slice(0, 5),
        };
      }
      return { day_of_week: i, start_time: '09:00', end_time: '19:00', is_working: false };
    });
    setSchedule(sched);
  }

  const flashTimer = useRef(null);
  const flash = useCallback((type, message) => {
    setStatus({ type, message });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setStatus(null), 3000);
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  async function saveSchedule() {
    try {
      await saveMutation.mutateAsync({ id: barber.id, schedules: schedule });
      flash('success', 'Horaires enregistres avec succes');
    } catch (err) {
      flash('error', err.message);
    }
  }

  async function handleAddOverride(e) {
    e.preventDefault();
    try {
      await addOverrideMutation.mutateAsync({
        id: barber.id,
        data: {
          date: ovDate,
          is_day_off: ovIsDayOff,
          start_time: ovIsDayOff ? undefined : ovStartTime,
          end_time: ovIsDayOff ? undefined : ovEndTime,
          reason: ovReason || undefined,
        },
      });
      setOvDate(''); setOvIsDayOff(true); setOvStartTime('09:00'); setOvEndTime('19:00'); setOvReason('');
      setShowOverrideForm(false);
      flash('success', 'Exception ajoutee');
    } catch (err) {
      flash('error', err.message);
    }
  }

  async function removeOverride(id) {
    if (!window.confirm('Supprimer cette exception ?')) return;
    try {
      await deleteOverrideMutation.mutateAsync(id);
      flash('success', 'Exception supprimee');
    } catch (err) {
      flash('error', err.message);
    }
  }

  const updateDay = (idx, field, value) => {
    setSchedule((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s))
    );
  };

  // Styles for the tab buttons
  const tabStyle = (active) => ({
    flex: 1,
    padding: '10px 0',
    fontSize: 13,
    fontWeight: 600,
    background: active ? 'rgba(var(--overlay),0.08)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    border: 'none',
    borderBottom: active ? '2px solid #fff' : '2px solid transparent',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'var(--font)',
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 600 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h3 className="modal-title">Horaires — {barber.name}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <button style={tabStyle(activeTab === 'schedule')} onClick={() => setActiveTab('schedule')}>
            Semaine type
          </button>
          <button style={tabStyle(activeTab === 'overrides')} onClick={() => setActiveTab('overrides')}>
            Exceptions
            {overrides.length > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  background: 'rgba(var(--overlay),0.12)',
                  padding: '2px 7px',
                  borderRadius: 10,
                  fontSize: 11,
                }}
              >
                {overrides.length}
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <InlineStatus status={status} />

          {loading ? (
            <div className="empty-state">Chargement...</div>
          ) : activeTab === 'schedule' ? (
            <WeeklyScheduleEditor
              schedule={schedule}
              updateDay={updateDay}
              saving={saving}
              onSave={saveSchedule}
            />
          ) : (
            <OverridesEditor
              overrides={overrides}
              showForm={showOverrideForm}
              onToggleForm={() => setShowOverrideForm(!showOverrideForm)}
              formProps={{
                ovDate,
                setOvDate,
                ovIsDayOff,
                setOvIsDayOff,
                ovStartTime,
                setOvStartTime,
                ovEndTime,
                setOvEndTime,
                ovReason,
                setOvReason,
                addingOverride,
              }}
              onAddOverride={handleAddOverride}
              onRemoveOverride={removeOverride}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Weekly Schedule Editor (tab content)
// ============================================

function WeeklyScheduleEditor({ schedule, updateDay, saving, onSave }) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginBottom: 20,
          overflowX: 'auto',
        }}
      >
        {schedule.map((day, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderRadius: 8,
              background: day.is_working
                ? 'rgba(34,197,94,0.04)'
                : 'rgba(var(--overlay),0.02)',
              border: '1px solid',
              borderColor: day.is_working
                ? 'rgba(34,197,94,0.12)'
                : 'var(--border)',
              transition: 'all 0.15s ease',
            }}
          >
            <span
              style={{
                width: 74,
                fontSize: 13,
                fontWeight: 600,
                color: day.is_working ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              {DAYS[idx]}
            </span>

            <button
              type="button"
              className={`toggle ${day.is_working ? 'active' : ''}`}
              onClick={() => updateDay(idx, 'is_working', !day.is_working)}
            />

            {day.is_working ? (
              <>
                <input
                  className="input"
                  type="time"
                  value={day.start_time || '09:00'}
                  onChange={(e) => updateDay(idx, 'start_time', e.target.value)}
                  style={{
                    width: 110,
                    padding: '6px 8px',
                    fontSize: 13,
                    textAlign: 'center',
                  }}
                />
                <span
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 12,
                    userSelect: 'none',
                  }}
                >
                  a
                </span>
                <input
                  className="input"
                  type="time"
                  value={day.end_time || '19:00'}
                  onChange={(e) => updateDay(idx, 'end_time', e.target.value)}
                  style={{
                    width: 110,
                    padding: '6px 8px',
                    fontSize: 13,
                    textAlign: 'center',
                  }}
                />
              </>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Repos
              </span>
            )}
          </div>
        ))}
      </div>

      <button
        className="btn btn-primary btn-sm"
        onClick={onSave}
        disabled={saving}
        style={{ width: '100%' }}
      >
        {saving ? 'Enregistrement...' : 'Enregistrer les horaires'}
      </button>
    </>
  );
}

// ============================================
// Overrides / Holidays Editor (tab content)
// ============================================

function OverridesEditor({
  overrides,
  showForm,
  onToggleForm,
  formProps,
  onAddOverride,
  onRemoveOverride,
}) {
  const {
    ovDate,
    setOvDate,
    ovIsDayOff,
    setOvIsDayOff,
    ovStartTime,
    setOvStartTime,
    ovEndTime,
    setOvEndTime,
    ovReason,
    setOvReason,
    addingOverride,
  } = formProps;

  return (
    <>
      {/* Existing overrides list */}
      {overrides.length === 0 ? (
        <div
          style={{
            padding: '24px 0',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          Aucune exception programmee.
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginBottom: 16,
          }}
        >
          {overrides.map((ov) => {
            const isDayOff = ov.is_day_off;
            return (
              <div
                key={ov.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  padding: '10px 14px',
                  background: isDayOff
                    ? 'rgba(239,68,68,0.04)'
                    : 'rgba(245,158,11,0.04)',
                  border: '1px solid',
                  borderColor: isDayOff
                    ? 'rgba(239,68,68,0.12)'
                    : 'rgba(245,158,11,0.12)',
                  borderRadius: 8,
                }}
              >
                {/* Date */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    {formatDateFr(ov.date)}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '1px 8px',
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 600,
                        background: isDayOff
                          ? 'rgba(239,68,68,0.12)'
                          : 'rgba(245,158,11,0.12)',
                        color: isDayOff ? 'var(--danger)' : 'var(--warning)',
                      }}
                    >
                      {isDayOff ? 'Jour off' : 'Horaire modifie'}
                    </span>
                    {!isDayOff && ov.start_time && ov.end_time && (
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {ov.start_time} - {ov.end_time}
                      </span>
                    )}
                    {ov.reason && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {ov.reason}
                      </span>
                    )}
                  </div>
                </div>

                {/* Delete button */}
                <button
                  className="btn-ghost"
                  style={{ color: 'var(--danger)', flexShrink: 0, padding: 6 }}
                  onClick={() => onRemoveOverride(ov.id)}
                  title="Supprimer"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add override toggle */}
      {!showForm ? (
        <button
          className="btn btn-secondary btn-sm"
          style={{ width: '100%' }}
          onClick={onToggleForm}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Ajouter une exception
        </button>
      ) : (
        <form
          onSubmit={onAddOverride}
          style={{
            padding: 16,
            background: 'rgba(var(--overlay),0.02)',
            border: '1px solid var(--border)',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <label
              className="label"
              style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}
            >
              Nouvelle exception
            </label>
            <button
              type="button"
              className="btn-ghost"
              style={{ padding: 4 }}
              onClick={onToggleForm}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Type toggle: day off vs custom hours */}
          <div className="form-group">
            <label className="label">Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`btn btn-sm ${ovIsDayOff ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setOvIsDayOff(true)}
                style={{ flex: 1 }}
              >
                Jour de conge
              </button>
              <button
                type="button"
                className={`btn btn-sm ${!ovIsDayOff ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setOvIsDayOff(false)}
                style={{ flex: 1 }}
              >
                Horaire special
              </button>
            </div>
          </div>

          {/* Date */}
          <div className="form-group">
            <label className="label">Date</label>
            <input
              className="input"
              type="date"
              value={ovDate}
              onChange={(e) => setOvDate(e.target.value)}
              required
              style={{ fontSize: 13 }}
            />
          </div>

          {/* Custom hours (only if not day off) */}
          {!ovIsDayOff && (
            <div className="form-group">
              <label className="label">Horaires</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  type="time"
                  value={ovStartTime}
                  onChange={(e) => setOvStartTime(e.target.value)}
                  required
                  style={{ flex: 1, fontSize: 13, textAlign: 'center' }}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>
                  a
                </span>
                <input
                  className="input"
                  type="time"
                  value={ovEndTime}
                  onChange={(e) => setOvEndTime(e.target.value)}
                  required
                  style={{ flex: 1, fontSize: 13, textAlign: 'center' }}
                />
              </div>
            </div>
          )}

          {/* Reason */}
          <div className="form-group">
            <label className="label">Raison (optionnel)</label>
            <input
              className="input"
              value={ovReason}
              onChange={(e) => setOvReason(e.target.value)}
              placeholder={ovIsDayOff ? 'ex: Vacances, RDV medical...' : 'ex: Fermeture anticipee...'}
              style={{ fontSize: 13 }}
            />
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onToggleForm}
              style={{ flex: 1 }}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={addingOverride}
              style={{ flex: 1 }}
            >
              {addingOverride ? '...' : ovIsDayOff ? 'Ajouter le conge' : 'Ajouter l\'exception'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

// ============================================
// Guest Days Modal — Manage cross-salon assignments
// ============================================

const SALON_OPTIONS = [
  { id: 'grenoble', label: 'Grenoble' },
  { id: 'meylan', label: 'Meylan' },
];

function GuestDaysModal({ barber, onClose }) {
  const { data: rawGuestDays, isLoading: loading } = useBarberGuestDays(barber.id);
  const addMutation = useAddBarberGuestDay();
  const deleteMutation = useDeleteBarberGuestDay();

  const guestDays = Array.isArray(rawGuestDays) ? rawGuestDays : [];
  const [status, setStatus] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [gdDate, setGdDate] = useState('');
  const [gdSalon, setGdSalon] = useState('');
  const [gdStartTime, setGdStartTime] = useState('09:00');
  const [gdEndTime, setGdEndTime] = useState('19:00');
  const adding = addMutation.isPending;

  const flashTimer = useRef(null);
  const flash = useCallback((type, message) => {
    setStatus({ type, message });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setStatus(null), 3000);
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const destinations = SALON_OPTIONS.filter(s => s.id !== barber.salon_id);

  async function handleAdd(e) {
    e.preventDefault();
    try {
      await addMutation.mutateAsync({
        id: barber.id,
        data: {
          date: gdDate,
          host_salon_id: gdSalon || destinations[0]?.id,
          start_time: gdStartTime,
          end_time: gdEndTime,
        },
      });
      setGdDate(''); setGdStartTime('09:00'); setGdEndTime('19:00');
      setShowForm(false);
      flash('success', 'Jour invite ajoute');
    } catch (err) {
      flash('error', err.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Supprimer ce jour invite ?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      flash('success', 'Jour invite supprime');
    } catch (err) {
      flash('error', err.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Jours invite — {barber.name}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <InlineStatus status={status} />

          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
            Planifier des jours ou {barber.name} travaille dans un autre salon. Il sera automatiquement bloque ici ces jours-la.
          </div>

          {loading ? (
            <div className="empty-state">Chargement...</div>
          ) : guestDays.length === 0 && !showForm ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Aucun jour invite programme.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {guestDays.map((gd) => (
                <div
                  key={gd.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 13,
                    padding: '10px 14px',
                    background: 'rgba(59,130,246,0.04)',
                    border: '1px solid rgba(59,130,246,0.12)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      {formatDateFr(gd.date)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <span style={{
                        display: 'inline-block', padding: '1px 8px', borderRadius: 10,
                        fontSize: 11, fontWeight: 600, background: 'rgba(59,130,246,0.12)', color: '#3b82f6',
                      }}>
                        {gd.host_salon_id === 'grenoble' ? 'Grenoble' : 'Meylan'}
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {(gd.start_time || '09:00').slice(0, 5)} - {(gd.end_time || '19:00').slice(0, 5)}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn-ghost"
                    style={{ color: 'var(--danger)', flexShrink: 0, padding: 6 }}
                    onClick={() => handleDelete(gd.id)}
                    title="Supprimer"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {!showForm ? (
            <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={() => { setGdSalon(destinations[0]?.id || ''); setShowForm(true); }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Ajouter un jour invite
            </button>
          ) : (
            <form
              onSubmit={handleAdd}
              style={{ padding: 16, background: 'rgba(var(--overlay),0.02)', border: '1px solid var(--border)', borderRadius: 10 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <label className="label" style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  Nouveau jour invite
                </label>
                <button type="button" className="btn-ghost" style={{ padding: 4 }} onClick={() => setShowForm(false)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="form-group">
                <label className="label">Salon destination</label>
                <select className="input" value={gdSalon} onChange={(e) => setGdSalon(e.target.value)} required style={{ fontSize: 13 }}>
                  {destinations.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="label">Date</label>
                <input className="input" type="date" value={gdDate} onChange={(e) => setGdDate(e.target.value)} required style={{ fontSize: 13 }} />
              </div>

              <div className="form-group">
                <label className="label">Horaires</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="input" type="time" value={gdStartTime} onChange={(e) => setGdStartTime(e.target.value)} required style={{ flex: 1, fontSize: 13, textAlign: 'center' }} />
                  <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>a</span>
                  <input className="input" type="time" value={gdEndTime} onChange={(e) => setGdEndTime(e.target.value)} required style={{ flex: 1, fontSize: 13, textAlign: 'center' }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)} style={{ flex: 1 }}>Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={adding} style={{ flex: 1 }}>
                  {adding ? '...' : 'Ajouter'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
