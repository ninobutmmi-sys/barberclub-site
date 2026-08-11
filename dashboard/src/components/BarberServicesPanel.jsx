import { useState, useMemo, useEffect } from 'react';
import { useBarbers, useBarberServices, useSetBarberService, useRemoveBarberService } from '../hooks/useApi';
import { formatPrice } from '../utils/format';

/**
 * Prestations vues par barbier.
 *
 * Le catalogue seul ne dit pas qui fait quoi ni à quelle vitesse : deux barbiers
 * peuvent assurer la même prestation en 30 et en 40 minutes. Cet écran part du
 * barbier, liste tout le catalogue du salon, et laisse régler la durée là où
 * elle diffère.
 *
 * Une durée ramenée à celle de la prestation n'est pas stockée comme exception
 * (le back renvoie custom_duration null) : le barbier suit alors la prestation
 * si sa durée change plus tard.
 */

const STEP = 5;   // même granularité que les créneaux admin (SLOT_INTERVAL_ADMIN)
const MIN = 5;
const MAX = 240;

function initials(name = '') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

export default function BarberServicesPanel() {
  const { data: allBarbers = [], isLoading: loadingBarbers } = useBarbers();
  const barbers = useMemo(
    () => allBarbers.filter((b) => b.is_active && b.role !== 'Admin'),
    [allBarbers]
  );

  const [barberId, setBarberId] = useState(null);
  useEffect(() => {
    if (!barberId && barbers.length) setBarberId(barbers[0].id);
  }, [barbers, barberId]);

  const { data: rows = [], isLoading, error } = useBarberServices(barberId);
  const barber = barbers.find((b) => b.id === barberId);

  const perso = rows.filter((r) => r.assigned && r.custom_duration != null).length;
  const assignees = rows.filter((r) => r.assigned).length;

  if (loadingBarbers) return <div className="empty-state">Chargement...</div>;
  if (!barbers.length) return <div className="empty-state">Aucun barbier actif dans ce salon.</div>;

  return (
    <div className="bsp">
      {/* ── Choix du barbier ── */}
      <div className="bsp-people" role="tablist" aria-label="Choisir un barbier">
        {barbers.map((b) => (
          <button
            key={b.id}
            role="tab"
            aria-selected={b.id === barberId}
            className={`bsp-person ${b.id === barberId ? 'active' : ''}`}
            onClick={() => setBarberId(b.id)}
          >
            <span className="bsp-avatar" aria-hidden="true">
              {b.photo_url
                ? <img src={b.photo_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                : initials(b.name)}
            </span>
            <span className="bsp-person-name">{b.name}</span>
          </button>
        ))}
      </div>

      {barber && (
        <p className="bsp-summary">
          <strong>{barber.name}</strong> assure <strong>{assignees}</strong> prestation{assignees > 1 ? 's' : ''}
          {perso > 0 && <> · <span className="bsp-dot-custom" aria-hidden="true" /> {perso} durée{perso > 1 ? 's' : ''} qui lui {perso > 1 ? 'sont propres' : 'est propre'}</>}
        </p>
      )}

      {error && <div className="bsp-error" role="alert">{error.message}</div>}

      {isLoading ? (
        <div className="empty-state">Chargement des prestations...</div>
      ) : (
        <ul className="bsp-list">
          {rows.map((s) => (
            <ServiceRow key={s.id} row={s} barberId={barberId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ServiceRow({ row, barberId }) {
  const setService = useSetBarberService();
  const removeService = useRemoveBarberService();

  // Valeur en cours d'édition : on ne pousse au serveur qu'au blur ou au pas,
  // pour ne pas déclencher une requête à chaque frappe.
  const [draft, setDraft] = useState(String(row.effective_duration));
  const [localError, setLocalError] = useState('');
  useEffect(() => { setDraft(String(row.effective_duration)); setLocalError(''); }, [row.effective_duration, row.assigned]);

  const saving = setService.isPending || removeService.isPending;
  const custom = row.assigned && row.custom_duration != null;

  async function commit(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < MIN || n > MAX) {
      setLocalError(`Entre ${MIN} et ${MAX} min`);
      setDraft(String(row.effective_duration));
      return;
    }
    if (n === row.effective_duration) return;   // rien à écrire
    setLocalError('');
    try {
      await setService.mutateAsync({ id: barberId, serviceId: row.id, customDuration: n });
    } catch (err) {
      setLocalError(err.message || 'Échec de l’enregistrement');
      setDraft(String(row.effective_duration));
    }
  }

  async function toggleAssigned() {
    setLocalError('');
    try {
      if (row.assigned) await removeService.mutateAsync({ id: barberId, serviceId: row.id });
      else await setService.mutateAsync({ id: barberId, serviceId: row.id, customDuration: null });
    } catch (err) {
      setLocalError(err.message || 'Échec de l’enregistrement');
    }
  }

  async function resetToDefault() {
    setLocalError('');
    try {
      await setService.mutateAsync({ id: barberId, serviceId: row.id, customDuration: null });
    } catch (err) {
      setLocalError(err.message || 'Échec de l’enregistrement');
    }
  }

  const inputId = `dur-${barberId}-${row.id}`;

  return (
    <li className={`bsp-row ${row.assigned ? '' : 'off'} ${saving ? 'saving' : ''}`}>
      <button
        className={`bsp-check ${row.assigned ? 'on' : ''}`}
        onClick={toggleAssigned}
        disabled={saving}
        aria-pressed={row.assigned}
        aria-label={row.assigned ? `Retirer ${row.name}` : `Ajouter ${row.name}`}
      >
        {row.assigned && (
          <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
        )}
      </button>

      <span className="bsp-color" style={{ background: row.color || '#22c55e' }} aria-hidden="true" />

      <div className="bsp-info">
        <span className="bsp-name">{row.name}</span>
        <span className="bsp-price">{formatPrice(row.price)}</span>
      </div>

      {row.assigned ? (
        <div className="bsp-duration">
          <button
            className="bsp-step" disabled={saving || Number(draft) <= MIN}
            onClick={() => commit(Number(draft) - STEP)} aria-label="Réduire de 5 minutes"
          >−</button>

          <label className="sr-only" htmlFor={inputId}>Durée de {row.name} pour ce barbier, en minutes</label>
          <input
            id={inputId}
            className={`bsp-input ${custom ? 'custom' : ''}`}
            type="number" inputMode="numeric" min={MIN} max={MAX} step={STEP}
            value={draft} disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
          <span className="bsp-unit">min</span>

          <button
            className="bsp-step" disabled={saving || Number(draft) >= MAX}
            onClick={() => commit(Number(draft) + STEP)} aria-label="Augmenter de 5 minutes"
          >+</button>

          {custom ? (
            <button className="bsp-revert" onClick={resetToDefault} disabled={saving}
              title={`Revenir à la durée standard (${row.default_duration} min)`}>
              propre · {row.default_duration}↺
            </button>
          ) : (
            <span className="bsp-standard">standard</span>
          )}
        </div>
      ) : (
        <span className="bsp-absent">ne la fait pas</span>
      )}

      {localError && <span className="bsp-row-error" role="alert">{localError}</span>}
    </li>
  );
}
