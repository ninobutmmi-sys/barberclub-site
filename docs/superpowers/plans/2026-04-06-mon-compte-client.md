# Mon Compte Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une page "Mon Compte" sur le site vitrine permettant aux clients de créer un compte fidélité, se connecter, et gérer leurs RDV sans dépendre du cancel_token par email.

**Architecture:** Page vanilla HTML/CSS/JS (comme tout le site), consommant les endpoints backend existants (`/api/auth/login`, `/api/auth/register`, `/api/client/bookings`, `/api/client/profile`). Aucune modification backend nécessaire. Une page par salon (`pages/meylan/mon-compte.html`, `pages/grenoble/mon-compte.html`) avec SALON_ID hardcodé. Auth tokens stockés en localStorage (`bc_client_*`).

**Tech Stack:** HTML5, CSS3 (glassmorphism, animations), Vanilla JS (ES6+), API REST existante

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `assets/css/mon-compte.css` | Styles de la page Mon Compte (auth forms, booking cards, profile, tabs, animations) |
| Create | `pages/meylan/mon-compte.html` | Page Mon Compte salon Meylan (HTML + JS inline, SALON_ID='meylan') |
| Create | `pages/grenoble/mon-compte.html` | Page Mon Compte salon Grenoble (copie avec SALON_ID='grenoble') |
| Modify | `pages/meylan/index.html` | Ajouter lien "Mon compte" dans la nav du hub salon |
| Modify | `pages/grenoble/index.html` | Ajouter lien "Mon compte" dans la nav du hub salon |
| Modify | `assets/css/salon-hub.css` | Style pour le nouveau nav-item si nécessaire |

---

### Task 1: Créer le CSS — `assets/css/mon-compte.css`

**Files:**
- Create: `assets/css/mon-compte.css`

Ce fichier contient TOUS les styles de la page. Il requiert `base.css` chargé en premier (grain, cursor, page-transition, focus-visible, skip-to-content).

- [ ] **Step 1: Créer le fichier CSS avec les styles de base (header, container, states)**

Patterns à suivre depuis `mon-rdv.css` :
- Header sticky avec blur : `background: rgba(0,0,0,0.95); backdrop-filter: blur(20px);`
- Container : `max-width: 480px; margin: 0 auto; padding: 24px 16px;`
- States : `.state { display: none; } .state.active { display: block; }`
- Spinner : identique à mon-rdv.css
- Font titres : `font-family: 'Orbitron', sans-serif; font-weight: 800; text-transform: uppercase;`

- [ ] **Step 2: Ajouter les styles du formulaire auth (login + register)**

Design glassmorphism cohérent avec le site :
- Input fields : `background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; color: #fff; font-size: 16px;` (16px obligatoire iOS anti-zoom)
- Labels : `font-size: 12px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.08em;`
- Bouton principal : fond blanc, texte noir, Orbitron, uppercase (comme `.btn-reschedule` dans mon-rdv.css)
- Bouton secondaire : fond transparent, bordure blanche subtile
- Lien toggle (login/register) : `color: rgba(255,255,255,0.5); text-decoration: underline;`
- Erreur : `color: #ef4444; font-size: 13px;`
- Password toggle (oeil) : bouton dans l'input, `position: absolute; right: 16px;`

- [ ] **Step 3: Ajouter les styles des tabs (Mes RDV / Mon Profil)**

- Container tabs : `display: flex; gap: 0; border-bottom: 1px solid rgba(255,255,255,0.08);`
- Tab button : `flex: 1; padding: 14px; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.4); background: none; border: none; border-bottom: 2px solid transparent; transition: all 0.3s;`
- Tab active : `color: #fff; border-bottom-color: #fff;`

- [ ] **Step 4: Ajouter les styles des booking cards (upcoming + past)**

