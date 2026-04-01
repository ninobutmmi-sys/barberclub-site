import { useState } from 'react';
import useMobile from '../hooks/useMobile';
import { useSystemHealth, usePurgeFailedNotifications } from '../hooks/useApi';
import { API_BASE } from '../api';

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}j`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function timeAgo(iso) {
  if (!iso) return 'Jamais';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'Il y a quelques secondes';
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)}h`;
  return `Il y a ${Math.floor(diff / 86400)}j`;
}

function StatusDot({ status }) {
  const colors = { ok: '#22c55e', running: '#3b82f6', error: '#ef4444', idle: '#6b7280' };
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: colors[status] || '#6b7280', marginRight: 6, flexShrink: 0,
    }} />
  );
}

export default function SystemHealth({ embedded } = {}) {
  const isMobile = useMobile();
  const { data, isLoading: loading, error, dataUpdatedAt, refetch } = useSystemHealth();
  const purgeMutation = usePurgeFailedNotifications();
  const [backupLoading, setBackupLoading] = useState(false);

  async function downloadBackup() {
    setBackupLoading(true);
    try {
      const token = localStorage.getItem('bc_access_token');
      const res = await fetch(`${API_BASE}/admin/system/backup`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `barberclub-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Erreur backup: ' + err.message);
    } finally {
      setBackupLoading(false);
    }
  }

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  if (loading && !data) {
    return <div className="empty-state">Chargement...</div>;
  }

  const api = data?.api || {};
  const db = data?.database || {};
  const mem = data?.memory || {};
  const notifs = data?.notifications || {};
  const crons = data?.crons || {};
  const errors = data?.recent_errors || [];

  return (
    <>
      {!embedded && (
        <div className="page-header">
          <div>
            <h2 className="page-title">Santé Système</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Monitoring API, base de données, notifications & cron jobs
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {lastUpdate && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                MAJ {lastUpdate.toLocaleTimeString('fr-FR')}
              </span>
            )}
            <button className="btn btn-secondary btn-sm" onClick={downloadBackup} disabled={backupLoading}>
              {backupLoading ? 'Export...' : 'Backup BDD'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => refetch()} disabled={loading}>
              {loading ? 'Chargement...' : 'Actualiser'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: '12px 16px', marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
          {error.message}
        </div>
      )}

      <div className="page-body">
        {/* ====== OVERVIEW KPIs ====== */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <KpiCard
            label="API"
            value={api.status === 'up' ? 'En ligne' : 'Hors ligne'}
            color={api.status === 'up' ? '#22c55e' : '#ef4444'}
            sub={api.env || ''}
          />
          <KpiCard
            label="Base de données"
            value={db.status === 'connected' ? 'Connectée' : 'Erreur'}
            color={db.status === 'connected' ? '#22c55e' : '#ef4444'}
            sub={db.error || ''}
          />
          <KpiCard
            label="Uptime"
            value={formatUptime(api.uptime || 0)}
            color="var(--text)"
            sub={api.nodeVersion || ''}
          />
          <KpiCard
            label="Mémoire"
            value={`${mem.heapUsedMB || 0} MB`}
            color={mem.heapUsedMB > 200 ? '#f59e0b' : 'var(--text)'}
            sub={`/ ${mem.heapTotalMB || 0} MB heap`}
          />
        </div>

        {/* ====== NOTIFICATIONS ====== */}
        <div className="a-card" style={{ marginBottom: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(var(--overlay), 0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Notifications ce mois</h3>
            {(notifs.sms_failed > 0 || notifs.email_failed > 0) && (
              <button
                className="btn btn-sm"
                style={{ fontSize: 11, padding: '4px 12px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, cursor: 'pointer' }}
                onClick={async () => {
                  if (!confirm('Supprimer toutes les notifications échouées ?')) return;
                  await purgeMutation.mutateAsync();
                }}
              >
                Purger les échecs
              </button>
            )}
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
              <MiniStat label="SMS envoyés" value={notifs.sms_sent} />
              <MiniStat label="SMS échoués" value={notifs.sms_failed} alert={notifs.sms_failed > 0} />
              <MiniStat label="Emails envoyés" value={notifs.email_sent} />
              <MiniStat label="Emails échoués" value={notifs.email_failed} alert={notifs.email_failed > 0} />
              <MiniStat label="En attente" value={notifs.pending} alert={notifs.pending > 5} />
              <MiniStat label="Coût SMS estimé" value={`${(notifs.sms_cost_estimate || 0).toFixed(2)} €`} />
            </div>
            {notifs.brevo_sender && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>Email: {notifs.brevo_sender}</span>
                <span>SMS: {notifs.brevo_sms_sender}</span>
              </div>
            )}
          </div>
        </div>

        {/* ====== NOTIFICATION HEALTH (30 days) ====== */}
        <div className="a-card" style={{ marginBottom: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(var(--overlay), 0.06)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Santé Notifications (30j)</h3>
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
              {/* SMS column */}
              <div style={{ padding: 16, borderRadius: 10, background: 'rgba(var(--overlay), 0.02)', border: '1px solid rgba(var(--overlay), 0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, color: '#8b5cf6' }}>SMS</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <MiniStat label="Envoyés" value={notifs.sms_sent_30d ?? '–'} />
                  <MiniStat label="Échoués" value={notifs.sms_failed_30d ?? '–'} alert={(notifs.sms_failed_30d || 0) > 0} />
                  <MiniStat label="En attente" value={notifs.sms_pending ?? '–'} alert={(notifs.sms_pending || 0) > 5} />
                  <DeliveryRateStat rate={notifs.sms_delivery_rate} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Dernier envoi : {notifs.last_sms_sent ? timeAgo(notifs.last_sms_sent) : 'Aucun'}
                </div>
              </div>
              {/* Email column */}
              <div style={{ padding: 16, borderRadius: 10, background: 'rgba(var(--overlay), 0.02)', border: '1px solid rgba(var(--overlay), 0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, color: '#3b82f6' }}>Email</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <MiniStat label="Envoyés" value={notifs.email_sent_30d ?? '–'} />
                  <MiniStat label="Échoués" value={notifs.email_failed_30d ?? '–'} alert={(notifs.email_failed_30d || 0) > 0} />
                  <MiniStat label="En attente" value={notifs.email_pending ?? '–'} alert={(notifs.email_pending || 0) > 5} />
                  <DeliveryRateStat rate={notifs.email_delivery_rate} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Dernier envoi : {notifs.last_email_sent ? timeAgo(notifs.last_email_sent) : 'Aucun'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ====== CRON JOBS ====== */}
        <div className="a-card" style={{ marginBottom: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(var(--overlay), 0.06)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Cron Jobs</h3>
          </div>
          {isMobile ? (
            <div style={{ padding: '8px 0' }}>
              {Object.entries(crons).map(([key, cron]) => (
                <div key={key} style={{ padding: '12px 20px', borderBottom: '1px solid rgba(var(--overlay), 0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                      <StatusDot status={cron.status} />
                      {cron.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {cron.schedule} &middot; {timeAgo(cron.lastRun)}
                    </div>
                  </div>
                  {cron.error && (
                    <span style={{ fontSize: 10, color: '#ef4444', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cron.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Schedule</th>
                    <th>Dernier run</th>
                    <th>Statut</th>
                    <th>Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(crons).map(([key, cron]) => (
                    <tr key={key}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{cron.label}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{cron.schedule}</td>
                      <td style={{ fontSize: 12 }}>{timeAgo(cron.lastRun)}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12 }}>
                          <StatusDot status={cron.status} />
                          {cron.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: '#ef4444', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cron.error || '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ====== RECENT ERRORS ====== */}
        <div className="a-card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(var(--overlay), 0.06)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
              Erreurs récentes
              {errors.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: 10 }}>
                  {errors.length}
                </span>
              )}
            </h3>
          </div>
          {errors.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              Aucune erreur récente
            </div>
          ) : isMobile ? (
            <div style={{ padding: '8px 0' }}>
              {errors.map((e) => (
                <div key={e.id} style={{ padding: '12px 20px', borderBottom: '1px solid rgba(var(--overlay), 0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: e.type === 'sms' ? '#8b5cf6' : '#3b82f6' }}>{e.type}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{new Date(e.created_at).toLocaleDateString('fr-FR')}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{e.client_name || '–'}</div>
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>{e.last_error}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{e.attempts} tentative(s)</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Client</th>
                    <th>Erreur</th>
                    <th>Tentatives</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e) => (
                    <tr key={e.id}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4,
                          background: e.type === 'sms' ? 'rgba(139,92,246,0.1)' : 'rgba(59,130,246,0.1)',
                          color: e.type === 'sms' ? '#8b5cf6' : '#3b82f6',
                        }}>
                          {e.type}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{e.client_name || '–'}</td>
                      <td style={{ fontSize: 11, color: '#ef4444', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.last_error}
                      </td>
                      <td style={{ fontSize: 12, textAlign: 'center' }}>{e.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ---- Liens externes ---- */}
      <div className="card" style={{ marginTop: 20, padding: '20px 24px' }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16, color: 'var(--text-secondary)' }}>
          Accès services externes
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href="https://app.brevo.com" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'rgba(var(--overlay), 0.03)', border: '1px solid rgba(var(--overlay), 0.06)', textDecoration: 'none', color: 'var(--text)', fontSize: 13, fontWeight: 500, transition: 'background 0.2s' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
            <span style={{ flex: 1 }}>Brevo — Meylan</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Email + SMS</span>
          </a>
          <a href="https://app.brevo.com" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'rgba(var(--overlay), 0.03)', border: '1px solid rgba(var(--overlay), 0.06)', textDecoration: 'none', color: 'var(--text)', fontSize: 13, fontWeight: 500, transition: 'background 0.2s' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
            <span style={{ flex: 1 }}>Brevo — Grenoble</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Email + SMS</span>
          </a>
          <a href="https://railway.com/project/ae37a882-edb0-44f4-917c-ef185f77c394" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'rgba(var(--overlay), 0.03)', border: '1px solid rgba(var(--overlay), 0.06)', textDecoration: 'none', color: 'var(--text)', fontSize: 13, fontWeight: 500, transition: 'background 0.2s' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
            <span style={{ flex: 1 }}>Railway — Backend</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Serveur + BDD</span>
          </a>
        </div>
      </div>
    </>
  );
}

function KpiCard({ label, value, color, sub }) {
  return (
    <div style={{
      padding: '16px 20px', borderRadius: 10,
      background: 'rgba(var(--overlay), 0.03)',
      border: '1px solid rgba(var(--overlay), 0.06)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)', color }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function MiniStat({ label, value, alert }) {
  return (
    <div style={{
      padding: '12px 16px', borderRadius: 8,
      background: alert ? 'rgba(239,68,68,0.06)' : 'rgba(var(--overlay), 0.02)',
      border: `1px solid ${alert ? 'rgba(239,68,68,0.2)' : 'rgba(var(--overlay), 0.04)'}`,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', color: alert ? '#ef4444' : 'var(--text)' }}>{value}</div>
    </div>
  );
}

function DeliveryRateStat({ rate }) {
  let color = 'var(--text-muted)';
  let bg = 'rgba(var(--overlay), 0.02)';
  let border = 'rgba(var(--overlay), 0.04)';
  if (rate !== null && rate !== undefined) {
    if (rate >= 95) {
      color = '#22c55e';
      bg = 'rgba(34,197,94,0.06)';
      border = 'rgba(34,197,94,0.2)';
    } else if (rate >= 90) {
      color = '#f59e0b';
      bg = 'rgba(245,158,11,0.06)';
      border = 'rgba(245,158,11,0.2)';
    } else {
      color = '#ef4444';
      bg = 'rgba(239,68,68,0.06)';
      border = 'rgba(239,68,68,0.2)';
    }
  }
  return (
    <div style={{ padding: '12px 16px', borderRadius: 8, background: bg, border: `1px solid ${border}` }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 }}>Taux livraison</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', color }}>
        {rate !== null && rate !== undefined ? `${rate}%` : '–'}
      </div>
    </div>
  );
}
