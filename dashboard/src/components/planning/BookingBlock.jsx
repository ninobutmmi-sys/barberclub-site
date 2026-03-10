// ---------------------------------------------------------------------------
// BookingBlock
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';
import { timeToMinutes, HOUR_START, PX_PER_MIN, FALLBACK_COLOR, STATUS_OVERRIDES, hexToBlockStyle } from './helpers';
import BookingHoverCard from './BookingHoverCard';

export default function BookingBlock({ booking, onClick, pxPerMin }) {
  const px = pxPerMin || PX_PER_MIN;
  const startMin = timeToMinutes(booking.start_time) - HOUR_START * 60;
  const endMin = timeToMinutes(booking.end_time) - HOUR_START * 60;
  const duration = endMin - startMin;
  const top = Math.max(startMin * px, 0);
  const height = duration * px;

  const color = STATUS_OVERRIDES[booking.status] || hexToBlockStyle(booking.service_color || FALLBACK_COLOR);
  const isTall = height >= 90;
  const isSmall = height < 50;
  const isTiny = height < 30;

  const blockRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const [showHover, setShowHover] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);

  const hasHover = window.matchMedia('(hover: hover)').matches;

  function handleMouseEnter(e) {
    if (!hasHover) return; // skip on touch devices
    e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';
    e.currentTarget.style.zIndex = '20';
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

  const isOnline = booking.source === 'online';
  const isFirstVisit = booking.is_first_visit;

  return (
    <>
      <div
        ref={blockRef}
        className={isFirstVisit ? 'planning-block-first-visit' : undefined}
        style={{
          position: 'absolute',
          top,
          left: 1,
          right: 1,
          height: Math.max(height, 26),
          background: color.bg,
          borderLeft: `3px solid ${isFirstVisit ? '#f59e0b' : color.border}`,
          borderRadius: '0 4px 4px 0',
          padding: isTiny ? '2px 5px' : '4px 6px',
          cursor: 'pointer',
          overflow: 'hidden',
          fontSize: 12,
          lineHeight: '15px',
          color: color.text || 'var(--text)',
          zIndex: 2,
          boxSizing: 'border-box',
          transition: 'box-shadow 0.12s, opacity 0.15s',
          opacity: 1,
        }}
        onClick={(e) => { e.stopPropagation(); setShowHover(false); onClick(booking, blockRef.current?.getBoundingClientRect()); }}
        onMouseMove={(e) => e.stopPropagation()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* First visit shimmer accent */}
        {isFirstVisit && (
          <div className="planning-block-first-shimmer" />
        )}

        {/* Source indicator — top right */}
        {isOnline && (
          <div className="planning-block-source" title="Réservé en ligne">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
        )}

        <div className="planning-block-time" style={{ fontWeight: 600, fontSize: 10, opacity: 0.7, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {booking.start_time?.slice(0, 5)} - {booking.end_time?.slice(0, 5)}
        </div>
        {!isTiny && (
          <div className="planning-block-name" style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isTall ? 'normal' : 'nowrap', paddingRight: isOnline ? 14 : 0 }}>
            {booking.client_first_name} {booking.client_last_name}
            {isFirstVisit && !isTiny && (
              <span className="planning-block-new-badge">
                <svg viewBox="0 0 24 24" width="8" height="8" fill="currentColor" stroke="none"><path d="M12 2l2.09 6.26L20.18 9.27l-5.09 3.9L16.18 19.27 12 16l-4.18 3.27 1.09-6.1-5.09-3.9 6.09-1.01z"/></svg>
                1er RDV
              </span>
            )}
          </div>
        )}
        {!isSmall && (
          <div className="planning-block-service" style={{ fontSize: 10, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isTall ? 'normal' : 'nowrap', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.02em' }}>
            {booking.service_name}
          </div>
        )}
      </div>
      {showHover && <BookingHoverCard booking={booking} anchorRect={anchorRect} />}
    </>
  );
}
