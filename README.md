# BarberClub — Plateforme digitale complète pour salons de barbier

> Système sur-mesure de site vitrine, réservation en ligne et gestion administrative pour deux salons haut de gamme à Grenoble et Meylan.

**Déposé dans le cadre du festival Multimédi'Alpes 2026 — Catégorie Développement Web**

---

## Le projet en bref

BarberClub remplace un logiciel de réservation externe (Timify, ~400 €/mois) par une plateforme entièrement personnalisée composée de trois briques :

| Brique | Description | Stack |
|--------|-------------|-------|
| **Site vitrine** | Landing page, pages salons, profils barbers, prestations, galerie, contact | HTML / CSS / JS vanilla, PWA |
| **Réservation en ligne** | Parcours client en 5 étapes avec confirmations email + SMS | HTML / JS + API REST |
| **Dashboard admin** | 15 modules de gestion quotidienne en temps réel | React 19, Vite, Socket.IO |
| **Backend API** | Serveur REST avec base de données, auth, notifications, cron jobs | Node.js, Express, PostgreSQL |

**Résultat :** coût d'hébergement < 10 €/mois au lieu de 400 €/mois — économie de 95 %.

---

## Chiffres clés

| Métrique | Valeur |
|----------|--------|
| Lignes de code | 76 000+ |
| Commits | 314 |
| Fichiers source | 330 |
| Tables PostgreSQL | 22 |
| Migrations SQL | 42 |
| Modules dashboard | 15 |
| Clients en base | 6 400+ |
| Salons gérés | 2 (Grenoble + Meylan) |
| Barbers actifs | 6 |
| Durée de développement | ~7 semaines (fév. — avr. 2026) |

---

## Site vitrine public

### Design & effets visuels

