import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getDashboard,
  getRevenue,
  getServiceStats,
  getBarberStats,
  getPeakHours,
  getInactiveClients,
  getOccupancy,
} from '../api';

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

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// ============================================
// KPI Card component
// ============================================

function KpiCard({ label, value, subtitle, trend, trendLabel, color }) {
  const isPositive = trend > 0;
  const isNegative = trend < 0;
  const trendColor = color === 'invert'
    ? (isPositive ? 'var(--danger)' : 'var(--success)')
    : (isPositive ? 'var(--success)' : isNegative ? 'var(--danger)' : 'var(--text-muted)');

  return (
    <div className="card" style={{ flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, lineHeight: 1.1, marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {trend !== undefined && trend !== null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: trendColor }}>
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
// Revenue Bar Chart (pure CSS)
// ============================================

function RevenueChart({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">Aucune donnee de revenu</div>;
  }

  const BAR_AREA_H = 180;
  const maxRevenue = Math.max(...data.map((d) => parseInt(d.revenue) || 0), 1);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: BAR_AREA_H, minWidth: data.length * 20, padding: '0 4px' }}>
        {data.map((d, i) => {
          const rev = parseInt(d.revenue) || 0;
          const barH = Math.max(Math.round((rev / maxRevenue) * BAR_AREA_H), rev > 0 ? 4 : 2);
          const dateStr = d.period || '';
          const dayNum = dateStr.split('-')[2] || '';
          return (
            <div
              key={i}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', minWidth: 14 }}
              title={`${dateStr}: ${formatPriceInt(rev)}`}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 24,
                  height: barH,
                  background: rev > 0
                    ? 'linear-gradient(to top, rgba(var(--overlay),0.15), rgba(var(--overlay),0.35))'
                    : 'rgba(var(--overlay),0.05)',
                  borderRadius: '4px 4px 0 0',
                  transition: 'height 0.3s ease',
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 3, padding: '0 4px', marginTop: 4 }}>
        {data.map((d, i) => {
          const dateStr = d.period || '';
          const dayNum = dateStr.split('-')[2] || '';
          return (
            <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--text-muted)', lineHeight: 1, minWidth: 14 }}>
              {dayNum}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{data[0]?.period}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{data[data.length - 1]?.period}</span>
      </div>
    </div>
  );
}

// ============================================
// Pie chart colors (matching Planning BLOCK_COLORS)
// ============================================

const PIE_COLORS = [
  '#22c55e', '#3b82f6', '#a855f7', '#f59e0b',
  '#ec4899', '#14b8a6', '#ef4444', '#6366f1',
];

// ============================================
// ServicePieChart — pure SVG
// ============================================

function ServicePieChart({ data }) {
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
    slices.push({ name: s.name, count, pct, start: cumulative, color: PIE_COLORS[i % PIE_COLORS.length] });
    cumulative += pct;
  });

  // SVG arc helper
  const cx = 80, cy = 80, r = 70;
  function arcPath(startPct, endPct) {
    if (endPct - startPct >= 0.9999) {
      // Full circle
      return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy - r}`;
    }
    const startAngle = startPct * 2 * Math.PI - Math.PI / 2;
    const endAngle = (startPct + (endPct - startPct)) * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = (endPct - startPct) > 0.5 ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <svg width="160" height="160" viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
        {slices.map((s, i) => (
          <path
            key={i}
            d={arcPath(s.start, s.start + s.pct)}
            fill={s.color}
            stroke="#111113"
            strokeWidth="1.5"
          >
            <title>{s.name}: {s.count} ({Math.round(s.pct * 100)}%)</title>
          </path>
        ))}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', flexShrink: 0 }}>{Math.round(s.pct * 100)}%</span>
          </div>
        ))}
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

  const maxCount = Math.max(...data.map((s) => parseInt(s.booking_count) || 0), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.map((s, i) => {
        const count = parseInt(s.booking_count) || 0;
        const rev = parseInt(s.revenue) || 0;
        const pct = (count / maxCount) * 100;
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800, color: 'var(--text-muted)', minWidth: 22 }}>
                  {i + 1}.
                </span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{count} RDV</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800 }}>
                  {formatPriceInt(rev)}
                </span>
              </div>
            </div>
            <div style={{ height: 4, background: 'rgba(var(--overlay),0.06)', borderRadius: 2 }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'rgba(var(--overlay),0.3)',
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Barber Performance table
// ============================================

function BarberPerformance({ data }) {
  if (!data || !data.barbers || data.barbers.length === 0) {
    return <div className="empty-state">Aucun barber</div>;
  }

  const barbers = data.barbers;
  const maxRev = Math.max(...barbers.map((b) => parseInt(b.revenue) || 0), 1);

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Barber</th>
            <th>RDV</th>
            <th>CA</th>
            <th>Clients</th>
            <th>No-shows</th>
            <th style={{ width: 120 }}>Performance</th>
          </tr>
        </thead>
        <tbody>
          {barbers.map((b, i) => {
            const rev = parseInt(b.revenue) || 0;
            const count = parseInt(b.booking_count) || 0;
            const pct = (rev / maxRev) * 100;
            return (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{b.name}</td>
                <td>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>
                    {count}
                  </span>
                </td>
                <td>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>
                    {formatPriceInt(rev)}
                  </span>
                </td>
                <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {parseInt(b.unique_clients) || 0}
                </td>
                <td>
                  {parseInt(b.no_shows) > 0 ? (
                    <span className="badge badge-no-show">{b.no_shows}</span>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>0</span>
                  )}
                </td>
                <td>
                  <div style={{ height: 6, background: 'rgba(var(--overlay),0.06)', borderRadius: 3 }}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: 'linear-gradient(90deg, var(--success), rgba(34,197,94,0.4))',
                      borderRadius: 3,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

  // Build a lookup: heatmap[day][hour] = count
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

  // Hours 9-19 (typical barber hours)
  const hours = [];
  for (let h = 9; h <= 19; h++) hours.push(h);

  // Days 1-6 (Mon-Sat), 0 = Sun
  const days = [1, 2, 3, 4, 5, 6];

  function getOpacity(count) {
    if (!count || maxCount === 0) return 0.03;
    return 0.1 + (count / maxCount) * 0.6;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${hours.length}, 1fr)`, gap: 3 }}>
        {/* Header row: hours */}
        <div />
        {hours.map((h) => (
          <div key={h} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 0' }}>
            {h}h
          </div>
        ))}

        {/* Data rows: one per day */}
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
                  title={`${DAY_LABELS[day]} ${h}h: ${count} RDV`}
                  style={{
                    height: 32,
                    borderRadius: 4,
                    background: count > 0
                      ? `rgba(var(--overlay),${getOpacity(count)})`
                      : 'rgba(var(--overlay),0.03)',
                    border: '1px solid rgba(var(--overlay),0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: count > 0 ? 'var(--text-secondary)' : 'transparent',
                    transition: 'background 0.2s',
                    cursor: 'default',
                  }}
                >
                  {count > 0 ? count : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Moins</span>
        {[0.05, 0.15, 0.3, 0.45, 0.6].map((op, i) => (
          <div
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: `rgba(var(--overlay),${op})`,
            }}
          />
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Plus</span>
      </div>
    </div>
  );
}

// ============================================
// Next Bookings list
// ============================================

function NextBookings({ bookings }) {
  if (!bookings || bookings.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 20 }}>
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
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 14px',
            background: 'rgba(var(--overlay),0.03)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            fontWeight: 800,
            minWidth: 50,
            flexShrink: 0,
          }}>
            {formatTime(b.start_time)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{b.client_name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.service_name}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>
            {b.barber_name}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Main Analytics Page
// ============================================

export default function Analytics() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [revenue, setRevenue] = useState([]);
  const [serviceStats, setServiceStats] = useState(null);
  const [barberStats, setBarberStats] = useState(null);
  const [peakHours, setPeakHours] = useState(null);
  const [occupancy, setOccupancy] = useState(null);
  const [inactiveClients, setInactiveClients] = useState([]);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [dash, rev, services, barbers, peaks, occ, inactive] = await Promise.all([
        getDashboard(),
        getRevenue({ period: 'day' }),
        getServiceStats({}),
        getBarberStats({}),
        getPeakHours({}),
        getOccupancy({}).catch(() => null),
        getInactiveClients().catch(() => ({ clients: [] })),
      ]);
      setDashboard(dash);
      setRevenue(rev);
      setServiceStats(services);
      setBarberStats(barbers);
      setPeakHours(peaks);
      setOccupancy(occ);
      setInactiveClients(inactive.clients || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Erreur de chargement');
    }
    setLoading(false);
  }

  // Compute no-show rate from today's data
  const todayBookings = dashboard?.today?.bookings || 0;
  const todayCancelled = dashboard?.today?.cancelled || 0;
  const todayTotal = todayBookings + todayCancelled;
  const noShowRate = todayTotal > 0 ? Math.round((todayCancelled / todayTotal) * 100) : 0;

  // Compute average daily revenue from revenue data
  const totalRev30 = revenue.reduce((sum, d) => sum + (parseInt(d.revenue) || 0), 0);
  const avgDailyRev = revenue.length > 0 ? Math.round(totalRev30 / revenue.length) : 0;

  // Barber average per day
  const workingDaysEstimate = revenue.filter((d) => (parseInt(d.revenue) || 0) > 0).length || 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Analytics</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Vue d'ensemble du salon
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadAll} disabled={loading}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Actualiser
        </button>
      </div>

      <div className="page-body">
        {error && (
          <div className="login-error" style={{ marginBottom: 20 }}>{error}</div>
        )}

        {loading ? (
          <div className="empty-state">Chargement des analytics...</div>
        ) : (
          <>
            {/* ---- KPI CARDS ---- */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
              <KpiCard
                label="RDV aujourd'hui"
                value={dashboard?.today?.bookings ?? '-'}
                subtitle="rendez-vous"
              />
              <KpiCard
                label="CA aujourd'hui"
                value={formatPriceInt(dashboard?.today?.revenue || 0)}
                subtitle={avgDailyRev > 0 ? `moy. ${formatPriceInt(avgDailyRev)}/j` : ''}
                trend={dashboard?.today?.revenue && avgDailyRev > 0
                  ? Math.round(((dashboard.today.revenue - avgDailyRev) / avgDailyRev) * 100)
                  : null}
              />
              <KpiCard
                label="CA ce mois"
                value={formatPriceInt(dashboard?.month?.revenue || 0)}
                subtitle={`${dashboard?.month?.bookings || 0} RDV`}
              />
              <KpiCard
                label="Taux annulation"
                value={`${noShowRate}%`}
                subtitle={`${todayCancelled} annul. / ${todayTotal}`}
                trend={noShowRate > 10 ? noShowRate : noShowRate > 0 ? -1 : 0}
                color="invert"
              />
            </div>

            {/* ---- ROW: REVENUE CHART + NEXT BOOKINGS ---- */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 28 }}>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Chiffre d'affaires</h3>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>30 derniers jours</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800 }}>
                    {formatPriceInt(totalRev30)}
                  </div>
                </div>
                <RevenueChart data={revenue} />
              </div>

              <div className="card">
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Prochains RDV</h3>
                <NextBookings bookings={dashboard?.next_bookings} />
              </div>
            </div>

            {/* ---- ROW: TOP SERVICES + PIE CHART ---- */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
              <div className="card">
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Top prestations</h3>
                <TopServices data={serviceStats?.services} />
              </div>

              <div className="card">
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Répartition prestations</h3>
                <ServicePieChart data={serviceStats?.services} />
              </div>
            </div>

            {/* ---- ROW: BARBER PERFORMANCE ---- */}
            <div style={{ marginBottom: 28 }}>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '20px 20px 0' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Performance barbers</h3>
                </div>
                <BarberPerformance data={barberStats} />
              </div>
            </div>

            {/* ---- BARBER OCCUPANCY ---- */}
            {occupancy?.barbers && occupancy.barbers.length > 0 && (
              <div className="card" style={{ marginBottom: 28 }}>
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Taux d'occupation</h3>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pourcentage de créneaux occupés cette semaine</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {occupancy.barbers.map((b, i) => {
                    const pct = Math.min(Math.round(parseFloat(b.occupancy_percent) || 0), 100);
                    const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={i}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</span>
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color }}>{pct}%</span>
                        </div>
                        <div style={{ height: 8, background: 'rgba(var(--overlay),0.06)', borderRadius: 4 }}>
                          <div style={{
                            height: '100%', width: `${pct}%`, background: color,
                            borderRadius: 4, transition: 'width 0.5s ease',
                          }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            {parseInt(b.booked_slots) || 0} RDV / {parseInt(b.total_slots) || 0} créneaux
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            {pct >= 80 ? 'Très occupé' : pct >= 50 ? 'Correct' : 'Sous-occupé'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ---- PEAK HOURS HEATMAP ---- */}
            <div className="card" style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Heures de pointe</h3>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Derniers 30 jours - Lundi a Samedi</span>
                </div>
                {peakHours?.best_days && peakHours.best_days.length > 0 && (
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Meilleur jour : </span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>
                      {DAY_LABELS[parseInt(peakHours.best_days[0].day_of_week)]}
                    </span>
                  </div>
                )}
              </div>
              <PeakHoursHeatmap data={peakHours} />
            </div>

            {/* ---- ALERTES: CLIENTS INACTIFS ---- */}
            <div className="card" style={{ marginBottom: 28 }}>
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Clients inactifs</h3>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Clients réguliers (5+ visites) sans rendez-vous depuis 45+ jours</span>
              </div>
              {inactiveClients.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  Tous vos clients réguliers sont actifs
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {inactiveClients.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => navigate(`/clients/${c.id}`)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '12px 14px',
                        background: 'rgba(var(--overlay),0.03)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {c.first_name} {c.last_name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.phone}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>
                        Dernière visite : {c.last_visit || '-'}
                      </div>
                      <div style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: c.days_since_visit >= 90 ? 'var(--danger)' : 'var(--warning)',
                        flexShrink: 0,
                      }}>
                        {c.days_since_visit} jours sans visite
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
