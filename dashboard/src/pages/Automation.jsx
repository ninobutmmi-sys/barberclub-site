import { useState, useEffect } from 'react';
import {
  getAutomationTriggers, updateAutomationTrigger,
  getWaitlist, addToWaitlist, updateWaitlistEntry, deleteWaitlistEntry, getWaitlistCount,
  getBarbers, getServices,
  getNotificationStats, getNotificationLogs,
} from '../api';
import useMobile from '../hooks/useMobile';

const TRIGGER_LABELS = {
  review_sms: {
    title: 'Avis Google automatique',
    desc: 'SMS envoyé 1h après un RDV terminé pour demander un avis Google.',
    icon: '⭐',
  },
  reactivation_sms: {
    title: 'Réactivation client inactif',
    desc: 'SMS automatique envoyé après 45 jours sans RDV.',
    icon: '🔄',
  },
  waitlist_notify: {
    title: 'Notification liste d\'attente',
    desc: 'SMS automatique quand une place se libère pour un client en attente.',
    icon: '📋',
  },
};

export default function Automation() {
  const isMobile = useMobile();
  const [tab, setTab] = useState('monitoring'); // monitoring | triggers | waitlist
  const [triggers, setTriggers] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editTrigger, setEditTrigger] = useState(null);
  const [addWlModal, setAddWlModal] = useState(false);

  // Monitoring
  const [stats, setStats] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (tab === 'monitoring') loadMonitoring();
  }, [tab]);

  async function loadMonitoring() {
    setStatsLoading(true);
    try {
      const [s, l] = await Promise.all([
        getNotificationStats(),
        getNotificationLogs({ limit: 15, offset: 0 }),
      ]);
      setStats(s);
      setRecentLogs(l.notifications || []);
    } catch (err) { /* silently handled */ }
    setStatsLoading(false);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [t, wl, wlc, b, s] = await Promise.all([
        getAutomationTriggers(),
        getWaitlist({ status: 'waiting' }),
        getWaitlistCount(),
        getBarbers(),
        getServices(),
      ]);
      setTriggers(t);
      setWaitlist(wl);
      setWaitlistCount(wlc.count ?? 0);
      setBarbers(b);
      setServices(s);
    } catch (err) { /* silently handled */ }
    setLoading(false);
  }

  async function handleToggleTrigger(trigger) {
    try {
      await updateAutomationTrigger(trigger.type, { is_active: !trigger.is_active });
      loadData();
    } catch (err) { alert(err.message); }
  }

  async function handleDeleteWaitlist(id) {
    if (!confirm('Retirer de la liste d\'attente ?')) return;
    try {
      await deleteWaitlistEntry(id);
      loadData();
    } catch (err) { alert(err.message); }
  }

  async function handleMarkNotified(entry) {
    try {
      await updateWaitlistEntry(entry.id, { status: 'notified' });
      loadData();
    } catch (err) { alert(err.message); }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Automatisation</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Triggers SMS automatiques & liste d'attente
          </p>
        </div>
      </div>

      <div className="page-body">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid rgba(var(--overlay),0.08)' }}>
          {[
            { id: 'monitoring', label: 'Monitoring' },
            { id: 'triggers', label: 'Triggers' },
            { id: 'waitlist', label: 'Liste d\'attente' },
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
              {t.id === 'waitlist' && waitlistCount > 0 && (
                <span style={{ marginLeft: 6, background: '#3b82f6', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
                  {waitlistCount}
                </span>
              )}
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

            {/* ====== WAITLIST TAB ====== */}
            {tab === 'waitlist' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setAddWlModal(true)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Ajouter en attente
                  </button>
                </div>

                {isMobile ? (
                  <div className="mob-card-list">
                    {waitlist.map((w) => (
                      <div key={w.id} className="mob-card-item" style={{ flexWrap: 'wrap' }}>
                        <div className="mob-card-left">
                          <div className="mob-card-title">{w.client_name}</div>
                          <div className="mob-card-sub">
                            {new Date(w.preferred_date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                            {w.preferred_time_start ? ` · ${w.preferred_time_start.slice(0, 5)}` : ''} — {w.service_name || '–'}
                          </div>
                        </div>
                        <div className="mob-card-right" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className={`badge badge-${w.status === 'waiting' ? 'active' : 'inactive'}`} style={{ fontSize: 9 }}>
                            {w.status === 'waiting' ? 'En attente' : w.status === 'notified' ? 'Notifié' : w.status === 'booked' ? 'Réservé' : 'Expiré'}
                          </span>
                          {w.status === 'waiting' && (
                            <button className="btn btn-primary btn-sm" style={{ fontSize: 10, padding: '3px 8px' }} onClick={(e) => { e.stopPropagation(); handleMarkNotified(w); }}>Notifier</button>
                          )}
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', padding: 4 }} onClick={(e) => { e.stopPropagation(); handleDeleteWaitlist(w.id); }}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                    {waitlist.length === 0 && <div className="empty-state">Aucun client en liste d'attente</div>}
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>Téléphone</th>
                          <th>Barber souhaité</th>
                          <th>Prestation</th>
                          <th>Date souhaitée</th>
                          <th>Créneau</th>
                          <th>Statut</th>
                          <th style={{ width: 120 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {waitlist.map((w) => (
                          <tr key={w.id}>
                            <td style={{ fontWeight: 600 }}>{w.client_name}</td>
                            <td style={{ fontSize: 12 }}>{w.client_phone}</td>
                            <td style={{ fontSize: 12 }}>{w.barber_name || '–'}</td>
                            <td style={{ fontSize: 12 }}>{w.service_name || '–'}</td>
                            <td style={{ fontSize: 12 }}>
                              {new Date(w.preferred_date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </td>
                            <td style={{ fontSize: 12 }}>
                              {w.preferred_time_start ? `${w.preferred_time_start.slice(0, 5)} – ${w.preferred_time_end?.slice(0, 5) || '?'}` : 'Toute la journée'}
                            </td>
                            <td>
                              <span className={`badge badge-${w.status === 'waiting' ? 'active' : w.status === 'notified' ? 'inactive' : 'inactive'}`}>
                                {w.status === 'waiting' ? 'En attente' : w.status === 'notified' ? 'Notifié' : w.status === 'booked' ? 'Réservé' : 'Expiré'}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                {w.status === 'waiting' && (
                                  <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleMarkNotified(w)}>
                                    Notifier
                                  </button>
                                )}
                                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteWaitlist(w.id)}>
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {waitlist.length === 0 && (
                          <tr><td colSpan="8" style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Aucun client en liste d'attente</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Trigger Config Modal */}
      {editTrigger && (
        <TriggerConfigModal
          trigger={editTrigger}
          onClose={() => setEditTrigger(null)}
          onSaved={() => { setEditTrigger(null); loadData(); }}
        />
      )}

      {/* Add to Waitlist Modal */}
      {addWlModal && (
        <AddWaitlistModal
          barbers={barbers}
          services={services}
          onClose={() => setAddWlModal(false)}
          onSaved={() => { setAddWlModal(false); loadData(); }}
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

function TriggerConfigModal({ trigger, onClose, onSaved }) {
  const [message, setMessage] = useState(trigger.config?.message || '');
  const [delayMinutes, setDelayMinutes] = useState(trigger.config?.delay_minutes || 60);
  const [inactiveDays, setInactiveDays] = useState(trigger.config?.inactive_days || 45);
  const [googleReviewUrl, setGoogleReviewUrl] = useState(trigger.config?.google_review_url || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const config = { ...trigger.config, message };
    if (trigger.type === 'review_sms') {
      config.delay_minutes = parseInt(delayMinutes);
      config.google_review_url = googleReviewUrl;
    }
    if (trigger.type === 'reactivation_sms') {
      config.inactive_days = parseInt(inactiveDays);
    }
    try {
      await updateAutomationTrigger(trigger.type, { config });
      onSaved();
    } catch (err) { setError(err.message); }
    setSaving(false);
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
            {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}

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
                {trigger.type === 'review_sms' && <> <code style={{ color: '#3b82f6' }}>{'{lien_avis}'}</code></>}
                {trigger.type === 'reactivation_sms' && <> <code style={{ color: '#3b82f6' }}>{'{lien_reservation}'}</code></>}
                {trigger.type === 'waitlist_notify' && <> <code style={{ color: '#3b82f6' }}>{'{date}'}</code> <code style={{ color: '#3b82f6' }}>{'{heure}'}</code> <code style={{ color: '#3b82f6' }}>{'{lien_reservation}'}</code></>}
              </div>
            </div>

            {trigger.type === 'review_sms' && (
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

            {trigger.type === 'reactivation_sms' && (
              <div className="form-group">
                <label className="label">Jours d'inactivité avant envoi</label>
                <input className="input" type="number" min="7" max="365" value={inactiveDays} onChange={(e) => setInactiveDays(e.target.value)} />
              </div>
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

function AddWaitlistModal({ barbers, services, onClose, onSaved }) {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [barberId, setBarberId] = useState(barbers[0]?.id || '');
  const [serviceId, setServiceId] = useState(services[0]?.id || '');
  const [date, setDate] = useState('');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await addToWaitlist({
        client_name: clientName,
        client_phone: clientPhone,
        barber_id: barberId,
        service_id: serviceId,
        preferred_date: date,
        preferred_time_start: timeStart || undefined,
        preferred_time_end: timeEnd || undefined,
      });
      onSaved();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3 className="modal-title">Ajouter en liste d'attente</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="input-row">
              <div className="form-group">
                <label className="label">Nom du client</label>
                <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Téléphone</label>
                <input className="input" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} required placeholder="06..." />
              </div>
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Barber souhaité</label>
                <select className="input" value={barberId} onChange={(e) => setBarberId(e.target.value)} required>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Prestation</label>
                <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Date souhaitée</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Créneau début (optionnel)</label>
                <input className="input" type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} min="09:00" max="19:00" />
              </div>
              <div className="form-group">
                <label className="label">Créneau fin (optionnel)</label>
                <input className="input" type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} min="09:00" max="19:00" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Ajout...' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
