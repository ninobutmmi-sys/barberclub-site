import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfWeek, addMonths, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import useMobile from '../hooks/useMobile';
import {
  useDashboard,
  useRevenue,
  useServiceStats,
  useBarberStats,
  usePeakHours,
  useInactiveClients,
  useOccupancy,
  useMemberStats,
  useTrends,
  useRevenueHourly,
} from '../hooks/useApi';

// ============================================
// Helpers
// ============================================

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20AC';
}

function formatPriceInt(cents) {
  return Math.round(cents / 100).toLocaleString('fr-FR') + ' \u20AC';
}

function formatTime(timeStr) {
  if (!timeStr) return '-';
  return timeStr.substring(0, 5);
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// ============================================
// Accent colors for KPIs
// ============================================

const ACCENTS = {
  blue:  { color: '#3b82f6', bg: 'rgba(59,130,246,0.07)',  glow: 'rgba(59,130,246,0.15)' },
  green: { color: '#22c55e', bg: 'rgba(34,197,94,0.07)',   glow: 'rgba(34,197,94,0.15)' },
  amber: { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  glow: 'rgba(245,158,11,0.15)' },
  red:   { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',   glow: 'rgba(239,68,68,0.15)' },
};

// ============================================
// Section Header
// ============================================

function SectionTitle({ icon, title, subtitle, right, className = '' }) {
  return (
    <div className={className} style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      marginBottom: 20,
      paddingBottom: 16,
      borderBottom: '1px solid rgba(var(--overlay),0.04)',
    }}>
      <div style={{
        width: 38,
        height: 38,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, rgba(var(--overlay),0.06), rgba(var(--overlay),0.02))',
        borderRadius: 10,
        border: '1px solid rgba(var(--overlay),0.06)',
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.02em' }}>{title}</h3>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

// ============================================
// KPI Card
// ============================================

function KpiCard({ label, value, subtitle, trend, trendLabel, color, accent = 'blue', icon, className = '' }) {
  const a = ACCENTS[accent] || ACCENTS.blue;
  const isPositive = trend > 0;
  const isNegative = trend < 0;
  const trendColor = color === 'invert'
    ? (isPositive ? 'var(--danger)' : 'var(--success)')
    : (isPositive ? 'var(--success)' : isNegative ? 'var(--danger)' : 'var(--text-muted)');

  return (
    <div className={`a-kpi ${className}`}>
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 24, right: 24, height: 2,
        background: `linear-gradient(90deg, transparent, ${a.color}, transparent)`,
        opacity: 0.5, borderRadius: '0 0 2px 2px',
      }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {label}
        </div>
        {icon && <div style={{ opacity: 0.25 }}>{icon}</div>}
      </div>

      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800,
        lineHeight: 1.1, marginBottom: 8,
      }}>
        {value}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {trend !== undefined && trend !== null && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: trendColor,
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 8px',
            background: isPositive ? 'rgba(34,197,94,0.1)' : isNegative ? 'rgba(239,68,68,0.1)' : 'rgba(var(--overlay),0.05)',
            borderRadius: 6,
          }}>
            {isPositive ? '\u2191' : isNegative ? '\u2193' : '\u2192'}{' '}
            {trendLabel || `${Math.abs(trend)}%`}
          </span>
        )}
        {subtitle && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</span>
        )}
      </div>
    </div>
  );
}

// ============================================
// Revenue Area Chart (gradient)
// ============================================

