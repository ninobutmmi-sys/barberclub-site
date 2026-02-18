# BarberClub - Contexte Projet Complet

## Vue d'ensemble

BarberClub est un site vitrine + systeme de reservation pour un salon de barbier a Meylan (pres de Grenoble). Le proprietaire (Nino) veut remplacer Timify (~200$/mois) par un systeme custom. Le site existait deja (HTML/CSS statique), on y ajoute un backend API + interface de reservation + dashboard admin.

**Chemin du projet** : `/Users/nino/Desktop/BarberClub Site/`

---

## Architecture Technique

### Frontend Client (Site vitrine + Reservation)
- **Tech** : HTML/CSS/JS vanilla (pas de framework)
- **Design** : Fond noir, police Orbitron (titres) + Inter (corps), glassmorphism, style premium/dark
- **Serveur dev** : `npx serve -l 5500` depuis la racine du projet
- **URL dev** : `http://localhost:5500`
- **Page de reservation** : `/pages/meylan/reserver.html` (5 etapes : barber > prestation > date/creneau > infos client > succes)

### Backend API
- **Tech** : Node.js + Express
- **Chemin** : `/backend/`
- **Port** : 3000
- **Commande** : `npm run dev` (utilise `node --watch src/index.js`)
- **URL dev** : `http://localhost:3000`
- **Base de donnees** : Supabase PostgreSQL
  - Projet ref : `xntayuoywfdyjakarugp`
  - Connection string dans `/backend/.env` → `DATABASE_URL`

### Dashboard Admin
- **Tech** : React 19 + Vite 6 + React Router 7 + date-fns 4
- **Chemin** : `/dashboard/`
- **Port** : 5174
- **Commande** : `npm run dev`
- **URL dev** : `http://localhost:5174`

---

## Structure des Fichiers (hors node_modules)

```
BarberClub Site/
├── index.html                          # Landing page (choix salon Meylan/Grenoble)
├── sw.js                               # Service Worker (PWA)
├── config/manifest.json                # PWA manifest
├── assets/
│   ├── fonts/Orbitron-ExtraBold.ttf
│   ├── images/barbers/                 # Photos barbers
│   ├── icons/                          # Icones PWA
│   └── js/booking-modal.js             # Ancien modal (plus utilise)
├── pages/
│   ├── meylan/
│   │   ├── index.html                  # Page accueil Meylan
│   │   ├── reserver.html               # *** INTERFACE DE RESERVATION (Phase 3) ***
│   │   ├── barbers.html                # Page barbers
│   │   ├── prestations.html            # Page prestations (vitrine)
│   │   ├── contact.html
│   │   └── galerie.html
│   ├── grenoble/                       # Salon Grenoble (vitrine seulement, pas de booking)
│   │   ├── index.html
│   │   ├── reserver.html               # Encore sur Timify (iframe)
│   │   └── ...
│   ├── barbers/                        # Pages individuelles barbers
│   └── legal/                          # Mentions legales, CGU, RGPD
├── backend/
│   ├── .env                            # Variables d'environnement
│   ├── package.json
│   ├── database/
│   │   ├── schema.sql                  # Schema complet de la BDD
│   │   └── seed.sql                    # Donnees initiales (barbers, services, horaires)
│   └── src/
│       ├── index.js                    # Point d'entree, montage routes, CORS, cron
│       ├── config/
│       │   ├── env.js                  # Parsing des variables d'env
│       │   └── database.js             # Pool PostgreSQL (pg)
│       ├── middleware/
│       │   ├── auth.js                 # JWT verify, generateAccessToken, generateRefreshToken, requireAuth, requireAdmin
│       │   ├── rateLimiter.js          # Rate limiting (express-rate-limit)
│       │   └── validate.js             # handleValidation (express-validator)
│       ├── routes/
│       │   ├── health.js               # GET /api/health
│       │   ├── auth.js                 # POST /api/auth/login, /register, /refresh, /logout
│       │   ├── bookings.js             # Routes publiques: POST /api/bookings, GET /api/bookings/:id, etc.
│       │   ├── client.js               # Routes client connecte: GET /api/barbers, /api/services, /api/availability
│       │   └── admin/
│       │       ├── bookings.js         # CRUD admin bookings (planning vue jour/semaine)
│       │       ├── services.js         # CRUD admin services
│       │       ├── barbers.js          # CRUD admin barbers + schedules + overrides
│       │       ├── clients.js          # CRUD admin clients (recherche, profil, RGPD delete)
│       │       └── analytics.js        # Dashboard stats, revenue, etc.
│       ├── services/
│       │   ├── availability.js         # Calcul des creneaux disponibles (10min intervals)
│       │   ├── booking.js              # Creation atomique de reservation
│       │   └── notification.js         # Service de notifications (email/SMS) - squelette
│       ├── cron/
│       │   ├── reminders.js            # Rappels SMS J-1
│       │   ├── reviews.js              # Demande avis Google post-visite
│       │   └── retryNotifications.js   # Retry notifications echouees
│       └── utils/
│           ├── errors.js               # ApiError class (badRequest, notFound, unauthorized, etc.)
│           ├── logger.js               # Winston logger
│           └── ics.js                  # Generation fichier .ics (calendrier)
└── dashboard/
    ├── package.json                    # React 19, React Router 7, Vite 6, date-fns 4
    ├── vite.config.js                  # Port 5174
    ├── index.html                      # Entry HTML (Google Fonts Inter)
    └── src/
        ├── main.jsx                    # React root render
        ├── App.jsx                     # BrowserRouter, routes: /login, /planning, /services, /barbers, /clients, /clients/:id
        ├── api.js                      # Client API complet (fetch + auto-refresh JWT sur 401)
        ├── auth.jsx                    # AuthContext (login/logout/user state, localStorage)
        ├── index.css                   # Theme dark complet (--bg: #0a0a0a, --bg-card: #111113, sidebar, tables, modals, etc.)
        ├── components/
        │   └── Layout.jsx              # Sidebar navigation (Planning, Prestations, Barbers, Clients) + logout
        └── pages/
            ├── Login.jsx               # Email/password → POST /api/auth/login avec type: 'barber'
            ├── Planning.jsx            # Vue planning jour, colonnes barbers, cartes RDV, modal detail avec statut
            ├── Services.jsx            # Tableau CRUD services (nom, prix en euros, duree, barbers assignes, actif)
            ├── Barbers.jsx             # Cards barbers + modal edit + modal horaires hebdo + overrides
            ├── Clients.jsx             # Tableau searchable + tri, clic pour detail
            └── ClientDetail.jsx        # Stats client, notes editables, historique RDV, bouton suppression RGPD
```

