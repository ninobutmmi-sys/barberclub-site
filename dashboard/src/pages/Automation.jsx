import { useState } from 'react';
import {
  useAutomationTriggers, useUpdateAutomationTrigger,
  useNotificationStats, useNotificationLogs,
} from '../hooks/useApi';

const TRIGGER_LABELS = {
  review_email: {
    title: 'Avis Google automatique',
    desc: 'Email envoyé 1h après un RDV terminé pour demander un avis Google.',
    icon: '⭐',
  },
  waitlist_notify: {
    title: 'Notification liste d\'attente',
    desc: 'SMS automatique quand une place se libère pour un client en attente.',
    icon: '📋',
  },
};

export default function Automation({ embedded } = {}) {
  const [tab, setTab] = useState('monitoring'); // monitoring | triggers
  const [editTrigger, setEditTrigger] = useState(null);

  // React Query hooks
  const triggersQuery = useAutomationTriggers();
  const statsQuery = useNotificationStats({ enabled: tab === 'monitoring' });
  const logsQuery = useNotificationLogs({ limit: 15, offset: 0 }, { enabled: tab === 'monitoring' });

  const triggers = triggersQuery.data || [];
  const stats = statsQuery.data || null;
  const recentLogs = logsQuery.data?.notifications || [];

  const loading = triggersQuery.isLoading;
  const error = triggersQuery.error?.message || null;
  const statsLoading = statsQuery.isLoading;

  const toggleMutation = useUpdateAutomationTrigger();

  async function handleToggleTrigger(trigger) {
    try {
      await toggleMutation.mutateAsync({ type: trigger.type, data: { is_active: !trigger.is_active } });
    } catch (err) { alert(err.message); }
  }

  return (
    <>
      {error && (
        <div role="alert" style={{ background: '#1c1917', border: '1px solid #dc2626', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fca5a5' }}>
          <span>{error}</span>
          <button onClick={() => triggersQuery.refetch()} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Réessayer</button>
        </div>
      )}
      {!embedded && (
        <div className="page-header">
          <div>
            <h2 className="page-title">Automatisation</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Triggers SMS automatiques & liste d'attente
            </p>
          </div>
        </div>
      )}

      <div className="page-body">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid rgba(var(--overlay),0.08)' }}>
          {[
            { id: 'monitoring', label: 'Monitoring' },
            { id: 'triggers', label: 'Triggers' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: 'none', borderBottom: tab === t.id ? '2px solid var(--text)' : '2px solid transparent',
                background: 'transparent', color: tab === t.id ? 'var(--text)' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty-state">Chargement...</div>
        ) : (
          <>
            {/* ====== MONITORING TAB ====== */}
            {tab === 'monitoring' && (
              <div>
                {statsLoading ? (
                  <div className="empty-state">Chargement...</div>
                ) : stats ? (
                  <>
                    {/* Stats cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
                      <StatCard label="SMS envoyes" value={stats.sms_sent} icon="💬" color="#22c55e" />
                      <StatCard label="Emails envoyes" value={stats.emails_sent} icon="📧" color="#3b82f6" />
                      <StatCard label="En attente" value={stats.pending} icon="⏳" color="#f59e0b" />
                      <StatCard label="Echecs" value={stats.sms_failed + stats.emails_failed} icon="⚠" color="#ef4444" />
                      <StatCard label="Cout SMS estime" value={`${stats.estimated_cost} €`} icon="💰" color="#a855f7" />
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.06em' }}>
                      Activite recente
                    </div>

                    {recentLogs.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)', fontSize: 13 }}>
                        Aucune notification envoyee pour le moment
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {recentLogs.map((log) => {
                          const typeMap = {
                            reminder_sms: { label: 'Rappel SMS', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
                            confirmation_email: { label: 'Confirmation', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
                            review_email: { label: 'Avis', color: '#a855f7', bg: 'rgba(168,85,247,0.1)' },
                          };
                          const t = typeMap[log.type] || { label: log.type, color: '#888', bg: 'rgba(136,136,136,0.1)' };
                          const statusColor = log.status === 'sent' ? '#22c55e' : log.status === 'failed' ? '#ef4444' : '#f59e0b';

                          return (
                            <div key={log.id} style={{
                              display: 'flex', alignItems: 'center', gap: 12,
                              padding: '10px 14px', borderRadius: 8,
                              background: 'rgba(var(--overlay),0.02)',
                              border: '1px solid rgba(var(--overlay),0.04)',
                            }}>
                              <div style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: statusColor, flexShrink: 0,
                              }} />
                              <span style={{
                                display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                                fontSize: 10, fontWeight: 700, background: t.bg, color: t.color,
                                flexShrink: 0,
                              }}>
                                {t.label}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {log.first_name} {log.last_name}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
                                {log.phone || log.email}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, minWidth: 90, textAlign: 'right' }}>
                                {new Date(log.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                                {' '}
                                {new Date(log.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )}

            {/* ====== TRIGGERS TAB ====== */}
            {tab === 'triggers' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {triggers.map((trigger) => {
                  const meta = TRIGGER_LABELS[trigger.type] || { title: trigger.type, desc: '', icon: '⚡' };
                  return (
                    <div key={trigger.id} style={{
                      padding: '20px 24px', borderRadius: 12,
                      background: 'rgba(var(--overlay),0.02)', border: '1px solid rgba(var(--overlay),0.06)',
                      display: 'flex', alignItems: 'flex-start', gap: 16,
                    }}>
                      <div style={{ fontSize: 28, lineHeight: 1, marginTop: 2 }}>{meta.icon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 15 }}>{meta.title}</span>
                          <span className={`badge badge-${trigger.is_active ? 'active' : 'inactive'}`}>
                            {trigger.is_active ? 'Actif' : 'Inactif'}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
                          {meta.desc}
                        </div>
                        {trigger.config && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'rgba(var(--overlay),0.02)', borderRadius: 6, border: '1px solid rgba(var(--overlay),0.04)', marginBottom: 12 }}>
                            <strong>Message :</strong> {trigger.config.message}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className={`btn btn-sm ${trigger.is_active ? 'btn-secondary' : 'btn-primary'}`}
                            onClick={() => handleToggleTrigger(trigger)}
                          >
                            {trigger.is_active ? 'Désactiver' : 'Activer'}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditTrigger(trigger)}>
                            Configurer
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </>
        )}
      </div>

      {/* Trigger Config Modal */}
      {editTrigger && (
        <TriggerConfigModal
          trigger={editTrigger}
          onClose={() => setEditTrigger(null)}
        />
      )}

    </>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div style={{
      padding: '16px 18px', borderRadius: 12,
      background: 'rgba(var(--overlay),0.02)', border: '1px solid rgba(var(--overlay),0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  );
}

function TriggerConfigModal({ trigger, onClose }) {
  const [message, setMessage] = useState(trigger.config?.message || '');
  const [delayMinutes, setDelayMinutes] = useState(trigger.config?.delay_minutes || 60);
  const [googleReviewUrl, setGoogleReviewUrl] = useState(trigger.config?.google_review_url || '');
  const [error, setError] = useState('');
  const mutation = useUpdateAutomationTrigger();
  const saving = mutation.isPending;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const config = { ...trigger.config, message };
    if (trigger.type === 'review_email') {
      config.delay_minutes = parseInt(delayMinutes);
      config.google_review_url = googleReviewUrl;
    }
    try {
      await mutation.mutateAsync({ type: trigger.type, data: { config } });
      onClose();
    } catch (err) { setError(err.message); }
  };

  const meta = TRIGGER_LABELS[trigger.type] || {};

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3 className="modal-title">Configurer : {meta.title}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="form-group">
              <label className="label">Message SMS</label>
              <textarea
                className="input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                style={{ resize: 'vertical', fontFamily: 'inherit', minHeight: 80 }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                Variables : <code style={{ color: '#3b82f6' }}>{'{prenom}'}</code> <code style={{ color: '#3b82f6' }}>{'{nom}'}</code>
                {trigger.type === 'review_email' && <> <code style={{ color: '#3b82f6' }}>{'{lien_avis}'}</code></>}
                {trigger.type === 'waitlist_notify' && <> <code style={{ color: '#3b82f6' }}>{'{date}'}</code> <code style={{ color: '#3b82f6' }}>{'{heure}'}</code> <code style={{ color: '#3b82f6' }}>{'{lien_reservation}'}</code></>}
              </div>
            </div>

            {trigger.type === 'review_email' && (
              <>
                <div className="form-group">
                  <label className="label">Délai après RDV terminé (minutes)</label>
                  <input className="input" type="number" min="15" max="1440" value={delayMinutes} onChange={(e) => setDelayMinutes(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="label">Lien avis Google</label>
                  <input className="input" value={googleReviewUrl} onChange={(e) => setGoogleReviewUrl(e.target.value)} placeholder="https://g.page/r/..." />
                </div>
              </>
            )}

          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

