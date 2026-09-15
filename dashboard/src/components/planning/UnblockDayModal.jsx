// ---------------------------------------------------------------------------
// UnblockDayModal — Ouvrir un jour de repos depuis la colonne du planning
//
// Un barbier qui vient finalement un jour de repos, c'est un imprevu du matin.
// Jusqu'ici il fallait passer par la fiche barbier. Ici on regle tout ce qui
// garde la journee fermee, au meme endroit : les horaires, la pause, et les
// blocages deja poses (ecole, ferme, pause d'une journee entiere) — sans les
// retirer, la colonne s'ouvrirait mais aucun client ne pourrait reserver.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CloseIcon } from './Icons';
import { BLOCK_TYPE_LABELS } from './BlockedSlotBlock';

const hhmm = (t) => (t || '').slice(0, 5);

export default function UnblockDayModal({ barberName, dateStr, closedReason, defaultStart, defaultEnd, defaultBreak, blocks, onConfirm, onClose }) {
  const [start, setStart] = useState(defaultStart || '09:00');
  const [end, setEnd] = useState(defaultEnd || '19:00');
  const [withBreak, setWithBreak] = useState(!!defaultBreak);
  const [breakStart, setBreakStart] = useState(defaultBreak?.start || '13:00');
  const [breakEnd, setBreakEnd] = useState(defaultBreak?.end || '14:00');
  const [removeIds, setRemoveIds] = useState(() => new Set(blocks.map((b) => b.id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dateLabel = format(parseISO(dateStr), 'EEEE d MMMM', { locale: fr });

  function toggleBlock(id) {
    setRemoveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (end <= start) {
      setError("L'heure de fin doit être après l'heure de début.");
      return;
    }
    if (withBreak && (breakEnd <= breakStart || breakStart < start || breakEnd > end)) {
      setError('La pause doit tenir dans la journée.');
      return;
    }
    setSaving(true);
    try {
      await onConfirm({
        start,
        end,
        pause: withBreak ? { start: breakStart, end: breakEnd } : null,
        removeIds: [...removeIds],
      });
      onClose();
    } catch (err) {
      setError(err.message || "La journée n'a pas pu être ouverte.");
      setSaving(false);
    }
  }

  const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unblockDayTitle"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440 }}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title" id="unblockDayTitle" style={{ fontSize: 15 }}>Ouvrir la journée</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
              {barberName} · {dateLabel}
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Fermer"><CloseIcon /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
            <p className="unblock-reason">{closedReason}</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>Début</span>
                <input type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} required style={{ fontSize: 16 }} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>Fin</span>
                <input type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} required style={{ fontSize: 16 }} />
              </label>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <label className="unblock-check">
                <input type="checkbox" checked={withBreak} onChange={(e) => setWithBreak(e.target.checked)} />
                <span>Pause déjeuner</span>
              </label>
              {withBreak && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingLeft: 26 }}>
                  <input type="time" className="input" aria-label="Début de la pause" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} style={{ fontSize: 16 }} />
                  <input type="time" className="input" aria-label="Fin de la pause" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)} style={{ fontSize: 16 }} />
                </div>
              )}
            </div>

            {blocks.length > 0 && (
              <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                <legend style={{ ...labelStyle, marginBottom: 6 }}>Blocages posés ce jour</legend>
                {blocks.map((b) => {
                  const kept = !removeIds.has(b.id);
                  return (
                    <label key={b.id} className={`unblock-check${kept ? ' is-kept' : ''}`}>
                      <input type="checkbox" checked={!kept} onChange={() => toggleBlock(b.id)} />
                      <span>
                        Retirer « {BLOCK_TYPE_LABELS[b.type] || b.type} » {hhmm(b.start_time)}–{hhmm(b.end_time)}
                        {b.reason ? <span className="unblock-check-note"> · {b.reason}</span> : null}
                        {kept && <span className="unblock-check-warn">Reste bloqué aux clients sur ce créneau</span>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}

            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Les clients pourront réserver {barberName} de {start} à {end}{withBreak ? `, hors pause ${breakStart}–${breakEnd}` : ''}, ce jour uniquement.
            </p>

            {error && <p role="alert" className="unblock-error">{error}</p>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Ouverture…' : 'Ouvrir la journée'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