---

## Base de Donnees

### Tables principales
- **barbers** : id (UUID), name, role, photo_url, email, password_hash, failed_login_attempts, locked_until, is_active, sort_order
- **services** : id (UUID), name, price (INTEGER en centimes), duration (INTEGER en minutes), is_active, sort_order
- **barber_services** : barber_id, service_id (table pivot)
- **schedules** : barber_id, day_of_week (0=Lundi...6=Dimanche), start_time, end_time, is_working
- **schedule_overrides** : barber_id, date, start_time, end_time, is_day_off, reason
- **clients** : id, first_name, last_name, phone (UNIQUE), email, password_hash, has_account, notes
- **bookings** : id, client_id, barber_id, service_id, date, start_time, end_time, status, price, cancel_token, source ('online'|'manual')
- **notification_queue** : booking_id, type, status, attempts, next_retry_at
- **refresh_tokens** : user_id, user_type, token, expires_at

### Donnees en base (seed)
- **Barbers** : Lucas (id: `b0000000-0000-0000-0000-000000000001`, email: lucas@barberclub.fr) et Julien (id: `b0000000-0000-0000-0000-000000000002`, email: julien@barberclub.fr)
- **Mot de passe** : `barberclub2026` pour les deux barbers
- **Services** : 12 prestations (Coupe Homme 27€, Coupe+Barbe 38€, etc.) — prix stockes en centimes
- **Horaires** : 9h-19h tous les jours pour les deux barbers
- **IMPORTANT** : Les UUIDs du seed sont non-standards (ex: `a0000000-0000-0000-0000-000000000001`). Les bits version/variant sont a 0, ce qui fait echouer `.isUUID()` d'express-validator. On utilise `.matches(uuidRegex)` a la place dans toutes les routes.

---

## Variables d'Environnement (.env)

```
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:Gatina1238190!@db.xntayuoywfdyjakarugp.supabase.co:5432/postgres
JWT_SECRET=bc_jwt_4f8a2e7d9c1b3f6a5e8d2c7b9a4f1e3d6c8b5a2f7e9d4c1b6a3f8e5d2c7b9a
JWT_REFRESH_SECRET=bc_ref_7d2e9f4a1c6b3e8d5a2f7c9b4e1d6a3f8c5b2e7d9a4f1c6b3e8a5d2f7c9b4e
CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500,http://localhost:5174,http://127.0.0.1:5174
RESEND_API_KEY=              (Phase 6 - pas encore configure)
TWILIO_ACCOUNT_SID=          (Phase 6)
TWILIO_AUTH_TOKEN=            (Phase 6)
TWILIO_PHONE_NUMBER=          (Phase 6)
SALON_NAME=BarberClub Meylan
SALON_ADDRESS=26 Av. du Gresivaudan, 38700 Corenc
```

