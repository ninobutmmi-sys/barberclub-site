import { useState, useEffect, useRef } from 'react';
import { getClients } from '../api';
import useMobile from '../hooks/useMobile';

// ============================================
// SMS Page — Octopush integration ready
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

export default function Sms() {
  const isMobile = useMobile();
  const [tab, setTab] = useState('send'); // 'send' | 'history' | 'settings'
  const [template, setTemplate] = useState(SMS_TEMPLATES[0]);
  const [message, setMessage] = useState(SMS_TEMPLATES[0].text);
  const [sender, setSender] = useState('BarberClub');
  const [recipientMode, setRecipientMode] = useState('manual'); // 'manual' | 'clients' | 'all'
  const [manualNumbers, setManualNumbers] = useState('');
  const [selectedClients, setSelectedClients] = useState([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  // Client search for recipient selection
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);

  // Settings
  const [apiKey, setApiKey] = useState(localStorage.getItem('octopush_api_key') || '');
  const [apiLogin, setApiLogin] = useState(localStorage.getItem('octopush_api_login') || '');

  const isConfigured = apiKey && apiLogin;
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
      setSearchLoading(true);
      try {
        const data = await getClients({ search: value.trim(), limit: 10 });
        setSearchResults(data.clients || []);
      } catch { setSearchResults([]); }
      setSearchLoading(false);
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
    if (recipientMode === 'clients') return selectedClients.length;
    return '?';
  }

  async function handleSend() {
    if (!isConfigured) {
      setResult({ error: 'Configurez vos identifiants Octopush dans l\'onglet Parametres.' });
      return;
    }

    let recipients = [];
    if (recipientMode === 'manual') {
      recipients = manualNumbers.split('\n').filter((n) => n.trim()).map((n) => ({ phone_number: n.trim() }));
    } else if (recipientMode === 'clients') {
      recipients = selectedClients.filter((c) => c.phone).map((c) => ({
        phone_number: c.phone.startsWith('+') ? c.phone : '+33' + c.phone.replace(/^0/, ''),
        param1: c.first_name,
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
      const res = await fetch('https://api.octopush.com/v1/public/sms-campaign/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
          'api-login': apiLogin,
          'cache-control': 'no-cache',
        },
        body: JSON.stringify({
          recipients,
          text: message,
          type: 'sms_premium',
          purpose: 'wholesale',
          sender: sender || 'BarberClub',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setResult({ error: data.message || data.error_code || `Erreur ${res.status}` });
      } else {
        setResult({
          success: true,
          ticket: data.sms_ticket,
          contacts: data.number_of_contacts,
          smsCount: data.number_of_sms_needed,
          cost: data.total_cost,
          credit: data.residual_credit,
        });
      }
    } catch (err) {
      setResult({ error: err.message });
    }
    setSending(false);
  }

  function handleSaveSettings() {
    localStorage.setItem('octopush_api_key', apiKey);
    localStorage.setItem('octopush_api_login', apiLogin);
    setResult({ success: true, message: 'Identifiants sauvegardes.' });
    setTimeout(() => setResult(null), 3000);
  }

  const formRow = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

  return (
    <>
      <style>{`
        @media (max-width: 1100px) {
          .sms-preview-col { display: none !important; }
          .sms-send-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 768px) {
          .sms-send-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div className="page-header">
        <div>
          <h2 className="page-title">SMS</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Envoi de SMS via Octopush
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isConfigured ? '#22c55e' : '#ef4444',
          }} />
          <span style={{ fontSize: 12, color: isConfigured ? '#22c55e' : '#ef4444' }}>
            {isConfigured ? 'Octopush connecte' : 'Non configure'}
          </span>
        </div>
      </div>

      <div className="page-body">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid rgba(var(--overlay),0.08)' }}>
          {[
            { id: 'send', label: 'Envoyer' },
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
                <input className="input" value={sender} onChange={(e) => setSender(e.target.value)} maxLength={11} placeholder="BarberClub" />
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Max 11 caracteres, pas de numeros</div>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, padding: '8px 10px', background: 'rgba(var(--overlay),0.02)', borderRadius: 6, border: '1px solid rgba(var(--overlay),0.06)' }}>
                Variables disponibles : <code style={{ color: '#3b82f6' }}>{'{prenom}'}</code> <code style={{ color: '#3b82f6' }}>{'{nom}'}</code> <code style={{ color: '#3b82f6' }}>{'{date}'}</code> <code style={{ color: '#3b82f6' }}>{'{heure}'}</code>
              </div>
            </div>

            {/* Right: recipients + send */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Destinataires</h3>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  {[
                    { id: 'manual', label: 'Numeros manuels' },
                    { id: 'clients', label: 'Selectionner clients' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      className={`btn btn-sm ${recipientMode === m.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setRecipientMode(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {recipientMode === 'manual' && (
                  <div className="form-group">
                    <label className="label">Numeros (un par ligne, format +33...)</label>
                    <textarea
                      className="input"
                      value={manualNumbers}
                      onChange={(e) => setManualNumbers(e.target.value)}
                      rows={5}
                      style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
                      placeholder={"+33612345678\n+33698765432"}
                    />
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
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>SMS envoye !</div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {result.contacts} contact{result.contacts > 1 ? 's' : ''} &bull; {result.smsCount} SMS &bull; Credit restant : {result.credit?.toFixed(2)}
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
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 12, textAlign: 'center' }}>Aperçu</div>
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
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sender || 'BarberClub'}</div>
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
                    {message.length} caractères · {Math.ceil(message.length / 160) || 1} SMS
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---- SETTINGS TAB ---- */}
        {tab === 'settings' && (
          <div style={{ maxWidth: 520 }}>
            <div className="card">
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Configuration Octopush</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
                Connectez votre compte Octopush pour envoyer des SMS. Creez un compte sur{' '}
                <a href="https://www.octopush.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>octopush.com</a>
                {' '}puis recuperez vos identifiants API.
              </p>

              <div className="form-group">
                <label className="label">Email du compte (api-login)</label>
                <input
                  className="input"
                  type="email"
                  value={apiLogin}
                  onChange={(e) => setApiLogin(e.target.value)}
                  placeholder="votre@email.com"
                />
              </div>

              <div className="form-group">
                <label className="label">Cle API (api-key)</label>
                <input
                  className="input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Votre cle API Octopush"
                />
              </div>

              {result?.message && (
                <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 6, color: '#22c55e', fontSize: 13, marginBottom: 12 }}>
                  {result.message}
                </div>
              )}

              <button className="btn btn-primary btn-sm" onClick={handleSaveSettings}>
                Sauvegarder
              </button>

              <div style={{ marginTop: 24, padding: '14px 16px', background: 'rgba(var(--overlay),0.02)', border: '1px solid rgba(var(--overlay),0.06)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>Comment ca marche</div>
                <ol style={{ fontSize: 12, color: '#aaa', lineHeight: 1.8, paddingLeft: 16, margin: 0 }}>
                  <li>Creez un compte sur <strong>octopush.com</strong></li>
                  <li>Allez dans Parametres &gt; API et copiez votre cle</li>
                  <li>Collez votre email et cle API ci-dessus</li>
                  <li>Rechargez votre credit SMS sur Octopush</li>
                  <li>Envoyez des SMS directement depuis ce dashboard</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