function RevenueChart({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">Aucune donnee de revenu</div>;
  }

  const W = 600, H = 200, PAD_L = 0, PAD_R = 0, PAD_T = 20, PAD_B = 30;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const values = data.map(d => parseInt(d.revenue) || 0);
  const maxVal = Math.max(...values, 1);

  // Build points
  const points = values.map((v, i) => {
    const x = PAD_L + (i / Math.max(values.length - 1, 1)) * chartW;
    const y = PAD_T + chartH - (v / maxVal) * chartH;
    return { x, y, v };
  });

  // Smooth curve (catmull-rom to bezier)
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  const linePath = smoothPath(points);
  const areaPath = linePath + ` L${points[points.length-1].x},${PAD_T + chartH} L${points[0].x},${PAD_T + chartH} Z`;

  // Date labels (show ~6 evenly spaced)
  const labelCount = Math.min(6, data.length);
  const labelIndices = [];
  for (let i = 0; i < labelCount; i++) {
    labelIndices.push(Math.round(i * (data.length - 1) / Math.max(labelCount - 1, 1)));
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(59,130,246,0.35)" />
            <stop offset="100%" stopColor="rgba(59,130,246,0)" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(pct => (
          <line key={pct} x1={PAD_L} y1={PAD_T + chartH * (1-pct)} x2={W-PAD_R} y2={PAD_T + chartH * (1-pct)}
            stroke="rgba(var(--overlay),0.04)" strokeWidth="1" />
        ))}
        {/* Area fill */}
        <path d={areaPath} fill="url(#areaGrad)" />
        {/* Line */}
        <path d={linePath} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots on non-zero points */}
        {points.map((p, i) => p.v > 0 && (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="#3b82f6" stroke="var(--bg-card)" strokeWidth="1.5">
            <title>{data[i]?.period}: {formatPriceInt(p.v)}</title>
          </circle>
        ))}
        {/* Date labels */}
        {labelIndices.map(i => (
          <text key={i} x={points[i]?.x} y={H - 4} textAnchor="middle"
            style={{ fontSize: 10, fill: 'var(--text-muted)', fontWeight: 500 }}>
            {(data[i]?.period || '').split('-')[2]}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ============================================
// Donut Chart colors
// ============================================

const DONUT_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f59e0b',
  '#ec4899', '#14b8a6', '#ef4444', '#6366f1',
  '#06b6d4', '#84cc16', '#f97316', '#8b5cf6',
];

// ============================================
// ServiceDonut — modern donut replacing pie
// ============================================

function ServiceDonut({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">Aucune donnee</div>;
  }

  const total = data.reduce((sum, s) => sum + (parseInt(s.booking_count) || 0), 0);
  if (total === 0) return <div className="empty-state">Aucune donnee</div>;

  // Build slices
  const slices = [];
  let cumulative = 0;
  data.forEach((s, i) => {
    const count = parseInt(s.booking_count) || 0;
    const pct = count / total;
    if (pct > 0) {
      slices.push({ name: s.name, count, pct, start: cumulative, color: DONUT_COLORS[i % DONUT_COLORS.length] });
      cumulative += pct;
    }
  });

  const cx = 80, cy = 80, outerR = 70, innerR = 46;

  function donutArc(startPct, endPct) {
    if (endPct - startPct >= 0.9999) {
      // Full ring: two semicircles for outer (CW) + inner (CCW) with evenodd
      return [
        `M ${cx} ${cy - outerR}`,
        `A ${outerR} ${outerR} 0 0 1 ${cx} ${cy + outerR}`,
        `A ${outerR} ${outerR} 0 0 1 ${cx} ${cy - outerR}`,
        `M ${cx} ${cy - innerR}`,
        `A ${innerR} ${innerR} 0 0 0 ${cx} ${cy + innerR}`,
        `A ${innerR} ${innerR} 0 0 0 ${cx} ${cy - innerR}`,
      ].join(' ');
    }
    const gap = 0.004; // tiny gap between slices
    const s = startPct + gap;
    const e = endPct - gap;
    if (e <= s) return '';

    const sa = s * 2 * Math.PI - Math.PI / 2;
    const ea = e * 2 * Math.PI - Math.PI / 2;
    const ox1 = cx + outerR * Math.cos(sa), oy1 = cy + outerR * Math.sin(sa);
    const ox2 = cx + outerR * Math.cos(ea), oy2 = cy + outerR * Math.sin(ea);
    const ix1 = cx + innerR * Math.cos(ea), iy1 = cy + innerR * Math.sin(ea);
    const ix2 = cx + innerR * Math.cos(sa), iy2 = cy + innerR * Math.sin(sa);
    const large = (e - s) > 0.5 ? 1 : 0;
    return `M ${ox1} ${oy1} A ${outerR} ${outerR} 0 ${large} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2} Z`;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <svg width="160" height="160" viewBox="0 0 160 160">
          {/* Shadow ring */}
          <circle cx={cx} cy={cy} r={(outerR + innerR) / 2} fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth={outerR - innerR + 2} />
          {slices.map((s, i) => (
            <path
              key={i}
              d={donutArc(s.start, s.start + s.pct)}
              fill={s.color}
              fillRule="evenodd"
              style={{ transition: 'opacity 0.2s', cursor: 'default' }}
            >
              <title>{s.name}: {s.count} ({Math.round(s.pct * 100)}%)</title>
            </path>
          ))}
        </svg>
        {/* Center label */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
            {total}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
            RDV
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
        {slices.slice(0, 8).map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0,
              boxShadow: `0 0 6px ${s.color}40`,
            }} />
            <span style={{
              fontSize: 12, fontWeight: 500, flex: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: 'var(--text-secondary)',
            }}>
              {s.name}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 700, color: 'var(--text)',
              fontFamily: 'var(--font-display)', flexShrink: 0,
            }}>
              {Math.round(s.pct * 100)}%
            </span>
          </div>
        ))}
        {slices.length > 8 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{slices.length - 8} autres</span>
        )}
      </div>
    </div>
  );
}

// ============================================
// Top Services list
// ============================================

