import { useState, useEffect, useCallback } from 'react';
import {
  getBarbers,
  updateBarber,
  getBarberSchedule,
  updateBarberSchedule,
  addBarberOverride,
  deleteBarberOverride,
} from '../api';
import useMobile from '../hooks/useMobile';

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
  const [barbers, setBarbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editBarber, setEditBarber] = useState(null);
  const [scheduleBarber, setScheduleBarber] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      setBarbers(await getBarbers());
    } catch (err) {
      setError('Impossible de charger les barbers. Vérifiez votre connexion.');
    }
    setLoading(false);
  }

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Barbers</h2>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="empty-state">Chargement...</div>
        ) : error ? (
          <div className="empty-state" style={{ color: 'var(--danger, #ef4444)' }}>{error}</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {barbers.map((b) => (
              <div className="card" key={b.id}>
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
                  <span
                    className={`badge badge-${b.is_active ? 'active' : 'inactive'}`}
                    style={{ marginLeft: 'auto' }}
                  >
                    {b.is_active ? 'Actif' : 'Inactif'}
                  </span>
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

                <div style={{ display: 'flex', gap: 8 }}>
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editBarber && (
        <EditBarberModal
          barber={editBarber}
          onClose={() => setEditBarber(null)}
          onSaved={() => {
            setEditBarber(null);
            loadData();
          }}
        />
      )}

      {scheduleBarber && (
        <ScheduleModal
          barber={scheduleBarber}
          onClose={() => setScheduleBarber(null)}
        />
      )}
    </>
  );
}

// ============================================
// Edit Barber Modal (unchanged)
// ============================================

function EditBarberModal({ barber, onClose, onSaved }) {
  const [name, setName] = useState(barber.name);
  const [role, setRole] = useState(barber.role || '');
  const [photoUrl, setPhotoUrl] = useState(barber.photo_url || '');
  const [isActive, setIsActive] = useState(barber.is_active);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateBarber(barber.id, { name, role, photo_url: photoUrl || null, is_active: isActive });
      onSaved();
    } catch (err) {
      alert(err.message);
    }
    setSaving(false);
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
  const [schedule, setSchedule] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  // Tab: "schedule" or "overrides"
  const [activeTab, setActiveTab] = useState('schedule');

  // Override form state
  const [ovDate, setOvDate] = useState('');
  const [ovIsDayOff, setOvIsDayOff] = useState(true);
  const [ovStartTime, setOvStartTime] = useState('09:00');
  const [ovEndTime, setOvEndTime] = useState('19:00');
  const [ovReason, setOvReason] = useState('');
  const [addingOverride, setAddingOverride] = useState(false);
  const [showOverrideForm, setShowOverrideForm] = useState(false);

  // Status helper: show a message then auto-clear
  const flash = useCallback((type, message) => {
    setStatus({ type, message });
    const timer = setTimeout(() => setStatus(null), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    loadSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSchedule() {
    setLoading(true);
    try {
      const data = await getBarberSchedule(barber.id);
      const sched = Array.from({ length: 7 }, (_, i) => {
        const existing = data.weekly?.find((w) => w.day_of_week === i);
        if (existing) {
          return {
            ...existing,
            start_time: (existing.start_time || '09:00').slice(0, 5),
            end_time: (existing.end_time || '19:00').slice(0, 5),
          };
        }
        return {
          day_of_week: i,
          start_time: '09:00',
          end_time: '19:00',
          is_working: false,
        };
      });
      setSchedule(sched);
      setOverrides(data.overrides || []);
    } catch (err) {
      // silently handled
    }
    setLoading(false);
  }

  async function saveSchedule() {
    setSaving(true);
    try {
      await updateBarberSchedule(barber.id, schedule);
      flash('success', 'Horaires enregistres avec succes');
    } catch (err) {
      flash('error', err.message);
    }
    setSaving(false);
  }

  async function handleAddOverride(e) {
    e.preventDefault();
    setAddingOverride(true);
    try {
      await addBarberOverride(barber.id, {
        date: ovDate,
        is_day_off: ovIsDayOff,
        start_time: ovIsDayOff ? undefined : ovStartTime,
        end_time: ovIsDayOff ? undefined : ovEndTime,
        reason: ovReason || undefined,
      });
      // Reset form
      setOvDate('');
      setOvIsDayOff(true);
      setOvStartTime('09:00');
      setOvEndTime('19:00');
      setOvReason('');
      setShowOverrideForm(false);
      flash('success', 'Exception ajoutee');
      await loadSchedule();
    } catch (err) {
      flash('error', err.message);
    }
    setAddingOverride(false);
  }

  async function removeOverride(id) {
    if (!window.confirm('Supprimer cette exception ?')) return;
    try {
      await deleteBarberOverride(id);
      flash('success', 'Exception supprimee');
      await loadSchedule();
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