Cards identiques à `mon-rdv.css` (`.booking-card`) avec ajouts :
- Card prochain RDV : bordure dorée subtile `border-color: rgba(202,138,4,0.3);` + badge "Prochain RDV" doré
- Badge prochain : `background: rgba(202,138,4,0.12); color: #ca8a04; font-size: 11px; padding: 3px 10px; border-radius: 20px;`
- Cards historique : style atténué `opacity: 0.7;`
- Empty state : `color: rgba(255,255,255,0.3); font-size: 14px; padding: 40px 0; text-align: center;`
- Status badges : réutiliser les classes de mon-rdv.css (`.confirmed`, `.completed`, `.cancelled`, `.no_show`)
- Boutons actions dans la card : annuler (rouge), décaler (blanc), calendrier (gris)

- [ ] **Step 5: Ajouter les styles du profil**

- Info rows : mêmes `.detail-row` que mon-rdv.css
- Bouton déconnexion : rouge subtil comme `.btn-cancel`
- Bouton exporter données : gris discret
- Bouton supprimer compte : rouge fort, en bas, séparé par une ligne
- Confirmation dialog : identique à `#confirmOverlay` de mon-rdv.css

- [ ] **Step 6: Ajouter les animations staggered reveal**

```css
@keyframes fadeSlideUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
}
.fade-in { animation: fadeSlideUp 0.5s cubic-bezier(0.16,1,0.3,1) both; }
.fade-in:nth-child(1) { animation-delay: 0.05s; }
.fade-in:nth-child(2) { animation-delay: 0.1s; }
.fade-in:nth-child(3) { animation-delay: 0.15s; }
/* ... jusqu'à 8 */

@media (prefers-reduced-motion: reduce) {
    .fade-in { animation: none !important; opacity: 1; transform: none; }
}
```

- [ ] **Step 7: Ajouter les styles responsive (mobile-first)**

Breakpoint 768px pour desktop (léger widen du container, ajustements padding).
Vérifier : inputs 16px (anti-zoom iOS), touch targets 44px minimum, pas de scroll horizontal.

- [ ] **Step 8: Commit**

```bash
git add assets/css/mon-compte.css
git commit -m "feat: add mon-compte.css — styles for client loyalty account page"
```

---

### Task 2: Créer la page HTML Meylan — `pages/meylan/mon-compte.html`

**Files:**
- Create: `pages/meylan/mon-compte.html`

Structure HTML suivant les patterns du site (base.css, grain, cursor, page-transition, skip-to-content, header sticky). Le JS est inline dans `<script>` en bas (comme mon-rdv.html, reserver.html).

- [ ] **Step 1: Créer le squelette HTML (head, body, header, states)**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Mon espace fidélité BarberClub — gérer mes rendez-vous">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#000000">
    <title>Mon Compte | BarberClub</title>
    <link rel="icon" type="image/png" sizes="96x96" href="../../assets/icons/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="dns-prefetch" href="https://api.barberclub-grenoble.fr">
    <link rel="preconnect" href="https://api.barberclub-grenoble.fr" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../../assets/css/base.css">
    <link rel="stylesheet" href="../../assets/css/mon-compte.css">
</head>
<body>
    <div class="grain" aria-hidden="true"></div>
    <div class="page-transition" aria-hidden="true"></div>
    <div class="cursor-dot" aria-hidden="true"></div>
    <div class="cursor-ring" aria-hidden="true"></div>
    <a href="#main-content" class="skip-to-content">Aller au contenu principal</a>
    <!-- Header sticky -->
    <!-- States: stateLoading, stateAuth, stateAccount -->
    <!-- Confirm dialogs -->
    <script src="../../assets/js/api-config.js"></script>
    <script>/* inline JS */</script>
