# App mobile BarberClub — Design (Capacitor)

**Date** : 2026-05-01
**Statut** : Validé par Nino, prêt pour writing-plans
**Cible** : MVP fonctionnel app iOS + Android côté **client uniquement** (pas de dashboard admin)
**Délai** : 2 semaines de dev plein temps
**Livrable V1** : TestFlight (iOS) + Internal Testing (Google Play) — pas de soumission store publique en V1

---

## 1. Goal & non-goals

### Goal
Livrer une app mobile native iOS + Android qui réplique l'expérience du site BarberClub côté client (réservation, mon-rdv, login, barbers, prestations, contact, galerie), enrichie de features natives (push, biometric, calendar, share, deep links), prête pour TestFlight + Google Internal Testing.

### Non-goals (V2 ou plus tard)
- **Programme de fidélité avec récompenses** : la page "mes RDV" affiche déjà les points côté site, l'app les affichera automatiquement. La mécanique récompenses + dépense de points sera dev en V2 (transversal site + app + dashboard).
- **Soumission App Store / Play Store publique** : itérations rejets Apple, sécurité hardenée → V2.
- **Sign in with Apple / Google** : obligatoire seulement si on garde "sign in with email" sur le store public → V2.
- **Certificate pinning, App Attestation (DeviceCheck / Play Integrity)** : sécurité avancée → V2.
- **Dashboard admin natif** : le dashboard reste web only.

### Contraintes
- **Le site web actuel ne doit pas être impacté** : code, build, deploy, URL, BDD — tout reste intact.
- **Backend** : modifications minimales et isolées (1 nouvelle table, 2 nouveaux endpoints, 1 nouveau service push mobile, 1 hook dans le service notifications existant). Aucune modif des endpoints existants.

---

## 2. Architecture & structure du repo

**Choix : monorepo, dossier `app/` isolé**

```
BarberClub Site/
├── pages/, assets/, config/         ← site web (intact)
├── backend/                          ← API Express (modifs minimales)
├── dashboard/                        ← admin (intact)
└── app/                              ← 🆕 nouveau dossier isolé
    ├── ios/                          ← projet Xcode généré par Capacitor
    ├── android/                      ← projet Android Studio
    ├── www/                          ← assets web embarqués (généré au build)
    ├── src/                          ← code spécifique app
    │   └── native-bridge.js         ← pont site ↔ Capacitor
    ├── capacitor.config.ts           ← config (app id, splash, plugins)
    ├── package.json                  ← Capacitor + plugins
    └── scripts/sync-from-site.sh     ← script copy site → www/
```

**App ID** : `fr.barberclub.app` (Bundle ID iOS + Application ID Android)

**Isolation du site** :
- Le dossier `app/` est read-only sur `pages/` et `assets/` (script de sync uniquement)
- Si on supprime `app/`, le site marche exactement pareil
- Ajouts à la racine : `.cloudflareignore` (ligne `app/`) et `.gitignore` (`app/ios/`, `app/android/`, `app/node_modules/`, `app/www/`)

**Exception explicite à l'isolation** : 2 fichiers `.well-known/apple-app-site-association` et `.well-known/assetlinks.json` doivent vivre à la racine du site déployé sur Cloudflare (requis pour Universal Links iOS + App Links Android). Ce sont les seules additions au site déployé. Aucun fichier source `pages/`/`assets/` n'est modifié.

---

## 3. Sync site → app (mécanisme central)

**Script `app/scripts/sync-from-site.sh`** :

1. Wipe `app/www/`
2. Copy `pages/` → `app/www/pages/`, `assets/` → `app/www/assets/` (sauf vidéos lourdes), `config/manifest.json` → `app/www/`, `index.html` → `app/www/index.html`
3. Patch les chemins API : **stratégie au build time** = inject une balise `<meta name="api-base-url" content="...">` dans `<head>` de chaque HTML synchronisé, lue par `assets/js/api-config.js`. Pas de regex sur le code applicatif (risque de drift). Le site déployé sur Cloudflare reste inchangé : la balise meta n'est injectée que dans `app/www/`, jamais dans `pages/` source.
4. Inject `<script src="/native-bridge.js">` dans toutes les pages HTML avant `</head>`
5. Copy `app/src/native-bridge.js` → `app/www/native-bridge.js`
6. `npx cap sync` : Capacitor copie `app/www/` dans iOS/Android et installe les plugins

