import { useAuth } from '../auth';

const SALONS = [
  {
    id: 'meylan',
    name: 'Meylan',
    address: '26 Av. du Gresivaudan, 38700 Corenc',
    barbers: ['Lucas', 'Julien'],
    image: '/salons/devanture-meylan.webp',
  },
  {
    id: 'grenoble',
    name: 'Grenoble',
    address: '5 Rue Clot Bey, 38000 Grenoble',
    barbers: ['Tom', 'Alan', 'Nathan', 'Clement'],
    image: '/salons/comptoir-grenoble.webp',
  },
];

function MapPinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function SalonSelector() {
  const { selectSalon } = useAuth();

  return (
    <div className="salon-selector-page">
      <div className="salon-selector-container">
        <div className="salon-selector-header">
          <img src="/logo.png" alt="BarberClub" className="salon-selector-logo" />
          <p className="salon-selector-subtitle">Espace Administration</p>
        </div>

        <div className="salon-selector-grid">
          {SALONS.map((s) => (
            <button
              key={s.id}
              className="salon-card"
              onClick={() => selectSalon(s.id)}
            >
              <div className="salon-card-image">
                <img src={s.image} alt={s.name} />
                <div className="salon-card-overlay" />
              </div>
              <div className="salon-card-body">
                <div className="salon-card-name">{s.name}</div>
                <div className="salon-card-meta">
                  <span className="salon-card-meta-item">
                    <MapPinIcon />
                    {s.address}
                  </span>
                  <span className="salon-card-meta-item">
                    <UsersIcon />
                    {s.barbers.join(', ')}
                  </span>
                </div>
                <div className="salon-card-arrow">
                  <span>Gerer ce salon</span>
                  <ArrowIcon />
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
