import { useState, useRef } from 'react';
import { getClients, sendSms } from '../api';
import useMobile from '../hooks/useMobile';
import { useTwilioStatus, useNotificationLogs } from '../hooks/useApi';

// ============================================
// SMS Page — Twilio integration (server-side)
// ============================================

const SMS_TEMPLATES = [
  {
    id: 'reminder',
    label: 'Rappel RDV',
    text: 'Bonjour {prenom}, rappel de votre RDV chez BarberClub le {date} a {heure}. A bientot !',
  },
  {
    id: 'promo',
    label: 'Promotion',
    text: 'BarberClub : -20% sur toutes les coupes cette semaine ! Reservez vite sur notre site. STOP au 36180',
  },
  {
    id: 'reactivation',
    label: 'Client inactif',
    text: 'Bonjour {prenom}, ca fait longtemps ! Votre barber vous attend chez BarberClub. Reservez votre creneau. STOP au 36180',
  },
  {
    id: 'custom',
    label: 'Message libre',
    text: '',
  },
];

function SmsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export default function Sms({ embedded } = {}) {
  const isMobile = useMobile();
  const [tab, setTab] = useState('send'); // 'send' | 'history' | 'settings'
  const [template, setTemplate] = useState(SMS_TEMPLATES[0]);
  const [message, setMessage] = useState(SMS_TEMPLATES[0].text);
  const [sender, setSender] = useState('BARBERCLUB');
  const [recipientMode, setRecipientMode] = useState('manual'); // 'manual' | 'clients' | 'all'
  const [manualNumbers, setManualNumbers] = useState('');
  const [selectedClients, setSelectedClients] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  // Client search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const searchTimer = useRef(null);

  // Twilio status
  const { data: twilioStatus, isLoading: loadingStatus } = useTwilioStatus({
    placeholderData: { configured: false },
  });

  // History
  const [logsPage, setLogsPage] = useState(0);
  const logsQuery = useNotificationLogs(
    { channel: 'sms', limit: 25, offset: logsPage * 25 },
    { enabled: tab === 'history' }
  );
  const logs = logsQuery.data?.notifications || [];
  const logsTotal = logsQuery.data?.total || 0;
  const logsLoading = logsQuery.isLoading;

  const isConfigured = twilioStatus?.configured && twilioStatus?.connected !== false;
  const charCount = message.length;
  const smsCount = Math.ceil(charCount / 160) || 1;

  function handleTemplateChange(id) {
    const tpl = SMS_TEMPLATES.find((t) => t.id === id) || SMS_TEMPLATES[0];
    setTemplate(tpl);
    if (tpl.id !== 'custom') setMessage(tpl.text);
  }

  function handleSearchClients(value) {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value || value.trim().length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await getClients({ search: value.trim(), limit: 10 });
        setSearchResults((data.clients || []).filter((c) => c.phone));
      } catch { setSearchResults([]); }
    }, 300);
  }

  function toggleClient(client) {
    setSelectedClients((prev) => {
      const exists = prev.find((c) => c.id === client.id);
      if (exists) return prev.filter((c) => c.id !== client.id);
      return [...prev, client];
    });
  }

  function getRecipientCount() {
    if (recipientMode === 'manual') {
      return manualNumbers.split('\n').filter((n) => n.trim()).length;
    }
    if (recipientMode === 'all') return allClients.length;
    return selectedClients.length;
  }

  async function loadAllClients() {
    setLoadingAll(true);
    try {
      let all = [];
      let offset = 0;
      const limit = 100;
      while (true) {
        const data = await getClients({ limit, offset });
        const batch = data.clients || [];
        all = all.concat(batch);
        if (batch.length < limit) break;
        offset += limit;
      }
      setAllClients(all.filter((c) => c.phone));
    } catch { setAllClients([]); }
    setLoadingAll(false);
  }

  async function handleSend() {
    if (!isConfigured) {
      setResult({ error: 'Twilio non configure. Verifiez la configuration dans l\'onglet Parametres.' });
      return;
    }

    let recipients = [];
    const cleanPhone = (p) => p.replace(/[\s.\-]/g, '');
    if (recipientMode === 'manual') {
      recipients = manualNumbers.split('\n').filter((n) => n.trim()).map((n) => ({ phone: cleanPhone(n.trim()) }));
    } else if (recipientMode === 'all') {
      recipients = allClients.map((c) => ({
        phone: cleanPhone(c.phone),
        first_name: c.first_name,
        last_name: c.last_name,
      }));
    } else {
      recipients = selectedClients.filter((c) => c.phone).map((c) => ({
        phone: cleanPhone(c.phone),
        first_name: c.first_name,
        last_name: c.last_name,
      }));
    }

    if (recipients.length === 0) {
      setResult({ error: 'Aucun destinataire selectionne.' });
      return;
    }
    if (!message.trim()) {
      setResult({ error: 'Le message est vide.' });
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const data = await sendSms({ recipients, message, sender });
      setResult({
        success: true,
        sent: data.sent,
        failed: data.failed,
      });
    } catch (err) {
      setResult({ error: err.message });
    }
    setSending(false);
  }

  function loadLogs(page) {
    setLogsPage(page);
  }

  const statusLabel = (s) => {
    if (s === 'sent') return { text: 'Envoye', color: '#22c55e' };
    if (s === 'failed') return { text: 'Echec', color: '#ef4444' };
    return { text: 'En attente', color: '#f59e0b' };
  };

  return (
    <>
      <style>{`
        @media (max-width: 1100px) {
          .sms-preview-col { display: none !important; }
          .sms-send-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 1023px) {
          .sms-send-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      {!embedded && <div className="page-header">
        <div>
          <h2 className="page-title">SMS</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Envoi de SMS via Twilio
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {loadingStatus ? (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Verification...</span>
            ) : (
              <>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: isConfigured ? '#22c55e' : '#ef4444',
                }} />
                <span style={{ fontSize: 12, color: isConfigured ? '#22c55e' : '#ef4444' }}>
                  {isConfigured ? 'Twilio connecte' : (twilioStatus?.error || 'Non configure')}
                </span>
              </>
            )}
          </div>
        </div>
      </div>}

      <div className="page-body">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid rgba(var(--overlay),0.08)' }}>
          {[
            { id: 'send', label: 'Envoyer' },
            { id: 'history', label: 'Historique' },
            { id: 'settings', label: 'Parametres' },
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

        {/* ---- SEND TAB ---- */}
        {tab === 'send' && (
          <div className="sms-send-grid" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.5fr', gap: 24, alignItems: 'start' }}>
            {/* Left: compose */}
            <div className="card">
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Composer le SMS</h3>

              <div className="form-group">
                <label className="label">Modele</label>
                <select className="input" value={template.id} onChange={(e) => handleTemplateChange(e.target.value)}>
                  {SMS_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="label">Message</label>
                <textarea
                  className="input"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  style={{ resize: 'vertical', fontFamily: 'inherit', minHeight: 100 }}
                  placeholder="Votre message SMS..."
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span>{charCount} caracteres</span>
                  <span>{smsCount} SMS / destinataire</span>
                </div>
              </div>

              <div className="form-group">
                <label className="label">Expediteur</label>
                <input className="input" value={sender} onChange={(e) => setSender(e.target.value)} maxLength={11} placeholder="BARBERCLUB" />
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Max 11 caracteres, pas de numeros</div>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, padding: '8px 10px', background: 'rgba(var(--overlay),0.02)', borderRadius: 6, border: '1px solid rgba(var(--overlay),0.06)' }}>
                Variables disponibles : <code style={{ color: '#3b82f6' }}>{'{prenom}'}</code> <code style={{ color: '#3b82f6' }}>{'{nom}'}</code>
              </div>
            </div>

            {/* Right: recipients + send */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Destinataires</h3>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  {[
                    { id: 'manual', label: 'Numeros manuels' },
                    { id: 'clients', label: 'Selectionner clients' },
                    { id: 'all', label: 'Toute la base' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      className={`btn btn-sm ${recipientMode === m.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => {
                        setRecipientMode(m.id);
                        if (m.id === 'all' && allClients.length === 0) loadAllClients();
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {recipientMode === 'manual' && (
                  <div className="form-group">
                    <label className="label">Numeros (un par ligne, format +33... ou 06...)</label>
                    <textarea
                      className="input"
                      value={manualNumbers}
                      onChange={(e) => setManualNumbers(e.target.value)}
                      rows={5}
                      style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
                      placeholder={"+33612345678\n0698765432"}
                    />
                  </div>
                )}

                {recipientMode === 'all' && (
                  <div style={{ padding: '14px 16px', background: 'rgba(var(--overlay),0.03)', borderRadius: 8, border: '1px solid rgba(var(--overlay),0.06)' }}>
                    {loadingAll ? (
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Chargement des clients...</span>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13 }}>
                          <strong>{allClients.length}</strong> client{allClients.length !== 1 ? 's' : ''} avec numero de telephone
                        </span>
                        <button className="btn btn-sm btn-secondary" onClick={loadAllClients} style={{ fontSize: 11 }}>
                          Actualiser
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {recipientMode === 'clients' && (
                  <>
                    <div className="form-group" style={{ marginBottom: 10 }}>
                      <input
                        className="input"
                        value={searchQuery}
                        onChange={(e) => handleSearchClients(e.target.value)}
                        placeholder="Rechercher un client..."
                      />
                    </div>
                    {searchResults.length > 0 && (
                      <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 10, border: '1px solid rgba(var(--overlay),0.08)', borderRadius: 6 }}>
                        {searchResults.map((c) => {
                          const selected = selectedClients.some((s) => s.id === c.id);
                          return (
                            <div
                              key={c.id}
                              onClick={() => toggleClient(c)}
                              style={{
                                padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                                background: selected ? 'rgba(59,130,246,0.1)' : 'transparent',
                                borderBottom: '1px solid rgba(var(--overlay),0.04)',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>{c.first_name} {c.last_name}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.phone || 'Pas de tel'}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {selectedClients.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        {selectedClients.map((c) => (
                          <span
                            key={c.id}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '4px 10px', background: 'rgba(59,130,246,0.12)',
                              border: '1px solid rgba(59,130,246,0.25)', borderRadius: 20,
                              fontSize: 12, fontWeight: 600,
                            }}
                          >
                            {c.first_name} {c.last_name}
                            <button
                              onClick={() => toggleClient(c)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                            >&times;</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 0' }}>
                  {getRecipientCount()} destinataire{getRecipientCount() !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Result */}
              {result && (
                <div style={{
                  padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13,
                  background: result.error ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                  border: `1px solid ${result.error ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'}`,
                  color: result.error ? '#ef4444' : '#22c55e',
                }}>
                  {result.error ? result.error : (
                    <>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>SMS envoyes !</div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {result.sent} envoye{result.sent > 1 ? 's' : ''}
                        {result.failed > 0 && ` — ${result.failed} echec(s)`}
                      </div>
                    </>
                  )}
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={handleSend}
                disabled={sending}
                style={{ width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 700 }}
              >
                <SmsIcon />
                {sending ? 'Envoi en cours...' : `Envoyer ${getRecipientCount()} SMS`}
              </button>
            </div>

            {/* iPhone Preview */}
            <div className="sms-preview-col" style={{ position: 'sticky', top: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 12, textAlign: 'center' }}>Apercu</div>
              <div style={{
                width: 260, margin: '0 auto', background: '#000', borderRadius: 36, padding: '12px 10px',
                border: '3px solid #333', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}>
                {/* Notch */}
                <div style={{ width: 100, height: 24, background: '#000', borderRadius: '0 0 12px 12px', margin: '0 auto 8px' }} />
                {/* Screen */}
                <div style={{
                  background: '#1a1a1a', borderRadius: 24, padding: '20px 14px', minHeight: 400,
                  display: 'flex', flexDirection: 'column',
                }}>
                  {/* Header */}
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#333', margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff' }}>BC</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sender || 'BARBERCLUB'}</div>
                  </div>
                  {/* Message bubble */}
                  {message.trim() && (
                    <div style={{
                      background: '#2a2a2a', borderRadius: '16px 16px 16px 4px', padding: '10px 14px',
                      fontSize: 13, lineHeight: 1.5, color: '#e0e0e0', maxWidth: '90%',
                      wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                    }}>
                      {message}
                    </div>
                  )}
                  {/* Character count */}
                  <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: 10, color: '#555', paddingTop: 16 }}>
                    {message.length} caracteres · {Math.ceil(message.length / 160) || 1} SMS
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---- HISTORY TAB ---- */}
        {tab === 'history' && (
          <div>
            {logsLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Chargement...</div>
            ) : logs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Aucun SMS dans l'historique</div>
            ) : (
              <>
                <div className="card" style={{ overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(var(--overlay),0.1)' }}>
                        <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase' }}>Date</th>
                        <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase' }}>Destinataire</th>
                        <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase' }}>Type</th>
                        <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase' }}>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => {
                        const st = statusLabel(log.status);
                        return (
                          <tr key={log.id} style={{ borderBottom: '1px solid rgba(var(--overlay),0.04)' }}>
                            <td style={{ padding: '10px 12px' }}>
                              {new Date(log.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                              {' '}
                              <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                                {new Date(log.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ fontWeight: 600 }}>{log.first_name} {log.last_name}</span>
                              <br />
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{log.phone}</span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                                fontSize: 11, fontWeight: 600,
                                background: log.type === 'review_email' ? 'rgba(251,191,36,0.1)' : log.type === 'campaign_sms' ? 'rgba(168,85,247,0.1)' : 'rgba(59,130,246,0.1)',
                                color: log.type === 'review_email' ? '#fbbf24' : log.type === 'campaign_sms' ? '#a855f7' : '#3b82f6',
                              }}>
                                {log.type === 'reminder_sms' ? 'Rappel' : log.type === 'review_email' ? 'Avis Google' : log.type === 'campaign_sms' ? 'Campagne' : log.type}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ color: st.color, fontWeight: 600, fontSize: 12 }}>{st.text}</span>
                              {log.provider_message_id && (
                                <button
                                  type="button"
                                  title="Copier l'ID provider (Twilio SID ou Brevo message ID)"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard?.writeText(log.provider_message_id);
                                  }}
                                  style={{
                                    display: 'block', marginTop: 3, padding: 0,
                                    background: 'transparent', border: 'none',
                                    color: 'var(--text-muted)', fontSize: 10,
                                    fontFamily: 'ui-monospace, monospace', cursor: 'pointer',
                                    textAlign: 'left',
                                  }}
                                >
                                  ID: {log.provider_message_id}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {logsTotal > 25 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={logsPage === 0}
                      onClick={() => loadLogs(logsPage - 1)}
                    >
                      Precedent
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 8px' }}>
                      Page {logsPage + 1} / {Math.ceil(logsTotal / 25)}
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={(logsPage + 1) * 25 >= logsTotal}
                      onClick={() => loadLogs(logsPage + 1)}
                    >
                      Suivant
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ---- SETTINGS TAB ---- */}
        {tab === 'settings' && (
          <div style={{ maxWidth: 520 }}>
            <div className="card">
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Configuration Twilio SMS</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
                Les SMS sont envoyes via Twilio (configure cote serveur).
                Les credentials sont stockes de maniere securisee dans le backend.
              </p>

              {twilioStatus && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(var(--overlay),0.03)', borderRadius: 8, border: '1px solid rgba(var(--overlay),0.06)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Statut</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: isConfigured ? '#22c55e' : '#ef4444' }}>
                      {isConfigured ? 'Connecte' : (twilioStatus.error || 'Non configure')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(var(--overlay),0.03)', borderRadius: 8, border: '1px solid rgba(var(--overlay),0.06)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Expediteur SMS</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{twilioStatus.smsSender || '—'}</span>
                  </div>
                  {twilioStatus.accountSidPreview && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(var(--overlay),0.03)', borderRadius: 8, border: '1px solid rgba(var(--overlay),0.06)' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Account SID</span>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'monospace' }}>{twilioStatus.accountSidPreview}</span>
                    </div>
                  )}
                  {twilioStatus.authDisabled && (
                    <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>
                      <span style={{ fontSize: 12, color: '#ef4444' }}>
                        Auth Twilio desactivee. Verifier credentials sur <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" style={{ color: '#ef4444', textDecoration: 'underline' }}>console.twilio.com</a>.
                      </span>
                    </div>
                  )}
                  {twilioStatus.circuitOpen && !twilioStatus.authDisabled && (
                    <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.08)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.3)' }}>
                      <span style={{ fontSize: 12, color: '#f59e0b' }}>
                        Circuit breaker ouvert ({twilioStatus.failures} erreurs recentes). Recovery automatique.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div style={{ padding: '14px 16px', background: 'rgba(var(--overlay),0.02)', border: '1px solid rgba(var(--overlay),0.06)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>Configuration</div>
                <p style={{ fontSize: 12, color: '#aaa', lineHeight: 1.8, margin: 0 }}>
                  La configuration Twilio se fait via les variables d'environnement du serveur
                  (<code style={{ color: '#3b82f6' }}>TWILIO_ACCOUNT_SID_*</code>, <code style={{ color: '#3b82f6' }}>TWILIO_AUTH_TOKEN_*</code>, <code style={{ color: '#3b82f6' }}>TWILIO_SMS_SENDER_*</code>).
                  Voir le compte sur <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>console.twilio.com</a>.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
