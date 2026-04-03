import { useState, useEffect, useMemo } from 'react';
import { format, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import useMobile from '../hooks/useMobile';
import * as api from '../api';

// ============================================
// Medals & Colors
// ============================================
const MEDALS = ['🥇', '🥈', '🥉'];
const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];
const RANK_BG = ['rgba(255,215,0,0.08)', 'rgba(192,192,192,0.06)', 'rgba(205,127,50,0.05)'];
const BAR_GRADIENTS = [
  'linear-gradient(90deg, #FFD700, #FFA500)',
  'linear-gradient(90deg, #C0C0C0, #A0A0A0)',
  'linear-gradient(90deg, #CD7F32, #A0652F)',
  'linear-gradient(90deg, rgba(var(--overlay),0.2), rgba(var(--overlay),0.1))',
];

// ============================================
// Trophy Card
// ============================================
function TrophyCard({ title, icon, description, ranking, isMobile }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 16, overflow: 'hidden', position: 'relative',
    }}>
      {/* Gold accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 24, right: 24, height: 2,
        background: 'linear-gradient(90deg, transparent, #FFD70080, transparent)',
      }} />

      {/* Header */}
      <div style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.01em' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{description}</div>
        </div>
      </div>

      {/* Ranking */}
      <div style={{ padding: '0 20px 20px' }}>
        {(!ranking || ranking.length === 0) ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            Pas encore de données ce mois
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ranking.map((entry, i) => (
              <div key={entry.barber_id || i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 10,
                background: i < 3 ? RANK_BG[i] : 'rgba(var(--overlay), 0.02)',
                border: i === 0 ? '1px solid rgba(255,215,0,0.15)' : '1px solid transparent',
                transition: 'transform 0.15s',
              }}>
                {/* Medal or rank number */}
                <div style={{
                  width: 28, textAlign: 'center', flexShrink: 0,
                  fontSize: i < 3 ? 18 : 13,
                  fontWeight: 800,
                  color: i < 3 ? RANK_COLORS[i] : 'var(--text-muted)',
                  fontFamily: i >= 3 ? 'var(--font-display)' : undefined,
                }}>
                  {i < 3 ? MEDALS[i] : `${i + 1}`}
                </div>

                {/* Name */}
                <div style={{
                  width: isMobile ? 60 : 80, flexShrink: 0,
                  fontSize: 13, fontWeight: i === 0 ? 800 : 600,
                  color: i === 0 ? 'var(--text)' : 'var(--text-secondary)',
                }}>
                  {entry.barber_name}
                </div>

                {/* Progress bar */}
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(var(--overlay), 0.04)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4,
                    width: `${entry.percentage || 0}%`,
                    background: i < 4 ? BAR_GRADIENTS[i] : BAR_GRADIENTS[3],
                    transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                  }} />
                </div>

                {/* Metric value (not CA, just count or %) */}
                {entry.display_value != null && (
                  <div style={{
                    fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
                    flexShrink: 0, minWidth: 30, textAlign: 'right',
                  }}>
                    {entry.display_value}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Zero No-Show Trophy (special display)
// ============================================
function ZeroNoShowCard({ winners, isMobile }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 16, overflow: 'hidden', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 24, right: 24, height: 2,
        background: 'linear-gradient(90deg, transparent, #22c55e80, transparent)',
      }} />

      <div style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>
          ✅
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Zéro faux plan</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Tous les clients sont venus</div>
        </div>
      </div>

      <div style={{ padding: '0 20px 20px' }}>
        {(!winners || winners.length === 0) ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            Aucun barber à zéro faux plan ce mois
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {winners.map((w) => (
              <div key={w.barber_id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 16px', borderRadius: 10,
                background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.15)',
              }}>
                <span style={{ fontSize: 16 }}>🏆</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>{w.barber_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{w.completed_count} RDV honorés</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Challenge Card
// ============================================
function ChallengeCard({ challenge, onDelete, isMobile }) {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (challenge.metric_type !== 'custom') {
      api.getChallengeProgress(challenge.id)
        .then(setProgress)
        .catch(() => {});
    }
  }, [challenge]);

  const barbers = progress?.progress || progress?.barbers || [];

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 16, overflow: 'hidden', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 24, right: 24, height: 2,
        background: 'linear-gradient(90deg, transparent, #3b82f680, transparent)',
      }} />

      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{challenge.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Objectif : {challenge.target_value} · Jusqu'au {format(new Date(challenge.end_date + 'T00:00:00'), 'd MMM', { locale: fr })}
          </div>
        </div>
        {onDelete && (
          <button
            onClick={() => { if (confirm('Supprimer ce challenge ?')) onDelete(challenge.id); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}
          >✕</button>
        )}
      </div>

      {barbers.length > 0 && (
        <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {barbers.map((b, i) => {
            const pct = Math.min(100, Math.round(((b.current_value || b.current || 0) / challenge.target_value) * 100));
            return (
              <div key={b.barber_id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 10,
                background: 'rgba(var(--overlay), 0.02)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, width: isMobile ? 60 : 80, flexShrink: 0, color: 'var(--text-secondary)' }}>
                  {b.barber_name}
                </span>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(var(--overlay), 0.04)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4, width: `${pct}%`,
                    background: pct >= 100 ? 'linear-gradient(90deg, #22c55e, #16a34a)' : 'linear-gradient(90deg, #3b82f6, #2563eb)',
                    transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                  }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: pct >= 100 ? '#22c55e' : 'var(--text-muted)', flexShrink: 0, minWidth: 50, textAlign: 'right' }}>
                  {b.current_value || b.current || 0}/{challenge.target_value}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Page
// ============================================
export default function Objectives() {
  const isMobile = useMobile();
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [data, setData] = useState(null);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const monthStr = format(selectedMonth, 'yyyy-MM');
  const monthLabel = format(selectedMonth, 'MMMM yyyy', { locale: fr });
  const isCurrentMonth = monthStr === format(new Date(), 'yyyy-MM');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getMonthlyObjectives(monthStr).catch(() => null),
      api.getChallenges().catch(() => []),
    ]).then(([obj, chal]) => {
      setData(obj);
      setChallenges(Array.isArray(chal) ? chal : chal?.challenges || []);
    }).finally(() => setLoading(false));
  }, [monthStr]);

  const handleDeleteChallenge = async (id) => {
    try {
      await api.deleteChallenge(id);
      setChallenges(prev => prev.filter(c => c.id !== id));
    } catch (e) { alert(e.message); }
  };

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Objectifs</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Trophées & challenges du mois
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style={{
              fontSize: 13, fontWeight: 700, minWidth: 140, textAlign: 'center',
              textTransform: 'capitalize', userSelect: 'none',
            }}>
              {monthLabel}
            </span>
            <button onClick={() => { if (!isCurrentMonth) setSelectedMonth(m => { const n = new Date(m); n.setMonth(n.getMonth() + 1); return n; }); }} style={{
              width: 30, height: 30, borderRadius: 7, border: 'none', background: 'transparent',
              color: 'var(--text-muted)', cursor: isCurrentMonth ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: isCurrentMonth ? 0.3 : 1,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>

        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} style={{ gap: 6 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Challenge
        </button>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="empty-state" style={{ padding: 60 }}>Chargement...</div>
        ) : (
          <>
            {/* Auto trophies */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
              gap: 16, marginBottom: 24,
            }}>
              <TrophyCard
                title="Meilleur volume"
                icon="👑"
                description="Classement par chiffre d'affaires"
                ranking={data?.trophies?.meilleur_volume?.ranking || []}
                isMobile={isMobile}
              />
              <TrophyCard
                title="Roi des ventes"
                icon="🛒"
                description="RDV avec un produit vendu"
                ranking={(data?.trophies?.roi_des_ventes?.ranking || []).map(r => ({ ...r, percentage: r.count ? Math.round((r.count / Math.max(...(data?.trophies?.roi_des_ventes?.ranking || []).map(x => x.count || 1))) * 100) : 0, display_value: r.count }))}
                isMobile={isMobile}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <ZeroNoShowCard
                winners={data?.trophies?.zero_faux_plan?.barbers || []}
                isMobile={isMobile}
              />
            </div>

            {/* Custom challenges */}
            {challenges.length > 0 && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: 'var(--text-muted)',
                  marginBottom: 12, paddingBottom: 8,
                  borderBottom: '1px solid rgba(var(--overlay), 0.06)',
                }}>
                  Challenges actifs
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {challenges.map(c => (
                    <ChallengeCard
                      key={c.id}
                      challenge={c}
                      onDelete={handleDeleteChallenge}
                      isMobile={isMobile}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Create challenge modal */}
      {showCreate && <CreateChallengeModal onClose={() => setShowCreate(false)} onCreated={(c) => { setChallenges(prev => [...prev, c]); setShowCreate(false); }} />}
    </>
  );
}

// ============================================
// Create Challenge Modal
// ============================================
function CreateChallengeModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [metric, setMetric] = useState('products_sold');
  const [endDate, setEndDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await api.createChallenge({
        title,
        target_value: parseInt(target),
        metric_type: metric,
        start_date: format(new Date(), 'yyyy-MM-dd'),
        end_date: endDate,
      });
      onCreated(result);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3 className="modal-title">Nouveau challenge</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-group">
              <label className="label">Titre du challenge</label>
              <input className="input" value={title} onChange={e => setTitle(e.target.value)} required placeholder="Ex: Vendre 20 cires" />
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Objectif (nombre)</label>
                <input className="input" type="number" min="1" value={target} onChange={e => setTarget(e.target.value)} required placeholder="15" />
              </div>
              <div className="form-group">
                <label className="label">Type</label>
                <select className="input" value={metric} onChange={e => setMetric(e.target.value)}>
                  <option value="products_sold">Produits vendus</option>
                  <option value="bookings_count">Nombre de RDV</option>
                  <option value="custom">Personnalisé</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Date de fin</label>
              <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Création...' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
