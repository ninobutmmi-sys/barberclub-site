# BarberClub — Ligne Directrice Projet

> Site vitrine + systeme de reservation custom + dashboard admin pour BarberClub, 2 salons de barbier : Meylan/Corenc et Grenoble. Remplace Timify (~400euros/mois pour 2 salons).

**Proprietaire/Dev** : Nino — prefere le francais, reponses concises, dark theme.

---

## Architecture

| Composant | Tech | Port | Commande | URL dev |
|-----------|------|------|----------|---------|
| **Site vitrine** | HTML/CSS/JS vanilla (PWA) | 5500 | `npx serve -l 5500` | `http://localhost:5500` |
| **Backend API** | Node.js 18+ / Express 4 / PostgreSQL | 3000 | `cd backend && npm run dev` | `http://localhost:3000/api` |
| **Dashboard admin** | React 19 + Vite 6 + React Router 7 | 5174 | `cd dashboard && npm run dev` | `http://localhost:5174` |
| **Base de donnees** | PostgreSQL (Railway) | — | — | — |
| **Email + SMS** | Brevo (ex-Sendinblue) | — | — | — |

---

## Stack technique

### Backend (Node.js/Express)

| Dependance | Version | Role |
|------------|---------|------|
| express | ^4.21.2 | Framework web |
| pg | ^8.13.1 | Client PostgreSQL |
| bcrypt | ^6.0.0 | Hash mots de passe (12 rounds) |
| jsonwebtoken | ^9.0.2 | Auth JWT |
| node-cron | ^3.0.3 | Taches planifiees |
| express-rate-limit | ^7.5.0 | Rate limiting |
| express-validator | ^7.2.1 | Validation input |
| cors | ^2.8.5 | Cross-origin |
| helmet | ^8.0.0 | Headers securite |
| winston | ^3.17.0 | Logging |
| cookie-parser | ^1.4.7 | Cookies httpOnly |
| dotenv | ^16.4.7 | Variables d'env |

### Dashboard (React)

| Dependance | Version | Role |
|------------|---------|------|
| react | ^19.0.0 | UI framework |
| react-dom | ^19.0.0 | DOM rendering |
| react-router-dom | ^7.1.0 | Routing (HashRouter) |
| date-fns | ^4.1.0 | Manipulation dates |
| vite | ^6.0.0 | Build tool |
| @vitejs/plugin-react | ^4.3.0 | JSX support |

### Services externes

| Service | Usage | Config |
|---------|-------|--------|
| **Brevo** | Email transactionnel + SMS | API REST, sender `BARBERCLUB` |
| **Railway** | Hebergement backend + PostgreSQL (prod) | Hobby ~5euros/mois |
| **Cloudflare Pages** | Hebergement site + dashboard | Gratuit |
| **Squarespace** | Domaine `barberclub-grenoble.fr` | Pointe encore vers ancien site |
| **Google Business** | Avis clients (lien review) | Via `GOOGLE_REVIEW_URL` |

---

## Structure des fichiers

