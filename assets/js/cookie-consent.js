/**
 * BarberClub — RGPD Cookie Consent Banner
 * Auto-injects a minimal cookie consent banner.
 */
(function () {
  if (localStorage.getItem('bc_cookie_consent')) return;

  var style = document.createElement('style');
  style.textContent = [
    '#bc-cookie-banner{position:fixed;bottom:0;left:0;right:0;z-index:9999;background:rgba(17,17,17,0.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,0.08);padding:16px 20px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;font-family:Inter,-apple-system,sans-serif;font-size:13px;color:rgba(255,255,255,0.7);animation:bc-slide-up .4s ease}',
    '@keyframes bc-slide-up{from{transform:translateY(100%)}to{transform:translateY(0)}}',
    '#bc-cookie-banner a{color:#fff;text-decoration:underline}',
    '#bc-cookie-banner button{padding:10px 24px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:transform .2s ease}',
    '#bc-cookie-banner button:active{transform:scale(0.95)}',
    '#bc-cookie-accept{background:#fff;color:#000}',
    '#bc-cookie-refuse{background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.12)}',
    '@media(max-width:600px){#bc-cookie-banner{flex-direction:column;text-align:center;gap:12px;padding:16px}#bc-cookie-banner .bc-cookie-btns{width:100%;display:flex;gap:8px}#bc-cookie-banner button{flex:1}}'
  ].join('');
  document.head.appendChild(style);

  var banner = document.createElement('div');
  banner.id = 'bc-cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Consentement cookies');

  // Determine relative path to legal pages
  var path = window.location.pathname;
  var legalBase = '/pages/legal/';
  if (path.includes('/pages/meylan/') || path.includes('/pages/grenoble/') || path.includes('/pages/barbers/')) {
    legalBase = '../legal/';
  }

  banner.innerHTML =
    '<span>Ce site utilise uniquement des cookies essentiels (session, pr\u00e9f\u00e9rences). Aucun tracking publicitaire. ' +
    '<a href="' + legalBase + 'politique-confidentialite.html">En savoir plus</a></span>' +
    '<div class="bc-cookie-btns">' +
    '<button id="bc-cookie-accept">Accepter</button>' +
    '<button id="bc-cookie-refuse">Refuser</button>' +
    '</div>';

  document.body.appendChild(banner);

  function dismiss(consent) {
    localStorage.setItem('bc_cookie_consent', consent);
    banner.style.animation = 'none';
    banner.style.transition = 'transform .3s ease, opacity .3s ease';
    banner.style.transform = 'translateY(100%)';
    banner.style.opacity = '0';
    setTimeout(function () { banner.remove(); }, 350);
  }

  document.getElementById('bc-cookie-accept').addEventListener('click', function () { dismiss('accepted'); });
  document.getElementById('bc-cookie-refuse').addEventListener('click', function () { dismiss('refused'); });
})();