**Vidéos** : restent sur Cloudflare CDN, app les charge en streaming via URL absolue. Sinon l'app dépasse la limite Apple 150 MB en cellulaire.

**`native-bridge.js`** : le pont JS qui :
- Détecte `window.Capacitor.isNativePlatform()`
- Override `localStorage.setItem`/`getItem`/`removeItem` pour les clés `bc_access_token`, `bc_refresh_token`, `bc_user`, `bc_salon` → redirection vers `@capacitor/preferences` (Keychain iOS / EncryptedSharedPreferences Android)
- Intercepte les actions natives possibles : `navigator.share`, ajout calendrier, `tel:`, etc.
- **Aucune modification du code source du site** — tout passe par override transparent

**Workflow Nino quand il modifie le site** :
```bash
# Modification site comme aujourd'hui
git commit / wrangler pages deploy

# Pour propager dans l'app :
cd app && npm run sync && npm run build:ios
# Puis upload TestFlight depuis Xcode
```

---

## 4. Plugins Capacitor & features natives

**Plugins officiels (Ionic team)**

| Plugin | Usage |
|--------|-------|
| `@capacitor/preferences` | Storage natif tokens auth |
| `@capacitor/push-notifications` | Permission, token APNs/FCM, click notif |
| `@capacitor/local-notifications` | Backup local rappel J-1 |
| `@capacitor/app` | Lifecycle, deep links via `appUrlOpen` |
| `@capacitor/browser` | Liens externes (Google Maps, avis) |
| `@capacitor/share` | Partage natif RDV |
| `@capacitor/haptics` | Feedback tactile (RDV confirmé, erreur) |
| `@capacitor/status-bar` | Style status bar |
| `@capacitor/splash-screen` | Splash logo BarberClub |
| `@capacitor/network` | Détection offline |

**Plugins community**

| Plugin | Usage |
|--------|-------|
| `capacitor-native-biometric` | Face ID / Touch ID / fingerprint |
| `@capacitor-community/calendar` | Ajout RDV calendrier natif |

**Features natives — points d'intégration**

1. **Login client** (étape login dans `reserver.html`) :
   - Si Capacitor + biométrie dispo → toggle "Activer Face ID" après 1er login
   - 2e login : "Se connecter avec Face ID" → biometric prompt → unlock refresh token Keychain → `/api/auth/refresh` → connecté

2. **Réservation confirmée** (étape 4) :
   - Haptics success
   - Bouton "Ajouter au calendrier" → calendar API native (au lieu .ics)
   - Bouton "Partager" → share natif

3. **Push notifications** :
   - Au 1er lancement après accept cookies : permission iOS/Android
   - Token device → `POST /api/client/push-token`
   - Click sur notif → deep link vers `mon-rdv.html?id=xxx`

4. **Universal Links / App Links** :
   - `https://barberclub-grenoble.fr/r/rdv/{id}/{token}` → si app installée, ouvre l'app ; sinon site
   - 2 fichiers à ajouter sur Cloudflare : `.well-known/apple-app-site-association` (JSON) + `.well-known/assetlinks.json`

---

## 5. Sécurité & flux d'auth

### Token storage
- **Pas de localStorage côté app** pour les tokens auth.
- `native-bridge.js` redirige les clés sensibles vers `@capacitor/preferences` :
  - iOS : Keychain (chiffré, lié au Secure Enclave)
  - Android : EncryptedSharedPreferences (chiffrement AES + Keystore)
