// ---------------------------------------------------------------------------
// BookingHoverCard — Timify-style popover on hover
// ---------------------------------------------------------------------------

import { createPortal } from 'react-dom';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { timeToMinutes, hexToBlockStyle, formatPhone, FALLBACK_COLOR, STATUS_LABELS } from './helpers';

function HoverRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text)', textAlign: 'right', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

export default function BookingHoverCard({ booking, anchorRect }) {
  if (!booking || !anchorRect) return null;

  const SOURCE_LABELS = { online: 'Réservé en ligne', manual: 'Ajouté manuellement', phone: 'Par téléphone', walk_in: 'Sans RDV' };
  const cardW = 380;
  const cardH = booking.client_notes ? 380 : 320;

  // Position: prefer right of block, fallback left if overflows
  let left = anchorRect.right + 8;
  let top = anchorRect.top - 20;
  if (left + cardW > window.innerWidth - 16) left = anchorRect.left - cardW - 8;
  if (top + cardH > window.innerHeight - 16) top = window.innerHeight - cardH - 16;
  if (top < 8) top = 8;

  const bookingDateStr = typeof booking.date === 'string' ? booking.date.slice(0, 10) : '';
  const startMin = timeToMinutes(booking.start_time);
  const endMin = timeToMinutes(booking.end_time);
  const durationMin = endMin - startMin;

  // Initials
  const initials = ((booking.client_first_name?.[0] || '') + (booking.client_last_name?.[0] || '')).toUpperCase();

  // Duration bar proportion (relative to a 2h window for visual scale)
  const barMax = 120; // 2h reference
  const barPct = Math.min((durationMin / barMax) * 100, 100);

  const color = hexToBlockStyle(booking.service_color || FALLBACK_COLOR);

  let formattedDate = bookingDateStr;
  try {
    formattedDate = format(parseISO(bookingDateStr), 'EEEE d MMMM yyyy', { locale: fr });
  } catch {}

  let createdAt = '';
  if (booking.created_at) {
    try {
      const d = new Date(booking.created_at);
      createdAt = format(d, 'dd/MM/yyyy HH:mm', { locale: fr });
    } catch {}
  }

  return createPortal(
    <div
      style={{
        position: 'fixed', top, left, width: cardW, zIndex: 9999,
        background: 'var(--bg-hover)', border: '1px solid rgba(var(--overlay),0.12)',
        borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden', pointerEvents: 'none',
        animation: 'hoverCardIn 0.15s ease-out',
      }}
    >
      {/* Price bar */}
      <div style={{
        padding: '10px 16px', background: 'rgba(var(--overlay),0.04)',
        borderBottom: '1px solid rgba(var(--overlay),0.08)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-display, Orbitron, monospace)' }}>
          {(booking.price / 100).toFixed(2).replace('.', ',') + ' \u20ac'}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
          background: booking.source === 'online' ? 'rgba(59,130,246,0.15)' : 'rgba(var(--overlay),0.06)',
          color: booking.source === 'online' ? '#60a5fa' : 'var(--text-secondary)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {SOURCE_LABELS[booking.source] || booking.source || '\u2013'}
        </span>
      </div>

      {/* Main content: 2 columns */}
      <div style={{ display: 'flex', padding: '14px 16px 10px', gap: 14 }}>
        {/* Left: booking details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Aperçu de la réservation
          </div>

          <div style={{ display: 'grid', gap: 5 }}>
            <HoverRow label="Service" value={booking.service_name} />
            <HoverRow label="Barber" value={booking.barber_name || '\u2013'} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Statut</span>
              <span className={`badge badge-${booking.status}`}>{STATUS_LABELS[booking.status] || booking.status}</span>
            </div>
            {createdAt && <HoverRow label="Créé le" value={createdAt} />}
          </div>
        </div>

        {/* Right: client card */}
        <div style={{
          width: 130, flexShrink: 0, padding: '10px 12px',
          background: 'rgba(var(--overlay),0.03)', borderRadius: 8,
          border: '1px solid rgba(var(--overlay),0.06)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: color.border || '#3b82f6',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '0.02em',
            flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, textAlign: 'center', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
            {booking.client_first_name} {booking.client_last_name}
          </div>
          {booking.client_phone && (
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', wordBreak: 'break-all' }}>
              {formatPhone(booking.client_phone)}
            </div>
          )}
          {booking.client_email && (
            <div style={{ fontSize: 9, color: '#60a5fa', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
              {booking.client_email}
            </div>
          )}
          {booking.is_first_visit && (
            <span style={{
              fontSize: 9, fontWeight: 800, background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff',
              padding: '2px 8px', borderRadius: 4, letterSpacing: '0.05em',
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
              <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" stroke="none"><path d="M12 2l2.09 6.26L20.18 9.27l-5.09 3.9L16.18 19.27 12 16l-4.18 3.27 1.09-6.1-5.09-3.9 6.09-1.01z"/></svg>
              1er RDV
            </span>
          )}
        </div>
      </div>

      {/* Duration bar */}
      <div style={{
        padding: '10px 16px 14px', borderTop: '1px solid rgba(var(--overlay),0.06)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          Durée
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
          {formattedDate}
        </div>
        <div style={{ position: 'relative', height: 24, background: 'rgba(var(--overlay),0.04)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${barPct}%`,
            background: `linear-gradient(90deg, ${color.border}44, ${color.border}88)`,
            borderRadius: 6,
          }} />
          <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>
            {booking.start_time?.slice(0, 5)}
          </div>
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: 'rgba(var(--overlay),0.7)' }}>
            {durationMin} min
          </div>
          <div style={{ position: 'absolute', right: 6, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>
            {booking.end_time?.slice(0, 5)}
          </div>
        </div>
      </div>

      {/* Client notes */}
      {booking.client_notes && (
        <div style={{
          padding: '8px 16px 12px', borderTop: '1px solid rgba(var(--overlay),0.06)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Notes
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {booking.client_notes}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
