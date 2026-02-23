# BarberClub — Projet Complet

> Site vitrine + système de réservation custom + dashboard admin pour BarberClub, salon de barbier premium à Meylan/Corenc (près de Grenoble). Remplace Timify (~200$/mois).

**Propriétaire/Dev** : Nino — préfère le français, réponses concises, dark theme.

---

## Architecture

| Composant | Tech | Port | Commande | URL dev |
|-----------|------|------|----------|---------|
| **Site vitrine** | HTML/CSS/JS vanilla (PWA) | 5500 | `npx serve -l 5500` (depuis racine) | `http://localhost:5500` |
| **Backend API** | Node.js/Express + PostgreSQL | 3000 | `cd backend && npm run dev` | `http://localhost:3000/api` |
| **Dashboard admin** | React 19 + Vite 6 + React Router 7 | 5174 | `cd dashboard && npm run dev` | `http://localhost:5174` |
| **Base de données** | Supabase PostgreSQL | — | Cloud | — |

---

## Structure des fichiers

```
BarberClub Site/
├── index.html                     # Landing — choix salon Grenoble / Meylan
├── sw.js                          # Service Worker PWA
├── .htaccess                      # Apache (cache, gzip, sécurité)
│
├── pages/
│   ├── meylan/                    # Salon Meylan (réservation custom)
│   │   ├── index.html             # Hub navigation salon
│   │   ├── reserver.html          # ★ Interface réservation 4 étapes
│   │   ├── mon-rdv.html           # Mes réservations client (consulter/annuler)
│   │   ├── reset-password.html    # Reset mot de passe client
│   │   ├── barbers.html           # Équipe (Lucas, Julien)
│   │   ├── prestations.html       # Services & tarifs
│   │   ├── galerie.html           # Photos salon
│   │   └── contact.html           # Adresse, horaires, carte Leaflet
│   │
│   ├── grenoble/                  # Salon Grenoble (vitrine, pas de booking custom)
│   │   ├── index.html             # Hub salon
│   │   ├── reserver.html          # Iframe Timify (booking externe)
│   │   ├── barbers.html           # Équipe (Tom, Alan, Nathan, Clément)
│   │   ├── prestations.html       # Services & tarifs
│   │   ├── galerie.html           # Photos salon
│   │   └── contact.html           # Adresse, horaires, carte Leaflet
│   │
│   ├── barbers/                   # Pages individuelles barbers
│   │   ├── barber-lucas.html      # Lucas — Co-fondateur, Meylan
│   │   ├── barber-julien.html     # Julien — Meylan
│   │   ├── barber-tom.html        # Tom — Grenoble
│   │   ├── barber-alan.html       # Alan — Grenoble
│   │   ├── barber-nathan.html     # Nathan — Grenoble
│   │   └── barber-clement.html    # Clément — Grenoble
│   │
│   ├── 404.html                   # Page 404 personnalisée
│   │
│   └── legal/                     # Pages légales (100% français, obligation légale)
│       ├── cgu.html
│       ├── mentions-legales.html
│       └── politique-confidentialite.html
│
├── assets/
│   ├── fonts/Orbitron-ExtraBold.ttf
│   ├── icons/                     # Icônes PWA (72→512px)
│   ├── images/
│   │   ├── common/                # Logo, favicon, couronne
│   │   ├── barbers/               # Photos portraits
│   │   └── salons/{grenoble,meylan}/  # Photos salons (JPG + WebP)
│   ├── videos/barbers/            # Vidéos présentation (MP4)
│   └── js/booking-modal.js        # Modal politique annulation (index pages)
│
├── config/
│   ├── manifest.json              # PWA manifest
│   ├── robots.txt
│   └── sitemap.xml
│
├── backend/
│   ├── .env                       # Variables d'environnement (ne pas commit)
│   ├── package.json               # Express, pg, jsonwebtoken, bcrypt, node-cron, helmet, winston...
│   ├── database/
│   │   ├── schema.sql             # Schéma complet de la BDD
│   │   ├── seed.sql               # Données initiales (barbers, services, horaires)
│   │   └── migrations/
│   │       ├── 003_blocked_slots.sql
│   │       ├── 004_cash_register.sql    # payments + register_closings
│   │       ├── 005_service_colors.sql
│   │       ├── 006_recurrence.sql       # recurrence_group_id
│   │       ├── 007_stocks_and_features.sql  # products, gift_cards, waitlist, campaigns, automation_triggers
│   │       ├── 008_reset_token.sql
│   │       ├── 009_review_requested.sql    # Flag review_requested sur bookings
│   │       └── 010_rescheduled_flag.sql    # Flag rescheduled sur bookings
│   └── src/
│       ├── index.js               # Entry — routes, CORS, helmet, cron, logging
│       ├── config/
│       │   ├── env.js             # Parsing .env (DATABASE_URL, JWT, CORS, Brevo, salon)
│       │   └── database.js        # Pool pg (max 20, SSL prod, DATE type parser fix)
│       ├── middleware/
│       │   ├── auth.js            # requireAuth, requireBarber, requireClient, optionalAuth, JWT tokens
│       │   ├── rateLimiter.js     # public: 60/min, auth: 10/15min, admin: 200/min
│       │   └── validate.js        # express-validator handler
│       ├── routes/
│       │   ├── health.js          # GET /api/health
│       │   ├── auth.js            # login, register, refresh, logout, forgot-password, reset-password
│       │   ├── bookings.js        # Routes publiques (barbers, services, availability, booking CRUD)
│       │   ├── client.js          # Routes client connecté (profile, mes bookings)
│       │   └── admin/
│       │       ├── bookings.js    # Planning jour/semaine, history, CRUD, récurrence
│       │       ├── services.js    # CRUD services
│       │       ├── barbers.js     # CRUD barbers + schedules + overrides
│       │       ├── clients.js     # Recherche, profil, inactive, RGPD delete
│       │       ├── analytics.js   # Dashboard, revenue, peak hours, occupancy, trends, members
│       │       ├── payments.js    # Caisse quotidienne, clôture, historique
│       │       ├── blockedSlots.js # Créneaux bloqués (pause, absent)
│       │       ├── mailing.js     # Campagnes email via Brevo
│       │       ├── sms.js         # SMS via Brevo (max 500 destinataires)
│       │       ├── notifications.js # Logs, stats, statut Brevo
│       │       ├── products.js    # Boutique (CRUD, ventes, gift cards)
│       │       ├── waitlist.js    # Liste d'attente
│       │       ├── automation.js  # Triggers auto (review SMS, reactivation, waitlist)
│       │       ├── campaignTracking.js
│       │       └── systemHealth.js  # Monitoring système (DB, Brevo, crons)
│       ├── services/
│       │   ├── availability.js    # Calcul créneaux (30min public, 5min admin)
│       │   ├── booking.js         # Création atomique, annulation, récurrence
│       │   └── notification.js    # Brevo email + SMS, queue + retry
│       ├── cron/
│       │   ├── reminders.js       # SMS rappel J-1 (quotidien 18h)
│       │   ├── reviews.js         # Email avis Google (quotidien 10h)
│       │   ├── retryNotifications.js # Retry queue (toutes les 2min) + cleanup
│       │   └── automationTriggers.js # Review SMS, reactivation, waitlist (toutes les 10min)
│       └── utils/
│           ├── errors.js          # ApiError (400, 401, 403, 404, 409, 429, 500)
│           ├── logger.js          # Winston
│           └── ics.js             # Génération fichier .ics
│
└── dashboard/
    ├── package.json               # React 19, React Router 7, Vite 6, date-fns 4
    ├── vite.config.js             # Port 5174
    └── src/
        ├── App.jsx                # Routes + ProtectedRoute
        ├── api.js                 # Client API centralisé (auto-refresh JWT sur 401)
        ├── auth.jsx               # AuthContext (localStorage: bc_user, bc_access_token, bc_refresh_token)
        ├── index.css              # Thème dark complet (100+ CSS variables)
        ├── components/
        │   ├── Layout.jsx         # Sidebar + bottom nav mobile + notifications bell + theme toggle
        │   └── SearchBar.jsx
        ├── hooks/
        │   ├── useMobile.js       # Breakpoint 1024px (mobile+tablette)
        │   └── useNotifications.js
        └── pages/
            ├── Login.jsx          # Email/password → type: 'barber'
            ├── Planning.jsx       # Vue calendrier semaine, colonnes barbers, drag-drop, hover cards
            ├── Analytics.jsx      # KPIs, revenue, peak hours, services/barbers stats, trends
            ├── Clients.jsx        # Recherche, tri, pagination, CSV export, badges VIP/member
            ├── ClientDetail.jsx   # Profil, stats, notes, historique, RGPD delete
            ├── Services.jsx       # CRUD services avec palette couleurs
            ├── Barbers.jsx        # CRUD barbers + schedules + overrides
            ├── History.jsx        # Historique réservations avec filtres
            ├── Caisse.jsx         # Caisse quotidienne, paiements, clôture
            ├── Sms.jsx            # Envoi SMS (templates, sélection clients, compteur caractères)
            ├── Mailing.jsx        # Campagnes email (templates, sélection, historique)
            ├── Automation.jsx     # Monitoring + triggers + waitlist
            ├── Campaigns.jsx      # Suivi campagnes ROI
            └── SystemHealth.jsx   # Monitoring système (DB, Brevo, crons)
```

