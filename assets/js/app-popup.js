/**
 * Badge « APP » + modale — BarberClub
 * ═══════════════════════════════════════════════════════════════════
 * Script à déposer, sur le modèle de cookie-consent.js. Aucune dépendance.
 *
 * DEUX TEMPS.
 * 1. Un badge se pose en bas à droite : le halo s'allume, la tuile arrive
 *    par en dessous avec un léger dépassement, le rim fait un tour rapide
 *    puis se met en orbite lente, et les lettres A-P-P montent depuis un
 *    masque — le geste du hero des pages salon (.hero-title .letter).
 * 2. Un clic ouvre une modale au centre, le site se floute derrière. On la
 *    ferme par la croix (Échap fonctionne aussi : un piège sans issue au
 *    clavier serait inaccessible). Un clic à côté ne ferme pas.
 *
 * PLACEMENT — toutes les pages font 100vh sans marge libre. Au repos le
 * badge se pose au-dessus de la barre de navigation des hubs et du bandeau
 * cookies, et reste à droite du bouton « En savoir plus » de Voiron sur la
 * landing. Rien n'est masqué tant qu'on n'a pas cliqué.
 *
 * Les trois arguments viennent de la fiche App Store de l'application, pas
 * d'une promesse inventée : fidélité en QR code présenté en caisse, points
 * cumulés, offres du moment.
 */
