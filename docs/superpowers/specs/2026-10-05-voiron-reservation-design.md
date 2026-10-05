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
  Réponse 403, `code: 'booking_closed'`, message
  « La réservation en ligne de Voiron ouvre bientôt. ».
- Le salon pris en compte est celui de la requête (`salon_id`), et pour le
  report celui du RDV en base.
- Le dashboard (`/api/admin/*`) n'est pas concerné : il peut créer des RDV
  Voiron avant l'ouverture. L'app BARBER CLUB+, si elle réserve par l'API
  publique, est bloquée comme le site.
- Statut public : `GET /api/salons/:id/status` → `{ id, online_booking_open }`.
  Salon inconnu → 404.
- Lecture du drapeau en base à chaque requête concernée (une requête indexée
  sur la clé primaire ; pas de cache, pour que l'interrupteur agisse tout de
  suite).

## 2. Interrupteur dans le dashboard

- `GET /api/admin/salon/online-booking` et `PUT` `{ open: boolean }` sur le
  salon courant (`req.user.salon_id`, déjà résolu par le middleware admin).
  Écriture tracée par `logAudit`.
- Page Système : carte « Réservation en ligne » en tête, interrupteur
  ouvert / fermé, confirmation avant changement, état lu depuis l'API.

## 3. Pages `pages/voiron/`

- `reserver.html`, `mon-rdv.html`, `reset-password.html`, `mon-compte.html`,
  copiées de Meylan (mise en page la plus proche), adaptées : `SALON_ID =
  'voiron'`, titres, meta, canonical, JSON-LD (adresse, téléphone, horaires
  9h-19h), photo `assets/images/salons/Voiron/`, adresse et téléphone affichés.
- `noindex, nofollow` sur les quatre pages, aucun lien depuis le site, absentes
  du sitemap jusqu'à la bascule.
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

## 5. Tests

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