---

## Base de données — Tables

| Table | Description | Clés importantes |
|-------|-------------|------------------|
| **barbers** | Comptes barbers/staff | id UUID, name, email, password_hash, is_active, photo_url, sort_order, failed_login_attempts, locked_until |
| **services** | Catalogue prestations | id UUID, name, price (centimes!), duration (minutes), color (hex), is_active, sort_order |
| **barber_services** | Pivot barber↔service | barber_id, service_id |
| **schedules** | Horaires hebdo par défaut | barber_id, day_of_week (**0=Lundi**, 6=Dimanche), start_time, end_time, is_working |
| **schedule_overrides** | Exceptions/vacances | barber_id, date, is_day_off, start_time, end_time, reason |
| **clients** | Profils clients | id UUID, first_name, last_name, phone (UNIQUE), email, has_account, password_hash, notes, reset_token, reset_token_expires |
| **bookings** | Réservations | id UUID, client_id, barber_id, service_id, date, start_time, end_time, status, price (centimes), cancel_token, source, reminder_sent, review_email_sent, is_first_visit, recurrence_group_id, campaign_id |
| **blocked_slots** | Créneaux bloqués | barber_id, date, start_time, end_time, type (break/personal/closed), reason |
| **notification_queue** | File d'attente notifs | booking_id, type, status (pending/sent/failed), attempts, next_retry_at, last_error |
| **refresh_tokens** | Sessions JWT | user_id, user_type (barber/client), token, expires_at |
| **payments** | Transactions caisse | booking_id (nullable), amount, method (cb/cash/lydia/other), barber_id, notes |
| **register_closings** | Clôtures de caisse | date, total_cb, total_cash, total_lydia, total_other, closed_by |
| **products** | Boutique stock | name, category, buy_price, sell_price, stock, alert_threshold, is_active |
| **product_sales** | Ventes produits | product_id, quantity, unit_price, method, barber_id |
| **gift_cards** | Cartes cadeaux | code (GC-XXXX-XXXX), initial_amount, balance, expires_at |
| **waitlist** | Liste d'attente | client_id, barber_id, service_id, preferred_date, status (waiting/notified/booked/expired) |
| **campaigns** | Suivi campagnes | name, type (sms/email), cost, recipients_count, clicks, bookings_generated |
| **automation_triggers** | Règles auto | type (review_sms/reactivation_sms/waitlist_notify), config JSONB, is_active |

