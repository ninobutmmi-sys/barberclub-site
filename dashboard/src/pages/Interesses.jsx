import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import useMobile from '../hooks/useMobile';
import { exportToCSV } from '../utils/csv';
import { formatPhoneWithFlag } from '../utils/phone';

// ============================================
// Les gens qui attendent l'ouverture de Voiron
//
// La page publique demandait une adresse email : une inscription en trois
// semaines. Quelqu'un qui passe devant les travaux sort son telephone, il ne
// tape pas une adresse — le formulaire demande maintenant un numero, et cette
// page rassemble tout le monde au meme endroit.
//
// Les premieres inscriptions avaient ete enregistrees sous Grenoble, avant que
// Voiron existe en base ; la migration 081 les a rattachees. La lecture reste
// bornee au salon connecte cote serveur, l'evenement n'est qu'un filtre de plus.
// ============================================

const EVENEMENT = 'ouverture_voiron';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Interesses() {
  const isMobile = useMobile();
  const [copie, setCopie] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['eventAlerts', EVENEMENT],
    queryFn: () => api.getEventAlerts({ event_name: EVENEMENT }),
    staleTime: 60_000,
  });

  const gens = useMemo(() => data?.alerts || [], [data]);
  const avecTel = gens.filter((g) => g.phone);
  const avecEmail = gens.filter((g) => g.email);

  // Sept derniers jours : de quoi voir si l'affiche du chantier travaille.
  const recents = gens.filter((g) => {
    const j = (Date.now() - new Date(g.created_at)) / 86400000;
    return j <= 7;
  }).length;

  function copierNumeros() {
    const liste = avecTel.map((g) => g.phone).join('\n');
    navigator.clipboard.writeText(liste).then(() => {
      setCopie(true);
      setTimeout(() => setCopie(false), 2500);
    });
  }

  function exporter() {
    exportToCSV(gens, `interesses-voiron-${new Date().toISOString().slice(0, 10)}.csv`, [
      { key: 'first_name', label: 'Prenom' },
      { key: 'phone', label: 'Telephone' },
      { key: 'email', label: 'Email' },
      { key: 'created_at', label: 'Inscrit le', transform: (v) => formatDate(v) },
      { key: 'notified_at', label: 'Prevenu le', transform: (v) => (v ? formatDate(v) : '') },
    ]);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Intéressés</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Les personnes qui veulent être prévenues de l&apos;ouverture
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => refetch()} disabled={isFetching} style={{ gap: 6 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
              style={isFetching ? { animation: 'spin 1s linear infinite' } : {}}>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Actualiser
          </button>
          {gens.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={exporter} style={{ gap: 6 }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="page-body">
        {error && <div className="login-error" role="alert" style={{ marginBottom: 20 }}>{error.message}</div>}

        {isLoading ? (
          <div className="empty-state">Chargement…</div>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
              gap: 12, marginBottom: 20,
            }}>
              {[
                ['Intéressés', gens.length, 'depuis l’ouverture de la page'],
                ['Numéros', avecTel.length, 'joignables par SMS'],
                ['Cette semaine', recents, 'nouvelles inscriptions'],
              ].map(([label, valeur, sous], i) => (
                <div key={i} className="a-card" style={{ padding: '16px 16px' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    {label}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800 }}>{valeur}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{sous}</div>
                </div>
              ))}
            </div>

            {avecTel.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                <button className="btn btn-secondary btn-sm" onClick={copierNumeros} style={{ gap: 6 }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  {copie ? 'Copiés !' : `Copier les ${avecTel.length} numéros`}
                </button>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)', alignSelf: 'center' }}>
                  À coller dans la section SMS le jour de l&apos;ouverture.
                </span>
              </div>
            )}

            {gens.length === 0 ? (
              <div className="empty-state" style={{ minHeight: 200 }}>
                Personne ne s&apos;est encore inscrit. Le formulaire est en bas de la page de Voiron.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {gens.map((g) => (
                  <div key={g.id} className="a-inactive-row" style={{ cursor: 'default', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: 'rgba(232,192,122,0.10)', border: '1px solid rgba(232,192,122,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13, color: '#E8C07A',
                    }}>
                      {(g.first_name || g.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>
                        {g.first_name || 'Sans prénom'}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        {g.phone ? formatPhoneWithFlag(g.phone) : g.email}
                      </div>
                    </div>
                    {g.phone && (
                      <a href={`tel:${g.phone}`} className="btn btn-secondary btn-sm" style={{ flexShrink: 0, gap: 6 }}>
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                        Appeler
                      </a>
                    )}
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {formatDate(g.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {avecEmail.length > 0 && (
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 14, lineHeight: 1.55 }}>
                {avecEmail.length} {avecEmail.length > 1 ? 'personnes se sont inscrites' : 'personne s’est inscrite'} avec
                une adresse email, avant que le formulaire passe au numéro.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