```
BarberClub Site/
|-- index.html                     # Landing — choix salon Grenoble / Meylan
|-- sw.js                          # Service Worker PWA (cache network-first)
|-- .htaccess                      # Apache (HTTPS, gzip, cache, securite)
|-- CLAUDE.md                      # Ce fichier — ligne directrice
|
|-- pages/
|   |-- meylan/                    # Salon Meylan (reservation custom)
|   |   |-- index.html             # Hub navigation salon (carousel barbers, nav grid, modal booking)
|   |   |-- reserver.html          # Interface reservation 4 etapes (~3900 lignes)
|   |   |-- mon-rdv.html           # Consulter/annuler/modifier RDV (via cancel_token)
|   |   |-- reset-password.html    # Reset mot de passe client
|   |   |-- barbers.html           # Equipe (Lucas, Julien)
|   |   |-- prestations.html       # Services & tarifs
|   |   |-- galerie.html           # Photos salon + avis Google
|   |   +-- contact.html           # Adresse, horaires, carte Leaflet, transports
|   |
|   |-- grenoble/                  # Salon Grenoble (reservation custom, meme systeme)
|   |   |-- index.html             # Hub salon
|   |   |-- reserver.html          # Interface reservation 4 etapes (custom, comme Meylan)
|   |   |-- mon-rdv.html           # Consulter/annuler/modifier RDV
|   |   |-- reset-password.html    # Reset mot de passe
|   |   |-- barbers.html           # Equipe (Tom, Alan, Nathan, Clement)
|   |   |-- prestations.html       # Services & tarifs
|   |   |-- galerie.html           # Photos salon
|   |   +-- contact.html           # Adresse, horaires, carte, transports
|   |
|   |-- barbers/                   # Pages individuelles (6 barbers)
|   |   +-- barber-{lucas,julien,tom,alan,nathan,clement}.html
|   |
|   |-- 404.html                   # Page 404 glassmorphism
|   +-- legal/                     # Pages legales (100% francais, obligation legale)
|       |-- cgu.html
|       |-- mentions-legales.html
|       +-- politique-confidentialite.html
|
|-- assets/
|   |-- fonts/                     # Orbitron-ExtraBold.ttf
|   |-- icons/                     # Icones PWA (72->512px) + favicon.png
|   |-- images/
|   |   |-- common/                # logo-blanc.png, logo.png, couronne.png
|   |   |-- barbers/               # Portraits (lucas.png, julien.jpg, etc.)
|   |   +-- salons/{grenoble,meylan}/  # Photos salons (JPG + WebP)
|   |-- videos/
|   |   |-- barbers/               # Videos presentation (6x MP4)
|   |   +-- Barbers-coupes/        # Portfolio coupes par barber
|   +-- js/
|       |-- booking-modal.js       # Modal politique annulation
|       +-- cookie-consent.js      # Bandeau RGPD cookies (toutes pages)
|
|-- config/
|   |-- manifest.json              # PWA manifest (standalone, portrait)
|   |-- robots.txt                 # SEO (Sitemap, Crawl-delay: 1)
|   +-- sitemap.xml                # 20+ URLs
|
|-- backend/
|   |-- .env                       # Secrets (NE PAS COMMIT)
|   |-- package.json
|   |-- database/
|   |   |-- schema.sql             # Schema complet
|   |   |-- seed.sql               # Donnees initiales
|   |   +-- migrations/            # 003 -> 022 (20 migrations)
|   +-- src/
|       |-- index.js               # Entry (routes, CORS, helmet, cron, advisory locks)
|       |-- constants.js           # Constantes metier (voir section dediee)
|       |-- config/
|       |   |-- env.js             # Parsing .env + multi-salon config (getSalonConfig)
|       |   +-- database.js        # Pool pg (max 20, SSL prod, type parsers DATE/TIME)
|       |-- middleware/
|       |   |-- auth.js            # JWT (access 15min, refresh 90j, rotation, httpOnly cookie)
|       |   |-- rateLimiter.js     # public 60/min, auth 10/15min, admin 200/min
|       |   +-- validate.js        # express-validator wrapper
|       |-- routes/
|       |   |-- health.js          # GET /api/health + /api/health/ping
|       |   |-- auth.js            # login, register, refresh, logout, forgot/reset, claim-account
|       |   |-- bookings.js        # Public : barbers, services, availability, CRUD, waitlist, ics
|       |   |-- client.js          # Client connecte : profil, mes RDV
|       |   +-- admin/             # 14 fichiers routes admin
|       |       |-- bookings.js    # Planning day/week, history, create, reschedule, cancel, status
|       |       |-- services.js    # CRUD prestations + assignation barbers
|       |       |-- barbers.js     # CRUD barbers + horaires + overrides + guest assignments
|       |       |-- clients.js     # Liste, search, detail, inactive (3+ visites, 3 mois), export CSV
|       |       |-- blockedSlots.js # Break/personal/closed
|       |       |-- payments.js    # Transactions caisse (CB/cash/lydia)
|       |       |-- products.js    # Stock boutique
|       |       |-- analytics.js   # Revenue, occupancy, peak hours, stats barbers/services
|       |       |-- waitlist.js    # Gestion liste d'attente
|       |       |-- automation.js  # Triggers : review_sms, waitlist_notify (PAS reactivation)
|       |       |-- mailing.js     # Campagnes email bulk
|       |       |-- sms.js         # Campagnes SMS
|       |       |-- notifications.js # Queue, logs, retry
|       |       |-- campaignTracking.js # Suivi ROI
|       |       +-- systemHealth.js # Status crons, DB health, circuit breaker
|       |-- services/
|       |   |-- availability.js    # Calcul creneaux (30min public, 5min admin, guest assignments)
|       |   |-- booking.js         # Creation atomique, annulation (+ waitlist SMS), recurrence
|       |   +-- notification.js    # Brevo email+SMS, queue+retry, circuit breaker, templates HTML
|       |-- cron/                   # 6 jobs planifies (prod only, advisory locks)
|       |   |-- reminders.js       # SMS rappel J-1 (cron 18h)
|       |   |-- retryNotifications.js # processQueue + cleanup notifs + cleanup tokens
|       |   |-- automationTriggers.js # Auto-complete + review SMS + waitlist expire
|       |   +-- backup.js          # Snapshot BDD quotidien
|       +-- utils/
|           |-- errors.js          # ApiError (400/401/403/404/409/429/500)
|           |-- logger.js          # Winston (info prod, debug dev)
|           +-- ics.js             # Generateur fichier .ics
|
+-- dashboard/
    |-- package.json
    |-- vite.config.js             # Port 5174, ES2018
    |-- index.html                 # Entry HTML
    +-- src/
        |-- App.jsx                # Routes (HashRouter, lazy loading)
        |-- api.js                 # Client API centralise (auto-refresh JWT sur 401, auto-inject salon_id)
        |-- auth.jsx               # AuthContext (localStorage: bc_user, bc_access/refresh_token, bc_salon)
        |-- constants.js           # COLOR_PALETTE (20 couleurs)
        |-- index.css              # Theme dark/light (2100+ lignes, 100+ CSS variables)
        |-- components/
        |   |-- Layout.jsx         # Sidebar 240px (collapse 64px) + bottom nav mobile + notif bell + theme toggle
        |   |-- SearchBar.jsx      # Recherche globale clients (debounce 300ms)
        |   +-- ErrorBoundary.jsx  # Catch errors React
        |-- hooks/
        |   |-- useMobile.js       # Breakpoint 1024px
        |   +-- useNotifications.js # Poll /admin/bookings toutes les 30s
        |-- utils/
        |   |-- csv.js             # Export CSV (UTF-8 BOM, separateur ;)
        |   +-- planning/helpers.js # formatPrice, timeToMinutes, PX_PER_MIN, etc.
        +-- pages/                 # 14 pages actives
            |-- SalonSelector.jsx  # Choix Meylan/Grenoble au login
            |-- Login.jsx          # Auth barber (email + password)
            |-- Planning.jsx       # Grille horaire 8h-20h, day/week, auto-refresh 30s
            |-- Analytics.jsx      # KPI, revenue, occupancy, clients inactifs (3+ visites, 3 mois)
            |-- Services.jsx       # CRUD prestations, couleur, barbers
            |-- Barbers.jsx        # Horaires, overrides, guest days
            |-- Clients.jsx        # Liste paginee, search, tri, export CSV
            |-- ClientDetail.jsx   # Fiche client, notes, historique, suppression RGPD
            |-- History.jsx        # Historique filtrable (date, barber, status)
            |-- Sms.jsx            # Templates + envoi bulk + historique
            |-- Mailing.jsx        # Compose + envoi bulk + historique
            |-- Campaigns.jsx      # Suivi ROI campagnes
            |-- Automation.jsx     # Triggers (review_sms, waitlist) + gestion waitlist
            |-- SystemHealth.jsx   # API/DB health, crons, memory, notifications
            +-- Caisse.jsx         # NON ROUTE (code mort, pas dans App.jsx)
```

