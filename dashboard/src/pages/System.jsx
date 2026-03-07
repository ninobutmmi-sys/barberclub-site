import { useState, lazy, Suspense } from 'react';

const SystemHealth = lazy(() => import('./SystemHealth'));
const Automation = lazy(() => import('./Automation'));
const AuditLog = lazy(() => import('./AuditLog'));

const TABS = [
  { key: 'sante', label: 'Sante' },
  { key: 'automation', label: 'Automation' },
  { key: 'journal', label: 'Journal' },
];

const Loader = () => (
  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement...</div>
);

export default function System() {
  const [tab, setTab] = useState('sante');

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Systeme</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Monitoring, automatisations et journal
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(var(--overlay),0.08)', marginBottom: 0 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px', fontSize: 13, fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? 'var(--text)' : 'var(--text-secondary)',
              background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid var(--text)' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<Loader />}>
        {tab === 'sante' && <SystemHealth embedded />}
        {tab === 'automation' && <Automation embedded />}
        {tab === 'journal' && <AuditLog embedded />}
      </Suspense>
    </>
  );
}
