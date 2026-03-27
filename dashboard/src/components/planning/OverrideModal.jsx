// ---------------------------------------------------------------------------
// OverrideModal — Mini modal to override a recurring pause for a single day
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CloseIcon } from './Icons';

export default function OverrideModal({ block, barberName, barberScheduleEnd, onSave, onClose }) {
  if (!block) return null;

  const [startTime, setStartTime] = useState(block.end_time?.slice(0, 5) || '14:00');
  const [saving, setSaving] = useState(false);

  const dateLabel = block.date
    ? format(parseISO(block.date), 'EEEE d MMMM', { locale: fr })
    : '';

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        date: block.date,
        start_time: startTime,
        end_time: barberScheduleEnd || '19:00',
        is_day_off: false,
        reason: 'Override pause planning',
      });
      onClose();
    } catch (err) {
      alert(err.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ fontSize: 15 }}>
            Modifier horaire — {barberName}, {dateLabel}
          </h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Pause habituelle : {block.start_time?.slice(0, 5)} — {block.end_time?.slice(0, 5)}
            </p>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Heure de début</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="input"
                style={{ fontSize: 16 }}
                required
              />
            </label>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              {barberName} travaillera de {startTime} à {barberScheduleEnd || '19:00'} ce jour uniquement.
            </p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Enregistrement...' : 'Modifier pour ce jour'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