---

## Base de donnees — 22 tables

| Table | Description | Cles importantes |
|-------|-------------|------------------|
| **barbers** | Comptes staff (6 barbers) | UUID, email UNIQUE, password_hash, is_active, salon_id, failed_login_attempts, locked_until |
| **services** | Catalogue prestations | UUID, price (centimes!), duration (min), color (hex), sort_order, salon_id |
| **barber_services** | Pivot barber-service | PK(barber_id, service_id) |
| **schedules** | Horaires hebdo | barber_id, day_of_week (0=Lundi!), start/end_time, is_working, salon_id |
| **schedule_overrides** | Exceptions/vacances | barber_id, date, is_day_off, reason, salon_id |
| **clients** | Profils clients (6443) | UUID, phone UNIQUE, has_account, review_requested, reactivation_sms_sent_at |
| **client_salons** | Pivot client-salon | client_id, salon_id |
| **bookings** | Reservations | UUID, status, price (centimes), cancel_token, salon_id, recurrence_group_id, rescheduled |
| **blocked_slots** | Creneaux bloques | type (break/personal/closed), reason, salon_id |
| **guest_assignments** | Barbers visiteurs | barber_id, date, host_salon_id, start_time, end_time |
| **notification_queue** | File d'attente notifs | type, status (pending/sent/failed), attempts, next_retry_at |
| **refresh_tokens** | Sessions JWT | user_type (barber/client), token UNIQUE, expires_at |
| **payments** | Transactions caisse | amount (centimes), method (cb/cash/lydia/other) |
| **register_closings** | Clotures de caisse | date UNIQUE, totaux par methode |
| **products** | Boutique stock | buy_price, sell_price, stock_quantity, alert_threshold |
| **product_sales** | Ventes produits | product_id, quantity, payment_method, salon_id |
| **gift_cards** | Cartes cadeaux | code UNIQUE (GC-XXXX-XXXX), balance, expires_at |
| **waitlist** | Liste d'attente | status (waiting/notified/booked/expired), salon_id |
| **campaigns** | Suivi campagnes | type (sms/email), tracking_code, ROI metrics |
| **automation_triggers** | Regles auto | type UNIQUE, config JSONB, is_active, salon_id |
| **salons** | Configuration salons | id (meylan/grenoble), name, address, phone |

