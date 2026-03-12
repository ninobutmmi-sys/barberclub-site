// ---------------------------------------------------------------------------
// BookingQuickActions — Desktop popover + Mobile bottom sheet
// ---------------------------------------------------------------------------

import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function BookingQuickActions({ booking, anchorRect, onViewDetail, onDelete, onStatusChange, onClose, isMobile }) {
  const popRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (popRef.current && !popRef.current.contains(e.target)) onClose();
    }
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    if (!isMobile) window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose, isMobile]);

  if (!booking) return null;

  // ---- MOBILE: bottom sheet ----
  if (isMobile) {
    return createPortal(
      <>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9998 }} onClick={onClose} />
        <div
          ref={popRef}
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
            background: 'var(--bg-card)', borderRadius: '16px 16px 0 0',
            padding: '12px 16px calc(env(safe-area-inset-bottom, 0px) + 16px)',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ width: 32, height: 4, borderRadius: 2, background: 'rgba(var(--overlay),0.15)', margin: '0 auto 16px' }} />

          {/* Client info + call */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '14px 16px', background: 'rgba(var(--overlay),0.04)', borderRadius: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{booking.client_first_name} {booking.client_last_name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
                {booking.service_name} · {booking.start_time?.slice(0, 5)} – {booking.end_time?.slice(0, 5)}
              </div>
            </div>
            {booking.client_phone && (
              <a
                href={`tel:${booking.client_phone.replace(/\s/g, '')}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#22c55e', textDecoration: 'none', flexShrink: 0,
                }}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </a>
            )}
          </div>

          {/* Status actions */}
          {booking.status === 'confirmed' && onStatusChange && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => onStatusChange(booking.id, 'completed')}
                style={{
                  flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                  background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                Termine
              </button>
              <button
                onClick={() => onStatusChange(booking.id, 'no_show')}
                style={{
                  flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                  background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                Faux plan
              </button>
            </div>
          )}

          {/* Detail + Delete */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onViewDetail(booking)}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12,
                background: 'rgba(var(--overlay),0.06)', border: '1px solid rgba(var(--overlay),0.1)',
                color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'var(--font)',
              }}
            >
              Voir details
            </button>
            <button
              onClick={() => onDelete(booking)}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
                color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'var(--font)',
              }}
            >
              Supprimer
            </button>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ---- DESKTOP: small popover ----
  if (!anchorRect) return null;

  const popW = 44;
  let left = anchorRect.right + 6;
  let top = anchorRect.top + (anchorRect.height / 2) - 46;
  if (left + popW > window.innerWidth - 12) left = anchorRect.left - popW - 6;
  if (top < 8) top = 8;
  if (top + 92 > window.innerHeight - 12) top = window.innerHeight - 104;

  return createPortal(
    <div
      ref={popRef}
      className="quick-actions-pop"
      style={{ position: 'fixed', top, left, zIndex: 9999 }}
    >
      <button className="quick-actions-btn" title="Modifier" onClick={(e) => { e.stopPropagation(); onViewDetail(booking); }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
      </button>
      <button className="quick-actions-btn" title="Supprimer" style={{ '--qa-color': '#ef4444' }} onClick={(e) => { e.stopPropagation(); onDelete(booking); }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
      </button>
    </div>,
    document.body
  );
}
