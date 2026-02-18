import { useState, useEffect } from 'react';
import { getBarbers, updateBarber, getBarberSchedule, updateBarberSchedule, addBarberOverride, deleteBarberOverride } from '../api';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export default function Barbers() {
  const [barbers, setBarbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editBarber, setEditBarber] = useState(null);
  const [scheduleBarber, setScheduleBarber] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      setBarbers(await getBarbers());
    } catch (err) {
      console.error(err);
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
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {barbers.map((b) => (
              <div className="card" key={b.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.06)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 18,
                    border: '2px solid var(--border)'
                  }}>
                    {b.name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {b.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.role || 'Barber'}</div>
                  </div>
                  <span className={`badge badge-${b.is_active ? 'active' : 'inactive'}`} style={{ marginLeft: 'auto' }}>
                    {b.is_active ? 'Actif' : 'Inactif'}
                  </span>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                  {b.email}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setEditBarber(b)}>
                    Modifier
                  </button>
                  <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setScheduleBarber(b)}>
                    Horaires
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editBarber && (
        <EditBarberModal barber={editBarber} onClose={() => setEditBarber(null)} onSaved={() => { setEditBarber(null); loadData(); }} />
      )}

      {scheduleBarber && (
        <ScheduleModal barber={scheduleBarber} onClose={() => setScheduleBarber(null)} />
      )}
    </>
  );
}

function EditBarberModal({ barber, onClose, onSaved }) {
  const [name, setName] = useState(barber.name);
  const [role, setRole] = useState(barber.role || '');
  const [isActive, setIsActive] = useState(barber.is_active);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateBarber(barber.id, { name, role, is_active: isActive });
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
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="label">Nom</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="label">Rôle</label>
              <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Barber" />
            </div>
            <div className="form-group">
              <label className="label">Statut</label>
              <button type="button" className={`toggle ${isActive ? 'active' : ''}`} onClick={() => setIsActive(!isActive)} />
              <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text-secondary)' }}>{isActive ? 'Actif' : 'Inactif'}</span>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? '...' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ScheduleModal({ barber, onClose }) {
  const [schedule, setSchedule] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Override form
  const [ovDate, setOvDate] = useState('');
  const [ovDayOff, setOvDayOff] = useState(true);
  const [ovReason, setOvReason] = useState('');

  useEffect(() => { loadSchedule(); }, []);

  async function loadSchedule() {
    setLoading(true);
    try {
      const data = await getBarberSchedule(barber.id);
      // Build schedule array indexed by day (0-6)
      const sched = Array.from({ length: 7 }, (_, i) => {
        const existing = data.weekly?.find((w) => w.day_of_week === i);
        return existing || { day_of_week: i, start_time: '09:00', end_time: '19:00', is_working: false };
      });
      setSchedule(sched);
      setOverrides(data.overrides || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  async function saveSchedule() {
    setSaving(true);
    try {
      await updateBarberSchedule(barber.id, schedule);
      alert('Horaires enregistrés');
    } catch (err) {
      alert(err.message);
    }
    setSaving(false);
  }

  async function addOverride(e) {
    e.preventDefault();
    try {
      await addBarberOverride(barber.id, {
        date: ovDate,
        is_day_off: ovDayOff,
        reason: ovReason || undefined,
      });
      setOvDate('');
      setOvReason('');
      loadSchedule();
    } catch (err) {
      alert(err.message);
    }
  }

  async function removeOverride(id) {
    try {
      await deleteBarberOverride(id);
      loadSchedule();
    } catch (err) {
      alert(err.message);
    }
  }

  const updateDay = (idx, field, value) => {
    setSchedule((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Horaires — {barber.name}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="empty-state">Chargement...</div>
          ) : (
            <>
              <label className="label" style={{ marginBottom: 12 }}>Semaine type</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                {schedule.map((day, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 70, fontSize: 13, fontWeight: 600 }}>{DAYS[idx]}</span>
                    <button
                      type="button"
                      className={`toggle ${day.is_working ? 'active' : ''}`}
                      onClick={() => updateDay(idx, 'is_working', !day.is_working)}
                    />
                    {day.is_working && (
                      <>
                        <input className="input" type="time" value={day.start_time || '09:00'}
                          onChange={(e) => updateDay(idx, 'start_time', e.target.value)}
                          style={{ width: 100, padding: '6px 8px', fontSize: 13 }}
                        />
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                        <input className="input" type="time" value={day.end_time || '19:00'}
                          onChange={(e) => updateDay(idx, 'end_time', e.target.value)}
                          style={{ width: 100, padding: '6px 8px', fontSize: 13 }}
                        />
                      </>
                    )}
                    {!day.is_working && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Repos</span>}
                  </div>
                ))}
              </div>

              <button className="btn btn-primary btn-sm" onClick={saveSchedule} disabled={saving} style={{ marginBottom: 24 }}>
                {saving ? '...' : 'Enregistrer les horaires'}
              </button>

              <label className="label" style={{ marginBottom: 8 }}>Exceptions (congés, jours fériés...)</label>

              {overrides.length > 0 && (
                <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {overrides.map((ov) => (
                    <div key={ov.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                      <span style={{ fontWeight: 600 }}>{ov.date}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {ov.is_day_off ? 'Jour off' : `${ov.start_time} - ${ov.end_time}`}
                      </span>
                      {ov.reason && <span style={{ color: 'var(--text-muted)' }}>({ov.reason})</span>}
                      <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: 'var(--danger)' }} onClick={() => removeOverride(ov.id)}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={addOverride} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <label className="label">Date</label>
                  <input className="input" type="date" value={ovDate} onChange={(e) => setOvDate(e.target.value)} required style={{ width: 150, padding: '6px 8px', fontSize: 13 }} />
                </div>
                <div>
                  <label className="label">Raison</label>
                  <input className="input" value={ovReason} onChange={(e) => setOvReason(e.target.value)} placeholder="Congé" style={{ width: 120, padding: '6px 8px', fontSize: 13 }} />
                </div>
                <button type="submit" className="btn btn-secondary btn-sm">+ Jour off</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