### Contraintes critiques
- `bookings_no_overlap` : UNIQUE (barber_id, date, start_time) WHERE status != 'cancelled' AND deleted_at IS NULL
- Booking statuses : `confirmed`, `completed`, `no_show`, `cancelled`
- RLS active sur toutes les tables (migration 014) — acces uniquement via backend
- Advisory locks PostgreSQL pour serialiser bookings et crons

### Migrations appliquees (003 -> 022)
003 blocked_slots, 004 cash_register, 005 service_colors, 006 recurrence, 007 stocks_and_features, 008 reset_token, 009 review_requested, 010 rescheduled_flag, 011 fix_julien_email, 012 booking_color, 013 client_login_columns, 014 enable_rls, 015 fix_notification_status_constraint, 016 reactivation_dedup_and_index, 017 multi_salon, 018 seed_grenoble, 019 client_salons, 020 guest_assignments, 021 notification_composite_index, 022 salons_table

---

## Constantes metier (constants.js)

```
BCRYPT_ROUNDS: 12
MAX_LOGIN_ATTEMPTS: 5
LOCKOUT_MINUTES: 15
RESET_TOKEN_EXPIRY_MS: 3600000 (1h)
MAX_BOOKING_ADVANCE_MONTHS: 6
CANCELLATION_DEADLINE_HOURS: 12
MIN_BOOKING_LEAD_MINUTES: 5
SMS_CONFIRMATION_THRESHOLD_HOURS: 24
MAX_RECURRENCE_OCCURRENCES: 52
SLOT_INTERVAL_PUBLIC: 30 min
SLOT_INTERVAL_ADMIN: 5 min
ADMIN_SCHEDULE_END: '20:00'
NOTIFICATION_RETRY_DELAYS: [5, 15, 60] min
NOTIFICATION_BATCH_SIZE: 10
NOTIFICATION_CLEANUP_DAYS: 30
BREVO_CIRCUIT_THRESHOLD: 3 failures -> open 60s
BREVO_REQUEST_TIMEOUT_MS: 15000
```

---

## API — Endpoints complets

### Public (rate-limited 60/min)
```
GET  /api/health                    # Status + DB check
GET  /api/health/ping               # "pong" (ultralight)
POST /api/auth/login                # Login barber OU client (lockout 5 tentatives)
POST /api/auth/register             # Inscription client (upgrade si phone existant)
POST /api/auth/refresh              # Rotation JWT (httpOnly cookie)
POST /api/auth/logout               # Supprime refresh token
POST /api/auth/forgot-password      # Email reset (expire 1h), anti-enumeration
POST /api/auth/reset-password       # Reset + auto-login
POST /api/auth/claim-account        # Guest -> compte (via booking cancel_token)
GET  /api/barbers?salon_id          # Liste barbers (residents + guests)
GET  /api/services?barber_id&salon_id # Catalogue services
GET  /api/availability?service_id&date&barber_id&salon_id # Creneaux dispo (30min)
POST /api/bookings                  # Creer RDV (atomique, anti double-booking)
GET  /api/bookings/:id?token        # Details via cancel_token
POST /api/bookings/:id/cancel       # Annuler (>12h, notifie waitlist)
POST /api/bookings/:id/reschedule   # Modifier (1x max, >12h)
GET  /api/bookings/:id/ics?token    # Telecharger .ics calendar
POST /api/waitlist                  # Inscription liste d'attente
GET  /r/avis?salon=                 # Redirect Google review (per-salon)
GET  /r/rdv/:id/:token              # Redirect mon-rdv.html (per-salon)
GET  /api/track/*                   # Tracking campagnes (public)
```

### Client authentifie (requireAuth + requireClient)
```
GET  /api/client/profile            # Mon profil
PUT  /api/client/profile            # Modifier profil
GET  /api/client/bookings           # Mes RDV
```