### Contraintes critiques
- `bookings_no_overlap` : UNIQUE (barber_id, date, start_time) WHERE status != 'cancelled'
- `clients.phone` : UNIQUE
- Booking statuses : `confirmed`, `completed`, `no_show`, `cancelled`

---

## API Endpoints

### Routes publiques (rate limit: 60/min)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/barbers` | Barbers actifs + jours off |
| GET | `/api/services?barber_id=` | Services (filtre optionnel) |
| GET | `/api/availability?service_id=&date=&barber_id=` | Créneaux dispos |
| POST | `/api/bookings` | Créer réservation |
| GET | `/api/bookings/:id?token=` | Détails réservation |
| POST | `/api/bookings/:id/cancel` | Annuler (cancel_token, min 12h avant) |
| GET | `/api/bookings/:id/ics?token=` | Télécharger .ics |
| POST | `/api/waitlist` | Rejoindre liste d'attente |

### Auth (rate limit: 10/15min)

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/login` | Login (type: barber ou client) |
| POST | `/api/auth/register` | Inscription client |
| POST | `/api/auth/refresh` | Refresh token |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/auth/forgot-password` | Demande reset |
| POST | `/api/auth/reset-password` | Exécute reset |

### Client connecté (JWT client)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/client/profile` | Mon profil |
| PUT | `/api/client/profile` | Modifier profil |
| GET | `/api/client/bookings` | Mes RDV (upcoming + past) |

