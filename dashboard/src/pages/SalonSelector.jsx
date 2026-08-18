import { useAuth } from '../auth';

// Les equipes sont ecrites en dur : cet ecran s'affiche AVANT le login, donc
// aucun appel API n'est possible pour les lire. A tenir a jour a la main quand
// un barbier arrive ou part (source : barbers WHERE is_active, par sort_order).
const SALONS = [
  {
    id: 'meylan',
    name: 'Meylan',
    address: '26 Av. du Gresivaudan, 38700 Corenc',
    barbers: ['Alexandre', 'Nathan', 'Lucas', 'Julien'],
    image: '/salons/devanture-meylan.webp',
  },
  {
    id: 'grenoble',
    name: 'Grenoble',
    address: '5 Rue Clot Bey, 38000 Grenoble',
    barbers: ['Tom', 'Alan', 'Clement', 'Nathan', 'Louay'],
    image: '/salons/comptoir-grenoble.webp',
  },
  {
    // Salon pas encore ouvert : la carte est volontairement non cliquable.
    // Il n'existe aucun salon_id 'voiron' en base, et l'API admin n'accepte
    // que meylan et grenoble — le selectionner enfermerait l'utilisateur
    // sur un dashboard qui repond 403 partout.
    id: 'voiron',
    name: 'Voiron',
    address: '5 Av. Leon et Joanny Tardy, 38500 Voiron',
    barbers: ['Clement', 'Julien'],
    image: '/salons/facade-voiron.webp',
    soon: true,
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
          {SALONS.map((s) => {
            // Un salon a venir n'est pas un bouton desactive, c'est une annonce.
            // On rend donc une div : rien a cliquer, rien a tabuler, et le texte
            // "Prochainement" reste lu normalement.
            const Card = s.soon ? 'div' : 'button';
            return (
            <Card
              key={s.id}
              className={`salon-card${s.soon ? ' salon-card-soon' : ''}`}
              onClick={s.soon ? undefined : () => selectSalon(s.id)}
            >
              <div className="salon-card-image">
                <img src={s.image} alt={s.name} />
                <div className="salon-card-overlay" />
                {s.soon && <span className="salon-card-flag">Prochainement</span>}
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
                  <span>{s.soon ? 'Ouverture a venir' : 'Gerer ce salon'}</span>
                  {!s.soon && <ArrowIcon />}
                </div>
              </div>
            </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