(function () {
  'use strict';

  var STORE_IOS     = 'https://apps.apple.com/app/id6764382812';
  var STORE_ANDROID = 'https://play.google.com/store/apps/details?id=fr.barberclubgrenoble.app';
  var ICON          = '/assets/images/common/app-icon.jpg';
  var DELAY         = 1200;   // le badge se pose une fois la page installée
  var MODAL_KEY     = 'bc_app_modal';
  var SNOOZE_DAYS   = 30;     // une fois vue et fermée, on laisse tranquille
  var MAGNET_RADIUS = 140;
  var MAGNET_PULL   = 0.2;

  var ua = navigator.userAgent || '';
  var isAndroid = /android/i.test(ua);
  // Tout ce qui n'est pas Android part sur l'App Store : iPhone et iPad
  // évidemment, et l'ordinateur aussi — le lien Apple sans code pays
  // redirige de lui-même vers la boutique du visiteur.
  var href  = isAndroid ? STORE_ANDROID : STORE_IOS;
  var label = isAndroid ? 'Google Play' : 'App Store';

  var fine = window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  // ── La modale s'ouvre-t-elle d'elle-même ? ────────────────────────
  // Une fois par visiteur, à l'arrivée. Ensuite le badge reste là pour la
  // rouvrir : personne ne se fait interrompre deux fois.
  var seen;
  try { seen = JSON.parse(localStorage.getItem(MODAL_KEY) || 'null'); } catch (e) { seen = null; }
  var autoOpen = !(seen && (seen.state === 'installed' ||
                            Date.now() - seen.at < SNOOZE_DAYS * 864e5));
  function rememberModal(state) {
    try { localStorage.setItem(MODAL_KEY, JSON.stringify({ state: state, at: Date.now() })); } catch (e) {}
  }

  var GRAIN = "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

  var GLYPH = isAndroid
    ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>';

  // ── Styles ────────────────────────────────────────────────────────
  var css = [
    "@font-face{font-family:'Orbitron';src:url('/assets/fonts/Orbitron-ExtraBold.ttf') format('truetype');font-weight:800;font-display:swap}",
    // Un angle enregistré : sans ça un conic-gradient n'est pas interpolable,
    // et faire tourner l'élément ferait tourner le rectangle arrondi avec lui.
    "@property --a{syntax:'<angle>';inherits:false;initial-value:0deg}",

    /* ══════════════ LE BADGE ══════════════ */
    // Échelle de z-index : 900 le badge, 950 la modale, sous les cookies (9999).
    '.bc-app{position:fixed;z-index:900;right:22px;bottom:22px;--tx:0px;--ty:0px;--rx:0deg;--ry:0deg;--mx:50%;--my:50%;display:flex;flex-direction:column;align-items:center;gap:8px;padding:0;background:none;border:0;cursor:pointer;opacity:0;transform:translate(var(--tx),var(--ty));transition:opacity 500ms ease}',
    '.bc-app.is-in{opacity:1}',
    // Derrière le voile flouté, le badge ne serait qu'une tache : il s'efface.
    '.bc-app.is-hidden{opacity:0;pointer-events:none}',

    // Le halo s'allume en premier : la lumière avant l'objet.
    '.bc-app-halo{position:absolute;top:-14px;left:50%;width:104px;height:104px;margin-left:-52px;border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,0.2),transparent 70%);filter:blur(16px);opacity:0;pointer-events:none;transition:opacity 340ms ease}',
    '.bc-app.is-in .bc-app-halo{animation:bc-app-bloom 620ms ease-out both,bc-app-breathe 9s ease-in-out 700ms infinite}',
    '@keyframes bc-app-bloom{from{opacity:0;transform:scale(0.4)}to{opacity:0.5;transform:scale(1)}}',
    '@keyframes bc-app-breathe{0%,100%{transform:scale(0.94);opacity:0.42}50%{transform:scale(1.06);opacity:0.62}}',
    '.bc-app:hover .bc-app-halo{opacity:0.95}',

    // La tuile arrive par en dessous, en pivotant, avec un léger dépassement.
    '.bc-app-stage{position:relative;z-index:1;perspective:520px}',
    '.bc-app-tile{position:relative;display:block;width:56px;height:56px;border-radius:16px;overflow:hidden;background:#000;box-shadow:0 16px 34px rgba(0,0,0,0.7);transform:rotateX(var(--rx)) rotateY(var(--ry));transition:transform 420ms cubic-bezier(0.16,1,0.3,1),box-shadow 340ms ease}',
    '.bc-app.is-in .bc-app-tile{animation:bc-app-land 780ms cubic-bezier(0.34,1.5,0.5,1) 180ms both}',
    '@keyframes bc-app-land{from{opacity:0;transform:translate(22px,40px) rotate(14deg) scale(0.5)}to{opacity:1;transform:none}}',
    '.bc-app:hover .bc-app-tile{box-shadow:0 22px 46px rgba(0,0,0,0.76),0 0 30px rgba(255,255,255,0.16)}',
    '.bc-app:active .bc-app-tile{transform:scale(0.94);transition-duration:120ms}',
    '.bc-app-tile img{position:relative;z-index:1;width:100%;height:100%;object-fit:cover;display:block;transform:scale(1.22)}',

    // Le rim fait un tour rapide à l'arrivée, puis se met en orbite lente.
    '.bc-app-rim{position:absolute;inset:0;z-index:3;border-radius:16px;padding:1px;pointer-events:none;background:conic-gradient(from var(--a),rgba(255,255,255,0.14) 0deg,rgba(255,255,255,0.9) 30deg,rgba(255,255,255,0.14) 68deg,rgba(255,255,255,0.14) 360deg);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;opacity:0.75;transition:opacity 340ms ease}',
    '.bc-app.is-in .bc-app-rim{animation:bc-app-orbit 900ms cubic-bezier(0.3,0,0.2,1) 620ms 1 both,bc-app-orbit 7s linear 1.52s infinite}',
    '.bc-app:hover .bc-app-rim{opacity:1}',
    '@keyframes bc-app-orbit{to{--a:360deg}}',

    '.bc-app-spec{position:absolute;inset:0;z-index:2;border-radius:16px;pointer-events:none;opacity:0;background:radial-gradient(30px circle at var(--mx) var(--my),rgba(255,255,255,0.5),rgba(255,255,255,0.1) 40%,transparent 72%);transition:opacity 300ms ease}',
    '.bc-app:hover .bc-app-spec{opacity:1}',

    '.bc-app-sheen{position:absolute;inset:-50%;z-index:2;pointer-events:none;background:linear-gradient(66deg,transparent 42%,rgba(255,255,255,0.32) 50%,transparent 58%);transform:translateX(-130%);animation:bc-app-sheen 6s ease-in-out 4s infinite}',
    '@keyframes bc-app-sheen{0%{transform:translateX(-130%)}28%,100%{transform:translateX(130%)}}',
    '.bc-app:hover .bc-app-sheen{animation-play-state:paused}',

    // Les lettres montent depuis un masque, comme le titre du hero.
    '.bc-app-word{position:relative;z-index:1;display:block;overflow:hidden;font-family:Orbitron,sans-serif;font-weight:800;font-size:8.5px;letter-spacing:0.26em;text-indent:0.26em;text-transform:uppercase;color:rgba(255,255,255,0.5);transition:color 300ms ease}',
    '.bc-app-word i{display:inline-block;font-style:normal;transform:translateY(120%)}',
    '.bc-app.is-in .bc-app-word i{animation:bc-app-letter 520ms cubic-bezier(0.16,1,0.3,1) both;animation-delay:calc(var(--l) * 70ms + 700ms)}',
    '@keyframes bc-app-letter{to{transform:none}}',
    '.bc-app:hover .bc-app-word{color:rgba(255,255,255,0.9)}',
    '.bc-app:focus-visible{outline:2px solid rgba(255,255,255,0.75);outline-offset:7px;border-radius:18px}',

    /* ══════════════ LA MODALE ══════════════ */
    '.bc-modal{position:fixed;z-index:950;inset:0;display:grid;place-items:center;padding:20px}',
    '.bc-modal[hidden]{display:none}',

    // Le voile floute le site. Le flou est posé d'emblée et c'est l'opacité
    // qui s'anime : animer un backdrop-filter saccade sur la plupart des GPU.
    '.bc-modal-veil{position:absolute;inset:0;background:rgba(4,4,5,0.58);backdrop-filter:blur(7px) saturate(115%);-webkit-backdrop-filter:blur(7px) saturate(115%);opacity:0;transition:opacity 420ms ease}',
    '.bc-modal.is-open .bc-modal-veil{opacity:1}',

    '.bc-modal-frame{position:relative;width:100%;max-width:396px;padding:1px;border-radius:23px;overflow:hidden;background:rgba(255,255,255,0.13);box-shadow:0 40px 90px rgba(0,0,0,0.82);opacity:0;transform:translateY(20px) scale(0.94);transition:opacity 300ms ease,transform 520ms cubic-bezier(0.16,1,0.3,1)}',
    '.bc-modal.is-open .bc-modal-frame{opacity:1;transform:none}',
    // Le rim : un balayage conique qui fait le tour du cadre.
    '.bc-modal-rim{position:absolute;top:50%;left:50%;width:170%;aspect-ratio:1;margin:-85% 0 0 -85%;background:conic-gradient(from var(--a),transparent 0deg,rgba(255,255,255,0.7) 24deg,transparent 58deg,transparent 360deg);pointer-events:none;opacity:0}',
    '.bc-modal.is-open .bc-modal-rim{opacity:1;animation:bc-app-orbit 8s linear infinite;transition:opacity 700ms ease 300ms}',
    '.bc-modal-panel{position:relative;max-height:calc(100vh - 44px);overflow-y:auto;padding:26px 24px 24px;border-radius:22px;background:linear-gradient(158deg,rgba(255,255,255,0.07),rgba(255,255,255,0.018) 46%,rgba(255,255,255,0.045)),rgba(7,7,8,0.97)}',
    // La lumière qui traverse le panneau à l'ouverture. Une fois.
    '.bc-modal-panel::before{content:"";position:absolute;inset:-40% -60%;background:linear-gradient(74deg,transparent 40%,rgba(255,255,255,0.1) 50%,transparent 60%);transform:translateX(-120%);pointer-events:none;z-index:3}',
    '.bc-modal.is-open .bc-modal-panel::before{animation:bc-modal-sweep 1100ms cubic-bezier(0.32,0,0.2,1) 260ms both}',
    '@keyframes bc-modal-sweep{from{transform:translateX(-120%)}to{transform:translateX(120%)}}',
    
    // La couronne en filigrane et le grain du site : la modale est de la
    // même matière que les cartes du site, pas une fenêtre étrangère.
    '.bc-modal-mark{position:absolute;right:-40px;bottom:-56px;width:210px;height:auto;filter:invert(1);opacity:0.05;pointer-events:none;transform:rotate(-8deg)}',
    '.bc-modal-grain{position:absolute;inset:0;border-radius:22px;pointer-events:none;opacity:0.05;background-image:' + GRAIN + ';background-size:150px}',
    '.bc-modal-panel>*:not(.bc-modal-mark):not(.bc-modal-grain):not(.bc-modal-close){position:relative;z-index:1}',
    '.bc-modal-grain{border-radius:22px}',

    '.bc-modal-close{position:absolute;top:10px;right:10px;z-index:2;width:44px;height:44px;display:grid;place-items:center;background:none;border:0;cursor:pointer;color:rgba(255,255,255,0.4);transition:color 0.2s ease}',
    '.bc-modal-close:hover{color:#fff}',
    '.bc-modal-close:focus-visible{outline:2px solid rgba(255,255,255,0.6);outline-offset:-9px;border-radius:13px}',
    '.bc-modal-close svg{width:15px;height:15px}',

    '.bc-modal-head{display:flex;align-items:center;gap:15px}',
    '.bc-modal-tile{flex:0 0 auto;display:block;width:62px;height:62px;border-radius:16px;overflow:hidden;background:#000;border:1px solid rgba(255,255,255,0.18);box-shadow:0 12px 28px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.1)}',
    '.bc-modal-eyebrow{margin:0;font-family:Inter,-apple-system,sans-serif;font-size:8.5px;font-weight:400;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.42)}',
    '.bc-modal-tile img{width:100%;height:100%;object-fit:cover;display:block;transform:scale(1.22)}',

    // Le nom à la voix du hero : Orbitron, 0.06em, interligne 0.95.
    '.bc-modal-name{margin:8px 0 0;font-family:Orbitron,sans-serif;font-weight:800;font-size:23px;line-height:0.95;letter-spacing:0.06em;text-transform:uppercase;color:#fff}',
    '.bc-modal-lead{margin:24px 0 0;font-family:Orbitron,sans-serif;font-weight:800;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:rgba(255,255,255,0.72)}',

    '.bc-modal-list{position:relative;margin:16px 0 0;padding:0 0 0 22px;list-style:none}',
    // Le rail : il s'éclaircit en descendant, comme une progression.
    '.bc-modal-list::before{content:"";position:absolute;left:4px;top:7px;bottom:9px;width:1px;background:linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.5))}',
    '.bc-modal-list li{position:relative;margin-top:17px}',
    '.bc-modal-list li:first-child{margin-top:0}',
    // Le nœud, aligné sur la ligne du libellé.
    '.bc-modal-list li::before{content:"";position:absolute;left:-22px;top:3px;width:9px;height:9px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(7,7,8,0.97),0 0 12px rgba(255,255,255,0.5)}',
    // Le dernier nœud est le but : il est plus présent.
    '.bc-modal-list li:last-child::before{width:11px;height:11px;left:-23px;top:2px}',
    // Une couronne miniature en puce : la marque tient lieu de repère.
    
    '.bc-modal-list b{display:block;font-family:Orbitron,sans-serif;font-weight:800;font-size:10.5px;line-height:1.3;letter-spacing:0.13em;text-transform:uppercase;color:#fff}',
    '.bc-modal-list span{display:block;margin-top:6px;font-family:Inter,-apple-system,sans-serif;font-size:12.5px;line-height:1.5;color:rgba(255,255,255,0.6)}',
    // Chaque ligne monte à son tour, une fois la modale posée.
    '.bc-modal-list li{opacity:0}',
    '.bc-modal.is-open .bc-modal-list li{animation:bc-modal-rise 480ms cubic-bezier(0.16,1,0.3,1) both;animation-delay:calc(var(--i) * 80ms + 220ms)}',
    '@keyframes bc-modal-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',

    '.bc-modal-cta{margin-top:24px;min-height:52px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:14px;background:#fff;color:#000;font-family:Inter,-apple-system,sans-serif;font-size:13.5px;font-weight:600;text-decoration:none;cursor:pointer;box-shadow:0 12px 30px -12px rgba(255,255,255,0.6);transition:transform 180ms cubic-bezier(0.16,1,0.3,1),background 200ms ease}',
    '.bc-modal-cta:hover{background:rgba(255,255,255,0.88);transform:translateY(-1px)}',
    '.bc-modal-cta:active{transform:scale(0.98)}',
    '.bc-modal-cta:focus-visible{outline:2px solid #fff;outline-offset:3px}',
    '.bc-modal-cta svg{width:15px;height:15px;flex:0 0 auto}',
    '.bc-modal-store{margin:12px 0 0;text-align:center;font-family:Inter,-apple-system,sans-serif;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.44)}',

    '@media (max-width:560px){',
    '.bc-app{right:16px;bottom:16px}',
    '.bc-app-tile{width:52px;height:52px;border-radius:15px}',
    '.bc-app-rim,.bc-app-spec{border-radius:15px}',
    '.bc-app-halo{width:96px;height:96px;margin-left:-48px}',
    '.bc-modal{padding:16px}',
    '.bc-modal-panel{padding:28px 20px 22px}',
    '.bc-modal-name{font-size:30px}',
    '}',

    '@media (prefers-reduced-motion:reduce){',
    '.bc-app-halo,.bc-app-tile,.bc-app-rim,.bc-app-sheen,.bc-app-word i{animation:none!important}',
    '.bc-app-halo{opacity:0.45}',
    '.bc-app-word i{transform:none}',
    '.bc-modal-veil,.bc-modal-panel{transition:opacity 200ms linear}',
    '.bc-modal-panel{transform:none}',
    '.bc-modal.is-open .bc-modal-panel{transform:none}',
    '.bc-modal-list li{opacity:1;animation:none!important}',
    '}'
  ].join('');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ── Le badge ──────────────────────────────────────────────────────
  function letters(word) {
    return word.split('').map(function (c, i) {
      return '<i style="--l:' + i + '">' + c + '</i>';
    }).join('');
  }

  var el = document.createElement('button');
  el.type = 'button';
  el.className = 'bc-app';
  el.setAttribute('aria-haspopup', 'dialog');
  el.setAttribute('aria-label', "L'application BARBER CLUB+ — en savoir plus");
  el.innerHTML =
    '<span class="bc-app-halo" aria-hidden="true"></span>' +
    '<span class="bc-app-stage">' +
      '<span class="bc-app-tile">' +
        '<img src="' + ICON + '" alt="" aria-hidden="true">' +
        '<span class="bc-app-sheen" aria-hidden="true"></span>' +
        '<span class="bc-app-spec" aria-hidden="true"></span>' +
        '<span class="bc-app-rim" aria-hidden="true"></span>' +
      '</span>' +
    '</span>' +
    '<span class="bc-app-word">' + letters('App') + '</span>';
  document.body.appendChild(el);

  // ── La modale ─────────────────────────────────────────────────────
  // Les trois arguments viennent de la fiche App Store, mot pour mot sur le
  // fond : QR code présenté en caisse, points cumulés, offres du moment.
  var CROWN = '/assets/images/common/couronne.png';
  function row(i, key, line) {
    return '<li style="--i:' + i + '"><b>' + key + '</b><span>' + line + '</span></li>';
  }

  var modal = document.createElement('div');
  modal.className = 'bc-modal';
  modal.hidden = true;
  modal.innerHTML =
    '<div class="bc-modal-veil"></div>' +
    '<div class="bc-modal-frame">' +
    '<div class="bc-modal-rim" aria-hidden="true"></div>' +
    '<div class="bc-modal-panel" role="dialog" aria-modal="true" aria-labelledby="bc-modal-name">' +
      '<img class="bc-modal-mark" src="' + CROWN + '" alt="" aria-hidden="true">' +
      '<span class="bc-modal-grain" aria-hidden="true"></span>' +
      '<button type="button" class="bc-modal-close" aria-label="Fermer">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
        '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '<div class="bc-modal-head">' +
        '<span class="bc-modal-tile"><img src="' + ICON + '" alt="" aria-hidden="true"></span>' +
        '<div>' +
          '<p class="bc-modal-eyebrow">L\'application</p>' +
          '<h2 class="bc-modal-name" id="bc-modal-name">Barber Club+</h2>' +
        '</div>' +
      '</div>' +
      '<p class="bc-modal-lead">Ce que le site ne fait pas</p>' +
      '<ul class="bc-modal-list">' +
        row(0, 'Cumulez des points', 'Votre fidélité compte à chaque passage.') +
        row(1, 'Débloquez des récompenses', 'Vos points s\'échangent contre des avantages.') +
        row(2, 'Montez en rang', 'De Bronze à Platine, jusqu\'au meilleur rang du club.') +
      '</ul>' +
      '<a class="bc-modal-cta" href="' + href + '" target="_blank" rel="noopener">' +
        GLYPH + '<span>Télécharger</span></a>' +
      '<p class="bc-modal-store">Sur ' + label + '</p>' +
    '</div></div>';
  document.body.appendChild(modal);

  var panel = modal.querySelector('.bc-modal-panel');
  var closeBtn = modal.querySelector('.bc-modal-close');
  var cta = modal.querySelector('.bc-modal-cta');
  var lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    el.classList.add('is-hidden');
    document.documentElement.style.overflow = 'hidden';
    // Un rendu avant d'ajouter la classe, sinon la transition ne part pas.
    requestAnimationFrame(function () {
      modal.classList.add('is-open');
      closeBtn.focus();
    });
  }

  function close() {
    modal.classList.remove('is-open');
    el.classList.remove('is-hidden');
    document.documentElement.style.overflow = '';
    setTimeout(function () { modal.hidden = true; }, 420);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  el.addEventListener('click', open);
  closeBtn.addEventListener('click', function () { rememberModal('dismissed'); close(); });
  cta.addEventListener('click', function () { rememberModal('installed'); });
  // Un clic à côté ne ferme pas : on sort par la croix.
  modal.querySelector('.bc-modal-veil').addEventListener('click', function (e) { e.stopPropagation(); });

  // Piège de focus. Échap reste actif : une modale sans issue au clavier
  // enferme les personnes qui n'utilisent pas de souris.
  modal.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { rememberModal('dismissed'); close(); return; }
    if (e.key !== 'Tab') return;
    var focusables = [closeBtn, cta];
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ── Trouver sa place en bas d'écran ───────────────────────────────
  // Deux choses se disputent ce coin : le bandeau cookies (fixé tout en bas)
  // et la grille de navigation des hubs salon. Le badge se pose au-dessus
  // des deux — réserver reste le geste de la page.
  var nav = document.querySelector('.nav-row');

  function place() {
    var bottom = window.innerWidth <= 560 ? 16 : 22;

    var banner = document.getElementById('bc-cookie-banner');
    if (banner) {
      var rb = banner.getBoundingClientRect();
      if (rb.height) bottom = Math.max(bottom, Math.round(window.innerHeight - rb.top) + 12);
    }
    if (nav) {
      var rn = nav.getBoundingClientRect();
      if (rn.height && rn.top >= window.innerHeight / 2) {
        bottom = Math.max(bottom, Math.round(window.innerHeight - rn.top + 14));
      }
    }
    el.style.bottom = bottom + 'px';
  }

  window.addEventListener('resize', place);
  setTimeout(function () { place(); el.classList.add('is-in'); }, DELAY);
  new MutationObserver(place).observe(document.body, { childList: true });

  // ── Ouverture à l'arrivée, après l'écran de chargement ────────────
  // La landing joue une intro de 2,4 s puis pose la classe `done` sur
  // `.intro`. On l'attend plutôt que de deviner une durée — et s'il n'y a
  // pas d'intro (les autres pages), on ouvre après un temps de pose.
  if (autoOpen) {
    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      setTimeout(function () { if (modal.hidden) open(); }, 900);
    }

    var intro = document.querySelector('.intro');
    if (!intro || intro.classList.contains('done') ||
        getComputedStyle(intro).display === 'none') {
      fire();
    } else {
      var watcher = new MutationObserver(function () {
        if (intro.classList.contains('done')) { watcher.disconnect(); fire(); }
      });
      watcher.observe(intro, { attributes: true, attributeFilter: ['class'] });
      // Garde-fou : si l'intro ne se terminait jamais, on n'attendrait pas
      // indéfiniment. 7 s couvre largement les 2,4 s prévues.
      setTimeout(function () { watcher.disconnect(); fire(); }, 7000);
    }
  }

  // ── Aimantation, inclinaison, reflet ──────────────────────────────
  // Souris fine seulement : au doigt il n'y a ni survol ni approche.
  if (!fine || calm) return;

  var tile = el.querySelector('.bc-app-tile');
  var frame = null;

  function reset() {
    el.style.setProperty('--tx', '0px');
    el.style.setProperty('--ty', '0px');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.transition = 'opacity 500ms ease, transform 520ms cubic-bezier(0.16,1,0.3,1)';
  }
  reset();

  document.addEventListener('mousemove', function (e) {
    if (frame || !modal.hidden) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      var r = tile.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2);
      var dy = e.clientY - (r.top + r.height / 2);
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MAGNET_RADIUS) { reset(); return; }

      var force = 1 - dist / MAGNET_RADIUS;
      el.style.transition = 'opacity 500ms ease, transform 220ms cubic-bezier(0.16,1,0.3,1)';
      el.style.setProperty('--tx', (dx * MAGNET_PULL * force).toFixed(1) + 'px');
      el.style.setProperty('--ty', (dy * MAGNET_PULL * force).toFixed(1) + 'px');

      var px = (e.clientX - r.left) / r.width;
      var py = (e.clientY - r.top) / r.height;
      if (px >= 0 && px <= 1 && py >= 0 && py <= 1) {
        el.style.setProperty('--ry', ((px - 0.5) * 26).toFixed(1) + 'deg');
        el.style.setProperty('--rx', ((0.5 - py) * 26).toFixed(1) + 'deg');
        el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      } else {
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      }
    });
  }, { passive: true });

  window.addEventListener('blur', reset);
})();
