// ---------------------------------------------------------------------------
// NowIndicator
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { HOUR_START, TOTAL_MINUTES, PX_PER_MIN } from './helpers';

export default function NowIndicator({ pxPerMin }) {
  const px = pxPerMin || PX_PER_MIN;
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const minutes = now.getHours() * 60 + now.getMinutes();
  const offset = minutes - HOUR_START * 60;
  if (offset < 0 || offset > TOTAL_MINUTES) return null;
  const top = offset * px;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <div style={{ position: 'absolute', top, left: 0, right: 0, height: 0, zIndex: 20, pointerEvents: 'none' }}>
      {/* Time label in gutter */}
      <div style={{ position: 'absolute', left: 4, top: -9, fontSize: 10, fontWeight: 800, color: '#ef4444', fontFamily: 'var(--font-display, Orbitron, monospace)', fontVariantNumeric: 'tabular-nums', background: 'var(--bg, #0a0a0a)', padding: '1px 4px', borderRadius: 3, letterSpacing: '0.02em' }}>
        {timeStr}
      </div>
      {/* Circle at the gutter/grid boundary — with pulse animation */}
      <div className="planning-now-dot" />
      {/* Line across all columns */}
      <div style={{ position: 'absolute', left: 52, right: 0, top: 0, height: 2, background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.4)' }} />
    </div>
  );
}