</body>
</html>
```

Les 3 states principaux :
- `stateLoading` : spinner (vérification session existante)
- `stateAuth` : formulaires login/register (toggle entre les deux)
- `stateAccount` : espace connecté (tabs Mes RDV / Mon Profil)

- [ ] **Step 2: Coder le HTML du state Auth (login + register forms)**

Header avec bouton retour vers `./` (comme mon-rdv.html).

**Écran d'accueil auth :**
- Logo couronne + "BarberClub" en Orbitron
- Sous-titre "Espace fidélité"
- Formulaire login visible par défaut :
  - Input email (type="email", autocomplete="email")
  - Input password (type="password", autocomplete="current-password") + toggle oeil
  - Bouton "Se connecter" (Orbitron, blanc)
  - Lien "Mot de passe oublié ?" vers `reset-password.html`
  - Séparateur "—"
  - Lien "Créer mon compte fidélité"
- Formulaire register (caché par défaut) :
  - Input prénom (autocomplete="given-name")
  - Input nom (autocomplete="family-name")
  - Input téléphone (type="tel", autocomplete="tel") — utiliser `phone-country.js` comme reserver.html
  - Input email (type="email", autocomplete="email")
  - Input password + toggle oeil + indicateur force
  - Bouton "Créer mon compte" (Orbitron, blanc)
  - Lien "Déjà un compte ? Se connecter"
- Div erreur (caché par défaut)

- [ ] **Step 3: Coder le HTML du state Account (Mes RDV + Mon Profil)**

**Header connecté :** "BarberClub" + nom du client à droite + bouton déconnexion (icône)

**Tabs :**
- Tab "Mes RDV" (active par défaut)
- Tab "Mon Profil"

**Contenu Mes RDV :**
- Section "Prochain rendez-vous" (1 card max, glow doré)
  - Badge "PROCHAIN RDV" doré
  - Barber, prestation, date, horaire, prix
  - Boutons : Décaler / Annuler / Ajouter au calendrier
- Section "Historique" (cards passées, atténuées)
  - Chaque card : badge status, barber, prestation, date, horaire
- Empty state si aucun RDV
- Bouton "Prendre un RDV" en bas (lien vers reserver.html)

**Contenu Mon Profil :**
- Initiales dans un cercle (avatar placeholder)
- Infos : prénom, nom, téléphone, email, membre depuis
- Bouton "Exporter mes données" (RGPD Art. 20)
- Séparateur
- Bouton "Supprimer mon compte" (rouge, RGPD Art. 17, demande mot de passe)
- Bouton "Se déconnecter"

**Dialogs :**
- Confirmation annulation RDV (même que mon-rdv.html)
- Confirmation suppression compte (demande mot de passe)

- [ ] **Step 4: Coder le JavaScript — module Auth (login, register, session)**

```javascript
const API = window.BARBERCLUB_API;
const SALON_ID = 'meylan';

