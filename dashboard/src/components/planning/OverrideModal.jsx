// ---------------------------------------------------------------------------
// OverrideModal — Modifier l'horaire d'un barber pour un jour donné
// (ouvert au clic sur une pause récurrente sur le Planning)
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CloseIcon } from './Icons';

export default function OverrideModal({ block, barberName, barberScheduleStart, barberScheduleEnd, onSave, onClose }) {
  if (!block) return null;

  const scheduleStart = barberScheduleStart || '09:00';
  const scheduleEnd = barberScheduleEnd || '19:00';

  // Default = début normal de la journée du barber (donc "pas de pause ce jour" si on submit sans changer)
  // Avant : block.end_time = fin de pause → restreignait silencieusement le matin (bug en prod 02/05)
  const [startTime, setStartTime] = useState(scheduleStart);
  const [saving, setSaving] = useState(false);

  const dateLabel = block.date
    ? format(parseISO(block.date), 'EEEE d MMMM', { locale: fr })
    : '';

  // Le matin sera-t-il fermé ?
  const closesMorning = startTime > scheduleStart;
  const minutesClosed = (() => {
    if (!closesMorning) return 0;
    const [sh, sm] = scheduleStart.split(':').map(Number);
    const [nh, nm] = startTime.split(':').map(Number);
    return (nh * 60 + nm) - (sh * 60 + sm);
  })();
  const hoursClosed = Math.floor(minutesClosed / 60);
  const minsRem = minutesClosed % 60;
  const closedLabel = hoursClosed > 0
    ? `${hoursClosed}h${minsRem > 0 ? String(minsRem).padStart(2, '0') : ''}`
    : `${minsRem} min`;

  async function handleSubmit(e) {
    e.preventDefault();

    // Confirmation forte si on ferme une grosse partie de la journée
    if (closesMorning && minutesClosed >= 30) {
      const ok = window.confirm(
        `⚠️ Tu vas fermer ${closedLabel} de la journée de ${barberName}.\n\n` +
        `Les nouveaux clients ne pourront PAS réserver entre ${scheduleStart} et ${startTime} ce ${dateLabel}.\n\n` +
        `(Les RDV déjà existants ne sont pas affectés.)\n\n` +
        `Confirmer ?`
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      await onSave({
        date: block.date,
        start_time: startTime,
        end_time: scheduleEnd,
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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ fontSize: 15 }}>
            Modifier horaire — {barberName}, {dateLabel}
          </h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Horaire normal : {scheduleStart} — {scheduleEnd}
              <br />
              Pause habituelle : {block.start_time?.slice(0, 5)} — {block.end_time?.slice(0, 5)}
            </p>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {barberName} commence à travailler à
              </span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="input"
                style={{ fontSize: 16 }}
                required
              />
            </label>

            {closesMorning ? (
              <div style={{
                padding: '10px 12px',
                background: 'rgba(220, 38, 38, 0.12)',
                border: '1px solid rgba(220, 38, 38, 0.4)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--danger, #dc2626)',
                lineHeight: 1.5,
              }}>
                ⚠️ <strong>Le matin ({scheduleStart}–{startTime}, soit {closedLabel}) sera FERMÉ</strong> aux nouveaux clients ce jour.
                <br />
                {barberName} sera disponible uniquement de <strong>{startTime} à {scheduleEnd}</strong>.
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                {barberName} travaillera de {startTime} à {scheduleEnd} sans pause ce jour.
              </p>
            )}
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
