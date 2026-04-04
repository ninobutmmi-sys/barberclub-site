import { useState } from 'react';
import { getCampaignROI } from '../api';
import { useCampaigns } from '../hooks/useApi';
import useMobile from '../hooks/useMobile';
import { formatPrice } from '../utils/format';

export default function Campaigns({ embedded } = {}) {
  const isMobile = useMobile();
  const { data: campaigns = [], isLoading: loading, error } = useCampaigns();
  const [selectedROI, setSelectedROI] = useState(null);

  async function viewROI(campaign) {
    try {
      const roi = await getCampaignROI(campaign.id);
      setSelectedROI({ ...campaign, ...roi });
    } catch (err) { alert(err.message); }
  }

  return (
    <>
      {error && (
        <div role="alert" style={{ background: '#1c1917', border: '1px solid #dc2626', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fca5a5' }}>
          <span>{error.message}</span>
        </div>
      )}
      {!embedded && (
        <div className="page-header">
          <div>
            <h2 className="page-title">Campagnes</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Suivi ROI des campagnes SMS & Email
            </p>
          </div>
        </div>
      )}

      <div className="page-body">
        {/* Stats Overview */}
        {campaigns.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            <StatCard
              label="Total campagnes"
              value={campaigns.length}
            />
            <StatCard
              label="Coût total SMS/Email"
              value={formatPrice(campaigns.reduce((s, c) => s + (c.cost_cents || 0), 0))}
            />
            <StatCard
              label="Clics totaux"
              value={campaigns.reduce((s, c) => s + (c.clicks || 0), 0)}
            />
            <StatCard
              label="RDV générés"
              value={campaigns.reduce((s, c) => s + (c.bookings_generated || 0), 0)}
            />
          </div>
        )}

        {loading ? (
          <div className="empty-state">Chargement...</div>
        ) : campaigns.length === 0 ? (
          <div className="empty-state" style={{ padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Aucune campagne</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Les campagnes sont créées automatiquement quand vous envoyez des SMS ou emails depuis les onglets SMS et Mailing.
            </div>
          </div>
        ) : (
          isMobile ? (
            <div className="mob-card-list">
              {campaigns.map((c) => {
                const roi = c.cost_cents > 0 ? Math.round(((c.revenue_generated - c.cost_cents) / c.cost_cents) * 100) : 0;
                return (
                  <div key={c.id} className="mob-card-item" onClick={() => viewROI(c)}>
                    <div className="mob-card-left">
                      <div className="mob-card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {c.name}
                        <span style={{
                          padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                          background: c.type === 'sms' ? 'rgba(59,130,246,0.12)' : 'rgba(168,85,247,0.12)',
                          color: c.type === 'sms' ? '#3b82f6' : '#a855f7',
                        }}>{c.type}</span>
                      </div>
                      <div className="mob-card-sub">{c.recipients_count} dest. · {c.bookings_generated} RDV · {c.clicks} clics</div>
                    </div>
                    <div className="mob-card-right">
                      <div className="mob-card-value">{formatPrice(c.revenue_generated)}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: roi > 0 ? '#22c55e' : roi < 0 ? '#ef4444' : 'var(--text-secondary)' }}>
                        {roi > 0 ? '+' : ''}{roi}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Campagne</th>
                    <th>Type</th>
                    <th>Date d'envoi</th>
                    <th>Destinataires</th>
                    <th>Coût</th>
                    <th>Clics</th>
                    <th>RDV générés</th>
                    <th>CA généré</th>
                    <th>ROI</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const roi = c.cost_cents > 0
                      ? Math.round(((c.revenue_generated - c.cost_cents) / c.cost_cents) * 100)
                      : 0;
                    return (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>
                          {c.name}
                          {c.message_preview && (
                            <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.message_preview}
                            </div>
                          )}
                        </td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                            background: c.type === 'sms' ? 'rgba(59,130,246,0.12)' : 'rgba(168,85,247,0.12)',
                            color: c.type === 'sms' ? '#3b82f6' : '#a855f7',
                          }}>
                            {c.type}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {new Date(c.sent_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                        <td style={{ fontWeight: 600 }}>{c.recipients_count}</td>
                        <td style={{ fontSize: 12 }}>{formatPrice(c.cost_cents)}</td>
                        <td style={{ fontWeight: 600 }}>{c.clicks}</td>
                        <td style={{ fontWeight: 600 }}>{c.bookings_generated}</td>
                        <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>
                          {formatPrice(c.revenue_generated)}
                        </td>
                        <td>
                          <span style={{
                            fontWeight: 700, fontSize: 13,
                            color: roi > 0 ? '#22c55e' : roi < 0 ? '#ef4444' : 'var(--text-secondary)',
                          }}>
                            {roi > 0 ? '+' : ''}{roi}%
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => viewROI(c)}>
                            Détails
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* ROI Detail Modal */}
      {selectedROI && (
        <div className="modal-backdrop" onClick={() => setSelectedROI(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 className="modal-title">ROI — {selectedROI.name}</h3>
              <button className="btn-ghost" onClick={() => setSelectedROI(null)}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <ROICard label="Coût campagne" value={formatPrice(selectedROI.cost_cents)} />
                <ROICard label="Clics" value={selectedROI.clicks} />
                <ROICard label="RDV générés" value={selectedROI.bookings_count || selectedROI.bookings_generated} />
                <ROICard label="CA généré" value={formatPrice(selectedROI.revenue_cents || selectedROI.revenue_generated)} color="#22c55e" />
              </div>

              {/* ROI Visual */}
              <div style={{
                padding: 20, textAlign: 'center', borderRadius: 12,
                background: 'rgba(var(--overlay),0.02)', border: '1px solid rgba(var(--overlay),0.06)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', fontWeight: 600 }}>Retour sur investissement</div>
                <div style={{
                  fontSize: 42, fontWeight: 800, fontFamily: 'var(--font-display)',
                  color: (selectedROI.roi_percent || 0) > 0 ? '#22c55e' : (selectedROI.roi_percent || 0) < 0 ? '#ef4444' : 'var(--text-secondary)',
                }}>
                  {(selectedROI.roi_percent || 0) > 0 ? '+' : ''}{selectedROI.roi_percent || 0}%
                </div>
              </div>

              {selectedROI.message_preview && (
                <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(var(--overlay),0.02)', borderRadius: 8, border: '1px solid rgba(var(--overlay),0.04)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>Message envoyé</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selectedROI.message_preview}</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedROI(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{
      flex: '1 1 180px', padding: '16px 20px', borderRadius: 10,
      background: 'rgba(var(--overlay),0.03)', border: '1px solid rgba(var(--overlay),0.06)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{value}</div>
    </div>
  );
}

function ROICard({ label, value, color }) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 8,
      background: 'rgba(var(--overlay),0.02)', border: '1px solid rgba(var(--overlay),0.06)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)', color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}