### Admin (requireAuth + requireBarber + 200/min)
```
# Planning & Bookings
GET    /api/admin/bookings              # Planning day/week
GET    /api/admin/bookings/history      # Historique filtrable (pagination max 200)
POST   /api/admin/bookings              # Creation manuelle (+ recurrence optionnelle)
PUT    /api/admin/bookings/:id          # Modifier details
POST   /api/admin/bookings/:id/reschedule # Reschedule admin (sans limite 12h)
POST   /api/admin/bookings/:id/cancel   # Cancel admin (sans limite 12h)
PATCH  /api/admin/bookings/:id/status   # completed/no_show/confirmed

# Services
GET    /api/admin/services              # Tous (y compris inactifs)
POST   /api/admin/services              # Creer (prix centimes, duree min, couleur, barbers)
PUT    /api/admin/services/:id          # Modifier
DELETE /api/admin/services/:id          # Supprimer

# Barbers
GET    /api/admin/barbers               # Liste
PUT    /api/admin/barbers/:id           # Modifier (nom, email, photo)
GET    /api/admin/barbers/:id/schedule  # Horaires hebdo + overrides
PUT    /api/admin/barbers/:id/schedule  # Modifier horaires
POST   /api/admin/barbers/:id/overrides # Ajouter exception (vacances, break)
DELETE /api/admin/barbers/:id/overrides/:oid # Supprimer exception
GET    /api/admin/barbers/:id/guest-days # Guest assignments
POST   /api/admin/barbers/:id/guest-days # Ajouter guest day
DELETE /api/admin/barbers/:id/guest-days/:gid # Supprimer

# Clients
GET    /api/admin/clients               # Liste paginee (max 100), search, tri
GET    /api/admin/clients/inactive      # Clients inactifs (3+ visites, 90j sans RDV, limit 20)
GET    /api/admin/clients/:id           # Fiche + historique
PUT    /api/admin/clients/:id           # Modifier (notes)
DELETE /api/admin/clients/:id           # Supprimer (RGPD)

# Blocked Slots
GET    /api/admin/blocked-slots         # Liste
POST   /api/admin/blocked-slots         # Creer
DELETE /api/admin/blocked-slots/:id     # Supprimer

# Caisse & Paiements
GET    /api/admin/payments/daily/:date  # Transactions du jour
POST   /api/admin/payments              # Enregistrer paiement
DELETE /api/admin/payments/:id          # Supprimer
POST   /api/admin/payments/close        # Cloturer caisse
GET    /api/admin/payments/closings     # Historique clotures

# Produits (stock boutique)
GET    /api/admin/products              # Liste
POST   /api/admin/products              # Creer
PUT    /api/admin/products/:id          # Modifier
DELETE /api/admin/products/:id          # Supprimer
POST   /api/admin/products/:id/sales    # Enregistrer vente

# Analytics
GET    /api/admin/analytics/dashboard   # KPI globaux
GET    /api/admin/analytics/revenue     # Revenue par periode
GET    /api/admin/analytics/peak-hours  # Heures de pointe
GET    /api/admin/analytics/occupancy   # Taux d'occupation
GET    /api/admin/analytics/services    # Stats prestations
GET    /api/admin/analytics/barbers     # Stats barbers
GET    /api/admin/analytics/members     # Stats adherents

# Communication
POST   /api/admin/sms/send              # Envoyer SMS bulk
POST   /api/admin/mailing/send          # Envoyer email bulk
GET    /api/admin/notifications/logs    # Logs notifications
GET    /api/admin/notifications/stats   # KPI notifications
DELETE /api/admin/notifications/purge   # Purger echecs

# Automation & Waitlist
GET    /api/admin/automation            # Triggers actifs (review_sms, waitlist_notify)
PUT    /api/admin/automation/:type      # Configurer/toggle trigger
GET    /api/admin/waitlist              # Liste d'attente
POST   /api/admin/waitlist              # Ajouter
PUT    /api/admin/waitlist/:id          # Modifier status
DELETE /api/admin/waitlist/:id          # Supprimer

# Campagnes
GET    /api/admin/campaigns             # Liste
POST   /api/admin/campaigns             # Creer
GET    /api/admin/campaigns/:id/roi     # Details ROI

# Systeme
GET    /api/admin/system/status         # Crons, DB health, circuit breaker, memory
```

---

## Brevo — Email + SMS

### Configuration
| Param | Valeur |
|-------|--------|
| Sender Email | `noreply@barberclub-grenoble.fr` (DNS SPF/DKIM requis) |
| Sender Name | `BarberClub Meylan` ou `BarberClub Grenoble` (per-salon) |
| Sender SMS | `BARBERCLUB` (alphanumeric sender ID) |
| API | REST `https://api.brevo.com/v3/` via `BREVO_API_KEY` |
| Cout SMS | ~0.045euros/SMS |
| Emails gratuits | 300/jour |
| Circuit breaker | 3 failures consecutifs -> open 60s par salon |

### Templates email (HTML inline dans notification.js, design monochrome dark)
| Template | Declencheur | Contenu |
|----------|-------------|---------|
| Confirmation | Creation booking | Recap + lien Google Maps + lien gerer RDV |
| Annulation | Client ou admin annule | Confirmation annulation + bouton reprendre RDV |
| Reschedule | Admin deplace RDV | Ancien/nouveau creneau + lien gerer |
| Reset password | Client forgot-password | Lien reset (expire 1h) |
| Campagne marketing | Admin mailing | Contenu libre + footer "STOP" desinscription |

**PAS d'email avis Google** — l'avis passe uniquement par SMS.

### SMS actifs
| Type | Declencheur | Contenu |
|------|-------------|---------|
| Rappel J-1 | Cron 18h la veille, OU immediat si RDV <24h | `BarberClub - Rappel RDV le...` |
| Review Google | Automation 60min post-coupe | `Merci ! Laisse un avis...` (1x par client a vie) |

### SMS manuels (via dashboard)
- **Reactivation clients inactifs** : supprime du code automatique. Liste visible dans Analytics (3+ visites, 3 mois). Envoi manuel via section SMS.
- **Waitlist** : bouton "Notifier" dans la page Liste d'attente envoie un SMS individuel au client (pas automatique)

