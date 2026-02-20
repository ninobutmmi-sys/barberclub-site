import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  getBookings,
  getBarbers,
  getServices,
  getClients,
  updateBookingStatus,
  updateBooking,
  deleteBooking,
  createBooking,
  getBlockedSlots,
  createBlockedSlot,
  deleteBlockedSlot,
  updateClient,
  getBarberSchedule,
} from '../api';
import {
  format,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  startOfWeek,
  endOfWeek,
  isToday,
  parseISO,
} from 'date-fns';
import { fr } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20AC';
}

function timeToMinutes(t) {
  if (!t) return 0;
  const parts = t.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

const HOUR_START = 9;
const HOUR_END = 19;
const TOTAL_MINUTES = (HOUR_END - HOUR_START) * 60;
const PX_PER_MIN = 3;
const GRID_HEIGHT = TOTAL_MINUTES * PX_PER_MIN; // 1800px
const HOUR_HEIGHT = 60 * PX_PER_MIN; // 180px

const STATUS_LABELS = {
  confirmed: 'Confirmé',
  completed: 'Terminé',
  no_show: 'No-show',
  cancelled: 'Annulé',
};

// Convert a hex color to block style (opaque bg, solid border) — theme-aware
function hexToBlockStyle(hex) {
  if (!hex || hex.length !== 7) hex = '#22c55e';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const base = isDark ? [17, 17, 19] : [245, 245, 247];
  const alpha = isDark ? 0.30 : 0.25;
  const br = Math.round(r * alpha + base[0] * (1 - alpha));
  const bg = Math.round(g * alpha + base[1] * (1 - alpha));
  const bb = Math.round(b * alpha + base[2] * (1 - alpha));
  return {
    bg: `rgb(${br},${bg},${bb})`,
    border: hex,
    text: isDark ? '#fff' : '#111',
  };
}

// Fallback color palette for bookings without service_color
const FALLBACK_COLOR = '#22c55e';

const STATUS_OVERRIDES = {
  completed: { bg: 'var(--status-completed-bg)', border: '#6b7280', text: 'var(--text)' },
  no_show: { bg: 'var(--status-noshow-bg)', border: '#ef4444', text: 'var(--text)' },
  cancelled: { bg: 'var(--status-cancelled-bg)', border: 'var(--status-cancelled-border)', text: 'var(--text-muted)' },
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function PlusIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={spinning ? { animation: 'spin 0.8s linear infinite' } : undefined}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// BookingHoverCard — Timify-style popover on hover
// ---------------------------------------------------------------------------

function BookingHoverCard({ booking, anchorRect }) {
  if (!booking || !anchorRect) return null;

  const SOURCE_LABELS = { online: 'Réservé en ligne', manual: 'Ajouté manuellement', phone: 'Par téléphone', walk_in: 'Sans RDV' };
  const cardW = 380;
  const cardH = 320;

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
          {formatPrice(booking.price)}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
          background: booking.source === 'online' ? 'rgba(59,130,246,0.15)' : 'rgba(var(--overlay),0.06)',
          color: booking.source === 'online' ? '#60a5fa' : 'var(--text-secondary)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {SOURCE_LABELS[booking.source] || booking.source || '–'}
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
            <HoverRow label="Barber" value={booking.barber_name || '–'} />
            <HoverRow label="Statut" value={STATUS_LABELS[booking.status] || booking.status} />
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
              {booking.client_phone}
            </div>
          )}
          {booking.client_email && (
            <div style={{ fontSize: 9, color: '#60a5fa', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
              {booking.client_email}
            </div>
          )}
          {booking.is_first_visit && (
            <span style={{
              fontSize: 9, fontWeight: 800, background: '#3b82f6', color: '#fff',
              padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em',
            }}>NOUVEAU</span>
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
    </div>,
    document.body
  );
}

function HoverRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text)', textAlign: 'right', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BookingBlock
// ---------------------------------------------------------------------------

function BookingBlock({ booking, onClick, isDragging }) {
  const startMin = timeToMinutes(booking.start_time) - HOUR_START * 60;
  const endMin = timeToMinutes(booking.end_time) - HOUR_START * 60;
  const duration = endMin - startMin;
  const top = Math.max(startMin * PX_PER_MIN, 0);
  const height = duration * PX_PER_MIN;

  const color = STATUS_OVERRIDES[booking.status] || hexToBlockStyle(booking.service_color || FALLBACK_COLOR);
  const isSmall = height < 50;
  const isTiny = height < 30;

  const blockRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const [showHover, setShowHover] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);

  function handleDragStart(e) {
    e.stopPropagation();
    setShowHover(false);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
      bookingId: booking.id,
      barberId: booking.barber_id,
      date: typeof booking.date === 'string' ? booking.date.slice(0, 10) : '',
    }));
  }

  function handleMouseEnter(e) {
    e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';
    e.currentTarget.style.zIndex = '20';
    if (isDragging) return;
    hoverTimerRef.current = setTimeout(() => {
      if (blockRef.current) {
        setAnchorRect(blockRef.current.getBoundingClientRect());
        setShowHover(true);
      }
    }, 400);
  }

  function handleMouseLeave(e) {
    e.currentTarget.style.boxShadow = '';
    e.currentTarget.style.zIndex = '2';
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setShowHover(false);
  }

  useEffect(() => {
    return () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); };
  }, []);

  return (
    <>
      <div
        ref={blockRef}
        draggable="true"
        onDragStart={handleDragStart}
        style={{
          position: 'absolute',
          top,
          left: 1,
          right: 1,
          height: Math.max(height, 26),
          background: color.bg,
          borderLeft: `3px solid ${color.border}`,
          borderRadius: '0 4px 4px 0',
          padding: isTiny ? '2px 5px' : '4px 6px',
          cursor: isDragging ? 'grabbing' : 'pointer',
          overflow: 'hidden',
          fontSize: 12,
          lineHeight: '15px',
          color: color.text || 'var(--text)',
          zIndex: 2,
          boxSizing: 'border-box',
          transition: 'box-shadow 0.12s, opacity 0.15s',
          opacity: isDragging ? 0.4 : 1,
        }}
        onClick={(e) => { e.stopPropagation(); setShowHover(false); onClick(booking); }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div style={{ fontWeight: 600, fontSize: 10, opacity: 0.7, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {isDragging ? 'Déplacement...' : <>{booking.start_time?.slice(0, 5)} - {booking.end_time?.slice(0, 5)}</>}
        </div>
        {!isTiny && (
          <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {booking.client_first_name} {booking.client_last_name}
            {booking.is_first_visit && (
              <span style={{
                background: '#3b82f6', color: '#fff', fontSize: 8, fontWeight: 800,
                padding: '1px 4px', borderRadius: 3, marginLeft: 4, letterSpacing: 0.5,
                lineHeight: 1, verticalAlign: 'middle',
              }}>NEW</span>
            )}
          </div>
        )}
        {!isSmall && (
          <div style={{ fontSize: 10, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.02em' }}>
            {booking.service_name}
          </div>
        )}
      </div>
      {showHover && !isDragging && <BookingHoverCard booking={booking} anchorRect={anchorRect} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// BlockedSlotBlock
// ---------------------------------------------------------------------------

const BLOCK_TYPE_LABELS = { break: 'Pause', personal: 'Perso', closed: 'Fermé' };

function BlockedSlotBlock({ block, onClick }) {
  const startMin = timeToMinutes(block.start_time) - HOUR_START * 60;
  const endMin = timeToMinutes(block.end_time) - HOUR_START * 60;
  const duration = endMin - startMin;
  const top = Math.max(startMin * PX_PER_MIN, 0);
  const height = duration * PX_PER_MIN;

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: 1,
        right: 1,
        height: Math.max(height, 18),
        background: 'repeating-linear-gradient(135deg, rgba(var(--overlay),0.03), rgba(var(--overlay),0.03) 4px, rgba(var(--overlay),0.08) 4px, rgba(var(--overlay),0.08) 8px)',
        borderLeft: '3px solid rgba(var(--overlay),0.2)',
        borderRadius: '0 4px 4px 0',
        padding: '2px 5px',
        cursor: 'pointer',
        overflow: 'hidden',
        fontSize: 10,
        color: 'rgba(var(--overlay),0.4)',
        zIndex: 1,
        boxSizing: 'border-box',
      }}
      onClick={(e) => { e.stopPropagation(); onClick(block); }}
      title={`${block.start_time?.slice(0, 5)} - ${block.end_time?.slice(0, 5)} | ${BLOCK_TYPE_LABELS[block.type] || block.type}${block.reason ? ' — ' + block.reason : ''}`}
    >
      <div style={{ fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {BLOCK_TYPE_LABELS[block.type] || block.type}
      </div>
      {height >= 30 && block.reason && (
        <div style={{ fontSize: 9, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {block.reason}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NowIndicator
// ---------------------------------------------------------------------------

function NowIndicator() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const minutes = now.getHours() * 60 + now.getMinutes();
  const offset = minutes - HOUR_START * 60;
  if (offset < 0 || offset > TOTAL_MINUTES) return null;
  const top = offset * PX_PER_MIN;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <div style={{ position: 'absolute', top, left: 0, right: 0, height: 0, zIndex: 20, pointerEvents: 'none' }}>
      {/* Time label in gutter */}
      <div style={{ position: 'absolute', left: 4, top: -9, fontSize: 10, fontWeight: 800, color: '#ef4444', fontFamily: 'var(--font-display, Orbitron, monospace)', fontVariantNumeric: 'tabular-nums', background: 'var(--bg, #0a0a0a)', padding: '1px 4px', borderRadius: 3, letterSpacing: '0.02em' }}>
        {timeStr}
      </div>
      {/* Circle at the gutter/grid boundary */}
      <div style={{ position: 'absolute', left: 48, top: -4, width: 9, height: 9, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px rgba(239,68,68,0.5)' }} />
      {/* Line across all columns */}
      <div style={{ position: 'absolute', left: 52, right: 0, top: 0, height: 2, background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.4)' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// BookingDetailModal
// ---------------------------------------------------------------------------

function BookingDetailModal({ booking, barbers, services, onClose, onStatusChange, onDelete, onReschedule, onNotesUpdated }) {
  const [subView, setSubView] = useState('detail'); // 'detail' | 'delete' | 'reschedule'
  const [notifyClient, setNotifyClient] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // Reschedule form state
  const [rDate, setRDate] = useState('');
  const [rTime, setRTime] = useState('');
  const [rBarberId, setRBarberId] = useState('');
  const [rServiceId, setRServiceId] = useState('');
  const [rSaving, setRSaving] = useState(false);
  const [rError, setRError] = useState('');

  // Notes state
  const [notes, setNotes] = useState(booking?.client_notes || '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const noteTimerRef = useRef(null);

  // Auto-save notes after 800ms of inactivity
  function handleNotesChange(value) {
    setNotes(value);
    setNotesSaved(false);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(async () => {
      if (!booking?.client_id) return;
      setNotesSaving(true);
      try {
        await updateClient(booking.client_id, { notes: value });
        setNotesSaved(true);
        onNotesUpdated?.(booking.client_id, value);
        setTimeout(() => setNotesSaved(false), 2000);
      } catch { /* silent */ }
      setNotesSaving(false);
    }, 800);
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (noteTimerRef.current) clearTimeout(noteTimerRef.current); };
  }, []);

  if (!booking) return null;

  const color = hexToBlockStyle(booking.service_color || FALLBACK_COLOR);
  const hasEmail = !!booking.client_email;
  const bookingDateStr = typeof booking.date === 'string' ? booking.date.slice(0, 10) : format(new Date(booking.date), 'yyyy-MM-dd');

  function openReschedule() {
    setRDate(bookingDateStr);
    setRTime(booking.start_time?.slice(0, 5) || '09:00');
    setRBarberId(booking.barber_id || '');
    setRServiceId(booking.service_id || '');
    setNotifyClient(true);
    setRError('');
    setSubView('reschedule');
  }

  async function handleDelete() {
    setDeleting(true);
    await onDelete(booking.id, notifyClient && hasEmail);
    setDeleting(false);
  }

  async function handleReschedule(e) {
    e.preventDefault();
    setRError('');
    setRSaving(true);
    try {
      await onReschedule(booking.id, {
        date: rDate,
        start_time: rTime,
        barber_id: rBarberId,
        service_id: rServiceId,
        notify_client: notifyClient && hasEmail,
      });
    } catch (err) {
      setRError(err.message);
      setRSaving(false);
    }
  }

  // ---------- DELETE CONFIRMATION ----------
  if (subView === 'delete') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
          <div className="modal-header">
            <h3 className="modal-title" style={{ color: 'var(--danger, #ef4444)' }}>Supprimer le RDV</h3>
            <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
          </div>
          <div className="modal-body">
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{booking.client_first_name} {booking.client_last_name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #ccc)', marginTop: 2 }}>
                {booking.service_name} — {booking.date ? format(parseISO(bookingDateStr), 'EEEE d MMM', { locale: fr }) : ''} à {booking.start_time?.slice(0, 5)}
              </div>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary, #ccc)', marginBottom: 16 }}>
              Cette action est irréversible. Le créneau sera libéré.
            </p>
            {hasEmail && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 14px', background: 'rgba(var(--overlay),0.03)', border: '1px solid rgba(var(--overlay),0.08)', borderRadius: 8 }}>
                <input
                  type="checkbox"
                  checked={notifyClient}
                  onChange={(e) => setNotifyClient(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#3b82f6', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Prévenir le client par email</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{booking.client_email}</div>
                </div>
              </label>
            )}
            {!hasEmail && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' }}>
                Pas d'email — le client ne sera pas notifié.
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary btn-sm" onClick={() => setSubView('detail')}>Retour</button>
            <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Suppression...' : 'Confirmer la suppression'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- RESCHEDULE FORM ----------
  if (subView === 'reschedule') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="modal-header">
            <h3 className="modal-title">Déplacer le RDV</h3>
            <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
          </div>
          <form onSubmit={handleReschedule}>
            <div className="modal-body">
              {rError && (
                <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', fontSize: 13, marginBottom: 14 }}>{rError}</div>
              )}
              <div style={{ background: 'rgba(var(--overlay),0.03)', border: '1px solid rgba(var(--overlay),0.08)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{booking.client_first_name} {booking.client_last_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Actuellement : {booking.date ? format(parseISO(bookingDateStr), 'EEE d MMM', { locale: fr }) : ''} à {booking.start_time?.slice(0, 5)} avec {booking.barber_name}
                </div>
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>Nouveau créneau</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="label">Date</label>
                  <input className="input" type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="label">Heure</label>
                  <input className="input" type="time" value={rTime} onChange={(e) => setRTime(e.target.value)} min="09:00" max="19:00" required />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="label">Barber</label>
                  <select className="input" value={rBarberId} onChange={(e) => setRBarberId(e.target.value)} required>
                    {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Prestation</label>
                  <select className="input" value={rServiceId} onChange={(e) => setRServiceId(e.target.value)} required>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ height: 1, background: 'rgba(var(--overlay),0.08)', margin: '14px 0' }} />

              {hasEmail && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 14px', background: 'rgba(var(--overlay),0.03)', border: '1px solid rgba(var(--overlay),0.08)', borderRadius: 8 }}>
                  <input
                    type="checkbox"
                    checked={notifyClient}
                    onChange={(e) => setNotifyClient(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: '#3b82f6', cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Prévenir le client par email</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{booking.client_email}</div>
                  </div>
                </label>
              )}
              {!hasEmail && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' }}>
                  Pas d'email — le client ne sera pas notifié.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSubView('detail')}>Retour</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={rSaving}>
                {rSaving ? 'Déplacement...' : 'Déplacer le RDV'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ---------- DETAIL VIEW (default) ----------
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Rendez-vous</h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gap: 4 }}>
            <DetailRow label="Client" value={`${booking.client_first_name} ${booking.client_last_name}`} bold />
            <DetailRow label="Téléphone" value={booking.client_phone || '–'} />
            <DetailRow label="Email" value={booking.client_email || '–'} />
            <DetailRow label="Barber" value={booking.barber_name || '–'} />
            <DetailRow label="Prestation" value={booking.service_name} bold />
            <DetailRow label="Horaire" value={`${booking.start_time?.slice(0, 5)} – ${booking.end_time?.slice(0, 5)}`} />
            <DetailRow label="Date" value={booking.date ? format(parseISO(bookingDateStr), 'EEEE d MMMM yyyy', { locale: fr }) : '–'} />
            <DetailRow label="Prix" value={formatPrice(booking.price)} valueStyle={{ fontFamily: 'var(--font-display, Orbitron, monospace)', fontWeight: 800 }} />
            <DetailRow label="Source" value={{ online: 'En ligne', manual: 'Manuel', phone: 'Tél.', walk_in: 'Sans RDV' }[booking.source] || booking.source || '–'} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(var(--overlay),0.04)' }}>
              <span style={{ color: 'var(--text-muted, #888)', fontSize: 13 }}>Statut</span>
              <span className={`badge badge-${booking.status}`}>
                {STATUS_LABELS[booking.status] || booking.status}
              </span>
            </div>
            <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(var(--overlay),0.03)', borderRadius: 6, border: '1px solid rgba(var(--overlay),0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #888)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes client</div>
                {notesSaving && <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Sauvegarde...</span>}
                {notesSaved && <span style={{ fontSize: 10, color: '#22c55e' }}>Sauvegarde</span>}
              </div>
              <textarea
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Ex: Sabot 3mm sur les cotes, fondu bas..."
                style={{
                  width: '100%', minHeight: 60, padding: '8px 10px', fontSize: 13,
                  background: 'rgba(var(--overlay),0.04)', border: '1px solid rgba(var(--overlay),0.1)',
                  borderRadius: 6, color: 'var(--text)', resize: 'vertical', lineHeight: 1.5,
                  fontFamily: 'inherit', outline: 'none',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'rgba(59,130,246,0.4)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'rgba(var(--overlay),0.1)'; }}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
          {booking.status === 'confirmed' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => onStatusChange(booking.id, 'completed')}>Terminé</button>
              <button className="btn btn-secondary btn-sm" style={{ color: 'var(--warning, #f59e0b)' }} onClick={() => onStatusChange(booking.id, 'no_show')}>No-show</button>
              <button className="btn btn-secondary btn-sm" onClick={openReschedule}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                Déplacer
              </button>
            </>
          )}
          {booking.status === 'no_show' && (
            <button className="btn btn-primary btn-sm" onClick={() => onStatusChange(booking.id, 'confirmed')}>Re-confirmer</button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => { setNotifyClient(true); setSubView('delete'); }}>Supprimer</button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, bold, valueStyle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(var(--overlay),0.04)' }}>
      <span style={{ color: 'var(--text-muted, #888)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, fontSize: 14, textAlign: 'right', ...valueStyle }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateBookingModal
// ---------------------------------------------------------------------------

function CreateBookingModal({ barbers, services, onClose, onCreated, initialDate, initialTime, initialBarberId }) {
  const [barberId, setBarberId] = useState(initialBarberId || (barbers[0]?.id ?? ''));
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [date, setDate] = useState(initialDate || format(new Date(), 'yyyy-MM-dd'));
  const [time, setTime] = useState(initialTime || '09:00');
  const selectedService = services.find((s) => s.id === serviceId);
  const [duration, setDuration] = useState(selectedService?.duration || 30);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Recurrence state
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState('biweekly');
  const [recurrenceEndType, setRecurrenceEndType] = useState('occurrences');
  const [recurrenceOccurrences, setRecurrenceOccurrences] = useState(6);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [recurrenceResult, setRecurrenceResult] = useState(null); // { created, skipped }

  // Client autocomplete state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const searchTimerRef = useRef(null);
  const searchWrapperRef = useRef(null);

  // Update duration when service changes
  useEffect(() => {
    const svc = services.find((s) => s.id === serviceId);
    if (svc) setDuration(svc.duration);
  }, [serviceId, services]);

  // Close search dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup timer
  useEffect(() => {
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, []);

  function handleSearchChange(e) {
    const value = e.target.value;
    setSearchQuery(value);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!value || value.trim().length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const data = await getClients({ search: value.trim(), limit: 5 });
        setSearchResults(data.clients || []);
        setSearchOpen(true);
      } catch { setSearchResults([]); }
      setSearchLoading(false);
    }, 300);
  }

  function handleSelectClient(client) {
    setSelectedClient(client);
    setFirstName(client.first_name || '');
    setLastName(client.last_name || '');
    setPhone(client.phone || '');
    setEmail(client.email || '');
    setSearchQuery('');
    setSearchResults([]);
    setSearchOpen(false);
  }

  function handleClearClient() {
    setSelectedClient(null);
    setFirstName('');
    setLastName('');
    setPhone('');
    setEmail('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        barber_id: barberId, service_id: serviceId, date, start_time: time,
        duration, first_name: firstName, last_name: lastName, phone, email: email || undefined,
      };

      if (repeatEnabled) {
        const recurrence = { type: recurrenceType, end_type: recurrenceEndType };
        if (recurrenceEndType === 'occurrences') recurrence.occurrences = recurrenceOccurrences;
        else recurrence.end_date = recurrenceEndDate;
        payload.recurrence = recurrence;
      }

      const result = await createBooking(payload);

      if (repeatEnabled && result.created) {
        setRecurrenceResult(result);
        setSaving(false);
      } else {
        onCreated();
      }
    } catch (err) { setError(err.message); setSaving(false); }
  }

  const formRow = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

  const RECURRENCE_LABELS = { weekly: 'Toutes les semaines', biweekly: 'Toutes les 2 semaines', monthly: 'Tous les mois' };

  // ---------- RECURRENCE RESULT VIEW ----------
  if (recurrenceResult) {
    const { created, skipped } = recurrenceResult;
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="modal-header">
            <h3 className="modal-title">RDV recurrents crees</h3>
            <button className="btn-ghost" onClick={() => { setRecurrenceResult(null); onCreated(); }}><CloseIcon /></button>
          </div>
          <div className="modal-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '12px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{created.length} rendez-vous cree{created.length > 1 ? 's' : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{RECURRENCE_LABELS[recurrenceType]}</div>
              </div>
            </div>

            {skipped.length > 0 && (
              <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', marginBottom: 6 }}>
                  {skipped.length} date{skipped.length > 1 ? 's' : ''} ignoree{skipped.length > 1 ? 's' : ''} (creneaux deja pris)
                </div>
                {skipped.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
                    {s.date} — {s.reason}
                  </div>
                ))}
              </div>
            )}

            {created.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {created.map((bk, i) => {
                  const d = typeof bk.date === 'string' ? bk.date.slice(0, 10) : bk.date;
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(var(--overlay),0.04)', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{d}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{bk.start_time?.slice(0, 5)} - {bk.end_time?.slice(0, 5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-primary btn-sm" onClick={() => { setRecurrenceResult(null); onCreated(); }}>Fermer</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3 className="modal-title">Nouveau rendez-vous</h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', fontSize: 13, marginBottom: 14 }}>{error}</div>
            )}

            {/* Section RDV */}
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>Rendez-vous</div>
            <div style={formRow}>
              <div className="form-group">
                <label className="label">Barber</label>
                <select className="input" value={barberId} onChange={(e) => setBarberId(e.target.value)} required>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Prestation</label>
                <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration}min)</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="label">Date</label>
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Heure</label>
                <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} min="09:00" max="19:00" required />
              </div>
              <div className="form-group">
                <label className="label">Duree (min)</label>
                <input className="input" type="number" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 0)} min="5" step="5" required />
              </div>
            </div>

            {/* Recurrence toggle */}
            <div style={{ height: 1, background: 'rgba(var(--overlay),0.08)', margin: '12px 0' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 0', marginBottom: repeatEnabled ? 8 : 0 }}>
              <div
                onClick={(e) => { e.preventDefault(); setRepeatEnabled(!repeatEnabled); }}
                style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: repeatEnabled ? '#3b82f6' : 'rgba(var(--overlay),0.12)',
                  position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 2, left: repeatEnabled ? 18 : 2, transition: 'left 0.2s',
                }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Repeter</span>
            </label>

            {repeatEnabled && (
              <div style={{ padding: '10px 14px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 8, marginBottom: 4 }}>
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="label">Frequence</label>
                  <select className="input" value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value)}>
                    <option value="weekly">Toutes les semaines</option>
                    <option value="biweekly">Toutes les 2 semaines</option>
                    <option value="monthly">Tous les mois</option>
                  </select>
                </div>
                <div style={formRow}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="label">Fin</label>
                    <select className="input" value={recurrenceEndType} onChange={(e) => setRecurrenceEndType(e.target.value)}>
                      <option value="occurrences">Apres X seances</option>
                      <option value="end_date">A une date</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    {recurrenceEndType === 'occurrences' ? (
                      <>
                        <label className="label">Nb de seances</label>
                        <input className="input" type="number" value={recurrenceOccurrences} onChange={(e) => setRecurrenceOccurrences(Math.max(2, Math.min(52, parseInt(e.target.value) || 2)))} min="2" max="52" />
                      </>
                    ) : (
                      <>
                        <label className="label">Date de fin</label>
                        <input className="input" type="date" value={recurrenceEndDate} onChange={(e) => setRecurrenceEndDate(e.target.value)} min={date} required={recurrenceEndType === 'end_date'} />
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div style={{ height: 1, background: 'rgba(var(--overlay),0.08)', margin: '12px 0' }} />

            {/* Section Client */}
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>Client</div>

            {/* Autocomplete search */}
            {!selectedClient && (
              <div ref={searchWrapperRef} style={{ position: 'relative', marginBottom: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="label">Rechercher un client existant</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input"
                      value={searchQuery}
                      onChange={handleSearchChange}
                      placeholder="Nom, prenom ou telephone..."
                      onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); }}
                    />
                    {searchLoading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 12 }}>...</span>}
                  </div>
                </div>
                {searchOpen && searchResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-hover)', border: '1px solid rgba(var(--overlay),0.1)', borderRadius: 6, zIndex: 50, maxHeight: 200, overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                    {searchResults.map((c) => (
                      <div
                        key={c.id}
                        style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(var(--overlay),0.06)', transition: 'background 0.1s' }}
                        onClick={() => handleSelectClient(c)}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--overlay),0.06)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{c.first_name} {c.last_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.phone}{c.email ? ` — ${c.email}` : ''}</div>
                      </div>
                    ))}
                  </div>
                )}
                {searchOpen && searchQuery.trim().length >= 2 && searchResults.length === 0 && !searchLoading && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-hover)', border: '1px solid rgba(var(--overlay),0.1)', borderRadius: 6, zIndex: 50, padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
                    Aucun client trouve
                  </div>
                )}
              </div>
            )}

            {/* Selected client badge */}
            {selectedClient && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{selectedClient.first_name} {selectedClient.last_name}</span>
                <button type="button" onClick={handleClearClient} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>&times;</button>
              </div>
            )}

            <div style={formRow}>
              <div className="form-group">
                <label className="label">Prenom</label>
                <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required readOnly={!!selectedClient} style={selectedClient ? { opacity: 0.6 } : undefined} />
              </div>
              <div className="form-group">
                <label className="label">Nom</label>
                <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required readOnly={!!selectedClient} style={selectedClient ? { opacity: 0.6 } : undefined} />
              </div>
            </div>
            <div style={formRow}>
              <div className="form-group">
                <label className="label">Telephone</label>
                <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required readOnly={!!selectedClient} style={selectedClient ? { opacity: 0.6 } : undefined} />
              </div>
              <div className="form-group">
                <label className="label">Email</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={!!selectedClient} style={selectedClient ? { opacity: 0.6 } : undefined} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Creation...' : repeatEnabled ? 'Creer la serie' : 'Creer le RDV'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BlockSlotModal
// ---------------------------------------------------------------------------

function BlockSlotModal({ barbers, onClose, onCreated, initialDate, initialBarberId }) {
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
          <h3 className="modal-title">Bloquer un créneau</h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', fontSize: 13, marginBottom: 14 }}>{error}</div>
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
                <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} min="09:00" max="19:00" required />
              </div>
              <div className="form-group">
                <label className="label">Fin</label>
                <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} min="09:00" max="19:00" required />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Raison (optionnel)</label>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: Pause déjeuner" />
            </div>
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

// ---------------------------------------------------------------------------
// BlockDetailModal
// ---------------------------------------------------------------------------

function BlockDetailModal({ block, onClose, onDelete }) {
  if (!block) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Créneau bloqué</h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gap: 4 }}>
            <DetailRow label="Type" value={BLOCK_TYPE_LABELS[block.type] || block.type} bold />
            <DetailRow label="Barber" value={block.barber_name || '–'} />
            <DetailRow label="Date" value={block.date ? format(parseISO(typeof block.date === 'string' ? block.date.slice(0, 10) : block.date), 'EEEE d MMMM yyyy', { locale: fr }) : '–'} />
            <DetailRow label="Horaire" value={`${block.start_time?.slice(0, 5)} – ${block.end_time?.slice(0, 5)}`} />
            {block.reason && <DetailRow label="Raison" value={block.reason} />}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(block.id)}>Supprimer le blocage</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MinutePickerPopup
// ---------------------------------------------------------------------------

function MinutePickerPopup({ hour, position, onSelect, onClose }) {
  const popupRef = useRef(null);
  const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  useEffect(() => {
    function handleClickOutside(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose();
      }
    }
    function handleEsc(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  // Adjust popup position to stay within viewport
  const [adjustedPos, setAdjustedPos] = useState(position);
  useEffect(() => {
    if (!popupRef.current) return;
    const rect = popupRef.current.getBoundingClientRect();
    let { top, left } = position;
    if (rect.right > window.innerWidth - 12) left = window.innerWidth - rect.width - 12;
    if (rect.bottom > window.innerHeight - 12) top = position.top - rect.height - 10;
    if (left < 12) left = 12;
    if (top < 12) top = 12;
    setAdjustedPos({ top, left });
  }, [position]);

  const hh = String(hour).padStart(2, '0');

  return (
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        top: adjustedPos.top,
        left: adjustedPos.left,
        zIndex: 100,
        background: 'var(--bg-hover)',
        border: '1px solid rgba(var(--overlay),0.15)',
        borderRadius: 10,
        padding: '14px 16px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        minWidth: 280,
        animation: 'minutePopupIn 0.15s ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-secondary)' }}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Ajouter une réservation à :</span>
        </div>
        <span style={{ fontFamily: 'var(--font-display, Orbitron, monospace)', fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{hh}:--</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
        {minutes.map((m) => {
          const mm = String(m).padStart(2, '0');
          return (
            <button
              key={m}
              onClick={() => onSelect(`${hh}:${mm}`)}
              style={{
                padding: '8px 4px',
                fontSize: 13,
                fontWeight: 700,
                fontFamily: 'var(--font-display, Orbitron, monospace)',
                background: 'rgba(var(--overlay),0.05)',
                border: '1px solid rgba(var(--overlay),0.1)',
                borderRadius: 6,
                color: 'var(--text)',
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(var(--overlay),0.15)';
                e.currentTarget.style.borderColor = 'rgba(var(--overlay),0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(var(--overlay),0.05)';
                e.currentTarget.style.borderColor = 'rgba(var(--overlay),0.1)';
              }}
            >
              {mm}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimeGrid
// ---------------------------------------------------------------------------

function TimeGrid({ days, barbers, bookingsByDayBarber, blockedByDayBarber, barberOffDays, onBookingClick, onBlockClick, onSlotClick, view, onSwipeLeft, onSwipeRight, onDragDrop, draggingId }) {
  const scrollRef = useRef(null);
  const gridBodyRef = useRef(null);
  const touchRef = useRef(null);
  const barberCount = barbers.length || 1;
  const isWeek = view === 'week';
  const dayCount = days.length;

  // Check if a barber is off on a given date (0=Monday convention)
  function isBarberOff(barberId, date) {
    const offSet = barberOffDays?.[barberId];
    if (!offSet || offSet.size === 0) return false;
    const jsDay = date.getDay(); // 0=Sunday
    const dow = jsDay === 0 ? 6 : jsDay - 1; // Convert to 0=Monday
    return offSet.has(dow);
  }

  // Minute picker state
  const [minutePicker, setMinutePicker] = useState(null); // { hour, dayStr, barberId, position: {top, left} }

  // Hover indicator state
  const [hoverInfo, setHoverInfo] = useState(null); // { barberId, dayStr, top, time }

  // Drag-over highlight state
  const [dragOverTarget, setDragOverTarget] = useState(null); // { dayStr, barberId }

  // Swipe to navigate days on mobile
  function handleTouchStart(e) {
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function handleTouchEnd(e) {
    if (!touchRef.current) return;
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = e.changedTouches[0].clientY - touchRef.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    }
    touchRef.current = null;
  }

  // Build hour labels
  const hours = [];
  for (let h = HOUR_START; h <= HOUR_END; h++) hours.push(h);

  // Sticky header height
  const headerH = barberCount > 1 ? 68 : 44;

  return (
    <div
      ref={scrollRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(var(--overlay),0.08)',
        borderRadius: 10,
        background: 'var(--bg-card)',
        height: 'calc(100vh - 180px)',
        overflow: 'hidden',
      }}
    >
      {/* ===== STICKY HEADER (day names + barber names) ===== */}
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid rgba(var(--overlay),0.10)' }}>
        {/* Gutter spacer */}
        <div style={{ width: 52, minWidth: 52, borderRight: '1px solid rgba(var(--overlay),0.10)' }} />

        {/* Day headers */}
        {days.map((day) => {
          const dayStr = format(day, 'yyyy-MM-dd');
          const current = isToday(day);
          return (
            <div key={dayStr} style={{ flex: 1, borderRight: '1px solid rgba(var(--overlay),0.25)', overflow: 'hidden' }}>
              {/* Day label */}
              <div style={{
                textAlign: 'center',
                padding: '6px 2px 4px',
                background: current ? 'rgba(34,197,94,0.06)' : 'transparent',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: current ? '#22c55e' : 'var(--text-secondary)' }}>
                  {format(day, isWeek ? 'EEE' : 'EEEE', { locale: fr })}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: current ? '#22c55e' : 'var(--text)', fontFamily: 'var(--font-display, Orbitron, monospace)', lineHeight: 1.2 }}>
                  {format(day, 'd')}
                </div>
              </div>
              {/* Barber sub-headers */}
              {barberCount > 1 && (
                <div style={{ display: 'flex', borderTop: '1px solid rgba(var(--overlay),0.06)' }}>
                  {barbers.map((b) => {
                    const off = isBarberOff(b.id, day);
                    return (
                      <div key={b.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3px 1px', fontSize: 10, fontWeight: 700, color: off ? 'var(--text-muted)' : 'var(--text-secondary)', borderRight: '1px solid rgba(var(--overlay),0.04)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em', opacity: off ? 0.5 : 1 }}>
                        {b.photo_url && (
                          <img src={b.photo_url} alt={b.name} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', marginBottom: 1, filter: off ? 'grayscale(1) opacity(0.4)' : 'none' }} />
                        )}
                        {off ? <s>{b.name.split(' ')[0]}</s> : b.name.split(' ')[0]}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ===== SCROLLABLE BODY (time gutter + grid) ===== */}
      <div
        ref={gridBodyRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onScroll={() => { if (minutePicker) setMinutePicker(null); }}
      >
        <div style={{ display: 'flex', height: GRID_HEIGHT + 10, paddingTop: 10, position: 'relative' }}>
          {/* Now indicator — spans the entire grid width */}
          {days.some((d) => isToday(d)) && <NowIndicator />}

          {/* Time gutter */}
          <div style={{ width: 52, minWidth: 52, position: 'relative', borderRight: '1px solid rgba(var(--overlay),0.10)', flexShrink: 0 }}>
            {hours.map((h, i) => (
              <div key={h}>
                <div style={{ position: 'absolute', top: i * HOUR_HEIGHT - 7, right: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', userSelect: 'none' }}>
                  {String(h).padStart(2, '0')}:00
                </div>
                {i < hours.length - 1 && (
                  <div style={{ position: 'absolute', top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 - 6, right: 6, fontSize: 10, color: 'rgba(var(--overlay),0.35)', fontVariantNumeric: 'tabular-nums', userSelect: 'none' }}>
                    :30
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const current = isToday(day);

            return (
              <div key={dayStr} style={{ flex: 1, borderRight: '1px solid rgba(var(--overlay),0.25)', position: 'relative' }}>
                {/* Hour lines */}
                {hours.map((h, i) => (
                  <div key={`line-${h}`}>
                    <div style={{ position: 'absolute', top: i * HOUR_HEIGHT, left: 0, right: 0, borderTop: '1px solid rgba(var(--overlay),0.08)', pointerEvents: 'none' }} />
                    {i < hours.length - 1 && (
                      <div style={{ position: 'absolute', top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2, left: 0, right: 0, borderTop: '1px dashed rgba(var(--overlay),0.025)', pointerEvents: 'none' }} />
                    )}
                  </div>
                ))}

                {/* Barber columns */}
                <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
                  {barbers.map((barber, bIdx) => {
                    const key = `${dayStr}_${barber.id}`;
                    const dayBookings = bookingsByDayBarber[key] || [];
                    const dayBlocked = blockedByDayBarber?.[key] || [];
                    const barberIsOff = isBarberOff(barber.id, day);

                    const isDragOver = dragOverTarget && dragOverTarget.dayStr === dayStr && dragOverTarget.barberId === barber.id;

                    return (
                      <div
                        key={barber.id}
                        className="planning-barber-col"
                        style={{
                          flex: 1,
                          position: 'relative',
                          borderRight: bIdx < barberCount - 1 ? '1px solid rgba(var(--overlay),0.04)' : 'none',
                          cursor: barberIsOff ? 'default' : 'pointer',
                          background: barberIsOff ? 'repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(var(--overlay),0.02) 6px, rgba(var(--overlay),0.02) 7px)' : isDragOver ? 'rgba(59,130,246,0.08)' : 'transparent',
                          transition: 'background 0.15s',
                        }}
                        onClick={(e) => {
                          if (barberIsOff) return;
                          if (!gridBodyRef.current) return;
                          const rect = gridBodyRef.current.getBoundingClientRect();
                          const scrollTop = gridBodyRef.current.scrollTop;
                          const relativeY = (e.clientY - rect.top) + scrollTop - 10;
                          const totalMinutes = Math.round(relativeY / PX_PER_MIN / 5) * 5 + HOUR_START * 60;
                          const clamped = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, totalMinutes));
                          const hour = Math.floor(clamped / 60);
                          setMinutePicker({
                            hour,
                            dayStr,
                            barberId: barber.id,
                            position: { top: e.clientY - 10, left: e.clientX + 10 },
                          });
                          setHoverInfo(null);
                        }}
                        onMouseMove={(e) => {
                          if (minutePicker) return;
                          if (!gridBodyRef.current) return;
                          const rect = gridBodyRef.current.getBoundingClientRect();
                          const scrollTop = gridBodyRef.current.scrollTop;
                          const relativeY = (e.clientY - rect.top) + scrollTop - 10;
                          const totalMinutes = Math.round(relativeY / PX_PER_MIN / 5) * 5 + HOUR_START * 60;
                          const clamped = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, totalMinutes));
                          const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
                          const mm = String(clamped % 60).padStart(2, '0');
                          const topPx = (clamped - HOUR_START * 60) * PX_PER_MIN;
                          setHoverInfo({ barberId: barber.id, dayStr, top: topPx, time: `${hh}:${mm}` });
                        }}
                        onMouseLeave={() => setHoverInfo(null)}
                        onDragOver={(e) => {
                          if (barberIsOff) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDragOverTarget({ dayStr, barberId: barber.id });
                        }}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          setDragOverTarget({ dayStr, barberId: barber.id });
                        }}
                        onDragLeave={() => {
                          setDragOverTarget(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverTarget(null);
                          if (!gridBodyRef.current || !onDragDrop) return;
                          try {
                            const data = JSON.parse(e.dataTransfer.getData('application/json'));
                            const rect = gridBodyRef.current.getBoundingClientRect();
                            const scrollTop = gridBodyRef.current.scrollTop;
                            const relativeY = (e.clientY - rect.top) + scrollTop - 10;
                            const totalMinutes = Math.round(relativeY / PX_PER_MIN / 5) * 5 + HOUR_START * 60;
                            const clamped = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - 1, totalMinutes));
                            const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
                            const mm = String(clamped % 60).padStart(2, '0');
                            onDragDrop(data.bookingId, { date: dayStr, start_time: `${hh}:${mm}`, barber_id: barber.id });
                          } catch { /* invalid data */ }
                        }}
                      >
                        {/* Off-day overlay */}
                        {barberIsOff && (
                          <div style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 20, pointerEvents: 'none' }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(var(--overlay),0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(0,0,0,0.5)', padding: '3px 8px', borderRadius: 4 }}>Repos</span>
                          </div>
                        )}
                        {/* Hover time indicator */}
                        {!barberIsOff && hoverInfo && hoverInfo.barberId === barber.id && hoverInfo.dayStr === dayStr && !minutePicker && (
                          <div className="planning-hover-indicator" style={{ top: hoverInfo.top }}>
                            <div className="planning-hover-label">+ {hoverInfo.time}</div>
                          </div>
                        )}
                        {dayBlocked.map((bs) => (
                          <BlockedSlotBlock key={bs.id} block={bs} onClick={onBlockClick} />
                        ))}
                        {dayBookings.map((bk) => (
                          <BookingBlock key={bk.id} booking={bk} onClick={onBookingClick} isDragging={draggingId === bk.id} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Minute Picker Popup */}
      {minutePicker && (
        <MinutePickerPopup
          hour={minutePicker.hour}
          position={minutePicker.position}
          onClose={() => setMinutePicker(null)}
          onSelect={(time) => {
            const { dayStr, barberId } = minutePicker;
            setMinutePicker(null);
            onSlotClick?.(dayStr, barberId, time);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Planning component
// ---------------------------------------------------------------------------

export default function Planning() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState(window.innerWidth < 768 ? 'day' : 'week');
  const [bookings, setBookings] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blockedSlots, setBlockedSlots] = useState([]);
  const [barberOffDays, setBarberOffDays] = useState({}); // { barberId: Set([0,6]) }
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createDefaults, setCreateDefaults] = useState({});
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockDefaults, setBlockDefaults] = useState({});
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  // Detect mobile
  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setView('day');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const currentDateStr = format(currentDate, 'yyyy-MM-dd');

  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 1 }), [currentDateStr]);
  const weekEnd = useMemo(() => endOfWeek(currentDate, { weekStartsOn: 1 }), [currentDateStr]);

  const days = useMemo(() => {
    if (view === 'day') return [currentDate];
    const result = [];
    for (let i = 0; i < 7; i++) result.push(addDays(weekStart, i));
    return result;
  }, [view, weekStart, currentDateStr]);

  const apiDateStr = useMemo(
    () => format(view === 'week' ? weekStart : currentDate, 'yyyy-MM-dd'),
    [view, weekStart, currentDateStr]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [bk, b, s, bs] = await Promise.all([
        getBookings({ date: apiDateStr, view }),
        getBarbers(),
        getServices(),
        getBlockedSlots({ date: apiDateStr, view }),
      ]);
      setBookings(Array.isArray(bk) ? bk : []);
      const barberList = Array.isArray(b) ? b : [];
      setBarbers(barberList);
      setServices(Array.isArray(s) ? s : []);
      setBlockedSlots(Array.isArray(bs) ? bs : []);
      // Load schedules for all barbers to know off-days
      const offMap = {};
      await Promise.all(barberList.map(async (br) => {
        try {
          const sched = await getBarberSchedule(br.id);
          const offSet = new Set();
          (sched.weekly || []).forEach((w) => { if (!w.is_working) offSet.add(w.day_of_week); });
          offMap[br.id] = offSet;
        } catch { offMap[br.id] = new Set(); }
      }));
      setBarberOffDays(offMap);
    } catch (err) {
      console.error('Planning loadData error:', err);
    }
    setLoading(false);
  }, [apiDateStr, view]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const bookingsByDayBarber = useMemo(() => {
    const map = {};
    for (const bk of bookings) {
      const dateStr = typeof bk.date === 'string' ? bk.date.slice(0, 10) : format(new Date(bk.date), 'yyyy-MM-dd');
      const key = `${dateStr}_${bk.barber_id}`;
      if (!map[key]) map[key] = [];
      map[key].push(bk);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    }
    return map;
  }, [bookings]);

  const blockedByDayBarber = useMemo(() => {
    const map = {};
    for (const bs of blockedSlots) {
      const dateStr = typeof bs.date === 'string' ? bs.date.slice(0, 10) : format(new Date(bs.date), 'yyyy-MM-dd');
      const key = `${dateStr}_${bs.barber_id}`;
      if (!map[key]) map[key] = [];
      map[key].push(bs);
    }
    return map;
  }, [blockedSlots]);

  const stats = useMemo(() => {
    const active = bookings.filter((b) => b.status !== 'cancelled');
    return { count: active.length, revenue: active.reduce((s, b) => s + (b.price || 0), 0) };
  }, [bookings]);

  const navDisplay = useMemo(() => {
    if (view === 'day') return format(currentDate, 'EEEE d MMMM yyyy', { locale: fr });
    return `${format(weekStart, 'd MMM', { locale: fr })} \u2013 ${format(weekEnd, 'd MMM yyyy', { locale: fr })}`;
  }, [view, currentDateStr, weekStart, weekEnd]);

  function goToday() { setCurrentDate(new Date()); }
  function goPrev() { setCurrentDate(view === 'week' ? subWeeks(currentDate, 1) : subDays(currentDate, 1)); }
  function goNext() { setCurrentDate(view === 'week' ? addWeeks(currentDate, 1) : addDays(currentDate, 1)); }

  async function handleStatusChange(id, status) {
    try { await updateBookingStatus(id, status); setSelectedBooking(null); loadData(); } catch (err) { alert(err.message); }
  }

  async function handleDeleteBooking(id, notify = false) {
    try { await deleteBooking(id, { notify }); setSelectedBooking(null); loadData(); } catch (err) { alert(err.message); }
  }

  async function handleRescheduleBooking(id, data) {
    try {
      await updateBooking(id, data);
      setSelectedBooking(null);
      loadData();
    } catch (err) {
      throw err;
    }
  }

  function handleSlotClick(dateStr, barberId, time) {
    setCreateDefaults({ initialDate: dateStr, initialBarberId: barberId, initialTime: time });
    setShowCreateModal(true);
  }

  function handleCreateClick() {
    setCreateDefaults({ initialDate: format(currentDate, 'yyyy-MM-dd') });
    setShowCreateModal(true);
  }

  function handleCreated() {
    setShowCreateModal(false);
    setCreateDefaults({});
    loadData();
  }

  function handleBlockClick() {
    setBlockDefaults({ initialDate: format(currentDate, 'yyyy-MM-dd'), initialBarberId: barbers[0]?.id });
    setShowBlockModal(true);
  }

  function handleBlockCreated() {
    setShowBlockModal(false);
    setBlockDefaults({});
    loadData();
  }

  async function handleDeleteBlock(id) {
    if (!confirm('Supprimer ce blocage ?')) return;
    try { await deleteBlockedSlot(id); setSelectedBlock(null); loadData(); } catch (err) { alert(err.message); }
  }

  async function handleDragDrop(bookingId, { date, start_time, barber_id }) {
    setDraggingId(bookingId);
    try {
      await updateBooking(bookingId, { date, start_time, barber_id });
      await loadData();
    } catch (err) {
      alert('Erreur lors du déplacement : ' + err.message);
    }
    setDraggingId(null);
  }

  return (
    <>
      {/* Header */}
      <div className="page-header" style={isMobile ? { flexDirection: 'column', alignItems: 'stretch', gap: 8 } : undefined}>
        <div style={isMobile ? { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } : undefined}>
          <div>
            <h2 className="page-title" style={isMobile ? { fontSize: 18 } : undefined}>Planning</h2>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', gap: 12 }}>
              <span>RDV : <span style={{ fontFamily: 'var(--font-display, Orbitron, monospace)', fontWeight: 800, fontSize: 13, color: 'var(--text)', marginLeft: 4 }}>{stats.count}</span></span>
              <span>CA : <span style={{ fontFamily: 'var(--font-display, Orbitron, monospace)', fontWeight: 800, fontSize: 13, color: 'var(--text)', marginLeft: 4 }}>{formatPrice(stats.revenue)}</span></span>
            </div>
          </div>
          {isMobile && (
            <button className="btn btn-primary btn-sm" onClick={handleCreateClick} style={{ padding: '6px 10px' }}>
              <PlusIcon size={14} /> Nouveau
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: isMobile ? 'space-between' : undefined }}>
          {!isMobile && (
            <div style={{ display: 'flex', background: 'rgba(var(--overlay),0.04)', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(var(--overlay),0.08)' }}>
              {['week', 'day'].map((v) => (
                <button key={v} onClick={() => setView(v)} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: view === v ? 'rgba(var(--overlay),0.10)' : 'transparent', color: view === v ? 'var(--text)' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                  {v === 'week' ? 'Semaine' : 'Jour'}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: isMobile ? 1 : undefined, justifyContent: isMobile ? 'center' : undefined }}>
            <button onClick={goPrev} style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(var(--overlay),0.08)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft /></button>
            <span style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize', minWidth: isMobile ? 0 : 180, textAlign: 'center', userSelect: 'none' }}>{navDisplay}</span>
            <button onClick={goNext} style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(var(--overlay),0.08)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight /></button>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={goToday} style={isMobile ? { padding: '4px 10px', fontSize: 12 } : undefined}>Aujourd&apos;hui</button>
          <button className="btn btn-secondary btn-sm" onClick={handleRefresh} disabled={refreshing} title="Actualiser" style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RefreshIcon spinning={refreshing} />
          </button>
          {!isMobile && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={handleBlockClick} style={{ color: 'var(--text-secondary)' }}>Bloquer créneau</button>
              <button className="btn btn-primary btn-sm" onClick={handleCreateClick}><PlusIcon size={14} /> Nouveau RDV</button>
            </>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="page-body" style={{ paddingBottom: 0 }}>
        {loading ? (
          <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Chargement du planning...</div>
          </div>
        ) : barbers.length === 0 ? (
          <div className="empty-state" style={{ minHeight: 300 }}>Aucun barber configuré.</div>
        ) : (
          <TimeGrid
            days={days}
            barbers={barbers}
            bookingsByDayBarber={bookingsByDayBarber}
            blockedByDayBarber={blockedByDayBarber}
            barberOffDays={barberOffDays}
            onBookingClick={setSelectedBooking}
            onBlockClick={setSelectedBlock}
            onSlotClick={handleSlotClick}
            view={view}
            onSwipeLeft={goNext}
            onSwipeRight={goPrev}
            onDragDrop={handleDragDrop}
            draggingId={draggingId}
          />
        )}
      </div>

      {/* Modals */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          barbers={barbers}
          services={services}
          onClose={() => setSelectedBooking(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDeleteBooking}
          onReschedule={handleRescheduleBooking}
          onNotesUpdated={(clientId, newNotes) => {
            setBookings((prev) => prev.map((b) =>
              b.client_id === clientId ? { ...b, client_notes: newNotes } : b
            ));
            setSelectedBooking((prev) => prev ? { ...prev, client_notes: newNotes } : prev);
          }}
        />
      )}

      {showCreateModal && (
        <CreateBookingModal
          barbers={barbers}
          services={services}
          onClose={() => { setShowCreateModal(false); setCreateDefaults({}); }}
          onCreated={handleCreated}
          {...createDefaults}
        />
      )}

      {showBlockModal && (
        <BlockSlotModal
          barbers={barbers}
          onClose={() => { setShowBlockModal(false); setBlockDefaults({}); }}
          onCreated={handleBlockCreated}
          {...blockDefaults}
        />
      )}

      {selectedBlock && (
        <BlockDetailModal
          block={selectedBlock}
          onClose={() => setSelectedBlock(null)}
          onDelete={handleDeleteBlock}
        />
      )}
    </>
  );
}
