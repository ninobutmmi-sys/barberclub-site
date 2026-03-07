import { useState, lazy, Suspense } from 'react';

const Sms = lazy(() => import('./Sms'));
const Mailing = lazy(() => import('./Mailing'));
const Campaigns = lazy(() => import('./Campaigns'));

const TABS = [
  { key: 'sms', label: 'SMS' },
  { key: 'mailing', label: 'Mailing' },
  { key: 'campagnes', label: 'Campagnes' },
];

const Loader = () => (
  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement...</div>
);

export default function Messages() {
  const [tab, setTab] = useState('sms');

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Messages</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            SMS, emails et campagnes
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
        {tab === 'sms' && <Sms embedded />}
        {tab === 'mailing' && <Mailing embedded />}
        {tab === 'campagnes' && <Campaigns embedded />}
      </Suspense>
    </>
  );
}
