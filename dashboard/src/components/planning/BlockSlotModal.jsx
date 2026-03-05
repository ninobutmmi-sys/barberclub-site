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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await createBlockedSlot({ barber_id: barberId, date, start_time: startTime, end_time: endTime, type, reason: reason || undefined });
      onCreated();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  const formRow = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Bloquer un cr\u00e9neau</h3>
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
                  <option value="break">Pause d\u00e9jeuner</option>
                  <option value="personal">Perso / RDV</option>
                  <option value="closed">Ferm\u00e9</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Date</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div style={formRow}>
              <div className="form-group">
                <label className="label">D\u00e9but</label>
                <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} min="08:00" max="20:00" required />
              </div>
              <div className="form-group">
                <label className="label">Fin</label>
                <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} min="08:00" max="20:00" required />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Raison (optionnel)</label>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: Pause d\u00e9jeuner" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Cr\u00e9ation...' : 'Bloquer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