### Admin (JWT barber, rate limit: 200/min)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/admin/bookings?date=&view=` | Planning jour/semaine |
| GET | `/api/admin/bookings/history` | Historique avec filtres/pagination |
| POST | `/api/admin/bookings` | Créer RDV (+ récurrence) |
| PUT | `/api/admin/bookings/:id` | Modifier/déplacer RDV |
| PATCH | `/api/admin/bookings/:id/status` | Statut (completed/no_show) |
| DELETE | `/api/admin/bookings/:id` | Soft delete + email optionnel |
| CRUD | `/api/admin/services` | Gestion prestations |
| CRUD | `/api/admin/barbers` | Gestion barbers |
| GET/PUT | `/api/admin/barbers/:id/schedule` | Horaires hebdo |
| POST/DELETE | `/api/admin/barbers/:id/overrides` | Exceptions planning |
| CRUD | `/api/admin/clients` | Gestion clients + RGPD delete |
| GET | `/api/admin/clients/inactive` | Clients inactifs 45j+ |
| GET | `/api/admin/analytics/*` | Dashboard, revenue, peak, occupancy, trends, members |
| GET/POST/DELETE | `/api/admin/payments/daily`, `/api/admin/payments/*` | Caisse, clôtures |
| GET/POST/DELETE | `/api/admin/blocked-slots` | Créneaux bloqués |
| POST | `/api/admin/mailing/send` | Campagne email Brevo |
| POST | `/api/admin/sms/send` | SMS Brevo |
| GET | `/api/admin/notifications/stats`, `/api/admin/notifications/brevo-status` | Logs, stats, statut Brevo |
| CRUD | `/api/admin/products/*` | Boutique, ventes, gift cards |
| CRUD | `/api/admin/waitlist` | Liste d'attente |
| GET/PUT | `/api/admin/automation` | Triggers automatiques |
| GET | `/api/track/*` | Tracking campagnes (no auth) |

---

## Règles métier importantes

### Réservation
- **Prix en centimes** : 2700 = 27,00€
- **Créneaux** : 30 min d'intervalle (public), 5 min (admin)
- **Avance max** : 6 mois
- **Annulation** : minimum 12h avant le RDV
- **Double-booking** : empêché par index UNIQUE + `SELECT...FOR UPDATE` (row lock)
- **"Peu importe" le barber** : load balancing (moins de RDV ce jour-là)
- **Récurrence** : weekly/biweekly/monthly, max 52 occurrences, skip conflits silencieusement

### Convention day_of_week
- **0 = Lundi, 6 = Dimanche** (PAS la convention JS où 0=Dimanche)

### Horaires barbers (Meylan)
- **Lucas** : repos Lundi + Dimanche, travaille Mardi→Samedi 9h-19h
- **Julien** : repos Samedi + Dimanche, travaille Lundi→Vendredi 9h-19h (Mercredi 13h-19h)

### Authentification
- **JWT Access** : 15 min, signé avec `JWT_SECRET`
- **JWT Refresh** : 90 jours, signé avec `JWT_REFRESH_SECRET`, stocké en BDD
- **Bcrypt** : 12 rounds
- **Brute force** : 5 tentatives → lockout 15 min
- **Login barber** : `{ email, password, type: "barber" }`
- **Credentials test** : `admin@admin.com` / `admin`

### Notifications (Brevo)
- **Email confirmation** : immédiat après réservation (récap + lien annulation + .ics)
- **SMS rappel** : 24h avant RDV (queue à 18h la veille)
- **SMS avis Google** : nouveau numéro uniquement, 1 seule fois à vie (trigger auto)
- **Email relance inactif** : si pas venu depuis 45j+, 3+ visites min, 1 seul envoi
- **Retry** : 3 tentatives max, backoff exponentiel (5min → 15min → 60min)
- **Cleanup** : notifications >30j supprimées (cron 03:00)

