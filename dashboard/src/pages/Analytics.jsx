import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
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
  useNoShowStats,
} from '../hooks/useApi';

// ============================================
// Helpers
// ============================================

function formatPriceInt(cents) {
  return Math.round(cents / 100).toLocaleString('fr-FR') + ' \u20AC';
}

function formatTime(timeStr) {
  if (!timeStr) return '-';
  return timeStr.substring(0, 5);
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Hook: returns [ref, hasBeenVisible] — once visible, stays true (lazy loading) */
function useInView() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || visible) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { rootMargin: '200px' });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible]);
  return [ref, visible];
}

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
  const isMob = useMobile();
  const sz = isMob ? 30 : 38;
  return (
    <div className={className} style={{
      display: 'flex',
      alignItems: 'center',
      gap: isMob ? 10 : 14,
      marginBottom: 20,
      paddingBottom: 16,
      borderBottom: '1px solid rgba(var(--overlay),0.04)',
    }}>
      <div style={{
        width: sz,
        height: sz,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, rgba(var(--overlay),0.06), rgba(var(--overlay),0.02))',
        borderRadius: isMob ? 8 : 10,
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

function RevenueChart({ data, prevData }) {
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const isMobile = useMobile();

  if (!data || data.length === 0) {
    return <div className="empty-state">Aucune donnee de revenu</div>;
  }

  const W = 600, H = 220, PAD_T = 20, PAD_B = 40;
  const chartH = H - PAD_T - PAD_B;
  const n = data.length;
  const gap = 3;
  const barW = Math.max((W - gap * (n - 1)) / n, 4);
  const values = data.map(d => parseInt(d.revenue) || 0);

  // Build prev month lookup by day number
  const prevByDay = {};
  if (prevData && prevData.length > 0) {
    prevData.forEach(d => {
      const day = parseInt((d.period || '').split('-')[2]);
      prevByDay[day] = parseInt(d.revenue) || 0;
    });
  }
  const prevValues = data.map(d => {
    const day = parseInt((d.period || '').split('-')[2]);
    return prevByDay[day] || 0;
  });

  const allMax = Math.max(...values, ...prevValues, 1);

  function formatDateLabel(period) {
    if (!period) return '';
    const parts = period.split('-');
    const day = parseInt(parts[2]);
    const monthNames = ['', 'jan', 'fev', 'mars', 'avr', 'mai', 'juin', 'juil', 'aout', 'sept', 'oct', 'nov', 'dec'];
    return `${day} ${monthNames[parseInt(parts[1])] || ''}`;
  }

  function handleBarHover(e) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.min(Math.max(Math.floor(mouseX / (barW + gap)), 0), n - 1);
    setHover(idx);
  }

  const showEvery = n > 20 ? 3 : n > 12 ? 2 : 1;

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ display: 'block', cursor: 'pointer' }}
          onMouseMove={handleBarHover}
          onMouseLeave={() => setHover(null)}
          onClick={() => { if (hover !== null) setSelected(selected === hover ? null : hover); }}
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map(pct => (
            <g key={pct}>
              <line x1={0} y1={PAD_T + chartH * (1-pct)} x2={W} y2={PAD_T + chartH * (1-pct)}
                stroke="rgba(var(--overlay),0.04)" strokeWidth="1" />
              <text x={4} y={PAD_T + chartH * (1-pct) - 4}
                style={{ fontSize: 8, fill: 'var(--text-muted)', fontWeight: 500, opacity: 0.5 }}>
                {formatPriceInt(Math.round(allMax * pct))}
              </text>
            </g>
          ))}

          {/* Bars */}
          {data.map((d, i) => {
            const x = i * (barW + gap);
            const val = values[i];
            const prevVal = prevValues[i];
            const h = (val / allMax) * chartH;
            const prevH = (prevVal / allMax) * chartH;
            const isHov = hover === i;
            const isSel = selected === i;

            return (
              <g key={i}>
                {/* Previous month bar (behind) */}
                {prevVal > 0 && (
                  <rect
                    x={x} y={PAD_T + chartH - prevH}
                    width={barW} height={prevH}
                    rx={2}
                    fill="none"
                    stroke="rgba(var(--overlay),0.12)"
                    strokeWidth="1"
                    strokeDasharray="3 2"
                  />
                )}
                {/* Current month bar */}
                <rect
                  x={x} y={PAD_T + chartH - h}
                  width={barW} height={Math.max(h, val > 0 ? 2 : 0)}
                  rx={2}
                  fill={isSel ? '#60a5fa' : isHov ? 'rgba(59,130,246,0.85)' : 'rgba(59,130,246,0.55)'}
                  style={{ transition: 'fill 0.15s, y 0.3s, height 0.3s' }}
                />
              </g>
            );
          })}

          {/* X-axis labels */}
          {data.map((d, i) => {
            if (i % showEvery !== 0 && i !== n - 1) return null;
            const x = i * (barW + gap) + barW / 2;
            const day = (d.period || '').split('-')[2];
            return (
              <text key={i} x={x} y={H - 8} textAnchor="middle"
                style={{
                  fontSize: 9, fontWeight: hover === i ? 700 : 500,
                  fill: hover === i || selected === i ? '#3b82f6' : 'var(--text-muted)',
                }}>
                {day}
              </text>
            );
          })}
        </svg>

        {/* Tooltip */}
        {hover !== null && data[hover] && (
          <div style={{
            position: 'absolute',
            left: `${((hover * (barW + gap) + barW / 2) / W) * 100}%`,
            top: 0,
            transform: 'translateX(-50%)',
            background: 'rgba(15,15,15,0.95)',
            border: '1px solid rgba(59,130,246,0.3)',
            borderRadius: 8,
            padding: '6px 12px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>
              {formatDateLabel(data[hover]?.period)}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#60a5fa', fontFamily: 'var(--font-display)' }}>
                {formatPriceInt(values[hover])}
              </span>
              {data[hover]?.booking_count > 0 && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                  {data[hover].booking_count} RDV
                </span>
              )}
            </div>
            {prevValues[hover] > 0 && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                Mois prec. : {formatPriceInt(prevValues[hover])}
                {values[hover] > 0 && prevValues[hover] > 0 && (
                  <span style={{
                    marginLeft: 6,
                    color: values[hover] >= prevValues[hover] ? '#22c55e' : '#ef4444',
                    fontWeight: 700,
                  }}>
                    {values[hover] >= prevValues[hover] ? '+' : ''}{Math.round(((values[hover] - prevValues[hover]) / prevValues[hover]) * 100)}%
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend mois precedent */}
      {Object.keys(prevByDay).length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 10, borderRadius: 2, background: 'rgba(59,130,246,0.55)' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ce mois</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 10, borderRadius: 2, border: '1px dashed rgba(var(--overlay),0.2)', background: 'transparent' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Mois precedent</span>
          </div>
        </div>
      )}

      {/* Detail panel on click */}
      {selected !== null && data[selected] && (
        <div style={{
          marginTop: 14, padding: '14px 18px',
          background: 'rgba(59,130,246,0.06)',
          border: '1px solid rgba(59,130,246,0.12)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 24, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{formatDateLabel(data[selected]?.period)}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800 }}>{formatPriceInt(values[selected])}</div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>RDV</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800 }}>{data[selected]?.booking_count || 0}</div>
            </div>
            {(data[selected]?.booking_count || 0) > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Moy/RDV</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800 }}>
                  {formatPriceInt(Math.round(values[selected] / (parseInt(data[selected].booking_count) || 1)))}
                </div>
              </div>
            )}
            {prevValues[selected] > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mois prec.</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--text-secondary)' }}>
                  {formatPriceInt(prevValues[selected])}
                </div>
              </div>
            )}
            {prevValues[selected] > 0 && values[selected] > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Evolution</div>
                <div style={{
                  fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800,
                  color: values[selected] >= prevValues[selected] ? '#22c55e' : '#ef4444',
                }}>
                  {values[selected] >= prevValues[selected] ? '+' : ''}{Math.round(((values[selected] - prevValues[selected]) / prevValues[selected]) * 100)}%
                </div>
              </div>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); setSelected(null); }} style={{
            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 4,
          }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}
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
// ServiceDonut
// ============================================

function ServiceDonut({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">Aucune donnee</div>;
  }

  const total = data.reduce((sum, s) => sum + (parseInt(s.booking_count) || 0), 0);
  if (total === 0) return <div className="empty-state">Aucune donnee</div>;

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
      return [
        `M ${cx} ${cy - outerR}`,
        `A ${outerR} ${outerR} 0 0 1 ${cx} ${cy + outerR}`,
        `A ${outerR} ${outerR} 0 0 1 ${cx} ${cy - outerR}`,
        `M ${cx} ${cy - innerR}`,
        `A ${innerR} ${innerR} 0 0 0 ${cx} ${cy + innerR}`,
        `A ${innerR} ${innerR} 0 0 0 ${cx} ${cy - innerR}`,
      ].join(' ');
    }
    const gap = 0.004;
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
    <div className="a-donut-layout">
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <svg width="160" height="160" viewBox="0 0 160 160">
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

function BarberPerformance({ data, occupancy }) {
  const isMobile = useMobile();
  if (!data || !data.barbers || data.barbers.length === 0) {
    return <div className="empty-state">Aucun barber</div>;
  }

  const barbers = data.barbers.filter((b) => b.name?.toLowerCase() !== 'admin');
  const maxRev = Math.max(...barbers.map((b) => parseInt(b.revenue) || 0), 1);

  const occMap = {};
  if (occupancy?.barbers) {
    occupancy.barbers.forEach(ob => { occMap[ob.name] = ob; });
  }

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
        const occ = occMap[b.name];
        const occPct = occ ? Math.min(Math.round(parseFloat(occ.occupancy_percent) || 0), 100) : null;
        const occColor = occPct !== null ? (occPct >= 80 ? '#22c55e' : occPct >= 50 ? '#f59e0b' : '#ef4444') : null;

        return (
          <div key={i} className="a-card a-card-lift" style={{ padding: isMobile ? '16px 14px' : '24px 22px', ...(isMobile ? { minWidth: 200, flex: '0 0 auto' } : {}) }}>
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

            {occPct !== null && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Occupation</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800, color: occColor }}>{occPct}%</span>
                </div>
                <div style={{ height: 5, background: 'rgba(var(--overlay),0.04)', borderRadius: 3 }}>
                  <div style={{
                    height: '100%', width: `${occPct}%`,
                    background: `linear-gradient(90deg, ${occColor}, ${occColor}80)`,
                    borderRadius: 3, transition: 'width 0.6s ease',
                  }} />
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                  {parseInt(occ.booked_slots) || 0} RDV / {parseInt(occ.total_slots) || 0} creneaux
                </div>
              </div>
            )}

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

  // PostgreSQL EXTRACT(DOW) returns 0=Sunday,1=Monday,...,6=Saturday
  // BarberClub convention: 0=Lundi,...,5=Samedi,6=Dimanche
  // Convert: pgDow => (pgDow + 6) % 7
  const heatmap = {};
  let maxCount = 0;
  data.heatmap.forEach((row) => {
    const pgDay = parseInt(row.day_of_week);
    const bbDay = (pgDay + 6) % 7;
    const hour = parseInt(row.hour);
    const count = parseInt(row.count);
    if (!heatmap[bbDay]) heatmap[bbDay] = {};
    heatmap[bbDay][hour] = (heatmap[bbDay][hour] || 0) + count;
    if (heatmap[bbDay][hour] > maxCount) maxCount = heatmap[bbDay][hour];
  });

  const hours = [];
  for (let h = 9; h <= 19; h++) hours.push(h);
  const days = [0, 1, 2, 3, 4, 5]; // Lun-Sam

  function getCellColor(count) {
    if (!count || maxCount === 0) return 'rgba(var(--overlay),0.02)';
    const t = count / maxCount;
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
// Revenue Hourly Heatmap (barber x hour)
// ============================================

function RevenueHourlyHeatmap({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">Aucune donnee</div>;
  }

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
// Members Section
// ============================================

function MembersSection({ stats }) {
  if (!stats) return null;

  const memRev = parseInt(stats.revenue?.member) || 0;
  const guestRev = parseInt(stats.revenue?.guest) || 0;
  const totalRev = memRev + guestRev || 1;
  const memPct = Math.round((memRev / totalRev) * 100);
  const guestPct = 100 - memPct;

  return (
    <div className="a-card">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'baseline', marginBottom: 18 }}>
        <div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: '#22c55e' }}>{stats.total_members}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>membres</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> / {stats.total_clients} clients</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 6, background: 'rgba(var(--overlay),0.04)' }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{stats.conversion_rate}%</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>conversion</span>
        </div>
        {stats.new_members_this_month > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, background: 'rgba(34,197,94,0.08)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>+{stats.new_members_this_month}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ce mois</span>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>CA (3 derniers mois)</div>
        <div style={{ display: 'flex', gap: 2, height: 24, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.3)' }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Membres</span>
            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{formatPriceInt(memRev)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(var(--overlay),0.2)' }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Invites</span>
            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{formatPriceInt(guestRev)}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: stats.monthly_signups?.length > 0 ? 16 : 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Visites moy. : <span style={{ fontWeight: 700 }}>{stats.avg_visits?.member || '0'}</span> membres
          <span style={{ color: 'var(--text-muted)' }}> / {stats.avg_visits?.guest || '0'} invites</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Panier : <span style={{ fontWeight: 700 }}>{formatPriceInt(stats.avg_spend?.member || 0)}</span> membres
          <span style={{ color: 'var(--text-muted)' }}> / {formatPriceInt(stats.avg_spend?.guest || 0)} invites</span>
        </div>
      </div>

      {stats.monthly_signups && stats.monthly_signups.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Inscriptions mensuelles
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 44 }}>
            {stats.monthly_signups.map((m, i) => {
              const max = Math.max(...stats.monthly_signups.map(s => parseInt(s.signups || s.count) || 0), 1);
              const count = parseInt(m.signups || m.count) || 0;
              const h = Math.max(Math.round((count / max) * 36), count > 0 ? 6 : 2);
              const mLabel = m.month?.substring(5, 7);
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: count > 0 ? '#22c55e' : 'var(--text-muted)' }}>{count}</span>
                  <div style={{
                    width: '100%', maxWidth: 24, height: h, borderRadius: '3px 3px 0 0',
                    background: count > 0 ? 'linear-gradient(to top, #16a34a, #22c55e)' : 'rgba(var(--overlay),0.04)',
                  }} />
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{mLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// TodayHero — Bloc 1
// ============================================

function TodayHero({ todayRevenue, todayBookings, nextBookings }) {
  const isMobile = useMobile();
  const upcoming = (nextBookings || []).slice(0, 3);
  const totalToday = todayBookings || 0;
  const upcomingCount = upcoming.length;

  return (
    <div className="a-today-hero a-stagger a-d1">
      <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 16 : 24, flexWrap: 'wrap' }}>
        {/* CA du jour */}
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            CA aujourd&apos;hui
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: isMobile ? 32 : 40, fontWeight: 800, lineHeight: 1 }}>
            {formatPriceInt(todayRevenue)}
          </div>
        </div>

        {/* Badge RDV */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 14px', borderRadius: 10,
          background: 'rgba(59,130,246,0.08)',
          border: '1px solid rgba(59,130,246,0.12)',
          flexShrink: 0,
        }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#3b82f6" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6' }}>
            {totalToday} RDV
          </span>
          {upcomingCount > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              dont {upcomingCount} a venir
            </span>
          )}
        </div>
      </div>

      {/* Prochains RDV inline */}
      {upcoming.length > 0 && (
        <div style={{
          display: 'flex', gap: isMobile ? 8 : 12, marginTop: 18,
          overflowX: 'auto', paddingBottom: 2,
          flexWrap: isMobile ? 'nowrap' : 'wrap',
        }}>
          {upcoming.map((b, i) => (
            <div key={b.id || i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px',
              background: 'rgba(var(--overlay),0.03)',
              border: '1px solid rgba(var(--overlay),0.05)',
              borderRadius: 10,
              flexShrink: 0,
              minWidth: isMobile ? 180 : 'auto',
            }}>
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800,
                color: '#3b82f6', flexShrink: 0,
              }}>
                {formatTime(b.start_time)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{b.client_name}</span>
              <span style={{
                fontSize: 11, color: 'var(--text-muted)',
                background: 'rgba(var(--overlay),0.04)',
                padding: '2px 6px', borderRadius: 4, flexShrink: 0,
              }}>
                {b.barber_name}
              </span>
            </div>
          ))}
        </div>
      )}

      {upcoming.length === 0 && totalToday === 0 && (
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
          Aucun RDV aujourd&apos;hui
        </div>
      )}
    </div>
  );
}