function TopServices({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">Aucune prestation</div>;
  }

  const maxRev = Math.max(...data.map((s) => parseInt(s.revenue) || 0), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {data.map((s, i) => {
        const count = parseInt(s.booking_count) || 0;
        const rev = parseInt(s.revenue) || 0;
        const pct = Math.max((rev / maxRev) * 100, count > 0 ? 3 : 0);
        const barColor = DONUT_COLORS[i % DONUT_COLORS.length];
        return (
          <div key={i} className="a-service-row" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 800,
                  color: i < 3 ? barColor : 'var(--text-muted)',
                  width: 24, textAlign: 'right',
                }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                <span style={{
                  fontSize: 11, color: 'var(--text-muted)',
                  background: 'rgba(var(--overlay),0.04)',
                  padding: '2px 8px', borderRadius: 4,
                }}>
                  {count} RDV
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800 }}>
                  {formatPriceInt(rev)}
                </span>
              </div>
            </div>
            <div style={{ height: 3, background: 'rgba(var(--overlay),0.04)', borderRadius: 2 }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: `linear-gradient(90deg, ${barColor}, ${barColor}80)`,
                borderRadius: 2,
                transition: 'width 0.5s cubic-bezier(0.22,1,0.36,1)',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Barber Performance
// ============================================

function BarberPerformance({ data }) {
  const isMobile = useMobile();
  if (!data || !data.barbers || data.barbers.length === 0) {
    return <div className="empty-state">Aucun barber</div>;
  }

  const barbers = data.barbers.filter((b) => b.name?.toLowerCase() !== 'admin');
  const maxRev = Math.max(...barbers.map((b) => parseInt(b.revenue) || 0), 1);

  return (
    <div style={isMobile
      ? { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }
      : { display: 'grid', gridTemplateColumns: `repeat(${Math.min(barbers.length, 3)}, 1fr)`, gap: 16 }
    }>
      {barbers.map((b, i) => {
        const rev = parseInt(b.revenue) || 0;
        const count = parseInt(b.booking_count) || 0;
        const clients = parseInt(b.unique_clients) || 0;
        const noShows = parseInt(b.no_shows) || 0;
        const pct = Math.round((rev / maxRev) * 100);
        const avgPerBooking = count > 0 ? Math.round(rev / count) : 0;

        return (
          <div key={i} className="a-card a-card-lift" style={{ padding: '24px 22px', ...(isMobile ? { minWidth: 200, flex: '0 0 auto' } : {}) }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12,
                background: `linear-gradient(135deg, ${DONUT_COLORS[i]}20, ${DONUT_COLORS[i]}08)`,
                border: `1px solid ${DONUT_COLORS[i]}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800,
                color: DONUT_COLORS[i],
              }}>
                {b.name.charAt(0)}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{b.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{count} rendez-vous</div>
              </div>
            </div>

            {/* Revenue */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, marginBottom: 4 }}>
                {formatPriceInt(rev)}
              </div>
              <div style={{ height: 4, background: 'rgba(var(--overlay),0.05)', borderRadius: 2 }}>
                <div style={{
                  height: '100%', width: `${pct}%`,
                  background: `linear-gradient(90deg, ${DONUT_COLORS[i]}, ${DONUT_COLORS[i]}60)`,
                  borderRadius: 2, transition: 'width 0.5s ease',
                }} />
              </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'rgba(var(--overlay),0.03)',
                border: '1px solid rgba(var(--overlay),0.04)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Clients</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>{clients}</div>
              </div>
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'rgba(var(--overlay),0.03)',
                border: '1px solid rgba(var(--overlay),0.04)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Panier moy.</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>{formatPriceInt(avgPerBooking)}</div>
              </div>
            </div>

            {noShows > 0 && (
              <div style={{
                marginTop: 10, padding: '6px 10px', borderRadius: 6,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.12)',
                fontSize: 11, fontWeight: 600, color: '#ef4444',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                {noShows} faux plan{noShows > 1 ? 's' : ''}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Peak Hours Heatmap
// ============================================

function PeakHoursHeatmap({ data }) {
  if (!data || !data.heatmap || data.heatmap.length === 0) {
    return <div className="empty-state">Aucune donnee</div>;
  }

  const heatmap = {};
  let maxCount = 0;
  data.heatmap.forEach((row) => {
    const day = parseInt(row.day_of_week);
    const hour = parseInt(row.hour);
    const count = parseInt(row.count);
    if (!heatmap[day]) heatmap[day] = {};
    heatmap[day][hour] = count;
    if (count > maxCount) maxCount = count;
  });

  const hours = [];
  for (let h = 9; h <= 19; h++) hours.push(h);
  const days = [1, 2, 3, 4, 5, 6];

  function getCellColor(count) {
    if (!count || maxCount === 0) return 'rgba(var(--overlay),0.02)';
    const t = count / maxCount;
    // Warm gradient: dark → amber → bright amber
    if (t < 0.33) return `rgba(245,158,11,${0.08 + t * 0.3})`;
    if (t < 0.66) return `rgba(245,158,11,${0.18 + t * 0.35})`;
    return `rgba(245,158,11,${0.35 + t * 0.4})`;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `56px repeat(${hours.length}, 1fr)`, gap: 4 }}>
        <div />
        {hours.map((h) => (
          <div key={h} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 0' }}>
            {h}h
          </div>
        ))}

        {days.map((day) => (
          <div key={day} style={{ display: 'contents' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', paddingRight: 8 }}>
              {DAY_LABELS[day]}
            </div>
            {hours.map((h) => {
              const count = heatmap[day]?.[h] || 0;
              return (
                <div
                  key={h}
                  className="a-heatcell"
                  title={`${DAY_LABELS[day]} ${h}h: ${count} RDV`}
                  style={{
                    height: 36,
                    background: getCellColor(count),
                    border: '1px solid rgba(var(--overlay),0.03)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    color: count > 0 ? (count / maxCount > 0.5 ? '#fbbf24' : 'var(--text-secondary)') : 'transparent',
                  }}
                >
                  {count > 0 ? count : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>Moins</span>
        {[0.03, 0.12, 0.25, 0.4, 0.6].map((op, i) => (
          <div key={i} style={{
            width: 16, height: 16, borderRadius: 4,
            background: `rgba(245,158,11,${op})`,
          }} />
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>Plus</span>
      </div>
    </div>
  );
}

// ============================================
// Next Bookings
// ============================================

function NextBookings({ bookings }) {
  if (!bookings || bookings.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 24 }}>
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 4 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        Aucun RDV a venir aujourd'hui
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {bookings.map((b, i) => (
        <div
          key={b.id || i}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 14px',
            background: 'rgba(var(--overlay),0.025)',
            border: '1px solid rgba(var(--overlay),0.04)',
            borderRadius: 10,
            transition: 'background 0.2s',
          }}
        >
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800,
            minWidth: 50, flexShrink: 0,
            color: '#3b82f6',
          }}>
            {formatTime(b.start_time)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{b.client_name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.service_name}</div>
          </div>
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            background: 'rgba(var(--overlay),0.04)',
            padding: '3px 8px', borderRadius: 5,
          }}>
            {b.barber_name}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Members Section
// ============================================

function MembersSection({ stats }) {
  const isMobile = useMobile();
  if (!stats) return null;

  const memRev = parseInt(stats.revenue?.member) || 0;
  const guestRev = parseInt(stats.revenue?.guest) || 0;
  const totalRev = memRev + guestRev || 1;
  const memPct = Math.round((memRev / totalRev) * 100);
  const guestPct = 100 - memPct;

  return (
    <>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Membres', value: stats.total_members, sub: `sur ${stats.total_clients} clients`, color: '#22c55e' },
          { label: 'Taux conversion', value: `${stats.conversion_rate}%`, sub: 'clients \u2192 membres', color: null },
          { label: 'Nouveaux ce mois', value: stats.new_members_this_month, sub: 'inscriptions', color: null },
          { label: 'Panier moyen', value: formatPriceInt(stats.avg_spend?.member || 0), sub: `vs ${formatPriceInt(stats.avg_spend?.guest || 0)} invites`, color: '#22c55e' },
        ].map((item, i) => (
          <div key={i} className="a-card a-card-lift" style={{ textAlign: 'center', padding: '20px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              {item.label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: item.color || 'var(--text)' }}>
              {item.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{item.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        {/* Revenue split */}
        <div className="a-card">
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>CA (3 derniers mois)</h4>
          <div style={{ display: 'flex', gap: 2, height: 28, borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{
              width: `${memPct}%`, minWidth: memPct > 0 ? 4 : 0,
              background: 'linear-gradient(90deg, #22c55e, #16a34a)',
              borderRadius: memPct === 100 ? 6 : '6px 0 0 6px',
              transition: 'width 0.6s ease',
            }} />
            <div style={{
              width: `${guestPct}%`, minWidth: guestPct > 0 ? 4 : 0,
              background: 'rgba(var(--overlay),0.12)',
              borderRadius: guestPct === 100 ? 6 : '0 6px 6px 0',
              transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.3)' }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Membres</span>
              <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{formatPriceInt(memRev)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(var(--overlay),0.2)' }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Invites</span>
              <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{formatPriceInt(guestRev)}</span>
            </div>
          </div>
        </div>

        {/* Visits + Monthly signups */}
        <div className="a-card">
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Visites moyennes / client</h4>
          <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
            <div style={{
              flex: 1, textAlign: 'center', padding: '14px 0',
              background: 'rgba(34,197,94,0.06)', borderRadius: 10,
              border: '1px solid rgba(34,197,94,0.1)',
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#22c55e' }}>
                {stats.avg_visits?.member || '0'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Membres</div>
            </div>
            <div style={{
              flex: 1, textAlign: 'center', padding: '14px 0',
              background: 'rgba(var(--overlay),0.03)', borderRadius: 10,
              border: '1px solid rgba(var(--overlay),0.05)',
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800 }}>
                {stats.avg_visits?.guest || '0'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Invites</div>
            </div>
          </div>

          {stats.monthly_signups && stats.monthly_signups.length > 0 && (
            <>
              <h4 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Inscriptions mensuelles
              </h4>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 52 }}>
                {stats.monthly_signups.map((m, i) => {
                  const max = Math.max(...stats.monthly_signups.map(s => parseInt(s.signups || s.count) || 0), 1);
                  const count = parseInt(m.signups || m.count) || 0;
                  const h = Math.max(Math.round((count / max) * 44), count > 0 ? 6 : 2);
                  const monthLabel = m.month?.substring(5, 7);
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: count > 0 ? '#22c55e' : 'var(--text-muted)' }}>{count}</span>
                      <div style={{
                        width: '100%', maxWidth: 24, height: h, borderRadius: '3px 3px 0 0',
                        background: count > 0 ? 'linear-gradient(to top, #16a34a, #22c55e)' : 'rgba(var(--overlay),0.04)',
                      }} />
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{monthLabel}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ============================================
// Projection Card (current month only)
// ============================================

function ProjectionCard({ projection }) {
  if (!projection) return null;

  const realized = projection.revenue_so_far || 0;
  const confirmed = projection.future_confirmed || 0;
  const projected = projection.projected_total || 0;
  const total = Math.max(projected, realized + confirmed, 1);
  const pctRealized = Math.round((realized / total) * 100);
  const pctConfirmed = Math.round((confirmed / total) * 100);

  return (
    <div className="a-card" style={{ padding: '24px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Projection du mois</h4>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Jour {projection.days_elapsed}/{projection.days_in_month}
          </span>
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
          padding: '6px 14px', borderRadius: 10,
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.12)',
          color: '#22c55e',
        }}>
          {formatPriceInt(projected)}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 14, background: 'rgba(var(--overlay),0.04)', borderRadius: 7, overflow: 'hidden', display: 'flex', marginBottom: 14 }}>
        <div style={{
          width: `${pctRealized}%`,
          background: 'linear-gradient(90deg, #22c55e, #16a34a)',
          borderRadius: '7px 0 0 7px',
          transition: 'width 0.6s ease',
        }} />
        <div style={{
          width: `${pctConfirmed}%`,
          background: 'rgba(34,197,94,0.25)',
          transition: 'width 0.6s ease',
        }} />
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: '#22c55e' }} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Realise</span>
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{formatPriceInt(realized)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(34,197,94,0.35)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Confirme</span>
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{formatPriceInt(confirmed)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(var(--overlay),0.08)', border: '1px dashed rgba(var(--overlay),0.15)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Projection</span>
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{formatPriceInt(projected - realized - confirmed)}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Revenue Hourly Heatmap (barber x hour)
// ============================================

function RevenueHourlyHeatmap({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">Aucune donnee</div>;
  }

  // Build barber -> hour -> revenue map
  const barberSet = new Set();
  const grid = {};
  let maxRev = 0;

  data.forEach(row => {
    const name = row.barber_name;
    const hour = parseInt(row.hour);
    const rev = parseInt(row.revenue) || 0;
    barberSet.add(name);
    if (!grid[name]) grid[name] = {};
    grid[name][hour] = rev;
    if (rev > maxRev) maxRev = rev;
  });

  const barbers = [...barberSet].sort();
  const hours = [];
  for (let h = 9; h <= 19; h++) hours.push(h);

  function getCellColor(rev) {
    if (!rev || maxRev === 0) return 'rgba(var(--overlay),0.02)';
    const t = rev / maxRev;
    if (t < 0.25) return `rgba(34,197,94,${0.08 + t * 0.3})`;
    if (t < 0.5) return `rgba(34,197,94,${0.18 + t * 0.35})`;
    if (t < 0.75) return `rgba(34,197,94,${0.30 + t * 0.35})`;
    return `rgba(34,197,94,${0.45 + t * 0.35})`;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `80px repeat(${hours.length}, 1fr)`, gap: 4 }}>
        <div />
        {hours.map(h => (
          <div key={h} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 0' }}>
            {h}h
          </div>
        ))}

        {barbers.map(name => (
          <div key={name} style={{ display: 'contents' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', paddingRight: 8 }}>
              {name}
            </div>
            {hours.map(h => {
              const rev = grid[name]?.[h] || 0;
              return (
                <div
                  key={h}
                  title={`${name} ${h}h: ${formatPriceInt(rev)}`}
                  style={{
                    height: 36, borderRadius: 6,
                    background: getCellColor(rev),
                    border: '1px solid rgba(var(--overlay),0.03)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 700,
                    color: rev > 0 ? (rev / maxRev > 0.4 ? '#22c55e' : 'var(--text-secondary)') : 'transparent',
                    cursor: 'default',
                    transition: 'background 0.2s',
                  }}
                >
                  {rev > 0 ? formatPriceInt(rev) : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>Moins</span>
        {[0.03, 0.12, 0.25, 0.4, 0.6].map((op, i) => (
          <div key={i} style={{
            width: 16, height: 16, borderRadius: 4,
            background: `rgba(34,197,94,${op})`,
          }} />
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>Plus</span>
      </div>
    </div>
  );
}

// ============================================
// Main Analytics Page
// ============================================

// ============================================
// Trend helper
// ============================================

function calcTrend(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

const BARBER_STATS_PIN = 'Jiinx211211@';

export default function Analytics() {
  const isMobile = useMobile();
  const navigate = useNavigate();
  const [barberPeriod, setBarberPeriod] = useState('day');
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [barberUnlocked, setBarberUnlocked] = useState(() => sessionStorage.getItem('bc_barber_stats_unlocked') === '1');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  function handlePinSubmit(e) {
    e.preventDefault();
    if (pinInput === BARBER_STATS_PIN) {
      setBarberUnlocked(true);
      sessionStorage.setItem('bc_barber_stats_unlocked', '1');
      setShowPinModal(false);
      setPinInput('');
      setPinError(false);
    } else {
      setPinError(true);
    }
  }

  const monthStr = format(selectedMonth, 'yyyy-MM');
  const monthLabel = format(selectedMonth, 'MMMM yyyy', { locale: fr });
  const isCurrentMonth = monthStr === format(new Date(), 'yyyy-MM');

  const monthParams = useMemo(() => ({ month: monthStr }), [monthStr]);

  // Compute from/to for barber stats period
  const barberStatsParams = useMemo(() => {
    if (barberPeriod === 'day') {
      const today = format(new Date(), 'yyyy-MM-dd');
      return { from: today, to: today };
    }
    if (barberPeriod === 'week') {
      const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
      return { from: format(monday, 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') };
    }
    return { month: monthStr }; // follow selected month
  }, [barberPeriod, monthStr]);

  const dashboardQuery = useDashboard(monthParams);
  const revenueQuery = useRevenue({ period: 'day', month: monthStr });
  const serviceStatsQuery = useServiceStats(monthParams);
  const barberStatsQuery = useBarberStats(barberStatsParams);
  const peakHoursQuery = usePeakHours(monthParams);
  const occupancyQuery = useOccupancy(monthParams);
  const inactiveQuery = useInactiveClients();
  const memberStatsQuery = useMemberStats();
  const trendsQuery = useTrends({ enabled: isCurrentMonth });
  const revenueHourlyQuery = useRevenueHourly(monthParams);

  const loading = dashboardQuery.isLoading;
  const error = dashboardQuery.error?.message || '';
  const dashboard = dashboardQuery.data || null;
  const revenueRaw = revenueQuery.data;
  const revenue = Array.isArray(revenueRaw) ? revenueRaw : (revenueRaw?.data || []);
  const serviceStats = serviceStatsQuery.data || null;
  const barberStats = barberStatsQuery.data || null;
  const peakHours = peakHoursQuery.data || null;
  const occupancy = occupancyQuery.data || null;
  const inactiveClients = inactiveQuery.data?.clients || [];
  const memberStats = memberStatsQuery.data || null;
  const trends = trendsQuery.data || null;
  const revenueHourly = revenueHourlyQuery.data || null;

  const prev = dashboard?.previous || null;

  function loadAll() {
    dashboardQuery.refetch();
    revenueQuery.refetch();
    serviceStatsQuery.refetch();
    barberStatsQuery.refetch();
    peakHoursQuery.refetch();
    occupancyQuery.refetch();
    inactiveQuery.refetch();
    memberStatsQuery.refetch();
    trendsQuery.refetch();
    revenueHourlyQuery.refetch();
  }

  const monthBookings = dashboard?.month?.bookings || 0;
  const monthCancelled = dashboard?.month?.cancelled || 0;
  const monthTotal = monthBookings + monthCancelled;
  const cancelRate = monthTotal > 0 ? Math.round((monthCancelled / monthTotal) * 100) : 0;
  const prevCancelRate = prev ? (prev.bookings + (prev.cancelled || 0)) > 0 ? Math.round(((prev.cancelled || 0) / (prev.bookings + (prev.cancelled || 0))) * 100) : 0 : null;

  const totalRevMonth = revenue.reduce((sum, d) => sum + (parseInt(d.revenue) || 0), 0);
  const avgDailyRev = revenue.length > 0 ? Math.round(totalRevMonth / revenue.length) : 0;

  // ---- Lock screen si pas deverrouille ----
  if (!barberUnlocked) {
    return (
      <>
        <div className="page-header">
          <h2 className="page-title">Analytics</h2>
        </div>
        <div className="page-body" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: '60vh',
        }}>
          <div style={{
            textAlign: 'center', maxWidth: 380,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: 20,
              background: 'rgba(var(--overlay),0.06)',
              border: '1px solid rgba(var(--overlay),0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Acces protege</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Les analytics sont reservees au gerant.
                <br />Entrez le mot de passe pour continuer.
              </p>
            </div>
            <form onSubmit={handlePinSubmit} style={{ width: '100%' }}>
              <input
                type="password"
                value={pinInput}
                onChange={e => { setPinInput(e.target.value); setPinError(false); }}
                placeholder="Mot de passe"
                autoFocus
                style={{
                  width: '100%', padding: '12px 16px', fontSize: 15,
                  background: 'rgba(var(--overlay),0.06)',
                  border: `1px solid ${pinError ? '#ef4444' : 'rgba(var(--overlay),0.1)'}`,
                  borderRadius: 12, color: 'var(--text)',
                  fontFamily: 'var(--font)', outline: 'none',
                  boxSizing: 'border-box', textAlign: 'center',
                }}
              />
              {pinError && (
                <p style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>Mot de passe incorrect</p>
              )}
              <button type="submit" style={{
                marginTop: 14, width: '100%', padding: '12px 0',
                borderRadius: 12, border: 'none', cursor: 'pointer',
                background: '#3b82f6', color: '#fff',
                fontSize: 14, fontWeight: 700,
              }}>
                Deverrouiller
              </button>
            </form>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Analytics</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Vue d&apos;ensemble du salon
            </p>
          </div>
          {/* Month selector */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(var(--overlay),0.04)',
            border: '1px solid rgba(var(--overlay),0.08)',
            borderRadius: 10, padding: '4px 6px',
          }}>
            <button onClick={() => setSelectedMonth(m => subMonths(m, 1))} style={{
              width: 30, height: 30, borderRadius: 7, border: 'none', background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style={{
              fontSize: 13, fontWeight: 700, color: 'var(--text)',
              minWidth: 140, textAlign: 'center', textTransform: 'capitalize',
              userSelect: 'none',
            }}>
              {monthLabel}
            </span>
            <button onClick={() => { if (!isCurrentMonth) setSelectedMonth(m => addMonths(m, 1)); }} style={{
              width: 30, height: 30, borderRadius: 7, border: 'none', background: 'transparent',
              color: isCurrentMonth ? 'var(--text-muted)' : 'var(--text-muted)', cursor: isCurrentMonth ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: isCurrentMonth ? 0.3 : 1,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            {!isCurrentMonth && (
              <button onClick={() => setSelectedMonth(new Date())} style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
                background: 'rgba(var(--overlay),0.06)', border: 'none', borderRadius: 6,
                padding: '4px 10px', cursor: 'pointer', marginLeft: 4,
              }}>
                Auj.
              </button>
            )}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadAll} disabled={loading} style={{ gap: 6 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={loading ? { animation: 'spin 1s linear infinite' } : {}}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Actualiser
        </button>
      </div>

      <div className="page-body">
        {error && (
          <div className="login-error" role="alert" style={{ marginBottom: 20 }}>{error}</div>
        )}

        {loading ? (
          <div className="empty-state" style={{ minHeight: 400 }}>
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.2, animation: 'spin 2s linear infinite' }}>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <span style={{ marginTop: 8 }}>Chargement des analytics...</span>
          </div>
        ) : (
          <>
            {/* ======== KPI CARDS ======== */}
            <div style={{ display: 'flex', gap: isMobile ? 8 : 16, marginBottom: 32, flexWrap: 'wrap' }}>
              <KpiCard
                className="a-stagger a-d1"
                label="RDV"
                value={monthBookings}
                subtitle="rendez-vous"
                trend={calcTrend(monthBookings, prev?.bookings)}
                trendLabel={prev ? `${calcTrend(monthBookings, prev.bookings) > 0 ? '+' : ''}${calcTrend(monthBookings, prev.bookings)}% vs mois prec.` : undefined}
                accent="blue"
                icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              />
              <KpiCard
                className="a-stagger a-d2"
                label="Chiffre d'affaires"
                value={formatPriceInt(dashboard?.month?.revenue || 0)}
                subtitle={avgDailyRev > 0 ? `moy. ${formatPriceInt(avgDailyRev)}/j` : ''}
                trend={calcTrend(dashboard?.month?.revenue || 0, prev?.revenue)}
                accent="green"
                icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}
              />
              <KpiCard
                className="a-stagger a-d3"
                label="Panier moyen"
                value={formatPriceInt(dashboard?.month?.average_basket || 0)}
                subtitle={`${monthBookings} RDV`}
                trend={calcTrend(dashboard?.month?.average_basket || 0, prev?.average_basket)}
                accent="amber"
                icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>}
              />
              <KpiCard
                className="a-stagger a-d4"
                label="Taux annulation"
                value={`${cancelRate}%`}
                subtitle={`${monthCancelled} annul. / ${monthTotal}`}
                trend={prevCancelRate !== null ? cancelRate - prevCancelRate : null}
                color="invert"
                accent="red"
                icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
              />
              {trends?.no_show_current && trends.no_show_current.count > 0 && (
                <KpiCard
                  className="a-stagger a-d4"
                  label="Faux plans"
                  value={trends.no_show_current.count}
                  subtitle={`${formatPriceInt(trends.no_show_current.cost)} perdus`}
                  accent="red"
                  icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
                />
              )}
            </div>

            {/* ======== REVENUE + NEXT BOOKINGS ======== */}
            <div className="a-stagger a-d5" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 16, marginBottom: 32 }}>
              <div className="a-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>Chiffre d&apos;affaires</h3>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{monthLabel}</span>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
                    padding: '6px 14px',
                    background: 'rgba(59,130,246,0.08)',
                    borderRadius: 10,
                    border: '1px solid rgba(59,130,246,0.12)',
                  }}>
                    {formatPriceInt(totalRevMonth)}
                  </div>
                </div>
                <RevenueChart data={revenue} />
              </div>

              <div className="a-card">
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Prochains RDV</h3>
                <NextBookings bookings={dashboard?.next_bookings} />
              </div>
            </div>

            {/* ======== PROJECTION (current month only) ======== */}
            {isCurrentMonth && trends?.projection && (
              <div className="a-stagger a-d5" style={{ marginBottom: 32 }}>
                <ProjectionCard projection={trends.projection} />
              </div>
            )}

            {/* ======== SECTION: PRESTATIONS ======== */}
            <SectionTitle
              className="a-stagger a-d6"
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>}
              title="Prestations"
              subtitle="Repartition et classement des services"
            />
            <div className="a-stagger a-d6" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 0.8fr', gap: 16, marginBottom: 32 }}>
              <div className="a-card" style={{ padding: '20px 8px' }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, paddingLeft: 16 }}>Top prestations</h4>
                <TopServices data={serviceStats?.services} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Donut */}
                <div className="a-card">
                  <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Repartition</h4>
                  <ServiceDonut data={serviceStats?.services} />
                </div>
                {/* Derived stats blocks */}
                {(() => {
                  const services = serviceStats?.services || [];
                  const totalRev = services.reduce((s, x) => s + (parseInt(x.revenue) || 0), 0);
                  const totalBookings = services.reduce((s, x) => s + (parseInt(x.booking_count) || 0), 0);
                  const activeCount = services.filter(x => (parseInt(x.booking_count) || 0) > 0).length;
                  const avgPrice = totalBookings > 0 ? Math.round(totalRev / totalBookings) : 0;
                  const prices = services.map(x => parseInt(x.price || x.revenue / (parseInt(x.booking_count) || 1)) || 0).filter(p => p > 0);
                  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
                  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
                  const durations = services.map(x => parseInt(x.duration) || 0).filter(d => d > 0);
                  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
                  const topService = services.length > 0 ? services.reduce((best, s) => (parseInt(s.booking_count) || 0) > (parseInt(best.booking_count) || 0) ? s : best, services[0]) : null;
                  const topCount = topService ? (parseInt(topService.booking_count) || 0) : 0;
                  const topPct = totalBookings > 0 ? Math.round((topCount / totalBookings) * 100) : 0;

                  return (
                    <>
                      {/* 3 mini KPIs */}
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
                        <div className="a-card a-card-lift" style={{ padding: '16px 10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>CA total</div>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>{formatPriceInt(totalRev)}</div>
                        </div>
                        <div className="a-card a-card-lift" style={{ padding: '16px 10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Panier moy.</div>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>{formatPriceInt(avgPrice)}</div>
                        </div>
                        <div className="a-card a-card-lift" style={{ padding: '16px 10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Actives</div>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>
                            {activeCount}<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>/{services.length}</span>
                          </div>
                        </div>
                      </div>

                      {/* Prestation star */}
                      {topService && topCount > 0 && (
                        <div className="a-card" style={{ padding: '18px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#f59e0b" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Prestation star</span>
                          </div>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{topService.name}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: '#f59e0b' }}>{topPct}%</span>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>des reservations</span>
                          </div>
                        </div>
                      )}

                      {/* Top 3 CA mini bars */}
                      {(() => {
                        const top3 = [...services].sort((a, b) => (parseInt(b.revenue) || 0) - (parseInt(a.revenue) || 0)).slice(0, 3);
                        const top3Max = Math.max(...top3.map(s => parseInt(s.revenue) || 0), 1);
                        if (top3Max <= 0) return null;
                        return (
                          <div className="a-card" style={{ padding: '18px 20px' }}>
                            <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Top 3 — Chiffre d'affaires</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {top3.map((s, i) => {
                                const rev = parseInt(s.revenue) || 0;
                                const pct = Math.max((rev / top3Max) * 100, rev > 0 ? 5 : 0);
                                return (
                                  <div key={i}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                                      <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{s.name}</span>
                                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{formatPriceInt(rev)}</span>
                                    </div>
                                    <div style={{ height: 4, background: 'rgba(var(--overlay),0.04)', borderRadius: 2 }}>
                                      <div style={{ height: '100%', width: `${pct}%`, background: DONUT_COLORS[i], borderRadius: 2, transition: 'width 0.5s ease' }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Fourchette prix + Inactifs row */}
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                        {minPrice > 0 && (
                          <div className="a-card" style={{ padding: '16px 14px' }}>
                            <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Fourchette prix</div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800 }}>{formatPriceInt(minPrice)}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>&ndash;</span>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800 }}>{formatPriceInt(maxPrice)}</span>
                            </div>
                          </div>
                        )}
                        <div className="a-card" style={{ padding: '16px 14px' }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Sans reservation</div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: services.length - activeCount > 0 ? '#f59e0b' : 'var(--success)' }}>
                              {services.length - activeCount}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>service{services.length - activeCount !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      </div>

                      {/* Duree moyenne if available */}
                      {avgDuration > 0 && (
                        <div className="a-card" style={{ padding: '16px 14px' }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Duree moyenne</div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800 }}>{avgDuration}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>min</span>
                          </div>
                        </div>
                      )}

                      {/* Revenu moyen par RDV */}
                      <div className="a-card" style={{ padding: '16px 14px' }}>
                        <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Revenu moyen / RDV</div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800 }}>
                          {formatPriceInt(avgPrice)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          {totalBookings} reservation{totalBookings !== 1 ? 's' : ''} au total
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* ======== SECTION: BARBERS ======== */}
            <SectionTitle
              className="a-stagger a-d7"
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
              title="Performance barbers"
              subtitle={barberPeriod === 'day' ? "Aujourd'hui" : barberPeriod === 'week' ? 'Cette semaine' : 'Derniers 30 jours'}
              right={
                <div style={{ display: 'flex', gap: 4, background: 'rgba(var(--overlay),0.04)', borderRadius: 8, padding: 3 }}>
                  {[
                    { key: 'day', label: 'Jour' },
                    { key: 'week', label: 'Semaine' },
                    { key: 'all', label: 'Mois' },
                  ].map((p) => (
                    <button key={p.key} onClick={() => setBarberPeriod(p.key)} style={{
                      padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.02em',
                      background: barberPeriod === p.key ? 'rgba(var(--overlay),0.12)' : 'transparent',
                      color: barberPeriod === p.key ? 'var(--text)' : 'var(--text-muted)',
                      transition: 'all 0.15s',
                    }}>{p.label}</button>
                  ))}
                </div>
              }
            />
            <div className="a-stagger a-d7" style={{ marginBottom: 32 }}>
              <BarberPerformance data={barberStats} />
            </div>

            {/* ======== REVENUE HOURLY HEATMAP ======== */}
            {revenueHourly && revenueHourly.length > 0 && (
              <>
                <SectionTitle
                  className="a-stagger a-d7"
                  icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#22c55e" strokeWidth="1.5" style={{ opacity: 0.7 }}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}
                  title="Revenue par creneau"
                  subtitle={`${monthLabel} — CA par heure et par barber`}
                />
                <div className="a-stagger a-d7 a-card" style={{ marginBottom: 32 }}>
                  <RevenueHourlyHeatmap data={revenueHourly} />
                </div>
              </>
            )}

            {/* ======== OCCUPANCY ======== */}
            {occupancy?.barbers && occupancy.barbers.length > 0 && (
              <div className="a-stagger a-d8 a-card" style={{ marginBottom: 32 }}>
                <div style={{ marginBottom: 18 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>Taux d'occupation</h3>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{monthLabel}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {occupancy.barbers.map((b, i) => {
                    const pct = Math.min(Math.round(parseFloat(b.occupancy_percent) || 0), 100);
                    const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={i}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: 8,
                              background: `${color}15`, border: `1px solid ${color}25`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 800, color,
                            }}>
                              {b.name.charAt(0)}
                            </div>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{b.name}</span>
                          </div>
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color }}>{pct}%</span>
                        </div>
                        <div style={{ height: 6, background: 'rgba(var(--overlay),0.04)', borderRadius: 3 }}>
                          <div style={{
                            height: '100%', width: `${pct}%`,
                            background: `linear-gradient(90deg, ${color}, ${color}80)`,
                            borderRadius: 3, transition: 'width 0.6s ease',
                            boxShadow: pct > 50 ? `0 0 12px ${color}30` : 'none',
                          }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {parseInt(b.booked_slots) || 0} RDV / {parseInt(b.total_slots) || 0} creneaux
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                            {pct >= 80 ? 'Tres occupe' : pct >= 50 ? 'Correct' : 'Sous-occupe'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ======== PEAK HOURS ======== */}
            <SectionTitle
              className="a-stagger a-d8"
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
              title="Heures de pointe"
              subtitle={`${monthLabel} — Lundi a Samedi`}
            />
            <div className="a-stagger a-d8 a-card" style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div />
                {peakHours?.best_days && peakHours.best_days.length > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 12px', borderRadius: 8,
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.12)',
                  }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#f59e0b" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>
                      {DAY_LABELS[parseInt(peakHours.best_days[0].day_of_week)]}
                    </span>
                  </div>
                )}
              </div>
              <PeakHoursHeatmap data={peakHours} />
            </div>

            {/* ======== SECTION: MEMBRES ======== */}
            {memberStats && (
              <>
                <SectionTitle
                  className="a-stagger a-d9"
                  icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#22c55e" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                  title="Membres du Club"
                  subtitle="Clients inscrits avec un compte"
                />
                <div className="a-stagger a-d9" style={{ marginBottom: 32 }}>
                  <MembersSection stats={memberStats} />
                </div>
              </>
            )}

            {/* ======== CLIENTS INACTIFS ======== */}
            <SectionTitle
              className="a-stagger a-d10"
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ef4444" strokeWidth="1.5" style={{ opacity: 0.7 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
              title="Clients inactifs"
              subtitle="Reguliers (3+ visites) sans RDV depuis 3 mois"
            />
            <div className="a-stagger a-d10" style={{ marginBottom: 32 }}>
              {inactiveClients.length === 0 ? (
                <div className="a-card" style={{ textAlign: 'center', padding: '32px 20px' }}>
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.15, marginBottom: 8 }}>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Tous vos clients reguliers sont actifs
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {inactiveClients.map((c) => (
                    <div
                      key={c.id}
                      className="a-inactive-row"
                      onClick={() => navigate(`/clients/${c.id}`)}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: c.days_since_visit >= 180
                          ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                        border: `1px solid ${c.days_since_visit >= 180
                          ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 13, flexShrink: 0,
                        color: c.days_since_visit >= 180 ? '#ef4444' : '#f59e0b',
                      }}>
                        {c.first_name?.charAt(0)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {c.first_name} {c.last_name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.phone}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {c.last_visit || '-'}
                      </div>
                      <div style={{
                        fontSize: 11, fontWeight: 700,
                        color: c.days_since_visit >= 180 ? '#ef4444' : '#f59e0b',
                        padding: '4px 10px', borderRadius: 6,
                        background: c.days_since_visit >= 180
                          ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                        flexShrink: 0,
                      }}>
                        {c.days_since_visit}j
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