### Cron jobs
| Fréquence | Job | Description |
|-----------|-----|-------------|
| Toutes les 2 min | processQueue | Retry notifications en attente |
| Toutes les 10 min | automationTriggers | Review SMS, reactivation, waitlist |
| 18h quotidien | reminders | Queue SMS rappels pour demain |
| 10h quotidien | reviews | Queue emails demande avis |
| 03h00 | cleanup notifications | Supprime notifications >30j |
| 03h30 | cleanup tokens | Supprime refresh tokens expirés |

---

## Design system (site vitrine)

- **Fond** : noir pur `#000`
- **Texte** : blanc `#fff`
- **Fonts** : Orbitron ExtraBold (titres, boutons, prix), Inter (corps)
- **Effets** : glassmorphism (`rgba(255,255,255,0.04-0.15)` + `backdrop-filter: blur(20-60px)`)
- **Bordures** : `rgba(255,255,255,0.06-0.15)`
- **Active** : `scale(0.95-0.97)`
- **Transitions** : `0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- **Breakpoint mobile** : 768px (site vitrine)
- **CSS inline** dans chaque page (pas de fichier CSS externe partagé)

### Dashboard
- **Thème dark** : `--bg: #0a0a0a`, `--bg-card: #111113`
- **Thème light** : toggle disponible
- **Sidebar** : 240px (collapsible → 64px), bottom nav sur mobile/tablette
- **Breakpoints dashboard** : desktop ≥1024px (sidebar), tablette 768-1023px (bottom nav + modals centrés + grille 2 colonnes), mobile <768px (bottom nav + modals plein écran)
- **`useMobile()` hook** : breakpoint 1024px (retourne `true` pour tablette + mobile)
- **Anti-zoom iOS** : `font-size: 16px !important` sur inputs/selects/textareas (<1024px)
- **State** : React hooks (useState, useContext) — pas de Redux
- **100+ CSS custom properties** dans `index.css`

---

## Stack de déploiement (planifié)

| Service | Hébergeur | Coût |
|---------|-----------|------|
| Backend + BDD | Railway Hobby | ~€5/mois |
| Site vitrine + Dashboard | Cloudflare Pages | Gratuit |
| Email + SMS | Brevo (ex-Sendinblue) | Email gratuit (300/j), SMS ~€0.045/SMS |
| Domaine | barberclub-grenoble.fr (OVH) | Déjà acheté |

### Config Brevo
- Sender SMS : `BARBERCLUB` (alphanumeric sender ID)
- Sender Email : `noreply@barberclub-grenoble.fr` (nécessite DNS SPF/DKIM)
- `BREVO_API_KEY` dans `.env`

### Dashboard sécurité
- `noindex/nofollow` + `robots.txt`
- Sous-domaine : `gestion.barberclub-grenoble.fr`
- JWT auth
- Option : Cloudflare Access (whitelist emails)

---