### Design tokens emails
```
DARK_BG: #0C0A09 | CARD_BG: #1C1917 | CARD_BORDER: #292524
TEXT_PRIMARY: #FAFAF9 | TEXT_SECONDARY: #A8A29E | TEXT_MUTED: #78716C
```

---

## Cron jobs (production uniquement)

| Frequence | Job | Description |
|-----------|-----|-------------|
| */2 min | processQueue | Retry notifications (backoff 5->15->60 min, max 3) |
| */10 min | automationTriggers | Auto-complete bookings passes + review SMS + expire waitlist |
| 18h daily | queueReminders | SMS rappels pour demain |
| 03h00 | cleanup notifications | Supprime notifs >30j |
| 03h30 | cleanup tokens | Supprime refresh tokens expires |
| 04h00 | dailyBackup | Snapshot BDD |

- Advisory locks PostgreSQL (pg_try_advisory_lock) pour eviter execution concurrente
- Monitoring via `GET /api/admin/system/status` (in-memory cronStatus)

---

## Authentification

| Param | Valeur |
|-------|--------|
| Access token | JWT 15 min (`JWT_SECRET`) |
| Refresh token | JWT 90 jours (`JWT_REFRESH_SECRET`), stocke en BDD + httpOnly cookie |
| Hash | Bcrypt 12 rounds |
| Brute force | 5 tentatives -> lockout 15 min (barbers + clients) |
| Max sessions | 5 par user (prune oldest) |
| Login barber | `POST /api/auth/login { email, password, type: "barber", salon_id }` |
| Dashboard auto-refresh | Sur 401 -> refresh token -> retry request -> sinon logout |
| Storage dashboard | `bc_user`, `bc_access_token`, `bc_refresh_token`, `bc_salon` (localStorage) |

### Credentials barbers
- **Meylan** : `barberclubmeylan@gmail.com` / [voir gestionnaire mdp]
- **Grenoble** : `barberclotbey@gmail.com` / [voir gestionnaire mdp]

---

## API — URLs

| Composant | URL actuelle | URL finale (apres DNS switch) |
|-----------|-------------|-------------------------------|
| Backend Railway | `https://fortunate-benevolence-production-7df2.up.railway.app/api` | `https://api.barberclub-grenoble.fr/api` |
| Site Cloudflare | `https://barberclub-site.pages.dev` | `https://barberclub-grenoble.fr` |
| Dashboard Cloudflare | `https://barberclub-dashboard.pages.dev` | `https://gestion.barberclub-grenoble.fr` |

Detection auto dans le code : `window.location.hostname === 'localhost'` -> dev / sinon -> prod

### Fichiers frontend pointant vers l'URL Railway (a maj au switch DNS)
`dashboard/src/api.js`, `pages/meylan/reserver.html`, `pages/meylan/mon-rdv.html`, `pages/meylan/reset-password.html`, `pages/grenoble/reserver.html`, `pages/grenoble/mon-rdv.html`, `pages/grenoble/reset-password.html`

---

## Design System

### Site vitrine
| Propriete | Valeur |
|-----------|--------|
| Fond | Noir pur `#000` |
| Texte | Blanc `#fff` |
| Font titres | Orbitron ExtraBold (`assets/fonts/`), clamp(42px, 14vw, 80px) |
| Font corps | Inter (Google Fonts) |
| Glassmorphism | `rgba(255,255,255,0.04-0.15)` + `backdrop-filter: blur(20-60px)` |
| Bordures | `rgba(255,255,255,0.06-0.15)` |
| Active | `scale(0.95-0.97)` |
| Transitions | `0.3s cubic-bezier(0.4, 0, 0.2, 1)` |
| Breakpoint | 768px mobile |
| CSS | **Inline dans chaque page** (pas de fichier externe partage) |
| Images | JPG + WebP pairs |
| PWA | Service Worker network-first + manifest standalone |
| Accessibility | skip-to-content, role=dialog, aria-modal, focus-visible, prefers-reduced-motion |

### Dashboard admin
| Propriete | Valeur |
|-----------|--------|
| Theme dark | `--bg: #0a0a0a`, `--bg-card: #111113` |
| Theme light | Toggle disponible (`bc_theme` localStorage) |
| Sidebar | 240px (collapsible -> 64px), bottom nav mobile |
| Breakpoint | 1024px (`useMobile()` hook) |
| State | React hooks (useState, useContext) — PAS de Redux |
| CSS | `index.css` 2100+ lignes, 100+ variables CSS |
| Anti-zoom iOS | `font-size: 16px !important` sur inputs (<1024px) |
| SEO | `noindex/nofollow` (admin seulement) |
| Lazy loading | Toutes les pages via React.lazy() + Suspense |

