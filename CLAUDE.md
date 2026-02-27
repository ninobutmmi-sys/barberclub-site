# BarberClub — Ligne Directrice Projet

> Site vitrine + systeme de reservation custom + dashboard admin pour BarberClub, salon de barbier premium a Meylan/Corenc (pres de Grenoble). Remplace Timify (~200$/mois).

**Proprietaire/Dev** : Nino — prefere le francais, reponses concises, dark theme.

---

## Architecture

| Composant | Tech | Port | Commande | URL dev |
|-----------|------|------|----------|---------|
| **Site vitrine** | HTML/CSS/JS vanilla (PWA) | 5500 | `npx serve -l 5500` | `http://localhost:5500` |
| **Backend API** | Node.js 18+ / Express 4 / PostgreSQL | 3000 | `cd backend && npm run dev` | `http://localhost:3000/api` |
| **Dashboard admin** | React 19 + Vite 6 + React Router 7 | 5174 | `cd dashboard && npm run dev` | `http://localhost:5174` |
| **Base de donnees** | PostgreSQL (Supabase cloud) | — | — | — |
| **Email + SMS** | Brevo (ex-Sendinblue) | — | — | — |

---

## Stack technique detaillee

### Backend (Node.js/Express)

| Dependance | Version | Role |
|------------|---------|------|
| express | ^4.21.2 | Framework web |
| pg | ^8.13.1 | Client PostgreSQL |
| bcrypt | ^5.1.1 | Hash mots de passe (12 rounds) |
| jsonwebtoken | ^9.0.2 | Auth JWT |
| node-cron | ^3.0.3 | Taches planifiees |
| express-rate-limit | ^7.5.0 | Rate limiting |
| express-validator | ^7.2.1 | Validation input |
| cors | ^2.8.5 | Cross-origin |
| helmet | ^8.0.0 | Headers securite |
| winston | ^3.17.0 | Logging |
| uuid | ^11.1.0 | Generation UUIDs |
| dotenv | ^16.4.7 | Variables d'env |

### Dashboard (React)

| Dependance | Version | Role |
|------------|---------|------|
| react | ^19.0.0 | UI framework |
| react-dom | ^19.0.0 | DOM rendering |
| react-router-dom | ^7.1.0 | Routing (HashRouter) |
| date-fns | ^4.1.0 | Manipulation dates |
| date-fns-tz | ^3.2.0 | Fuseaux horaires |
| vite | ^6.0.0 | Build tool |
| @vitejs/plugin-react | ^4.3.0 | JSX support |

### Services externes

| Service | Usage | Config |
|---------|-------|--------|
| **Brevo** | Email transactionnel + SMS | API REST, sender `BARBERCLUB` |
| **Supabase** | PostgreSQL cloud (BDD) | Via `DATABASE_URL` |
| **Railway** | Hebergement backend (prod) | Hobby ~5euros/mois |
| **Cloudflare Pages** | Hebergement site + dashboard | Gratuit |
| **OVH** | Domaine `barberclub-grenoble.fr` | Deja achete |
| **Google Business** | Avis clients (lien review) | Via `GOOGLE_REVIEW_URL` |

---

## Structure des fichiers

