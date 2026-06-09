// Accès rapide au back-office Oney (ventes de parfums).
// Les portails bancaires bloquent l'affichage en iframe → on ouvre Oney dans un
// nouvel onglet (la session navigateur d'Oney est réutilisée si déjà connecté).

// URL de l'espace marchand Oney (back-office ventes de parfums).
const ONEY_URL = 'https://open.oney.fr/#/ce';

const ONEY_GREEN = '#84bd00';

export default function Oney() {
  const openOney = () => {
    window.open(ONEY_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Oney</h2>
      </div>

      <div
        className="card"
        style={{
          maxWidth: 520,
          margin: '0 auto',
          padding: '40px 32px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background: `${ONEY_GREEN}1a`,
            border: `1px solid ${ONEY_GREEN}40`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: ONEY_GREEN,
          }}
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2" ry="2" />
            <line x1="2" y1="10" x2="22" y2="10" />
          </svg>
        </div>

        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700 }}>Espace Oney</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
            Gère les ventes de parfums et les paiements directement sur le back-office Oney.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={openOney}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, padding: '12px 24px' }}
        >
          Ouvrir Oney
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>

        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
          S'ouvre dans un nouvel onglet · connexion via tes identifiants Oney
        </p>
      </div>
    </>
  );
}
