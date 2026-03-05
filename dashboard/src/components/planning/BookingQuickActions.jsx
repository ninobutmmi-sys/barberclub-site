// ---------------------------------------------------------------------------
// BookingQuickActions — Timify-style action popover on click
// ---------------------------------------------------------------------------

import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function BookingQuickActions({ booking, anchorRect, onViewDetail, onDelete, onClose }) {
  const popRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (popRef.current && !popRef.current.contains(e.target)) onClose();
    }
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    function handleScroll() { onClose(); }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  if (!booking || !anchorRect) return null;

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
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button className="quick-actions-btn" title="Supprimer" style={{ '--qa-color': '#ef4444' }} onClick={(e) => { e.stopPropagation(); onDelete(booking); }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>,
    document.body
  );
}