```
BarberClub Site/
├── index.html                     # Landing — choix salon Grenoble / Meylan
├── sw.js                          # Service Worker PWA (cache network-first)
├── .htaccess                      # Apache (HTTPS, gzip, cache, securite)
├── CLAUDE.md                      # Ce fichier — ligne directrice
│
├── pages/
│   ├── meylan/                    # Salon Meylan (reservation custom)
│   │   ├── index.html             # Hub navigation salon
│   │   ├── reserver.html          # Interface reservation 4 etapes (3900 lignes)
│   │   ├── mon-rdv.html           # Mes reservations client (consulter/annuler)
│   │   ├── reset-password.html    # Reset mot de passe client
│   │   ├── barbers.html           # Equipe (Lucas, Julien)
│   │   ├── prestations.html       # Services & tarifs
│   │   ├── galerie.html           # Photos salon
│   │   └── contact.html           # Adresse, horaires, carte Leaflet
│   │
│   ├── grenoble/                  # Salon Grenoble (vitrine, PAS de booking custom)
│   │   ├── index.html             # Hub salon
│   │   ├── reserver.html          # Iframe Timify (booking externe)
│   │   ├── barbers.html           # Equipe (Tom, Alan, Nathan, Clement)
│   │   ├── prestations.html       # Services & tarifs
│   │   ├── galerie.html           # Photos salon
│   │   └── contact.html           # Adresse, horaires, carte
│   │
│   ├── barbers/                   # Pages individuelles (6 barbers)
│   │   └── barber-{lucas,julien,tom,alan,nathan,clement}.html
│   │
│   ├── 404.html                   # Page 404
│   └── legal/                     # Pages legales (100% francais, obligation legale)
│       ├── cgu.html
│       ├── mentions-legales.html
│       └── politique-confidentialite.html
│
├── assets/
│   ├── fonts/                     # Orbitron-ExtraBold.ttf + Variable
│   ├── icons/                     # Icones PWA (72→512px) + favicon.png
│   ├── images/
│   │   ├── common/                # logo-blanc.png, logo.png, couronne.png
│   │   ├── barbers/               # Portraits (lucas.png, julien.jpg, etc.)
│   │   └── salons/{grenoble,meylan}/  # Photos salons (JPG + WebP)
│   ├── videos/
│   │   ├── barbers/               # Videos presentation (6x MP4)
│   │   └── Barbers-coupes/        # Portfolio coupes par barber
│   └── js/booking-modal.js        # Modal politique annulation
│
├── config/
│   ├── manifest.json              # PWA manifest (standalone, portrait)
│   ├── robots.txt                 # SEO (Sitemap, Crawl-delay: 1)
│   └── sitemap.xml                # 20+ URLs, lastmod 2026-02-22
│
├── .wrangler/                     # Cache Cloudflare Pages CLI
│
├── backend/
│   ├── .env                       # Secrets (NE PAS COMMIT)
│   ├── .env.example               # Template
│   ├── package.json
│   ├── database/
│   │   ├── schema.sql             # Schema complet
│   │   ├── seed.sql               # Donnees initiales
│   │   └── migrations/            # 003 → 014 (12 migrations)
│   └── src/
│       ├── index.js               # Entry (routes, CORS, helmet, cron)
│       ├── config/
│       │   ├── env.js             # Parsing .env
│       │   └── database.js        # Pool pg (max 20, SSL prod, type parsers)
│       ├── middleware/
│       │   ├── auth.js            # JWT (access 15min, refresh 90j)
│       │   ├── rateLimiter.js     # public 60/min, auth 10/15min, admin 200/min
│       │   └── validate.js        # express-validator
│       ├── routes/
│       │   ├── health.js          # GET /api/health
│       │   ├── auth.js            # login, register, refresh, logout, forgot/reset
│       │   ├── bookings.js        # Public : barbers, services, availability, CRUD
│       │   ├── client.js          # Client connecte : profil, mes RDV
│       │   └── admin/             # 14 fichiers routes admin
│       ├── services/
│       │   ├── availability.js    # Calcul creneaux (30min public, 5min admin)
│       │   ├── booking.js         # Creation atomique, annulation, recurrence
│       │   └── notification.js    # Brevo email+SMS, queue+retry, templates HTML
│       ├── cron/                   # 6 jobs planifies (prod only)
│       └── utils/                  # ApiError, logger Winston, .ics generator
│
└── dashboard/
    ├── package.json
    ├── vite.config.js             # Port 5174, ES2018
    ├── index.html                 # Entry HTML
    └── src/
        ├── App.jsx                # Routes (HashRouter)
        ├── api.js                 # Client API centralise (auto-refresh JWT sur 401)
        ├── auth.jsx               # AuthContext (localStorage: bc_user, bc_access/refresh_token)
        ├── index.css              # Theme dark (2134 lignes, 100+ CSS variables)
        ├── components/
        │   ├── Layout.jsx         # Sidebar 240px + bottom nav mobile + notif bell
        │   └── SearchBar.jsx
        ├── hooks/
        │   ├── useMobile.js       # Breakpoint 1024px
        │   └── useNotifications.js # Poll /admin/bookings toutes les 30s
        ├── utils/csv.js           # Export CSV (UTF-8 BOM)
        └── pages/                 # 14 pages (Login, Planning, Analytics, Clients, etc.)
```

---

## Base de donnees — 18 tables

