# Voiron : réservation prête, fermée jusqu'à l'ouverture

Date : 2026-10-05. Statut : validé par Nino.

## Contexte

Voiron (3e salon) ouvre à une date pas encore fixée. L'équipe est en base
(migration 096 : Clément, Gabriel, Jules, Julien), tous en repos tant que les
horaires ne sont pas connus. Le salon ouvre de 9h à 19h. Le téléphone est
renseigné (097).

Objectif : tout le parcours de réservation en ligne est construit, déployé et
vérifiable, mais aucun client ne peut réserver avant que Nino ouvre la
réservation lui-même, le jour J, depuis le dashboard.

Hors périmètre : pages vitrine du salon (équipe, prestations, contact), la
page d'annonce `pages/voiron/index.html` devient la page du salon et reçoit
un bouton Réserver lors de la bascule (sous-projet 4).

## 1. Verrou serveur

- Migration : `salons.online_booking_open BOOLEAN NOT NULL DEFAULT true`, puis
  `false` pour `voiron`. Meylan et Grenoble inchangés.
- Routes publiques refusées quand le salon est fermé :
  `POST /api/bookings`, `POST /api/bookings/:id/reschedule`, `POST /api/waitlist`.
  Réponse 403 `{ error: 'La réservation en ligne de Voiron ouvre bientôt.',
  code: 'booking_closed' }`. Pour ça, `ApiError` gagne un champ `code`
  optionnel, que le handler global renvoie ; `trackError` ignore les erreurs
  `booking_closed` (refus attendu, pas une panne).
- `POST /bookings` et `POST /waitlist` : le garde lit le `salonId` déjà résolu
  par la route (défaut `'meylan'`, `bookings.js:381` et `:598`), avant
  `createBooking` (aucun effet de bord). Un barbier de Voiron invité à Meylan
  reste réservable sur Meylan : c'est le salon de la requête qui compte, et
  `salonCheck` (`services/booking.js:167`) empêche déjà de viser un barbier
  d'un autre salon.
- `reschedule` : la route ne connaît pas le salon ; le contrôle est fait dans
  `rescheduleBooking`, juste après le `SELECT … FOR UPDATE`, avec
  `booking.salon_id`.
- `cancel` n'est volontairement pas verrouillé : un client doit pouvoir
  annuler un RDV pris par le dashboard avant l'ouverture.
- Vérifié : aucune autre route publique ne crée de RDV (`register`,
  `claim-account`, `forgot-password`, `/client/*`, `/event-alerts`).
- Le dashboard (`/api/admin/*`) n'est pas concerné : il peut créer des RDV
  Voiron avant l'ouverture. L'app BARBER CLUB+, si elle réserve par l'API
  publique, est bloquée comme le site.
- Statut public : `GET /api/salons/:id/status` → `{ id, online_booking_open }`.
  `id` validé contre `SALON_IDS` ; salon inconnu → 404 (pas de repli sur
  Meylan comme `getSalonConfig`).
- Lecture du drapeau en base à chaque requête concernée (une requête indexée
  sur la clé primaire ; pas de cache, pour que l'interrupteur agisse tout de
  suite).

## 2. Interrupteur dans le dashboard

- `GET /api/admin/salon/online-booking` et `PUT` `{ open: boolean }` sur le
  salon courant (`req.user.salon_id`, déjà résolu par le middleware admin).
  Le middleware admin résout ce salon depuis le `salon_id` injecté par
  `dashboard/src/api.js`. Écriture tracée par
  `logAudit(req, action, entityType, entityId, details)`.
- Pas de rôle propriétaire dans le projet : tout barbier connecté au salon (y
  compris un invité du jour) peut basculer l'interrupteur. Assumé, comme pour
  le reste du dashboard ; la confirmation et l'audit limitent l'accident.
- Page Système, onglet Santé (`SystemHealth`) : carte « Réservation en ligne »
  en tête, interrupteur ouvert / fermé pour le salon courant, confirmation
  avant changement, état lu depuis l'API.

## 3. Pages `pages/voiron/`

- `reserver.html`, `mon-rdv.html`, `reset-password.html`, `mon-compte.html`,
  copiées de Meylan (mise en page la plus proche), adaptées : `SALON_ID =
  'voiron'`, titres, meta, canonical, JSON-LD (adresse, téléphone, horaires
  9h-19h), photo `assets/images/salons/Voiron/`, adresse et téléphone affichés.
- `mon-compte.html` a `'meylan'` codé en dur à deux endroits (lignes ~417 et
  ~576 de la copie Meylan) : les deux passent à `'voiron'`.
- `fetchWithRetry` (`reserver.html:702`) conserve `data.code` dans l'erreur
  levée (il ne retente pas les 403 : seuls réseau et ≥ 500 le sont).
- `noindex, nofollow` sur les quatre pages, aucun lien depuis le site, absentes
  du sitemap jusqu'à la bascule.
- `sw.js` : les quatre pages Voiron rejoignent `NEVER_CACHE`, sinon l'écran
  « Ouverture bientôt » serait resservi depuis le cache. `CACHE_VERSION` + 1.
- `reserver.html` interroge `/salons/voiron/status` au chargement. Fermé :
  écran « Ouverture bientôt » avec lien vers la page d'annonce. Avec
  `?apercu=1`, le parcours complet s'affiche (lecture seule de fait : la
  confirmation reçoit la 403 et affiche le message).
- Toute 403 `booking_closed` reçue par la page affiche le message du serveur.

## 4. Notifications Voiron (accompagnement de Nino)

- Emails : clé API Brevo propre à Voiron (`BREVO_API_KEY_VOIRON`), expéditeur
  `noreply@barberclub-grenoble.fr` / « BarberClub Voiron ». Vérifier sur
  Railway et via `GET /api/admin/notifications/brevo-status` côté Voiron.
- SMS : Twilio, `SMS_PROVIDER_VOIRON=twilio`, identifiants `TWILIO_*_VOIRON`
  (sinon repli sur les variables génériques), expéditeur `BARBERCLUB`,
  callback de statut vers le webhook Twilio. Vérifier via `twilio-status`.
- Lien avis Google : `GOOGLE_REVIEW_URL_VOIRON`, à fournir par Nino.

## 5. Ordre de déploiement

1. Backend (git push → Railway) : migration du drapeau, verrou, routes de
   statut et d'admin. Vérifier `GET /api/salons/voiron/status` → fermé.
2. Dashboard (build + wrangler) : la carte de l'interrupteur.
3. Site (`deploy-site.sh`) : pages Voiron et `sw.js`. La page ne doit jamais
   être en ligne avant la route de statut.

## 6. Tests

- Unitaires backend (mocks DB, comme `tests/unit/routes/*`) : verrou fermé →
  403 sur les trois routes pour Voiron ; Meylan/Grenoble passent ; route de
  statut ; routes admin du drapeau.
- Après déploiement : parcours `pages/voiron/reserver.html?apercu=1` en
  navigateur headless, confirmation interceptée côté réseau → vérifier la 403.
  Aucun RDV créé. Vérifier que `reserver.html` sans `apercu` affiche l'écran
  « Ouverture bientôt ».

## Le jour J (rappel, sous-projet 4)

Nino active l'interrupteur. Retrait du `noindex`, bouton Réserver sur la page
d'annonce, landing et sitemap, `contract_end` du profil Grenoble de Clément,
SMS aux inscrits.