---

## API Endpoints

### Routes Publiques (pas d'auth)
| Methode | Route | Description |
|---------|-------|-------------|
| GET | /api/health | Health check |
| GET | /api/barbers | Liste barbers actifs |
| GET | /api/services?barber_id= | Services (filtre optionnel par barber) |
| GET | /api/availability?service_id=&date=&barber_id= | Creneaux disponibles |
| POST | /api/bookings | Creer une reservation |
| GET | /api/bookings/:id?token= | Details d'une reservation |
| POST | /api/bookings/:id/cancel | Annuler (avec cancel_token) |
| GET | /api/bookings/:id/ics?token= | Telecharger .ics |

### Auth
| Methode | Route | Description |
|---------|-------|-------------|
| POST | /api/auth/login | Login (email, password, type: 'barber'|'client') |
| POST | /api/auth/register | Inscription client |
| POST | /api/auth/refresh | Refresh token |
| POST | /api/auth/logout | Logout (supprime refresh token) |

### Routes Admin (auth JWT required, type=barber)
| Methode | Route | Description |
|---------|-------|-------------|
| GET | /api/admin/bookings?date=&barber_id=&view= | Planning (jour/semaine) |
| POST | /api/admin/bookings | Ajout manuel de RDV |
| PUT | /api/admin/bookings/:id | Modifier un RDV |
| PATCH | /api/admin/bookings/:id/status | Changer statut (completed/no_show) |
| DELETE | /api/admin/bookings/:id | Soft delete RDV |
| GET | /api/admin/services | Toutes les prestations |
| POST | /api/admin/services | Creer prestation |
| PUT | /api/admin/services/:id | Modifier prestation |
| DELETE | /api/admin/services/:id | Soft delete prestation |
| GET | /api/admin/barbers | Tous les barbers |
| PUT | /api/admin/barbers/:id | Modifier barber |
| GET | /api/admin/barbers/:id/schedule | Horaires d'un barber |
| PUT | /api/admin/barbers/:id/schedule | Modifier horaires hebdo |
| POST | /api/admin/barbers/:id/overrides | Ajouter exception (jour off, horaires speciaux) |
| DELETE | /api/admin/barbers/overrides/:id | Supprimer exception |
| GET | /api/admin/clients?search=&sort=&order= | Liste clients avec recherche |
| GET | /api/admin/clients/:id | Profil client complet (stats, historique, favoris) |
| PUT | /api/admin/clients/:id | Modifier client (notes, nom, etc.) |
| DELETE | /api/admin/clients/:id | Suppression RGPD (anonymisation) |
| GET | /api/admin/analytics/dashboard | Stats globales |
| GET | /api/admin/analytics/revenue?start=&end= | Chiffre d'affaires par periode |

---

## Authentification

- **JWT Access Token** : 15 minutes, signe avec JWT_SECRET
- **JWT Refresh Token** : 7 jours, signe avec JWT_REFRESH_SECRET, stocke en BDD (table refresh_tokens)
- **Bcrypt** : 12 rounds pour le hash des mots de passe
- **Protection brute force** : Max 5 tentatives, verrouillage 15 min
- **Login barber** : POST /api/auth/login avec `{ email, password, type: "barber" }`
- **Credentials test** : lucas@barberclub.fr / barberclub2026

---

## Phases du Projet

### Phase 1 : Architecture — TERMINEE
- Schema BDD, structure backend, planification API

### Phase 2 : Backend & Base de donnees — TERMINEE
- Tout le backend Express, toutes les routes, middleware auth, services, cron jobs
- Schema SQL + seed SQL executes sur Supabase

### Phase 3 : Interface de Reservation Client — TERMINEE
- `/pages/meylan/reserver.html` — Interface 5 etapes en vanilla JS
- Remplace l'iframe Timify
- Flux : Choix barber (ou "peu importe") → Choix prestation → Calendrier + creneaux → Infos client → Confirmation
- Reservation testee et fonctionnelle (un RDV de test existe en base: Nino DALIBEY, 28 Feb 2026)

### Phase 4 : Dashboard Admin — EN COURS (90% fait)
- Dashboard React complet cree avec toutes les pages
- Login fonctionne (hash bcrypt corrige en base)
- Pages : Planning, Prestations, Barbers, Clients, ClientDetail
- **A TESTER** : Naviguer dans le dashboard, verifier que toutes les pages fonctionnent