// ============================================
// ActivitySection — Bloc 4 (onglets)
// ============================================

function ActivitySection({ serviceStats, peakHours, revenueHourly, monthLabel, isMobile }) {
  const [tab, setTab] = useState('services');
  const [showBarberHeatmap, setShowBarberHeatmap] = useState(false);

  const services = serviceStats?.services || [];
  const totalBookings = services.reduce((s, x) => s + (parseInt(x.booking_count) || 0), 0);
  const activeCount = services.filter(x => (parseInt(x.booking_count) || 0) > 0).length;
  const inactiveCount = services.length - activeCount;
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
      <SectionTitle
        className="a-stagger a-d8"
        icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>}
        title="Activite"
        subtitle="Prestations et heures de pointe"
        right={
          <div className="a-tab-bar">
            <button
              className={tab === 'services' ? 'active' : ''}
              onClick={() => setTab('services')}
            >
              Prestations
            </button>
            <button
              className={tab === 'peak' ? 'active' : ''}
              onClick={() => setTab('peak')}
            >
              Heures de pointe
            </button>
          </div>
        }
      />

      <div className="a-stagger a-d8" style={{ marginBottom: 32 }}>
        {tab === 'services' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 0.8fr', gap: 16, marginBottom: 12 }}>
              <div className="a-card" style={{ padding: '20px 8px' }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, paddingLeft: 16 }}>Top prestations</h4>
                <TopServices data={services} />
              </div>
              <div className="a-card">
                <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Repartition</h4>
                <ServiceDonut data={services} />
              </div>
            </div>

            {/* Stat strip */}
            <div className="a-stat-strip">
              {topService && topCount > 0 && (
                <div className="a-stat-strip-item">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#f59e0b" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  <span style={{ fontWeight: 700 }}>{topService.name}</span>
                  <span style={{ color: '#f59e0b', fontWeight: 800 }}>{topPct}%</span>
                </div>
              )}
              {minPrice > 0 && (
                <div className="a-stat-strip-item">
                  <span>{formatPriceInt(minPrice)} – {formatPriceInt(maxPrice)}</span>
                </div>
              )}
              {avgDuration > 0 && (
                <div className="a-stat-strip-item">
                  <span>Moy. {avgDuration} min</span>
                </div>
              )}
              <div className="a-stat-strip-item">
                <span>{activeCount} actives</span>
                {inactiveCount > 0 && <span style={{ color: '#f59e0b' }}>/ {inactiveCount} inactives</span>}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="a-card" style={{ marginBottom: showBarberHeatmap && revenueHourly?.length > 0 ? 16 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {monthLabel} — Lundi a Samedi
                </div>
                {peakHours?.best_days && peakHours.best_days.length > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 12px', borderRadius: 8,
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.12)',
                  }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#f59e0b" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>
                      {DAY_LABELS[(parseInt(peakHours.best_days[0].day_of_week) + 6) % 7]}
                    </span>
                  </div>
                )}
              </div>
              <div className="a-heatmap-scroll">
                <PeakHoursHeatmap data={peakHours} />
              </div>
            </div>

            {revenueHourly && revenueHourly.length > 0 && (
              <>
                <button
                  onClick={() => setShowBarberHeatmap(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 16px', margin: '12px 0',
                    background: 'rgba(var(--overlay),0.04)',
                    border: '1px solid rgba(var(--overlay),0.08)',
                    borderRadius: 8, cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                    transition: 'all 0.2s',
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ transition: 'transform 0.2s', transform: showBarberHeatmap ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                  {showBarberHeatmap ? 'Masquer' : 'Voir'} par barber
                </button>

                {showBarberHeatmap && (
                  <div className="a-card">
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 14 }}>
                      Revenue par creneau — {monthLabel}
                    </div>
                    <div className="a-heatmap-scroll">
                      <RevenueHourlyHeatmap data={revenueHourly} />
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ============================================
// NoShowSection — Bloc Faux Plans
// ============================================

function NoShowSection({ data, isMobile, navigate }) {
  if (!data) return null;

  const { overview, by_barber, by_service, by_day, by_hour, top_clients, trend, recent } = data;

  if (overview.count === 0 && (!trend || trend.every(t => t.no_shows === 0))) {
    return (
      <>
        <SectionTitle
          className="a-stagger a-d7"
          icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ef4444" strokeWidth="1.5" style={{ opacity: 0.7 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
          title="Faux plans"
          subtitle="Aucun faux plan ce mois"
        />
      </>
    );
  }

  const maxBarber = Math.max(...by_barber.map(b => b.count), 1);
  const maxService = Math.max(...by_service.map(s => s.count), 1);
  const maxHour = Math.max(...by_hour.map(h => h.count), 1);
  const maxTrend = Math.max(...trend.map(t => t.no_shows), 1);

  return (
    <>
      <SectionTitle
        className="a-stagger a-d7"
        icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ef4444" strokeWidth="1.5" style={{ opacity: 0.7 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
        title="Faux plans"
        subtitle={`${overview.count} faux plan${overview.count > 1 ? 's' : ''} — ${formatPriceInt(overview.cost)} perdus (${overview.rate}%)`}
      />

      <div className="a-stagger a-d7" style={{ marginBottom: 32 }}>
        {/* Row 1: Overview KPIs inline */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <div className="a-card" style={{ padding: '16px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Faux plans</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: '#ef4444' }}>{overview.count}</div>
          </div>
          <div className="a-card" style={{ padding: '16px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>CA perdu</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#ef4444' }}>{formatPriceInt(overview.cost)}</div>
          </div>
          <div className="a-card" style={{ padding: '16px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Taux</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800 }}>{overview.rate}%</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>sur {overview.total_bookings} RDV</div>
          </div>
          <div className="a-card" style={{ padding: '16px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Recidivistes</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: top_clients.length > 0 ? '#f59e0b' : 'var(--text)' }}>{top_clients.length}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>2+ faux plans</div>
          </div>
        </div>

        {/* Row 2: By barber + By service */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Par barber */}
          {by_barber.length > 0 && (
            <div className="a-card">
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Par barber</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {by_barber.map((b, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{b.barber_name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.rate}%</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800, color: '#ef4444' }}>{b.count}</span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'rgba(var(--overlay),0.04)', borderRadius: 2 }}>
                      <div style={{
                        height: '100%', width: `${(b.count / maxBarber) * 100}%`,
                        background: 'linear-gradient(90deg, #ef4444, #ef444480)',
                        borderRadius: 2, transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Par prestation */}
          {by_service.length > 0 && (
            <div className="a-card">
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Par prestation</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {by_service.map((s, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{s.service_name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatPriceInt(s.cost)}</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800, color: '#ef4444' }}>{s.count}</span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'rgba(var(--overlay),0.04)', borderRadius: 2 }}>
                      <div style={{
                        height: '100%', width: `${(s.count / maxService) * 100}%`,
                        background: 'linear-gradient(90deg, #f59e0b, #f59e0b80)',
                        borderRadius: 2, transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Row 3: By day + By hour + Trend */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Par jour */}
          {by_day.length > 0 && (
            <div className="a-card">
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Par jour</h4>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
                {[1, 2, 3, 4, 5, 6].map(pgDow => {
                  // pgDow 1=Monday..6=Saturday, convert to BarberClub 0=Lundi..5=Samedi
                  const bbDay = (pgDow + 6) % 7;
                  const entry = by_day.find(d => d.day_of_week === pgDow);
                  const count = entry ? entry.count : 0;
                  const maxDay = Math.max(...by_day.map(d => d.count), 1);
                  const h = count > 0 ? Math.max(Math.round((count / maxDay) * 64), 8) : 4;
                  return (
                    <div key={pgDow} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      {count > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: '#ef4444' }}>{count}</span>}
                      <div style={{
                        width: '100%', maxWidth: 28, height: h, borderRadius: '4px 4px 0 0',
                        background: count > 0 ? `rgba(239,68,68,${0.3 + (count / maxDay) * 0.5})` : 'rgba(var(--overlay),0.04)',
                      }} />
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{DAY_LABELS[bbDay]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Par heure */}
          {by_hour.length > 0 && (
            <div className="a-card">
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Par heure</h4>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
                {Array.from({ length: 11 }, (_, i) => i + 9).map(hour => {
                  const entry = by_hour.find(h => h.hour === hour);
                  const count = entry ? entry.count : 0;
                  const h = count > 0 ? Math.max(Math.round((count / maxHour) * 64), 8) : 4;
                  return (
                    <div key={hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      {count > 0 && <span style={{ fontSize: 9, fontWeight: 800, color: '#ef4444' }}>{count}</span>}
                      <div style={{
                        width: '100%', maxWidth: 22, height: h, borderRadius: '3px 3px 0 0',
                        background: count > 0 ? `rgba(239,68,68,${0.3 + (count / maxHour) * 0.5})` : 'rgba(var(--overlay),0.04)',
                      }} />
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{hour}h</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Evolution 6 mois */}
          {trend.length > 0 && (
            <div className="a-card">
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Evolution</h4>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
                {trend.map((t, i) => {
                  const h = t.no_shows > 0 ? Math.max(Math.round((t.no_shows / maxTrend) * 64), 8) : 4;
                  const mLabel = t.month.substring(5, 7);
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      {t.no_shows > 0 && <span style={{ fontSize: 9, fontWeight: 800, color: '#ef4444' }}>{t.no_shows}</span>}
                      <div title={`${t.rate}% — ${formatPriceInt(t.cost)}`} style={{
                        width: '100%', maxWidth: 28, height: h, borderRadius: '4px 4px 0 0',
                        background: t.no_shows > 0 ? `rgba(239,68,68,${0.3 + (t.no_shows / maxTrend) * 0.5})` : 'rgba(var(--overlay),0.04)',
                      }} />
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{mLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Row 4: Recidivistes */}
        {top_clients.length > 0 && (
          <div className="a-card" style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
              Recidivistes
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>Clients avec 2+ faux plans (historique complet)</span>
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {top_clients.map((c) => (
                <div
                  key={c.id}
                  className="a-inactive-row"
                  onClick={() => navigate(`/clients/${c.id}`)}
                  style={{ flexWrap: isMobile ? 'wrap' : 'nowrap' }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 13, flexShrink: 0, color: '#ef4444',
                  }}>
                    {c.first_name?.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.first_name} {c.last_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.phone}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                    Dernier : {c.last_no_show || '-'}
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: '#ef4444',
                    padding: '4px 10px', borderRadius: 6,
                    background: 'rgba(239,68,68,0.08)',
                    flexShrink: 0,
                  }}>
                    {c.total_no_shows}x — {formatPriceInt(c.total_cost)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Row 5: Derniers faux plans */}
        {recent && recent.length > 0 && (
          <div className="a-card">
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Derniers faux plans</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {recent.map((r, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px',
                  background: 'rgba(var(--overlay),0.02)',
                  borderRadius: 8,
                  flexWrap: isMobile ? 'wrap' : 'nowrap',
                }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', minWidth: 72, flexShrink: 0 }}>
                    {r.date}
                  </span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 800, color: '#3b82f6', flexShrink: 0 }}>
                    {formatTime(r.start_time)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.client_first_name} {r.client_last_name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{r.service_name}</span>
                  <span style={{
                    fontSize: 11, color: 'var(--text-muted)',
                    background: 'rgba(var(--overlay),0.04)',
                    padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                  }}>{r.barber_name}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 800, color: '#ef4444', flexShrink: 0 }}>
                    {formatPriceInt(r.price)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================
// Trend helper
// ============================================

function calcTrend(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

const BARBER_STATS_PIN = 'Jiinx211211@';

// ============================================
// Main Analytics Page
// ============================================

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

  const barberStatsParams = useMemo(() => {
    if (barberPeriod === 'day') {
      const today = format(new Date(), 'yyyy-MM-dd');
      return { from: today, to: today };
    }
    if (barberPeriod === 'week') {
      const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
      return { from: format(monday, 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') };
    }
    return { month: monthStr };
  }, [barberPeriod, monthStr]);

  const dashboardQuery = useDashboard(monthParams);
  const revenueQuery = useRevenue({ period: 'day', month: monthStr });
  const prevMonthStr = useMemo(() => format(subMonths(selectedMonth, 1), 'yyyy-MM'), [selectedMonth]);
  const prevRevenueQuery = useRevenue({ period: 'day', month: prevMonthStr });
  const serviceStatsQuery = useServiceStats(monthParams);
  const barberStatsQuery = useBarberStats(barberStatsParams);
  const peakHoursQuery = usePeakHours(monthParams);
  const occupancyQuery = useOccupancy(monthParams);
  const inactiveQuery = useInactiveClients();
  const memberStatsQuery = useMemberStats();
  const trendsQuery = useTrends({ enabled: isCurrentMonth });
  const revenueHourlyQuery = useRevenueHourly(monthParams);
  const noShowQuery = useNoShowStats(monthParams);

  const loading = dashboardQuery.isLoading;
  const error = dashboardQuery.error?.message || '';
  const dashboard = dashboardQuery.data || null;
  const revenueRaw = revenueQuery.data;
  const revenue = Array.isArray(revenueRaw) ? revenueRaw : (revenueRaw?.data || []);
  const prevRevenueRaw = prevRevenueQuery.data;
  const prevRevenue = Array.isArray(prevRevenueRaw) ? prevRevenueRaw : (prevRevenueRaw?.data || []);
  const serviceStats = serviceStatsQuery.data || null;
  const barberStats = barberStatsQuery.data || null;
  const peakHours = peakHoursQuery.data || null;
  const occupancy = occupancyQuery.data || null;
  const inactiveClients = inactiveQuery.data?.clients || [];
  const memberStats = memberStatsQuery.data || null;
  const trends = trendsQuery.data || null;
  const revenueHourly = revenueHourlyQuery.data || null;
  const noShowStats = noShowQuery.data || null;

  const prev = dashboard?.previous || null;

  function loadAll() {
    dashboardQuery.refetch();
    revenueQuery.refetch();
    prevRevenueQuery.refetch();
    serviceStatsQuery.refetch();
    barberStatsQuery.refetch();
    peakHoursQuery.refetch();
    occupancyQuery.refetch();
    inactiveQuery.refetch();
    memberStatsQuery.refetch();
    trendsQuery.refetch();
    revenueHourlyQuery.refetch();
    noShowQuery.refetch();
  }

  const monthBookings = dashboard?.month?.bookings || 0;
  const monthCancelled = dashboard?.month?.cancelled || 0;
  const monthTotal = monthBookings + monthCancelled;
  const cancelRate = monthTotal > 0 ? Math.round((monthCancelled / monthTotal) * 100) : 0;
  const prevCancelRate = prev ? (prev.bookings + (prev.cancelled || 0)) > 0 ? Math.round(((prev.cancelled || 0) / (prev.bookings + (prev.cancelled || 0))) * 100) : 0 : null;

  const totalRevMonth = revenue.reduce((sum, d) => sum + (parseInt(d.revenue) || 0), 0);
  const avgDailyRev = revenue.length > 0 ? Math.round(totalRevMonth / revenue.length) : 0;
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayRev = revenue.find(d => d.period === todayStr);
  const todayRevenue = todayRev ? parseInt(todayRev.revenue) || 0 : 0;
  const todayBookings = todayRev ? parseInt(todayRev.booking_count) || 0 : 0;

  // No-shows for subtitle
  const noShowCount = trends?.no_show_current?.count || 0;
  const noShowCost = trends?.no_show_current?.cost || 0;

  // Projection
  const projection = trends?.projection || null;

  // ---- Lock screen ----
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
              color: 'var(--text-muted)', cursor: isCurrentMonth ? 'default' : 'pointer',
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm print-hide" onClick={() => window.print()} style={{ gap: 6 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            PDF
          </button>
          <button className="btn btn-secondary btn-sm print-hide" onClick={loadAll} disabled={loading} style={{ gap: 6 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={loading ? { animation: 'spin 1s linear infinite' } : {}}>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Actualiser
          </button>
        </div>
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
            {/* ======== BLOC 1 : AUJOURD'HUI (mois courant uniquement) ======== */}
            {isCurrentMonth && (
              <TodayHero
                todayRevenue={todayRevenue}
                todayBookings={todayBookings}
                nextBookings={dashboard?.next_bookings}
              />
            )}

            {/* ======== BLOC 2 : CE MOIS — KPIs (4 cards) ======== */}
            <div className="a-kpi-grid" style={{ gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)' }}>
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
                className="a-stagger a-d2"
                label="RDV"
                value={monthBookings}
                subtitle="rendez-vous"
                trend={calcTrend(monthBookings, prev?.bookings)}
                trendLabel={prev ? `${calcTrend(monthBookings, prev.bookings) > 0 ? '+' : ''}${calcTrend(monthBookings, prev.bookings)}% vs mois prec.` : undefined}
                accent="blue"
                icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
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
                label="Annulations"
                value={`${cancelRate}%`}
                subtitle={noShowCount > 0
                  ? `${monthCancelled} annul. + ${noShowCount} faux plan${noShowCount > 1 ? 's' : ''} (${formatPriceInt(noShowCost)})`
                  : `${monthCancelled} annul. / ${monthTotal}`
                }
                trend={prevCancelRate !== null ? cancelRate - prevCancelRate : null}
                color="invert"
                accent="red"
                icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
              />
            </div>

            {/* ======== BLOC 2b : Ventes produits ======== */}
            {(dashboard?.month?.product_revenue > 0 || dashboard?.today?.product_revenue > 0) && (
              <div className="a-stagger a-d4" style={{
                display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap',
              }}>
                <div style={{
                  flex: 1, minWidth: 160, padding: '14px 18px', borderRadius: 12,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                    background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                  }}>🛒</div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Ventes produits (mois)</div>
                    <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)', marginTop: 2 }}>
                      {formatPriceInt(dashboard?.month?.product_revenue || 0)}
                    </div>
                  </div>
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dashboard?.month?.product_count || 0} vente{(dashboard?.month?.product_count || 0) > 1 ? 's' : ''}</div>
                  </div>
                </div>
                {dashboard?.today?.product_revenue > 0 && (
                  <div style={{
                    minWidth: 140, padding: '14px 18px', borderRadius: 12,
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Aujourd'hui</div>
                    <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-display)', color: '#8b5cf6' }}>
                      {formatPriceInt(dashboard?.today?.product_revenue || 0)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ======== BLOC 2 suite : COURBE CA + PROJECTION inline ======== */}
            <div className="a-stagger a-d5 a-card" style={{ marginBottom: 32 }}>
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
              <RevenueChart data={revenue} prevData={prevRevenue} />

              {/* Projection inline */}
              {isCurrentMonth && projection && (
                <div className="a-projection-inline">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>Projection</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                        Jour {projection.days_elapsed}/{projection.days_in_month}
                      </span>
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800,
                      padding: '4px 12px', borderRadius: 8,
                      background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.12)',
                      color: '#22c55e',
                    }}>
                      {formatPriceInt(projection.projected_total || 0)}
                    </div>
                  </div>

                  {(() => {
                    const realized = projection.revenue_so_far || 0;
                    const confirmed = projection.future_confirmed || 0;
                    const projected = projection.projected_total || 0;
                    const total = Math.max(projected, realized + confirmed, 1);
                    const pctRealized = Math.round((realized / total) * 100);
                    const pctConfirmed = Math.round((confirmed / total) * 100);

                    return (
                      <>
                        <div style={{ height: 12, background: 'rgba(var(--overlay),0.04)', borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: 12 }}>
                          <div style={{
                            width: `${pctRealized}%`,
                            background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                            borderRadius: '6px 0 0 6px',
                            transition: 'width 0.6s ease',
                          }} />
                          <div style={{
                            width: `${pctConfirmed}%`,
                            background: 'rgba(34,197,94,0.25)',
                            transition: 'width 0.6s ease',
                          }} />
                        </div>

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
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* ======== BLOC 3 : BARBERS ======== */}

            <SectionTitle
              className="a-stagger a-d6"
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
            <div className="a-stagger a-d6" style={{ marginBottom: 32 }}>
              <BarberPerformance data={barberStats} occupancy={occupancy} />
            </div>

            {/* ======== BLOC : FAUX PLANS ======== */}

            <NoShowSection data={noShowStats} isMobile={isMobile} navigate={navigate} />

            {/* ======== BLOC 4 : ACTIVITE (onglets) ======== */}

            <ActivitySection
              serviceStats={serviceStats}
              peakHours={peakHours}
              revenueHourly={revenueHourly}
              monthLabel={monthLabel}
              isMobile={isMobile}
            />

            {/* ======== BLOC 5 : CLIENTS (fusion membres + inactifs) ======== */}

            <SectionTitle
              className="a-stagger a-d9"
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              title="Clients"
              subtitle="Membres, conversion et clients inactifs"
            />

            {/* Membres */}
            {memberStats && (
              <div className="a-stagger a-d9" style={{ marginBottom: 20 }}>
                <MembersSection stats={memberStats} />
              </div>
            )}

            {/* Clients inactifs */}
            <div className="a-stagger a-d10" style={{ marginBottom: 32 }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--text-secondary)' }}>
                Clients inactifs
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>
                  Reguliers (3+ visites) sans RDV depuis 3 mois
                </span>
              </h4>
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
                      style={{ flexWrap: isMobile ? 'wrap' : 'nowrap' }}
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
