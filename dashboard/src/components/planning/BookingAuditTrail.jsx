/**
 * BookingAuditTrail — Shows modification history for a booking.
 * Fetches from /api/admin/audit-log?entity_type=booking&entity_id=...
 */

import { useState, useEffect } from 'react';
import * as api from '../../api';

const ACTION_CONFIG = {
  create:     { label: 'Créé',     color: '#22c55e', icon: '+' },
  update:     { label: 'Modifié',  color: '#3b82f6', icon: '✎' },
  reschedule: { label: 'Déplacé',  color: '#f59e0b', icon: '↻' },
  cancel:     { label: 'Annulé',   color: '#ef4444', icon: '✕' },
  status:     { label: 'Statut',   color: '#8b5cf6', icon: '◉' },
  delete:     { label: 'Supprimé', color: '#ef4444', icon: '🗑' },
};

function formatTime(iso) {
  return new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function describeDetails(action, details) {
  if (!details) return '';
  const d = typeof details === 'string' ? JSON.parse(details) : details;
  const parts = [];

  if (d.source === 'client') parts.push('par le client');
  if (action === 'reschedule' && d.old_date) parts.push(`${d.old_date} ${d.old_time || ''} → ${d.new_date} ${d.new_time || ''}`);
  if (action === 'status' && d.status) parts.push(d.status === 'no_show' ? 'Faux plan' : d.status === 'completed' ? 'Terminé' : d.status);
  if (action === 'update' && d.after) {
    const a = d.after;
    if (a.date) parts.push(`date: ${a.date}`);
    if (a.start_time) parts.push(`heure: ${a.start_time}`);
    if (a.barber) parts.push(`barber: ${a.barber}`);
    if (a.service) parts.push(`prestation: ${a.service}`);
  }
  if (action === 'create' && d.date) parts.push(`${d.date} à ${d.start_time || ''}`);
  if (d.recurring) parts.push(`récurrent (${d.count}x)`);

  return parts.join(' · ');
}

export default function BookingAuditTrail({ bookingId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    api.getAuditLog({ entity_type: 'booking', entity_id: bookingId, limit: 20 })
      .then((data) => setEntries(data.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [bookingId]);

  if (loading) return null;
  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', background: 'rgba(var(--overlay), 0.03)',
          border: '1px solid rgba(var(--overlay), 0.06)', borderRadius: 10,
          cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
          fontFamily: 'var(--font)', transition: 'all 0.15s',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          Historique ({entries.length})
        </span>
        <span style={{ fontSize: 10, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : '' }}>▾</span>
      </button>

      {expanded && (
        <div style={{
          marginTop: 6, padding: '8px 0',
          borderLeft: '2px solid rgba(var(--overlay), 0.08)',
          marginLeft: 18,
        }}>
          {entries.map((entry) => {
            const cfg = ACTION_CONFIG[entry.action] || ACTION_CONFIG.update;
            const desc = describeDetails(entry.action, entry.details);

            return (
              <div key={entry.id} style={{
                display: 'flex', gap: 10, padding: '8px 0 8px 16px',
                position: 'relative',
              }}>
                {/* Dot on the timeline */}
                <div style={{
                  position: 'absolute', left: -6, top: 12,
                  width: 10, height: 10, borderRadius: '50%',
                  background: cfg.color, border: '2px solid var(--bg-card)',
                  flexShrink: 0,
                }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: cfg.color,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {formatTime(entry.created_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {entry.actor_name || 'Système'}
                    {desc && <span style={{ color: 'var(--text-muted)' }}> — {desc}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
