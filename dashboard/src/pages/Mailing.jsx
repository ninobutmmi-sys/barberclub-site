import { useState, useEffect } from 'react';
import { getClients } from '../api';

// ============================================
// Mailing Page — Email campaigns
// ============================================

const EMAIL_TEMPLATES = [
  {
    id: 'promo',
    label: 'Promotion',
    subject: 'Offre speciale BarberClub !',
    body: `Bonjour {prenom},

Profitez de notre offre speciale cette semaine chez BarberClub !

-20% sur toutes les coupes du lundi au mercredi.

Reservez votre creneau des maintenant sur notre site.

A tres bientot,
L'equipe BarberClub`,
  },
  {
    id: 'reactivation',
    label: 'Relance client inactif',
    subject: 'Vous nous manquez chez BarberClub !',
    body: `Bonjour {prenom},

Ca fait un moment qu'on ne vous a pas vu chez BarberClub !

Votre barber vous attend. Reservez votre prochain creneau et retrouvez un style impeccable.

A bientot,
L'equipe BarberClub`,
  },
  {
    id: 'info',
    label: 'Information',
    subject: 'Information importante — BarberClub',
    body: `Bonjour {prenom},

Nous souhaitons vous informer que [votre message ici].

N'hesitez pas a nous contacter pour toute question.

Cordialement,
L'equipe BarberClub`,
  },
  {
    id: 'custom',
    label: 'Email libre',
    subject: '',
    body: '',
  },
];

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
  );
}