---

## Regles metier

### Reservation (flow public — 4 etapes)
1. **Choix barber** — Grid cards avec portrait (ou "peu importe" = load balancing)
2. **Choix prestation** — Services avec prix/duree (API `/api/services`)
3. **Choix creneau** — Date picker + slots 30min (API `/api/availability`)
4. **Details client** — Phone, email, prenom + recap + confirmation

### Contraintes
- **Prix en centimes** : 2700 = 27,00euros. Frontend fait `/ 100`
- **Creneaux** : 30 min d'intervalle (public), 5 min (admin)
- **Avance max** : 6 mois
- **Annulation** : minimum 12h avant le RDV
- **Modification** : 1 seule fois par RDV, minimum 12h avant
- **Double-booking** : index UNIQUE + advisory lock + `SELECT...FOR UPDATE` (row lock)
- **"Peu importe" le barber** : load balancing (moins de RDV ce jour)
- **Recurrence** : weekly/biweekly/monthly, max 52 occurrences, skip conflits
- **Guest barbers** : un barber peut travailler dans l'autre salon via guest_assignments

### Pas d'espace "Mon Compte"
Le client recoit un email avec un lien `cancel_token` pour gerer son RDV (voir/annuler/modifier). Pas de compte client avec profil/historique cote public.

### Convention day_of_week
- **0 = Lundi, 6 = Dimanche** (PAS la convention JS ou 0=Dimanche)

### Horaires barbers (Meylan)
- **Lucas** : repos Lundi + Dimanche, travaille Mardi->Samedi 9h-19h
- **Julien** : repos Samedi + Dimanche, travaille Lundi->Vendredi 9h-19h (Mercredi 13h-19h)

### Salons
- **Meylan** : 26 Av. du Gresivaudan, 38700 Corenc — Lucas, Julien
- **Grenoble** : 5 Rue Clot Bey, 38000 Grenoble — Tom, Alan, Nathan, Clement
- Les 2 salons utilisent le meme backend avec `salon_id`

### Clients inactifs
- Visibles dans Analytics : clients avec **3+ visites** et **90+ jours** sans RDV
- Code couleur : orange (3-6 mois), rouge (6 mois+)
- **Pas d'envoi SMS automatique** — envoi manuel via section SMS

---

## Notifications — Strategie

| Type | Declencheur | Canal | Statut |
|------|-------------|-------|--------|
| Confirmation RDV | Creation booking | Email (toujours) | Actif |
| Rappel J-1 | Cron 18h la veille, OU immediat si <24h | SMS | Actif |
| Avis Google | 60min apres RDV termine (1x par client a vie) | SMS | Actif (toggle dashboard) |
| Annulation | Client ou admin annule | Email | Actif |
| Reschedule | Admin deplace RDV | Email | Actif |
| Reset password | Client forgot-password | Email | Actif |
| Waitlist place liberee | Bouton "Notifier" dashboard (manuel) | SMS | Actif (manuel) |
| Reactivation inactifs | — | — | **Supprime** (envoi manuel via SMS) |

---

## Deploiement

### Hebergement

| Service | Hebergeur | Cout | Status |
|---------|-----------|------|--------|
| Backend + BDD | Railway Hobby | ~5euros/mois | Deploye |
| Site vitrine | Cloudflare Pages | Gratuit | Deploye |
| Dashboard | Cloudflare Pages | Gratuit | Deploye |
| Email | Brevo | Gratuit (300/j) | OK |
| SMS | Brevo | ~0.045euros/SMS | OK |
| Domaine | Squarespace | Deja achete | `barberclub-grenoble.fr` (pointe encore vers ancien site) |

### Commandes deploy
```bash
# Backend Railway : auto-deploy sur git push main (root /backend)
git push

# Site vitrine (Cloudflare Pages, branche production)
npx wrangler pages deploy . --project-name barberclub-site --branch production --commit-dirty=true

# Dashboard (Cloudflare Pages, branche production)
cd dashboard && npm run build && npx wrangler pages deploy dist --project-name barberclub-dashboard --branch production --commit-dirty=true
```

### Variables d'env production (Railway)
```
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://...@railway/postgres
JWT_SECRET=<256-bit>
JWT_REFRESH_SECRET=<256-bit>
CORS_ORIGINS=https://barberclub-site.pages.dev,https://barberclub-dashboard.pages.dev
BREVO_API_KEY=<cle-brevo>
BREVO_SENDER_EMAIL=noreply@barberclub-grenoble.fr
BREVO_SENDER_NAME=BarberClub Meylan
BREVO_SMS_SENDER=BARBERCLUB
GOOGLE_REVIEW_URL=https://g.page/r/...
SITE_URL=https://barberclub-site.pages.dev
API_URL=https://fortunate-benevolence-production-7df2.up.railway.app
```