Le site adopte un design dark premium avec glassmorphism (fond noir, surfaces semi-transparentes avec flou d'arrière-plan). Les principales interactions :

- **Intro cinématique** — séquence d'apparition du logo avec glow multi-couche (bloom, pulse, focus), jouée une seule fois par session
- **Sélecteur dual-salon** — split-screen avec expansion au survol, chaque côté affiche son salon avec Ken Burns (zoom lent 25s sur l'arrière-plan)
- **Parallaxe adaptative** — souris sur desktop, gyroscope sur mobile (avec demande de permission iOS)
- **Curseur custom** — point + anneau en `mix-blend-mode: difference`, l'anneau s'agrandit au survol des éléments interactifs
- **Boutons magnétiques** — se déplacent vers le curseur avec un coefficient de 0.3
- **Tilt 3D** — cartes barbers avec `perspective(800px)` et rotation ±5° selon la position du curseur
- **Animation lettre par lettre** — les titres s'animent caractère par caractère avec un délai en cascade de 0.06s
- **Effet ripple** — ondulation radiale au clic sur les boutons de réservation
- **Particules** — éléments flottants générés dynamiquement avec des durées aléatoires (7-21s)
- **Grain** — texture SVG en bruit fractal superposée à 3 % d'opacité

### Pages

- **Landing** (`/`) — sélecteur entre les deux salons + teaser troisième salon (Voiron, à venir)
- **Hub salon** (`/pages/[salon]/`) — navigation centrale vers toutes les sous-pages
- **Barbers** — grille d'équipe avec vidéos de présentation et tilt 3D au survol
- **Profil barber** — page individuelle avec vidéo hero, bio, galerie de réalisations
- **Prestations** — catalogue avec tarifs, durées et pastilles de couleur par service
- **Galerie** — photos du salon + avis Google intégrés
- **Contact** — carte Leaflet interactive, horaires, transports, lien Google Maps
- **Pages légales** — CGU, mentions légales, politique de confidentialité (conformes RGPD)

### PWA & SEO

- Progressive Web App installable avec Service Worker (cache network-first)
- Données structurées Schema.org (BarberShop, Person, BreadcrumbList, ReserveAction)
- Open Graph + Twitter Cards, sitemap.xml, robots.txt
- Consentement cookies avec chargement conditionnel des trackers

### Responsive

- Mobile-first avec breakpoints 768px et 1024px
- Navigation bottom bar glassmorphique sur mobile, barre centrée sur desktop
- `font-size: 16px` forcé sur les inputs pour éviter le zoom iOS
- Support `env(safe-area-inset-*)` pour les encoches

---

## Système de réservation

### Parcours client (5 étapes)

1. **Choix du barber** — grille de cartes avec avatar, nom, rôle. Option "Peu importe" qui répartit automatiquement la charge entre les barbers disponibles
2. **Choix de la prestation** — liste des services avec nom, durée, prix. Services filtrés selon le barber sélectionné
3. **Date et créneau** — calendrier mensuel avec navigation, créneaux de 30 min générés en temps réel. Suggestions rapides ("Ce soir", "Demain", "Samedi")
4. **Coordonnées** — téléphone (sélecteur pays E.164), email, prénom, code promo optionnel. Validation de la politique d'annulation via modal
5. **Confirmation** — récapitulatif complet, bouton de validation

### Après la réservation

- Email de confirmation immédiat avec fichier `.ics` (ajout au calendrier)
- SMS de rappel la veille (J-1 à 18h, ou immédiat si réservation < 24h)
- SMS de demande d'avis Google 60 min après le rendez-vous (une seule fois par client)
- Lien unique par `cancel_token` pour gérer le RDV sans créer de compte (annulation, report)

### Gestion du RDV (`/mon-rdv`)

- Consultation des détails via token ou recherche par téléphone
- Annulation gratuite jusqu'à 12h avant
- Report une fois maximum (12h avant), avec nouveau calendrier de créneaux
- Téléchargement du `.ics` à tout moment
- États : confirmé, terminé, annulé, déjà annulé

---

## Dashboard d'administration

Application React SPA avec mises à jour en temps réel via WebSocket. 15 modules :

### Gestion quotidienne

- **Planning** — grille horaire 8h-20h par barber, vue jour/semaine. Nouveaux RDV en temps réel via Socket.IO. Création manuelle, actions rapides (terminer, faux plan, annuler, décaler). Mini-calendrier de navigation, indicateur "maintenant"
- **Barbers** — profils, horaires hebdomadaires éditables, overrides (congés, pauses), assignations invité inter-salons
- **Services** — CRUD prestations avec prix, durée, durée samedi, couleur, assignation par barber, restrictions horaires
- **Clients** — base de 6 400+ fiches, recherche, tri, historique complet, notes, export CSV, suppression RGPD
- **Liste d'attente** — suivi des clients en attente, notification SMS automatique quand un créneau se libère, bouton de réservation rapide

### Suivi & analytics

- **Analytics** — CA par période/barber/service, taux d'occupation, heures de pointe, heatmap horaire, tendances vs mois précédent
- **Objectifs** — classement mensuel gamifié (CA, nombre de RDV, taux de présence) avec médailles
- **Historique** — journal des réservations filtrable + audit log complet (qui a fait quoi, avant/après)
- **Faux plans** — suivi des no-shows par client

### Communication

- **SMS** — campagnes avec templates (rappel, promo, réactivation), envoi en masse ou ciblé, historique
- **Mailing** — campagnes email via Brevo (300/jour gratuits), templates, suivi
- **Campagnes** — tracking ROI des campagnes (clics, conversions, CA généré)

### Commerce

- **Caisse** — transactions journalières (CB, espèces, Lydia), clôture quotidienne avec totaux par méthode
- **Boutique** — gestion de stock produits, alertes stock bas, historique des ventes, cartes cadeaux

### Système

- **Monitoring** — état API/DB/mémoire, statut des cron jobs, taux de livraison SMS/email, circuit breaker Brevo, backup DB

### Interface

- Sidebar rétractable (240px → 64px) avec navigation groupée
- Thème dark/light avec toggle
- Notifications temps réel (toast slide-in, badge compteur sur la cloche)
- Recherche globale de clients
- Responsive : sidebar sur desktop, bottom nav sur mobile
- Cache offline via React Query (localStorage)

---

## Architecture technique

### Backend (Node.js / Express)

```
backend/
├── src/
│   ├── routes/
│   │   ├── auth.js              # Login, register, refresh, forgot/reset password
│   │   ├── bookings.js          # CRUD public (réservation, annulation, report)
│   │   ├── client.js            # Profil client, export RGPD, suppression
│   │   └── admin/               # 14 fichiers de routes admin
│   │       ├── analytics.js     # KPIs, revenue, occupancy, peak hours
│   │       ├── bookings.js      # Planning, historique, actions admin
│   │       ├── barbers.js       # Staff, horaires, overrides, guest days
│   │       ├── clients.js       # Base clients, recherche, export
│   │       ├── services.js      # Prestations, restrictions
│   │       ├── payments.js      # Caisse, clôture
│   │       ├── products.js      # Boutique, stock, ventes
│   │       ├── sms.js           # Campagnes SMS
│   │       ├── mailing.js       # Campagnes email
│   │       ├── waitlist.js      # Liste d'attente
│   │       ├── notifications.js # Logs, stats, purge
│   │       ├── automation.js    # Triggers automatiques
│   │       ├── systemHealth.js  # Monitoring
│   │       └── ...
│   ├── services/
│   │   ├── booking.js           # Logique métier (création atomique, annulation, report)
│   │   ├── availability.js      # Calcul des créneaux disponibles
│   │   └── notification/        # Templates email/SMS, intégration Brevo, queue
│   ├── middleware/
│   │   ├── auth.js              # JWT verify, token generation, refresh
│   │   └── rateLimiter.js       # 3 niveaux (public 60/min, auth 10/15min, admin 200/min)
│   ├── cron/                    # 6 tâches planifiées
│   └── database/
│       ├── schema.sql           # DDL complet
│       └── migrations/          # 42 migrations incrémentales
```

### Base de données (PostgreSQL — 22 tables)

**Coeur métier :** `bookings`, `barbers`, `services`, `barber_services`, `clients`, `client_salons`, `schedules`, `schedule_overrides`, `blocked_slots`, `guest_assignments`

**Notifications :** `notification_queue` (file d'attente avec retry exponentiel, 3 tentatives, backoff 5→15→60 min)

**Commerce :** `payments`, `register_closings`, `products`, `product_sales`, `gift_cards`

**Fonctionnalités :** `waitlist`, `campaigns`, `automation_triggers`, `audit_log`

**Auth :** `refresh_tokens` (max 5 sessions actives par utilisateur)

**Config :** `salons` (multi-tenant, credentials Brevo par salon)

### Sécurité

| Mesure | Détail |
|--------|--------|
| Auth | JWT (access 15 min + refresh 90 jours avec rotation), bcrypt 12 rounds |
| Brute force | Verrouillage 15 min après 5 tentatives échouées |
| Rate limiting | 3 niveaux adaptatifs (public, auth, admin) |
| Double réservation | Advisory lock PostgreSQL + index unique transactionnel |
| Validation | express-validator sur toutes les entrées |
| Headers | Helmet (CSP, HSTS, X-Frame-Options, etc.) |
| CORS | Whitelist d'origines, credentials httpOnly |
| RGPD | Export données (art. 20), suppression/anonymisation (art. 17) |
| Audit | Traçabilité complète des actions dans `audit_log` |

### Cron jobs (production)

| Job | Fréquence | Rôle |
|-----|-----------|------|
| `processQueue` | Toutes les 2 min | Traite la file de notifications (email/SMS) avec retry |
| `queueReminders` | Toutes les 30 min | Planifie les rappels J-1 pour les RDV confirmés |
| `automationTriggers` | Toutes les 10 min | Auto-complétion des RDV passés, envoi review email |
| `cleanupNotifications` | 03h00 quotidien | Purge les notifications > 30 jours |
| `cleanupExpiredTokens` | 03h30 quotidien | Purge les refresh tokens expirés |
| `dailyBackup` | 04h00 quotidien | Sauvegarde de la base |

Chaque job utilise un **advisory lock PostgreSQL** dédié pour éviter les exécutions concurrentes en multi-instance.

### Notifications (Brevo)

- **Email :** confirmation, annulation, report, rappel, review, reset password
- **SMS :** confirmation (si < 24h), rappel J-1, review (60 min après), waitlist
- **Circuit breaker :** 3 échecs consécutifs → pause 60s. Erreur 401 (clé désactivée) → blocage permanent
- **Retry :** 3 tentatives avec backoff exponentiel (5 → 15 → 60 min)

### Temps réel (Socket.IO)

Le dashboard reçoit les événements en direct :
- `booking:created` — nouveau RDV affiché instantanément dans le planning
- `booking:updated` — modification reflétée
- `booking:cancelled` — RDV retiré du planning
- `booking:client-action` — notification quand un client annule/reporte depuis le site

---

## Infrastructure & déploiement

| Service | Hébergement | Coût |
|---------|-------------|------|
| Site vitrine | Cloudflare Pages | Gratuit |
| Dashboard | Cloudflare Pages | Gratuit |
| Backend API | Railway | ~5 €/mois |
| Base de données | PostgreSQL sur Railway | Inclus |
| Email + SMS | Brevo | 300 emails/jour gratuits, SMS ~0,045 €/unité |

**Déploiement :** `git push` déclenche le déploiement automatique sur Railway (backend). Le site et le dashboard sont déployés via Cloudflare Pages CLI.

---

## Stack technique complète

### Site vitrine
HTML5, CSS3, JavaScript ES6+, Service Worker, Leaflet (cartographie)

### Dashboard
React 19, Vite 6, React Router 7 (HashRouter), TanStack React Query 5, Socket.IO Client, date-fns 4 (locale FR)

### Backend
Node.js 18+, Express 4, PostgreSQL 14+, JSON Web Token, bcrypt, Helmet, CORS, express-validator, express-rate-limit, node-cron, Winston (logging), Brevo API (email + SMS), web-push, Socket.IO

### Typographie & design
Orbitron ExtraBold (titres, 800), Inter (corps, 300-700), dark theme glassmorphism

---

## Méthodologie

Ce projet a été développé sur environ 7 semaines, du 18 février au 9 avril 2026. L'IA Claude (Anthropic) a été utilisée comme assistant de développement pour accélérer l'écriture de certaines parties du code et résoudre des problèmes techniques ponctuels. La conception de l'architecture, les choix techniques, la logique métier, le design, les parcours utilisateurs et la gestion du projet ont été réalisés par mes soins. Le projet est en production et utilisé quotidiennement par les deux salons BarberClub et leurs clients.

---

## Lancer le projet en local

```bash
# Site vitrine
npx serve -l 5500

# Backend
cd backend && npm install && npm run dev
# → http://localhost:3000/api

# Dashboard
cd dashboard && npm install && npm run dev
# → http://localhost:5174
```

Variables d'environnement requises dans `backend/.env` :
```
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
BREVO_API_KEY=...
BREVO_SENDER_EMAIL=...
BREVO_SMS_SENDER=...
SITE_URL=...
API_URL=...
```

---

## Auteur

**Nino Dalibey** — Étudiant BUT MMI, IUT UGA Grenoble

Projet réalisé pour un client réel (BarberClub, SAS Clot Bey) dans le cadre d'une activité de développement web freelance.
