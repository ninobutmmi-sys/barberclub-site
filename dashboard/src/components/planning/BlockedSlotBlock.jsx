// ---------------------------------------------------------------------------
// BlockedSlotBlock
// ---------------------------------------------------------------------------

import { timeToMinutes, HOUR_START, PX_PER_MIN } from './helpers';

export const BLOCK_TYPE_LABELS = { break: 'Pause', personal: 'Perso', closed: 'Fermé' };

export default function BlockedSlotBlock({ block, onClick }) {
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
      onMouseMove={(e) => e.stopPropagation()}
      title={`${block.start_time?.slice(0, 5)} - ${block.end_time?.slice(0, 5)} | ${BLOCK_TYPE_LABELS[block.type] || block.type}${block.reason ? ' \u2014 ' + block.reason : ''}`}
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