### Variables a changer au switch DNS
```
CORS_ORIGINS -> ajouter https://barberclub-grenoble.fr,https://gestion.barberclub-grenoble.fr
SITE_URL -> https://barberclub-grenoble.fr
API_URL -> https://api.barberclub-grenoble.fr
```

### DNS prevu (Squarespace)
| Sous-domaine | Pointe vers |
|-------------|-------------|
| `barberclub-grenoble.fr` | Cloudflare Pages (site) |
| `gestion.barberclub-grenoble.fr` | Cloudflare Pages (dashboard) |
| `api.barberclub-grenoble.fr` | Railway |

---

## Bugs connus et fixes appliques

| Bug | Fix | Fichier |
|-----|-----|---------|
| DATE PostgreSQL -> Date JS (timezone) | `types.setTypeParser(1082, val => val)` | database.js |
| TIME PostgreSQL retourne `HH:MM:SS` | `.slice(0,5)` avant comparaison | Partout |
| day_of_week 0=Lundi vs JS 0=Dimanche | Conversion explicite | availability.js |
| UUIDs seed non-standard | `.matches(uuidRegex)` au lieu de `.isUUID()` | Toutes routes |
| `.isDate({ format })` bugge | `.matches(/^\d{4}-\d{2}-\d{2}$/)` | Routes bookings |
| Trust proxy manquant (rate limiter) | `app.set('trust proxy', 1)` | index.js |
| XSS dans emails | `escapeHtml()` sur champs clients | notification.js |
| Race condition double-booking | Advisory lock + `SELECT...FOR UPDATE` | booking.js |
| Retry explosif | Backoff exponentiel (5->15->60 min), max 3 | notification.js |
| Rate limiter bypassable | `keyGenerator` par IP+email | rateLimiter.js |
| Dates passees/futures >6 mois | Validation 400 avec ApiError | bookings.js |
| Crons concurrent multi-instance | `pg_try_advisory_lock` | index.js |
| Circuit breaker Brevo | 3 failures -> cooldown 60s per-salon | notification.js |

---

## Checklist bascule DNS

1. [ ] DNS Squarespace : CNAME `@`/`www` -> Cloudflare Pages (site)
2. [ ] DNS Squarespace : CNAME `gestion` -> Cloudflare Pages (dashboard)
3. [ ] DNS Squarespace : CNAME `api` -> Railway
4. [ ] Cloudflare Pages : custom domain `barberclub-grenoble.fr`
5. [ ] Cloudflare Pages : custom domain `gestion.barberclub-grenoble.fr`
6. [ ] Railway : custom domain `api.barberclub-grenoble.fr`
7. [ ] Railway : mettre a jour SITE_URL, API_URL, CORS_ORIGINS
8. [ ] Frontend : remettre `api.barberclub-grenoble.fr` dans les 7 fichiers
9. [ ] SPF/DKIM pour `noreply@barberclub-grenoble.fr` (Brevo sender auth)
10. [ ] Recharger credits SMS Brevo
11. [ ] Tester tous les flows sur domaines finaux
12. [ ] Soumettre nouveau sitemap Google Search Console
13. [ ] Verifier redirections 301 (anciennes URLs -> nouveau site)

---

## Notes pour Claude

1. **Ne PAS ouvrir en `file://`** — Toujours `localhost`, sinon CORS bloque
2. **Prix en centimes** — 2700 = 27,00euros. Frontend fait `/ 100`
3. **UUIDs seed non-standards** — Toujours `.matches(uuidRegex)`, JAMAIS `.isUUID()`
4. **day_of_week** — 0=Lundi en BDD, PAS 0=Dimanche comme JS
5. **CSS inline** — Chaque page HTML a son `<style>` integre, pas de CSS externe partage
6. **Multi-salon** — salon_id='meylan' ou 'grenoble', meme backend
7. **Pas de mon-compte** — Le client gere son RDV via cancel_token (lien dans l'email)
8. **Backend `--watch`** — Modifications auto-rechargees en dev
9. **Pages legales** — 100% francais obligatoire
10. **Chemins relatifs** — Depuis `pages/*/` : assets = `../../assets/`, legal = `../legal/`
11. **Crons** — Desactives en dev (`NODE_ENV !== production`)
12. **HashRouter** — Dashboard utilise `#` dans les URLs (pas besoin de config serveur)
13. **Brevo** — Templates email HTML inline dans `notification.js`, design monochrome dark
14. **Caisse.jsx** — Existe mais PAS route dans App.jsx (code mort)
15. **Reactivation SMS** — Supprime du code automatique. Liste inactifs visible dans Analytics. Envoi manuel via SMS.
16. **Guest assignments** — Un barber peut travailler dans l'autre salon (table guest_assignments)
17. **BDD Railway** — PostgreSQL sur Railway (pas Supabase), 22 tables, 6443 clients
18. **Domaine Squarespace** — Pas OVH, le domaine est gere sur Squarespace
