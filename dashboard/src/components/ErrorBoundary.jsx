import { Component } from 'react';
import { estChunkManquant, rechargerUneFois } from '../utils/reload';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    // Un module introuvable n'est pas un bug de l'application : c'est un
    // onglet resté ouvert pendant un déploiement. On recharge au lieu
    // d'afficher un écran d'erreur que la personne ne peut pas interpréter.
    if (estChunkManquant(error)) rechargerUneFois();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#fff',
          fontFamily: 'Inter, sans-serif',
        }}>
          <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Une erreur est survenue</h2>
            <p style={{ color: '#a8a29e', margin: '0 0 24px', fontSize: 14 }}>
              {estChunkManquant(this.state.error)
                ? 'Une nouvelle version vient d\u2019\u00eatre publi\u00e9e. Rechargez pour la r\u00e9cup\u00e9rer.'
                : (this.state.error?.message || 'Erreur inattendue')}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              style={{
                background: '#fff',
                color: '#0a0a0a',
                border: 'none',
                borderRadius: 8,
                padding: '10px 24px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Recharger la page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
