// ============================================
// BarberClub — API URL Configuration (shared)
// ============================================
// Single source of truth for the API URL.
// Used by all frontend pages (site vitrine).
// At DNS switch, change API_PROD here only.

(function () {
  const API_PROD = 'https://api.barberclub-grenoble.fr/api';
  const API_DEV = 'http://localhost:3000/api';
  window.BARBERCLUB_API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? API_DEV
    : API_PROD;
})();