- Code applicatif (api.js du site) inchangé — il continue d'appeler `localStorage.setItem` qui est intercepté.

### HTTPS strict
- Capacitor force HTTPS sur les calls API.
- Android : `usesCleartextTraffic="false"`, `networkSecurityConfig` strict.

### Refresh token rotation
- Backend déjà en place (rotation auto, table `refresh_tokens`, 90j) → aucune modif.

### Biometric login (flux complet)
1. Client login normal (email + password)
2. Après succès, prompt natif "Activer Face ID ?"
3. Si oui : refresh token stocké dans Keychain via `capacitor-native-biometric.setCredentials()`. Le plugin **gate l'accès au Keychain item via biométrie** (pas de wrap avec clé biométrique séparée — c'est l'API native du plugin).
4. Au lancement suivant : si toggle activé, écran "Touche pour déverrouiller" → biometric prompt → `getCredentials()` retourne le refresh token → `/api/auth/refresh` → connecté
5. 3 échecs biometric → fallback password classique
6. Logout → `deleteCredentials()` purge le Keychain

### Anti-tamper
- iOS : pas de jailbreak detection en V1 (overkill, V2 si soumission store)
- Android : `usesCleartextTraffic="false"` strict

### Apple Privacy Manifest
- `PrivacyInfo.xcprivacy` généré par Capacitor 6, complété pour déclarer : User Defaults, network calls, données stockées (email, téléphone, RDV)

### App Tracking Transparency (ATT)
- Pas de tracking cross-app → on déclare "Don't track" dans App Store Connect, pas de prompt ATT à l'utilisateur.

### RGPD
- **Nouveau endpoint obligatoire Apple** : `DELETE /api/client/account`
  - Apple impose depuis 2022 un moyen de supprimer son compte directement depuis l'app
  - ~20 lignes : auth required, soft-delete client, anonymisation phone/email, supprimer refresh tokens
- Bouton "Supprimer mon compte" dans la page profil/RDV (dans le site, donc embarqué automatiquement)

---

## 6. Push notifications & modifs backend

### Stack : Firebase Cloud Messaging (FCM)
- iOS : FCM relaye vers APNs (gratuit)
- Android : FCM direct (gratuit)
- **Pas Brevo** (Brevo ne fait pas de push mobile natif)
- Coût : 0 € illimité

### Modifs backend (minimales, isolées)

#### Migration BDD `023_client_push_tokens.sql`
```sql
CREATE TABLE client_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(device_token)
);
CREATE INDEX idx_client_push_tokens_client ON client_push_tokens(client_id);
```

#### Nouveaux endpoints
```
POST   /api/client/push-token       # Upsert token (auth client)
DELETE /api/client/push-token       # Au logout
DELETE /api/client/account          # RGPD Apple
```

#### Nouveau service `backend/src/services/pushMobile.js`
- **API FCM v1 (HTTP v1)** — la legacy FCM Server Key est deprecated depuis 2024
- Auth : OAuth2 via service account JSON, librairie `google-auth-library`
- Variables env Railway :
  - `FCM_PROJECT_ID` (depuis Firebase console)
  - `FCM_SERVICE_ACCOUNT_JSON` (contenu du fichier JSON service account, en string)
- Endpoint : `POST https://fcm.googleapis.com/v1/projects/{FCM_PROJECT_ID}/messages:send`
- Fail-safe : si push échoue, log + continue (pas critique, SMS reste source de vérité)

#### Hook dans `notification/templates.js`
```js
async function sendReminder(booking) {
  await sendReminderSMS(booking);                   // existant inchangé
  if (booking.client.has_push_token) {
    await sendPushMobile(booking);                  // nouveau, fail-safe
  }
}
```

### Notifications client envoyées

| Event | Notification |
|-------|--------------|
| Confirmation RDV | "✅ RDV confirmé chez {barber} le {date} à {heure}" |
| Rappel J-1 | "⏰ Rappel : RDV demain à {heure} chez BarberClub {salon}" |
| Annulation par admin | "❌ Ton RDV du {date} a été annulé. Tape pour reprendre RDV." |
| Modification | "📅 RDV déplacé au {nouvelle date}" |