| Table | Description | Cles importantes |
|-------|-------------|------------------|
| **barbers** | Comptes staff | UUID, email UNIQUE, password_hash, is_active, failed_login_attempts, locked_until |
| **services** | Catalogue prestations | UUID, price (centimes!), duration (min), color (hex), sort_order |
| **barber_services** | Pivot barber↔service | PK(barber_id, service_id) |
| **schedules** | Horaires hebdo | barber_id, day_of_week (0=Lundi!), start/end_time, is_working |
| **schedule_overrides** | Exceptions/vacances | barber_id, date, is_day_off, reason |
| **clients** | Profils clients | UUID, phone UNIQUE, has_account, review_requested, reset_token |
| **bookings** | Reservations | UUID, status, price (centimes), cancel_token, recurrence_group_id, rescheduled |
| **blocked_slots** | Creneaux bloques | type (break/personal/closed), reason |
| **notification_queue** | File d'attente notifs | type, status (pending/sent/failed), attempts, next_retry_at |
| **refresh_tokens** | Sessions JWT | user_type (barber/client), token UNIQUE, expires_at |
| **payments** | Transactions caisse | amount (centimes), method (cb/cash/lydia/other) |
| **register_closings** | Clotures de caisse | date UNIQUE, totaux par methode |
| **products** | Boutique stock | buy_price, sell_price, stock_quantity, alert_threshold |
| **product_sales** | Ventes produits | product_id, quantity, payment_method |
| **gift_cards** | Cartes cadeaux | code UNIQUE (GC-XXXX-XXXX), balance, expires_at |
| **waitlist** | Liste d'attente | status (waiting/notified/booked/expired) |
| **campaigns** | Suivi campagnes | type (sms/email), tracking_code, ROI metrics |
| **automation_triggers** | Regles auto | type UNIQUE, config JSONB, is_active |

### Contraintes critiques
- `bookings_no_overlap` : UNIQUE (barber_id, date, start_time) WHERE status != 'cancelled'
- Booking statuses : `confirmed`, `completed`, `no_show`, `cancelled`
- RLS active sur toutes les tables (migration 014) — acces uniquement via backend

### Migrations appliquees (003 → 014)
003 blocked_slots, 004 cash_register, 005 service_colors, 006 recurrence, 007 stocks_and_features, 008 reset_token, 009 review_requested, 010 rescheduled_flag, 011 fix_julien_email, 012 booking_color, 013 client_login_columns, 014 enable_rls

---

## Brevo — Integration Email + SMS

### Configuration
| Param | Valeur |
|-------|--------|
| Sender Email | `noreply@barberclub-grenoble.fr` (DNS SPF/DKIM requis) |
| Sender Name | `BarberClub Meylan` |
| Sender SMS | `BARBERCLUB` (alphanumeric sender ID) |
| API | REST `https://api.brevo.com/v3/` via `BREVO_API_KEY` |
| Cout SMS | ~0.045euros/SMS |
| Emails gratuits | 300/jour |

### Templates email (HTML inline, design monochrome dark)
| Template | Declencheur | Contenu |
|----------|-------------|---------|
| Confirmation | Creation booking | Recap + lien annulation + .ics |
| Review Google | Cron 10h (J+1 completed) | Merci + bouton avis |
| Annulation | Client ou admin annule | Confirmation annulation |

### SMS
| Type | Declencheur | Contenu |
|------|-------------|---------|
| Rappel J-1 | Cron 18h la veille | `BarberClub - Rappel RDV le...` |
| Review Google | Automation 60min post-coupe | `Merci ! Laisse un avis...` (1x par client a vie) |
| Reactivation | Automation inactif 45j+ | `Ca fait un moment ! Ton barber t'attend...` |

### Design tokens emails
```
DARK_BG: #0C0A09 | CARD_BG: #1C1917 | CARD_BORDER: #292524
TEXT_PRIMARY: #FAFAF9 | TEXT_SECONDARY: #A8A29E | TEXT_MUTED: #78716C
```
Assets heberges : `https://barberclub-site.pages.dev/assets/images/`

---

## Cron jobs (production uniquement)

| Frequence | Job | Description |
|-----------|-----|-------------|
| */2 min | processQueue | Retry notifications (backoff 5→15→60 min, max 3) |
| */10 min | automationTriggers | Auto-complete bookings passes + review SMS + reactivation + waitlist |
| 18h daily | queueReminders | SMS rappels pour demain |
| 10h daily | queueReviewRequests | Email avis Google (J+1 completed) |
| 03h00 | cleanup notifications | Supprime notifs >30j |
| 03h30 | cleanup tokens | Supprime refresh tokens expires |

Monitoring via `GET /api/admin/system/status` (in-memory cronStatus)

---

## Authentification