// Storage keys (prefixed to avoid collision with dashboard)
const KEYS = {
    accessToken: 'bc_client_access_token',
    refreshToken: 'bc_client_refresh_token',
    user: 'bc_client_user',
};
```

Fonctions auth :
- `login(email, password)` : POST `/api/auth/login` avec `{ email, password, type: 'client' }`. Stocker tokens + user en localStorage. Afficher `stateAccount`.
- `register(data)` : POST `/api/auth/register` avec `{ first_name, last_name, phone, email, password }`. Stocker tokens + user. Afficher `stateAccount`.
- `logout()` : POST `/api/auth/logout`. Vider localStorage. Afficher `stateAuth`.
- `refreshToken()` : POST `/api/auth/refresh` avec `{ refresh_token }`. Mettre à jour l'access token.
- `authFetch(url, opts)` : wrapper fetch qui injecte `Authorization: Bearer <token>`, et sur 401, tente refresh puis retry (comme `dashboard/src/api.js`).
- `checkSession()` : au chargement, vérifier si un access_token existe en localStorage. Si oui, tenter `GET /api/client/profile` pour valider. Si 401, tenter refresh. Si échec, vider session et afficher login.

**IMPORTANT :** Les clés localStorage doivent être différentes de celles du dashboard (`bc_access_token`, `bc_user`) pour éviter les conflits. Utiliser le préfixe `bc_client_`.

- [ ] **Step 5: Coder le JavaScript — module Bookings (load, render, cancel, reschedule)**

Fonctions bookings :
- `loadBookings()` : `authFetch(GET /api/client/bookings?salon_id=${SALON_ID})`. Retourne `{ upcoming, past }`.
- `renderUpcoming(bookings)` : Si 1+ booking, afficher le premier avec style "prochain" (glow doré), les suivants en cards normales. Si 0, empty state.
- `renderPast(bookings)` : Liste de cards atténuées. Max 10 affichées, bouton "Voir plus" si davantage.
- `cancelBooking(id, token)` : POST `/api/bookings/${id}/cancel` avec `{ token, salon_id }`. Rafraîchir la liste.
- `formatDateFR(dateStr)` : identique à mon-rdv.html.
- `formatPrice(cents)` : identique à mon-rdv.html.
- `esc(str)` : escape HTML identique à mon-rdv.html.

Pour le reschedule : lien vers `mon-rdv.html?id=${booking.id}&token=${booking.cancel_token}` (réutiliser la page existante plutôt que re-coder le calendrier).

- [ ] **Step 6: Coder le JavaScript — module Profile (load, export, delete)**

Fonctions profil :
- `loadProfile()` : `authFetch(GET /api/client/profile)`. Afficher les infos.
- `renderProfile(profile)` : Initiales, détails, date inscription.
- `exportData()` : `authFetch(GET /api/client/export-data)`. Télécharger en JSON.
- `deleteAccount(password)` : `authFetch(DELETE /api/client/delete-account, { password })`. Vider session, afficher confirmation.

- [ ] **Step 7: Coder le JavaScript — initialisation et event listeners**

```javascript
// Init
(async () => {
    show('stateLoading');
    const session = await checkSession();
    if (session) {
        await loadAccountData();
        show('stateAccount');
    } else {
        show('stateAuth');
    }
})();
```

Event listeners :
- Toggle login/register
- Submit login form (Enter key + button click)
- Submit register form
- Tab switch (Mes RDV / Mon Profil)
- Cancel booking buttons (ouvre dialog confirmation)
- Confirm cancel dialog
- Export data button
- Delete account button (ouvre dialog avec input password)
- Logout button
- Password toggle (oeil)
- Cursor custom (réutiliser le pattern de base.css — les `.cursor-dot` et `.cursor-ring` sont gérés par base.css, mais le JS cursor tracking doit être ajouté dans la page)

**Pattern cursor JS** (copier depuis les autres pages) :
```javascript
// Custom cursor
if (!matchMedia('(pointer: coarse)').matches) {
    const dot = document.querySelector('.cursor-dot');
    const ring = document.querySelector('.cursor-ring');
    let mx = 0, my = 0, cx = 0, cy = 0;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
    (function loop() {
        cx += (mx - cx) * 0.15; cy += (my - cy) * 0.15;
        dot.style.left = mx + 'px'; dot.style.top = my + 'px';
        ring.style.left = cx + 'px'; ring.style.top = cy + 'px';
        requestAnimationFrame(loop);
    })();
    document.querySelectorAll('a, button, input, [role="button"]').forEach(el => {
        el.addEventListener('mouseenter', () => ring.classList.add('hovering'));
        el.addEventListener('mouseleave', () => ring.classList.remove('hovering'));
    });
}
```

- [ ] **Step 8: Tester la page localement**

```bash
npx serve -l 5500
# Ouvrir http://localhost:5500/pages/meylan/mon-compte.html
# Lancer le backend : cd backend && npm run dev
```

Vérifier :
1. Page se charge, spinner puis login form
2. Créer un compte (utiliser un numéro de test)
3. Se connecter
4. Voir les RDV (upcoming + past)
5. Aller sur "Mon Profil"
6. Se déconnecter
7. Se reconnecter (session persistée en localStorage)
8. Tester responsive mobile (DevTools 375px)

- [ ] **Step 9: Commit**

```bash
git add pages/meylan/mon-compte.html
git commit -m "feat: add Mon Compte client page — Meylan salon"
```

---

### Task 3: Créer la version Grenoble — `pages/grenoble/mon-compte.html`

**Files:**
- Create: `pages/grenoble/mon-compte.html`

- [ ] **Step 1: Copier la page Meylan et adapter**

```bash
cp pages/meylan/mon-compte.html pages/grenoble/mon-compte.html
```

Modifications :
- `const SALON_ID = 'grenoble';`
- Meta description : adapter si nécessaire
- Vérifier que les liens relatifs (`../../assets/`, `reserver.html`, `reset-password.html`, `./`) sont corrects (même structure de dossiers)

- [ ] **Step 2: Tester la page Grenoble**

```bash
# Ouvrir http://localhost:5500/pages/grenoble/mon-compte.html
```

- [ ] **Step 3: Commit**

```bash
git add pages/grenoble/mon-compte.html
git commit -m "feat: add Mon Compte client page — Grenoble salon"
```

---

### Task 4: Ajouter le lien dans la navigation des hubs salon

**Files:**
- Modify: `pages/meylan/index.html` (nav-row dans bottom-nav)
- Modify: `pages/grenoble/index.html` (même modification)

- [ ] **Step 1: Ajouter l'item "Mon compte" dans la nav du hub Meylan**

Dans `pages/meylan/index.html`, dans la `.nav-row`, ajouter un nav-item "Mon compte" avec une icône SVG user/profile. Le placer à côté de "Salon" (dernière position) ou remplacer "Offres" si non utilisé.

Icône SVG (user circle) :
```html
<a href="mon-compte.html" class="nav-item">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    Mon compte
</a>
```

- [ ] **Step 2: Ajouter l'item dans la nav du hub Grenoble**

Même modification dans `pages/grenoble/index.html`.

- [ ] **Step 3: Tester la navigation**

Vérifier que le lien s'affiche correctement dans la grille nav, que l'icône est alignée, et que le lien fonctionne.

- [ ] **Step 4: Commit**

```bash
git add pages/meylan/index.html pages/grenoble/index.html
git commit -m "feat: add Mon Compte link in salon hub navigation"
```

---

### Task 5: Test complet et deploy

- [ ] **Step 1: Test du flow complet**

Checklist de test :
1. Depuis le hub Meylan → clic "Mon compte" → page auth
2. Créer un compte avec un email/tel existant → upgrade guest vers account
3. Se connecter → voir ses RDV (upcoming en haut, passés en bas)
4. Cliquer "Annuler" sur un RDV futur → dialog confirmation → annulation OK
5. Cliquer "Décaler" → redirigé vers mon-rdv.html avec cancel_token
6. Cliquer "Ajouter au calendrier" → télécharge .ics
7. Aller sur "Mon Profil" → infos correctes
8. "Exporter mes données" → JSON téléchargé
9. "Se déconnecter" → retour login
10. Revenir sur la page → auto-login (session persistée)
11. Même test sur Grenoble
12. Test mobile 375px (responsive)
13. Test accessibilité (tab navigation, focus visible, aria-labels)

- [ ] **Step 2: Vérifier la checklist UI/UX Pro Max**

- [ ] Pas d'emojis comme icônes (SVG uniquement)
- [ ] `cursor-pointer` sur tous les éléments cliquables
- [ ] Hover states avec transitions smooth (150-300ms)
- [ ] Contraste texte 4.5:1 minimum
- [ ] Focus states visibles pour navigation clavier
- [ ] `prefers-reduced-motion` respecté
- [ ] Responsive : 375px, 768px, 1024px
- [ ] Inputs 16px (anti-zoom iOS)
- [ ] Touch targets 44px minimum

- [ ] **Step 3: Commit final et deploy**

```bash
# Deploy site vitrine
npx wrangler pages deploy . --project-name barberclub-site --branch production --commit-dirty=true
```