## Variables d'environnement (.env)

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
JWT_SECRET=...
JWT_REFRESH_SECRET=...
CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500,http://localhost:5174,http://127.0.0.1:5174
BREVO_API_KEY=xkeysib-...
BREVO_SENDER_EMAIL=noreply@barberclub-grenoble.fr
BREVO_SENDER_NAME=BarberClub Meylan
BREVO_SMS_SENDER=BARBERCLUB
GOOGLE_REVIEW_URL=https://g.page/r/...
SALON_NAME=BarberClub Meylan
SALON_ADDRESS=26 Av. du Grésivaudan, 38700 Corenc
SALON_PHONE=+33xxxxxxxxx
SITE_URL=https://barberclub-grenoble.fr
```

---

## Bugs connus et fixes appliqués

| Bug | Fix | Fichiers |
|-----|-----|----------|
| node-postgres DATE retourne Date JS (timezone bug) | `types.setTypeParser(1082, val => val)` — retourne string | `database.js` |
| day_of_week 0=Lundi vs JS getDay() 0=Dimanche | Conversion explicite dans `availability.js` | `availability.js` |
| PostgreSQL TIME retourne `HH:MM:SS` | `.slice(0,5)` avant comparaison | Partout |
| UUIDs du seed non-standard (bits version=0) | `.matches(uuidRegex)` au lieu de `.isUUID()` | Toutes les routes |
| `.isDate({ format })` ne marche pas | `.matches(/^\d{4}-\d{2}-\d{2}$/)` | Routes bookings, analytics |
| Trust proxy manquant (rate limiter IP) | `app.set('trust proxy', 1)` | `index.js` |
| XSS dans emails | `escapeHtml()` sur tous les champs clients | `notification.js` |
| Race condition double-booking | `SELECT...FOR UPDATE` row lock en transaction | `booking.js` |
| Notification queue retry explosif | Exponential backoff (5→15→60 min), max 3 attempts | `notification.js` |
| Rate limiter auth bypassable via X-Forwarded-For | `keyGenerator` par IP+email dans `authLimiter` | `rateLimiter.js` |
| Availability acceptait dates passées et >6 mois | Validation 400 avec `ApiError` | `bookings.js` |

---

## Roadmap déploiement (3 phases)

### Phase 1 — Test Brevo (en attente rechargement 100 SMS/emails)
- [ ] Recharger compte Brevo (100 SMS/emails)
- [ ] Tester email confirmation réservation (récap + lien annulation/modif + .ics)
- [ ] Tester SMS rappel J-1 (cron 18h)
- [ ] Tester email avis Google (cron 10h, nouveau numéro uniquement)
- [ ] Tester email relance inactif (45j+, 3+ visites)
- [ ] Tester email annulation (via lien client + via admin)
- [ ] Tester email modification (reschedule, 1 seule fois)
- [ ] Tester retry queue (notification échouée → 3 tentatives backoff)

### Phase 2 — Migration Railway
- [ ] Créer projet Railway (plan Hobby ~€5/mois)
- [ ] Migrer BDD Supabase → PostgreSQL Railway
- [ ] Exécuter migrations 009 + 010 en prod
- [ ] Deploy backend sur Railway
- [ ] Configurer variables d'environnement (.env prod)
- [ ] Configurer DNS SPF/DKIM pour barberclub-grenoble.fr
- [ ] Ajouter `BREVO_API_KEY` dans `.env` prod
- [ ] Tester toutes les routes API en prod

### Phase 3 — Deploy test Cloudflare Pages
- [ ] Deploy site vitrine sur Cloudflare Pages (`*.pages.dev`)
- [ ] Deploy dashboard sur Cloudflare Pages (`*.pages.dev`)
- [ ] Tester réservation complète (flow client) sur URL pages.dev
- [ ] Tester dashboard admin sur URL pages.dev
- [ ] Valider CORS avec les nouvelles origines pages.dev
- [ ] Si tout OK → bascule DNS vers `barberclub-grenoble.fr` + `gestion.barberclub-grenoble.fr`

---

## TODO / Divers

- [x] Ajouter `review_requested` flag pour SMS avis unique (migration 009)
- [x] Créer page "Mes Réservations" frontend client (`pages/meylan/mon-rdv.html`)
- [x] Responsive tablette dashboard (breakpoint 1024px, bottom nav + modals centrés)
- [x] Fix audit sécurité (rate limiter, validation dates, manifest, console.log)
- [ ] Salon Grenoble : pas encore de booking custom (utilise Timify)
- [ ] Pages barber detail (`/pages/barbers/barber-*.html`) : améliorations possibles

---

## Notes pour Claude

1. **Ne PAS ouvrir en `file://`** — Toujours `localhost:5500`, sinon CORS bloque
2. **Prix en centimes** — 2700 = 27,00€. Frontend fait `/ 100`
3. **UUIDs seed non-standards** — Toujours `.matches(uuidRegex)`, JAMAIS `.isUUID()`
4. **day_of_week** — 0=Lundi en BDD, PAS 0=Dimanche comme JS
5. **CSS inline** — Chaque page HTML a son `<style>` intégré, pas de CSS externe partagé
6. **Grenoble** — Vitrine seulement, réservation via Timify (externe)
7. **Meylan** — Système complet (réservation + dashboard + backend)
8. **Backend `--watch`** — Modifications auto-rechargées en dev
9. **Pages légales** — 100% français obligatoire (obligation légale)
10. **Chemins relatifs** — Depuis `pages/*/` : assets = `../../assets/`, legal = `../legal/`