| Param | Valeur |
|-------|--------|
| Access token | JWT 15 min (`JWT_SECRET`) |
| Refresh token | JWT 90 jours (`JWT_REFRESH_SECRET`), stocke en BDD |
| Hash | Bcrypt 12 rounds |
| Brute force | 5 tentatives → lockout 15 min (barbers + clients) |
| Login barber | `POST /api/auth/login { email, password, type: "barber" }` |
| Dashboard auto-refresh | Sur 401 → refresh token → retry request → sinon logout |
| Storage dashboard | `bc_user`, `bc_access_token`, `bc_refresh_token` (localStorage) |
| Credentials test | `admin@admin.com` / `admin` |

---

## API — URLs de production

| Composant | URL |
|-----------|-----|
| Backend Railway | `https://fortunate-benevolence-production-7df2.up.railway.app/api` |
| Site Cloudflare | `https://barberclub-site.pages.dev` |
| Dashboard Cloudflare | (a deployer sur `gestion.barberclub-grenoble.fr`) |
| Domaine final | `barberclub-grenoble.fr` / `api.barberclub-grenoble.fr` |

Detection auto dans le code : `window.location.hostname === 'localhost'` → dev / sinon → prod

---

## Design System

### Site vitrine
| Propriete | Valeur |
|-----------|--------|
| Fond | Noir pur `#000` |
| Texte | Blanc `#fff` |
| Font titres | Orbitron ExtraBold (`assets/fonts/`) |
| Font corps | Inter (Google Fonts) |
| Glassmorphism | `rgba(255,255,255,0.04-0.15)` + `backdrop-filter: blur(20-60px)` |
| Bordures | `rgba(255,255,255,0.06-0.15)` |
| Active | `scale(0.95-0.97)` |
| Transitions | `0.3s cubic-bezier(0.4, 0, 0.2, 1)` |
| Breakpoint | 768px mobile |
| CSS | **Inline dans chaque page** (pas de fichier externe partage) |
| Images | JPG + WebP pairs |
| PWA | Service Worker network-first + manifest standalone |

### Dashboard admin
| Propriete | Valeur |
|-----------|--------|
| Theme dark | `--bg: #0a0a0a`, `--bg-card: #111113` |
| Theme light | Toggle disponible (`bc_theme` localStorage) |
| Sidebar | 240px (collapsible → 64px), bottom nav mobile |
| Breakpoint | 1024px (`useMobile()` hook) |
| State | React hooks (useState, useContext) — PAS de Redux |
| CSS | `index.css` 2134 lignes, 100+ variables CSS |
| Anti-zoom iOS | `font-size: 16px !important` sur inputs (<1024px) |
| SEO | `noindex/nofollow` (admin seulement) |

---

## Regles metier

### Reservation
- **Prix en centimes** : 2700 = 27,00euros. Frontend fait `/ 100`
- **Creneaux** : 30 min d'intervalle (public), 5 min (admin)
- **Avance max** : 6 mois
- **Annulation** : minimum 12h avant le RDV
- **Double-booking** : index UNIQUE + `SELECT...FOR UPDATE` (row lock)
- **"Peu importe" le barber** : load balancing (moins de RDV ce jour)
- **Recurrence** : weekly/biweekly/monthly, max 52 occurrences, skip conflits

### Convention day_of_week
- **0 = Lundi, 6 = Dimanche** (PAS la convention JS ou 0=Dimanche)

### Horaires barbers (Meylan)
- **Lucas** : repos Lundi + Dimanche, travaille Mardi→Samedi 9h-19h
- **Julien** : repos Samedi + Dimanche, travaille Lundi→Vendredi 9h-19h (Mercredi 13h-19h)

### Salons
- **Meylan** : Systeme complet (reservation custom + dashboard + backend)
- **Grenoble** : Vitrine seulement, reservation via Timify (externe)

---

## Deploiement

### Hebergement

| Service | Hebergeur | Cout | Status |
|---------|-----------|------|--------|
| Backend + BDD | Railway Hobby | ~5euros/mois | Deploye |
| Site vitrine | Cloudflare Pages | Gratuit | Deploye (`barberclub-site.pages.dev`) |
| Dashboard | Cloudflare Pages | Gratuit | A deployer |
| Email | Brevo | Gratuit (300/j) | Configure |
| SMS | Brevo | ~0.045euros/SMS | Configure |
| Domaine | OVH | Deja achete | `barberclub-grenoble.fr` |

### Wrangler / Cloudflare Pages
- `.wrangler/` dans le projet pour le cache CLI Cloudflare
- Build site : static files (pas de build step)
- Build dashboard : `npm run build` → `dist/`

