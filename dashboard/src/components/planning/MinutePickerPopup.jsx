// ---------------------------------------------------------------------------
// MinutePickerPopup
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';

export default function MinutePickerPopup({ hour, position, onSelect, onClose, occupiedSlots }) {
  const popupRef = useRef(null);
  const minutes = [0, 10, 20, 30, 40, 50];

  // Check if a minute is occupied by an existing booking/block
  function isOccupied(m) {
    if (!occupiedSlots || occupiedSlots.length === 0) return false;
    const slotMin = hour * 60 + m;
    return occupiedSlots.some(({ startMin, endMin }) => slotMin >= startMin && slotMin < endMin);
  }

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {minutes.map((m) => {
          const mm = String(m).padStart(2, '0');
          const occupied = isOccupied(m);
          return (
            <button
              key={m}
              onClick={() => { if (!occupied) onSelect(`${hh}:${mm}`); }}
              disabled={occupied}
              style={{
                padding: '8px 4px',
                fontSize: 13,
                fontWeight: 700,
                fontFamily: 'var(--font-display, Orbitron, monospace)',
                background: occupied ? 'rgba(var(--overlay),0.02)' : 'rgba(var(--overlay),0.05)',
                border: '1px solid rgba(var(--overlay),0.1)',
                borderRadius: 6,
                color: occupied ? 'rgba(var(--overlay),0.2)' : 'var(--text)',
                cursor: occupied ? 'not-allowed' : 'pointer',
                opacity: occupied ? 0.4 : 1,
                transition: 'all 0.12s',
                textDecoration: occupied ? 'line-through' : 'none',
              }}
              onMouseEnter={(e) => {
                if (occupied) return;
                e.currentTarget.style.background = 'rgba(var(--overlay),0.15)';
                e.currentTarget.style.borderColor = 'rgba(var(--overlay),0.3)';
              }}
              onMouseLeave={(e) => {
                if (occupied) return;
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