export default function Mailing() {
  const [tab, setTab] = useState('compose'); // 'compose' | 'settings'
  const [template, setTemplate] = useState(EMAIL_TEMPLATES[0]);
  const [subject, setSubject] = useState(EMAIL_TEMPLATES[0].subject);
  const [body, setBody] = useState(EMAIL_TEMPLATES[0].body);
  const [recipientMode, setRecipientMode] = useState('search'); // 'search' | 'all'
  const [selectedClients, setSelectedClients] = useState([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  // Settings — Resend (already configured in backend) or SMTP
  const [smtpHost, setSmtpHost] = useState(localStorage.getItem('mail_smtp_host') || '');
  const [smtpPort, setSmtpPort] = useState(localStorage.getItem('mail_smtp_port') || '587');
  const [smtpUser, setSmtpUser] = useState(localStorage.getItem('mail_smtp_user') || '');
  const [smtpPass, setSmtpPass] = useState(localStorage.getItem('mail_smtp_pass') || '');
  const [fromEmail, setFromEmail] = useState(localStorage.getItem('mail_from') || 'noreply@barberclub.fr');
  const [fromName, setFromName] = useState(localStorage.getItem('mail_from_name') || 'BarberClub');

  // Client search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [allClients, setAllClients] = useState([]);
  const [loadingAll, setLoadingAll] = useState(false);

  function handleTemplateChange(id) {
    const tpl = EMAIL_TEMPLATES.find((t) => t.id === id) || EMAIL_TEMPLATES[0];
    setTemplate(tpl);
    if (tpl.id !== 'custom') {
      setSubject(tpl.subject);
      setBody(tpl.body);
    }
  }

  async function handleSearch(value) {
    setSearchQuery(value);
    if (!value || value.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const data = await getClients({ search: value.trim(), limit: 10 });
      setSearchResults((data.clients || []).filter((c) => c.email));
    } catch { setSearchResults([]); }
    setSearchLoading(false);
  }

  async function loadAllClients() {
    setLoadingAll(true);
    try {
      const data = await getClients({ limit: 100 });
      const withEmail = (data.clients || []).filter((c) => c.email);
      setAllClients(withEmail);
      setSelectedClients(withEmail);
    } catch { /* silent */ }
    setLoadingAll(false);
  }

  function toggleClient(client) {
    setSelectedClients((prev) => {
      const exists = prev.find((c) => c.id === client.id);
      if (exists) return prev.filter((c) => c.id !== client.id);
      return [...prev, client];
    });
  }

  async function handleSend() {
    const recipients = selectedClients.filter((c) => c.email);

    if (recipients.length === 0) {
      setResult({ error: 'Aucun destinataire avec email.' });
      return;
    }
    if (!subject.trim() || !body.trim()) {
      setResult({ error: 'Sujet et contenu requis.' });
      return;
    }

    setSending(true);
    setResult(null);

    // For now, send via backend endpoint (uses Resend already configured)
    try {
      const res = await fetch(
        (window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://barberclub-site-production.up.railway.app') + '/api/admin/mailing/send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('bc_access_token')}`,
          },
          body: JSON.stringify({
            recipients: recipients.map((c) => ({
              email: c.email,
              first_name: c.first_name,
              last_name: c.last_name,
            })),
            subject,
            body,
            from_name: fromName,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        setResult({ error: data.error || `Erreur ${res.status}` });
      } else {
        setResult({
          success: true,
          sent: data.sent || recipients.length,
          failed: data.failed || 0,
        });
      }
    } catch (err) {
      setResult({ error: err.message });
    }
    setSending(false);
  }

  function handleSaveSettings() {
    localStorage.setItem('mail_smtp_host', smtpHost);
    localStorage.setItem('mail_smtp_port', smtpPort);
    localStorage.setItem('mail_smtp_user', smtpUser);
    localStorage.setItem('mail_smtp_pass', smtpPass);
    localStorage.setItem('mail_from', fromEmail);
    localStorage.setItem('mail_from_name', fromName);
    setResult({ success: true, message: 'Parametres sauvegardes.' });
    setTimeout(() => setResult(null), 3000);
  }

  return (
    <>
      <style>{`
        @media (max-width: 1100px) {
          .mailing-preview-col { display: none !important; }
          .mailing-compose-grid { grid-template-columns: 1.2fr 0.8fr !important; }
        }
      `}</style>
      <div className="page-header">
        <div>
          <h2 className="page-title">Mailing</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Campagnes email vers vos clients
          </p>
        </div>
      </div>

      <div className="page-body">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid rgba(var(--overlay),0.08)' }}>
          {[
            { id: 'compose', label: 'Composer' },
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

        {/* ---- COMPOSE TAB ---- */}
        {tab === 'compose' && (
          <div className="mailing-compose-grid" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.5fr', gap: 24, alignItems: 'start' }}>
            {/* Left: email content */}
            <div className="card">
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Contenu de l'email</h3>

              <div className="form-group">
                <label className="label">Modele</label>
                <select className="input" value={template.id} onChange={(e) => handleTemplateChange(e.target.value)}>
                  {EMAIL_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="label">Objet</label>
                <input
                  className="input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Objet de l'email..."
                />
              </div>

              <div className="form-group">
                <label className="label">Contenu</label>
                <textarea
                  className="input"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  style={{ resize: 'vertical', fontFamily: 'inherit', minHeight: 200, lineHeight: 1.6 }}
                  placeholder="Votre message..."
                />
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 10px', background: 'rgba(var(--overlay),0.02)', borderRadius: 6, border: '1px solid rgba(var(--overlay),0.06)' }}>
                Variables : <code style={{ color: '#3b82f6' }}>{'{prenom}'}</code> <code style={{ color: '#3b82f6' }}>{'{nom}'}</code> — seront remplacees automatiquement
              </div>
            </div>

            {/* Right: recipients + send */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Destinataires</h3>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button
                    className={`btn btn-sm ${recipientMode === 'search' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setRecipientMode('search')}
                  >
                    Selectionner
                  </button>
                  <button
                    className={`btn btn-sm ${recipientMode === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => { setRecipientMode('all'); if (allClients.length === 0) loadAllClients(); }}
                  >
                    {loadingAll ? 'Chargement...' : 'Tous les clients'}
                  </button>
                </div>

                {recipientMode === 'search' && (
                  <>
                    <div className="form-group" style={{ marginBottom: 10 }}>
                      <input
                        className="input"
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder="Rechercher un client avec email..."
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
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.email}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {selectedClients.length > 0 && (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, maxHeight: 120, overflowY: 'auto' }}>
                      {selectedClients.slice(0, 20).map((c) => (
                        <span
                          key={c.id}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '4px 10px', background: 'rgba(59,130,246,0.12)',
                            border: '1px solid rgba(59,130,246,0.25)', borderRadius: 20,
                            fontSize: 12, fontWeight: 600,
                          }}
                        >
                          {c.first_name}
                          <button
                            onClick={() => toggleClient(c)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                          >&times;</button>
                        </span>
                      ))}
                      {selectedClients.length > 20 && (
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 8px' }}>
                          +{selectedClients.length - 20} autres
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      {selectedClients.filter((c) => c.email).length} destinataire{selectedClients.filter((c) => c.email).length > 1 ? 's' : ''} avec email
                    </div>
                  </>
                )}

                {selectedClients.length > 0 && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSelectedClients([])}
                    style={{ fontSize: 11 }}
                  >
                    Tout deselectionner
                  </button>
                )}
              </div>

              {/* Result */}
              {result && (
                <div style={{
                  padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13,
                  background: result.error ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                  border: `1px solid ${result.error ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'}`,
                  color: result.error ? '#ef4444' : '#22c55e',
                }}>
                  {result.error || result.message || (
                    <>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Emails envoyes !</div>
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
                <MailIcon />
                {sending ? 'Envoi en cours...' : `Envoyer ${selectedClients.filter((c) => c.email).length} email${selectedClients.filter((c) => c.email).length > 1 ? 's' : ''}`}
              </button>
            </div>

            {/* iPhone Email Preview */}
            <div className="mailing-preview-col" style={{ position: 'sticky', top: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 12, textAlign: 'center' }}>Aperçu</div>
              <div style={{
                width: 260, margin: '0 auto', background: '#000', borderRadius: 36, padding: '12px 10px',
                border: '3px solid #333', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}>
                {/* Notch */}
                <div style={{ width: 100, height: 24, background: '#000', borderRadius: '0 0 12px 12px', margin: '0 auto 8px' }} />
                {/* Screen */}
                <div style={{
                  background: '#1a1a1a', borderRadius: 24, padding: '16px 12px', minHeight: 400,
                  display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}>
                  {/* Email header area */}
                  <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #2a2a2a' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>De: {fromName || 'BarberClub'}</div>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: '#e0e0e0', lineHeight: 1.3,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {subject || 'Objet...'}
                    </div>
                  </div>
                  {/* Email body */}
                  <div style={{
                    flex: 1, fontSize: 11, lineHeight: 1.6, color: '#bbb',
                    wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                    overflowY: 'auto', maxHeight: 320,
                  }}>
                    {body || 'Contenu de l\'email...'}
                  </div>
                  {/* Footer */}
                  <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: 9, color: '#444', paddingTop: 12, borderTop: '1px solid #2a2a2a' }}>
                    {body.length} caractères
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
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Configuration email</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
                Les emails utilisent Resend (deja configure dans le backend).
                Modifiez ici les informations d'expediteur.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="label">Nom expediteur</label>
                  <input className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="BarberClub" />
                </div>
                <div className="form-group">
                  <label className="label">Email expediteur</label>
                  <input className="input" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="noreply@barberclub.fr" />
                </div>
              </div>

              {result?.message && (
                <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 6, color: '#22c55e', fontSize: 13, marginBottom: 12 }}>
                  {result.message}
                </div>
              )}

              <button className="btn btn-primary btn-sm" onClick={handleSaveSettings}>
                Sauvegarder
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