### Variables d'env production
```
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://...@railway/postgres
JWT_SECRET=<256-bit>
JWT_REFRESH_SECRET=<256-bit>
CORS_ORIGINS=https://barberclub-grenoble.fr,https://gestion.barberclub-grenoble.fr,https://barberclub-site.pages.dev
BREVO_API_KEY=xkeysib-...
BREVO_SENDER_EMAIL=noreply@barberclub-grenoble.fr
BREVO_SENDER_NAME=BarberClub Meylan
BREVO_SMS_SENDER=BARBERCLUB
GOOGLE_REVIEW_URL=https://g.page/r/...
SITE_URL=https://barberclub-grenoble.fr
API_URL=https://api.barberclub-grenoble.fr
SALON_NAME=BarberClub Meylan
SALON_ADDRESS=26 Av. du Gresivaudan, 38700 Corenc
SALON_PHONE=+33xxxxxxxxx
```

### DNS prevu
| Sous-domaine | Pointe vers |
|-------------|-------------|
| `barberclub-grenoble.fr` | Cloudflare Pages (site) |
| `gestion.barberclub-grenoble.fr` | Cloudflare Pages (dashboard) |
| `api.barberclub-grenoble.fr` | Railway |

---

## Bugs connus et fixes appliques

| Bug | Fix | Fichier |
|-----|-----|---------|
| DATE PostgreSQL → Date JS (timezone) | `types.setTypeParser(1082, val => val)` | database.js |
| day_of_week 0=Lundi vs JS 0=Dimanche | Conversion explicite | availability.js |
| TIME retourne `HH:MM:SS` | `.slice(0,5)` avant comparaison | Partout |
| UUIDs seed non-standard | `.matches(uuidRegex)` au lieu de `.isUUID()` | Toutes routes |
| `.isDate({ format })` ne marche pas | `.matches(/^\d{4}-\d{2}-\d{2}$/)` | Routes bookings |
| Trust proxy manquant | `app.set('trust proxy', 1)` | index.js |
| XSS dans emails | `escapeHtml()` sur champs clients | notification.js |
| Race condition double-booking | `SELECT...FOR UPDATE` row lock | booking.js |
| Retry explosif | Backoff exponentiel (5→15→60 min), max 3 | notification.js |
| Rate limiter bypassable | `keyGenerator` par IP+email | rateLimiter.js |
| Dates passees/futures >6 mois | Validation 400 avec ApiError | bookings.js |

---

## Roadmap deploiement

### Phase 1 — Test Brevo (en cours)
- [ ] Recharger compte Brevo (100 SMS/emails)
- [ ] Tester tous les types de notifications (confirmation, rappel, review, annulation, relance)
- [ ] Tester retry queue

### Phase 2 — Finalisation Railway
- [ ] Configurer DNS SPF/DKIM pour barberclub-grenoble.fr
- [ ] Configurer `API_URL` propre (`api.barberclub-grenoble.fr`)

### Phase 3 — Deploy Cloudflare Pages
- [ ] Deploy dashboard sur Cloudflare Pages
- [ ] Configurer Cloudflare Access (whitelist emails) si besoin
- [ ] Bascule DNS `barberclub-grenoble.fr` + `gestion.barberclub-grenoble.fr`
- [ ] Mettre a jour CORS_ORIGINS

---

## Notes pour Claude

1. **Ne PAS ouvrir en `file://`** — Toujours `localhost`, sinon CORS bloque
2. **Prix en centimes** — 2700 = 27,00euros. Frontend fait `/ 100`
3. **UUIDs seed non-standards** — Toujours `.matches(uuidRegex)`, JAMAIS `.isUUID()`
4. **day_of_week** — 0=Lundi en BDD, PAS 0=Dimanche comme JS
5. **CSS inline** — Chaque page HTML a son `<style>` integre, pas de CSS externe partage
6. **Grenoble** — Vitrine seulement, reservation via Timify (externe)
7. **Meylan** — Systeme complet (reservation + dashboard + backend)
8. **Backend `--watch`** — Modifications auto-rechargees en dev
9. **Pages legales** — 100% francais obligatoire
10. **Chemins relatifs** — Depuis `pages/*/` : assets = `../../assets/`, legal = `../legal/`
11. **Crons** — Desactives en dev (`NODE_ENV !== production`)
12. **HashRouter** — Dashboard utilise `#` dans les URLs (pas besoin de config serveur)
13. **Brevo** — Templates email HTML inline dans `notification.js`, design monochrome dark
