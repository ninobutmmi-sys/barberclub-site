import { useState } from 'react';
import { useAuth } from '../auth';

export default function Login() {
  const { login, salon, clearSalon } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const salonLabel = salon === 'grenoble' ? 'Grenoble' : 'Meylan';

  return (
    <div className="login-page">
      <div className="login-card">
        <button className="login-back" onClick={clearSalon} type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Changer de salon
        </button>

        <div className="login-logo">
          <img src="/logo.png" alt="BarberClub" className="salon-selector-logo" />
          <p>{salonLabel}</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="login-error" role="alert">{error}</div>}

          <div className="form-group">
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@barberclub.fr"
              required
            />
          </div>

          <div className="form-group">
            <label className="label">Mot de passe</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading}
            style={{ width: '100%', marginTop: 8, padding: '14px 24px', fontSize: 14 }}
          >
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
