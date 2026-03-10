// ---------------------------------------------------------------------------
// BlockSlotModal
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { format } from 'date-fns';
import { createBlockedSlot } from '../../api';
import { CloseIcon } from './Icons';

export default function BlockSlotModal({ barbers, onClose, onCreated, initialDate, initialBarberId }) {
  const [barberId, setBarberId] = useState(initialBarberId || (barbers[0]?.id ?? ''));
  const [date, setDate] = useState(initialDate || format(new Date(), 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('12:00');
  const [endTime, setEndTime] = useState('13:00');
  const [type, setType] = useState('break');
  const [reason, setReason] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState('weekly');
  const [recurrenceEndType, setRecurrenceEndType] = useState('occurrences');
  const [recurrenceOccurrences, setRecurrenceOccurrences] = useState(10);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    setSaving(true);
    try {
      const payload = { barber_id: barberId, date, start_time: startTime, end_time: endTime, type, reason: reason || undefined };
      if (recurring) {
        payload.recurrence = {
          type: recurrenceType,
          end_type: recurrenceEndType,
          ...(recurrenceEndType === 'occurrences' ? { occurrences: recurrenceOccurrences } : { end_date: recurrenceEndDate }),
        };
      }
      const res = await createBlockedSlot(payload);
      if (res.created != null) {
        setResult(`${res.created} créneaux bloqués${res.skipped ? ` (${res.skipped} ignorés)` : ''}`);
        setTimeout(() => onCreated(), 1500);
      } else {
        onCreated();
      }
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  const formRow = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Bloquer un créneau</h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div role="alert" style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', fontSize: 13, marginBottom: 14 }}>{error}</div>
            )}
            <div style={formRow}>
              <div className="form-group">
                <label className="label">Barber</label>
                <select className="input" value={barberId} onChange={(e) => setBarberId(e.target.value)} required>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Type</label>
                <select className="input" value={type} onChange={(e) => setType(e.target.value)} required>
                  <option value="break">Pause déjeuner</option>
                  <option value="personal">Perso / RDV</option>
                  <option value="closed">Fermé</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Date</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div style={formRow}>
              <div className="form-group">
                <label className="label">Début</label>
                <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} min="08:00" max="20:30" required />
              </div>
              <div className="form-group">
                <label className="label">Fin</label>
                <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} min="08:00" max="21:00" required />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Raison (optionnel)</label>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: Pause déjeuner" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
              <label className="toggle-switch" style={{ position: 'relative', width: 40, height: 22, flexShrink: 0 }}>
                <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: 'absolute', inset: 0, borderRadius: 11, background: recurring ? 'var(--accent, #3b82f6)' : 'var(--border)', transition: '0.2s', cursor: 'pointer' }}>
                  <span style={{ position: 'absolute', top: 2, left: recurring ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: '0.2s' }} />
                </span>
              </label>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Répéter</span>
            </div>
            {recurring && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0 8px' }}>
                <div style={formRow}>
                  <div className="form-group">
                    <label className="label">Fréquence</label>
                    <select className="input" value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value)}>
                      <option value="weekly">Chaque semaine</option>
                      <option value="biweekly">Toutes les 2 semaines</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Fin</label>
                    <select className="input" value={recurrenceEndType} onChange={(e) => setRecurrenceEndType(e.target.value)}>
                      <option value="occurrences">Nombre</option>
                      <option value="end_date">Date de fin</option>
                    </select>
                  </div>
                </div>
                {recurrenceEndType === 'occurrences' ? (
                  <div className="form-group">
                    <label className="label">Nombre de semaines</label>
                    <input className="input" type="number" value={recurrenceOccurrences} onChange={(e) => setRecurrenceOccurrences(parseInt(e.target.value) || 2)} min="2" max="52" />
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="label">Jusqu'au</label>
                    <input className="input" type="date" value={recurrenceEndDate} onChange={(e) => setRecurrenceEndDate(e.target.value)} min={date} />
                  </div>
                )}
              </div>
            )}
            {result && (
              <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, color: '#22c55e', fontSize: 13 }}>{result}</div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Création...' : 'Bloquer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
