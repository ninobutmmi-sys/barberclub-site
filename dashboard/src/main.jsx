import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { rechargerUneFois } from './utils/reload';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Un chunk renomme par un deploiement fait echouer l'import : on recharge une
// fois pour aller chercher le nouveau nom. Voir utils/reload.js.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  rechargerUneFois();
});

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