### Phase 5 : Analytics & Donnees — A FAIRE
- Graphiques de stats (CA, reservations, clients)
- Possiblement integrer des charts (Chart.js ou similaire)

### Phase 6 : Notifications — A FAIRE
- **Resend** : Emails de confirmation, rappel
- **Twilio** : SMS de rappel J-1
- **Google Reviews** : Lien avis apres visite
- Les services/cron existent deja dans le backend mais les API keys ne sont pas configurees

### Phase 7 : Tests & Deploiement — A FAIRE
- Tests unitaires/integration
- Deploiement production (hebergeur a determiner)
- Configuration domaine reel

---

## Bugs Corriges

### 1. `.isUUID()` rejette les UUIDs du seed
**Probleme** : Les UUIDs du seed (`a0000000-...`, `b0000000-...`) ont les bits version/variant a 0, incompatibles avec la validation stricte UUID v4.
**Fix** : Remplace `.isUUID()` par `.matches(uuidRegex)` avec `const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;` dans TOUS les fichiers de routes :
- `/backend/src/routes/bookings.js`
- `/backend/src/routes/admin/bookings.js`
- `/backend/src/routes/admin/services.js`
- `/backend/src/routes/admin/barbers.js`
- `/backend/src/routes/admin/clients.js`

### 2. `.isDate()` format invalide
**Probleme** : `.isDate({ format: 'YYYY-MM-DD' })` ne fonctionne pas comme attendu.
**Fix** : Remplace par `.matches(/^\d{4}-\d{2}-\d{2}$/)` dans bookings.js et analytics.js.

### 3. Route POST /api/bookings retournait 404
**Probleme** : Les routes booking etaient montees sur `/api` sans prefixe `/bookings`.
**Fix** : Ajoute le prefixe `/bookings` aux routes POST, GET/:id, cancel, ics dans bookings.js.

### 4. Hash bcrypt ne correspondait pas au mot de passe
**Probleme** : Le hash dans seed.sql ne matchait pas `barberclub2026`.
**Fix** : Genere un nouveau hash avec `bcrypt.hash('barberclub2026', 12)` et mis a jour en BDD + dans seed.sql.

### 5. Navigation arriere dans reserver.html
**Probleme** : Retour en arriere de l'etape prestation vers barber = ecran noir (bug CSS position absolute/relative pendant transition).
**Fix** : Remplace le systeme de transition CSS (position absolute/relative) par un systeme `display: none/block` avec animations CSS keyframes (`stepIn` / `stepInReverse`).

---

## Commandes pour Demarrer

```bash
# 1. Backend (port 3000)
cd "/Users/nino/Desktop/BarberClub Site/backend"
npm run dev

# 2. Frontend client (port 5500)
cd "/Users/nino/Desktop/BarberClub Site"
npx serve -l 5500

# 3. Dashboard admin (port 5174)
cd "/Users/nino/Desktop/BarberClub Site/dashboard"
npm run dev
```

### URLs
- **Site client** : http://localhost:5500/pages/meylan/reserver.html
- **Dashboard admin** : http://localhost:5174 (login: lucas@barberclub.fr / barberclub2026)
- **API** : http://localhost:3000/api/health

---

## Notes Importantes pour le Prochain Claude

1. **Ne PAS ouvrir le site en file://** — Toujours passer par localhost:5500, sinon CORS bloque tout
2. **Les UUIDs du seed sont non-standards** — Utiliser `.matches(uuidRegex)` et JAMAIS `.isUUID()`
3. **Les prix sont en centimes** — 2700 = 27,00 EUR. Le dashboard et l'interface client font la conversion (/ 100)
4. **L'utilisateur n'est PAS developpeur** — Il faut des instructions simples et claires
5. **Le salon Grenoble n'a pas encore de systeme de reservation** — Il utilise encore Timify
6. **CORS est configure pour** : localhost:5500, 127.0.0.1:5500, localhost:5174, 127.0.0.1:5174
7. **Le backend utilise `--watch`** — Les modifications de fichiers sont prises en compte automatiquement
8. **Supabase est la BDD** — Pas de BDD locale, tout passe par le cloud Supabase

---

## Prochaines Etapes Immediates

1. **Tester le dashboard admin** — Verifier que toutes les pages (Planning, Prestations, Barbers, Clients) fonctionnent correctement apres le login
2. **Tester la navigation dans reserver.html** — Verifier que le retour arriere fonctionne bien maintenant
3. **Phase 5** : Ajouter des graphiques analytics au dashboard
4. **Phase 6** : Configurer Resend (email) et Twilio (SMS) pour les notifications
5. **Phase 7** : Tests et deploiement
