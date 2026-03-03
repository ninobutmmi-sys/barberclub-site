import { useAuth } from '../auth';

const SALONS = [
  {
    id: 'meylan',
    name: 'Meylan',
    address: '26 Av. du Gresivaudan, 38700 Corenc',
    barbers: 'Lucas, Julien',
  },
  {
    id: 'grenoble',
    name: 'Grenoble',
    address: '5 Rue Clot Bey, 38000 Grenoble',
    barbers: 'Tom, Alan, Nathan, Clement',
  },
];

export default function SalonSelector() {
  const { selectSalon } = useAuth();

  return (
    <div className="login-page">
      <div style={{ width: '100%', maxWidth: 520, padding: '0 20px' }}>
        <div className="login-logo">
          <h1>BarberClub</h1>
          <p>Choisissez votre salon</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {SALONS.map((s) => (
            <button
              key={s.id}
              className="salon-card"
              onClick={() => selectSalon(s.id)}
            >
              <div className="salon-card-name">{s.name}</div>
              <div className="salon-card-address">{s.address}</div>
              <div className="salon-card-barbers">{s.barbers}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