Avis Google reste SMS only (pas de double notif).

### Engagement backend
~80 lignes au total : migration + endpoint push-token + endpoint delete-account + service pushMobile + hook reminder. Aucune modif des endpoints existants.

---

## 7. Planning par jour (2 semaines plein temps)

### Semaine 1 — Foundation

| Jour | Travail | Livrable |
|------|---------|----------|
| J1 | Créer `app/`, init Capacitor, `cap add ios/android`, .gitignore + .cloudflareignore, app id `fr.barberclub.app` | App vide qui s'ouvre simulateur iOS |
| J2 | Script `sync-from-site.sh`, premier sync, patch URLs API | App qui affiche la landing du site |
| J3 | `native-bridge.js`, plugin Preferences, deep links basiques, plugin App | Login client OK, tokens dans Keychain |
| J4 | Plugin Push (JS), migration BDD, endpoints push-token | Token device enregistré sur backend |
| J5 | Service FCM backend, hook templates, endpoint `DELETE /api/client/account` | Push reçu sur device test à création RDV |

**Code review J5** : full review de la semaine 1 avant Semaine 2.

### Semaine 2 — Features natives + finitions

| Jour | Travail | Livrable |
|------|---------|----------|
| J6 | Plugin biometric, flux "Activer Face ID après login" | Face ID / fingerprint marche |
| J7 | Share, calendar natif, haptics, status bar, splash, network | Toutes features natives MVP |
| J8 | Universal Links iOS + App Links Android, fichiers `.well-known/` Cloudflare | Clic email RDV → ouvre l'app |
| J9 | Splash logo BarberClub, icons (1024 iOS + adaptive Android), branding, privacy manifest | App jolie + conforme Apple |
| J10 | Tests multi-device : iPhone SE / 15 / Samsung / Xiaomi / tablet | Liste régressions |
| J11-12 | Fix bugs, edge cases (offline, RDV expiré, token invalid) | App stable |
| J13-14 | TestFlight + Internal Testing, doc `app/README.md`, polish | **TestFlight + Internal Testing prêts** |

**Code review J7, J10, J14** : code review systématique pour debug à chaque étape majeure (consigne Nino 2026-05-01).

---

## 8. Setup à faire par Nino (chemin non-critique)

| Étape | Quand | Coût |
|-------|-------|------|
| Apple Developer Program (création + validation entité) | **Démarrer J1** (validation entité = 1-2 semaines pour business, 24-48h individu) | 99 €/an |
| Google Play Console | Vers J6 | 25 € one-shot |
| Firebase project | Vers J4 (je guide) | Gratuit |
| Certificat APNs Apple | Quand compte Apple validé | Gratuit (5 min) |
| Icônes app (1024×1024 PNG) | Vers J9 | Soit fourni par Nino, soit généré depuis logo existant |
| Tester sur iPhone réel régulièrement | Tout au long | 0 |

---

## 9. Risques & mitigations

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Apple rejette pour "wrapper trop fin" (4.2.3) | Moyenne | Élevé | Ajout features natives (push + biometric + calendar + share + deep links) en V1, puis V2 stricte avant soumission publique |
| Sync site→app diverge (modif site oubliée dans l'app) | Élevée | Moyen | Script `sync-from-site.sh` 100% reproductible, doc workflow dans `app/README.md`, CI plus tard |
| Push FCM échoue silencieusement | Moyenne | Faible | Fail-safe : SMS Brevo reste source de vérité, push = bonus |
| Vidéos Cloudflare lentes en cellulaire | Faible | Faible | Lazy load existant, posters images |
| RDV créé hors-ligne perdu | Faible | Moyen | Bloquer la réservation si offline (message "pas de connexion") en V1, queue offline en V2 |
| Régression site web pendant le dev de l'app | Faible | Élevé | Le dossier `app/` est read-only sur le site, sync = copie. Code review systématique inclut check régression. |
| Capacitor learning curve (1ère app native) | Moyenne | Moyen | TestFlight delay acceptable (V1 ≠ soumission store). Doc Capacitor + Ionic est riche. Si J5 en retard → décaler features non-critiques (haptics, network detection) en buffer J11-12. |
| Apple Developer entité business non validée à temps | Moyenne | Élevé | Démarrer enrollment J1 (cf §8). Si délai > 2 semaines : compte individuel temporaire pour TestFlight, switch après. |

---

## 10. Tests & validation

### Tests fonctionnels (J10)
- Devices cibles : iPhone SE (petit écran iOS 16+), iPhone 15+ (encoche), Samsung Galaxy S series, Xiaomi low-end, iPad
- Flows critiques : ouverture app, choix salon, réservation 4 étapes, login, mon-rdv, modif/annulation, push reçu, click sur push, biometric login

### Tests sécurité
- Vérifier que tokens ne sont **jamais** dans localStorage côté app (DevTools)
- Vérifier que API ne tape jamais en HTTP (Charles Proxy ou Wireshark)
- Tester refresh token expiré → renouvellement transparent

### Tests régression site (chaque code review)
- Le site marche pareil avant/après chaque modif app
- Pas de régression en prod après deploy

### Code review
À chaque jour majeur (J5, J7, J10, J14) : invocation skill `code-review` ou `superpowers:requesting-code-review` pour debug. Fix HIGH/CRITICAL avant de passer.

---

## 11. Out of scope explicite

| Feature | Raison |
|---------|--------|
| Programme fidélité (récompenses + dépense points) | V2 transversale (site + app + dashboard) |
| Soumission App Store / Play Store publique | V2 — V1 = TestFlight + Internal Testing seulement |
| Sign in with Apple / Google | V2 (obligatoire seulement pour soumission publique) |
| Certificate pinning, App Attestation, jailbreak detection | V2 hardening |
| Dashboard admin natif | Web only |
| Mode offline avec queue | V1 = bloque réservation si offline |
| Apple Watch / Wear OS companion | Hors scope |

---

## 12. Définition de done V1

- [ ] App iOS build + tourne sur iPhone réel sans crash
- [ ] App Android build + tourne sur Samsung + Xiaomi sans crash
- [ ] Login client → token Keychain (vérifié Xcode)
- [ ] Réservation 4 étapes complète → RDV créé en BDD
- [ ] Push reçu à création RDV (device test)
- [ ] Biometric login marche (Face ID + Touch ID + fingerprint Android)
- [ ] Click sur push notif → deep link vers RDV
- [ ] Universal Link `r/rdv/.../...` ouvre l'app (sinon site)
- [ ] Endpoint `DELETE /api/client/account` opérationnel
- [ ] Site web 100% inchangé en prod (régression check) — sauf ajout des 2 fichiers `.well-known/` documentés en §2
- [ ] Message "Pas de connexion" affiché proprement si offline pendant réservation
- [ ] TestFlight build uploaded + invitable par lien
- [ ] Google Internal Testing build uploaded + invitable par lien
- [ ] Doc `app/README.md` avec workflow sync + build + test
- [ ] Code reviews J5, J7, J10, J14 passés sans HIGH/CRITICAL ouverts

---

## Annexe : commandes de référence

```bash
# Setup initial (J1)
cd "BarberClub Site"
mkdir app && cd app
npm init -y
npm install @capacitor/core @capacitor/cli
npx cap init "BarberClub" "fr.barberclub.app"
npx cap add ios
npx cap add android

# Sync site → app (chaque dev cycle)
cd app
npm run sync       # = ./scripts/sync-from-site.sh
npm run build:ios  # = npx cap sync ios && npx cap open ios
npm run build:android

# Test sur device
# iOS : Xcode → choose device → Cmd+R
# Android : Android Studio → choose device → Run
```
