# App Mobile BarberClub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing BarberClub PWA in a Capacitor native shell to ship iOS/Android client apps with native features (push, biometric, calendar, share, deep links), ready for TestFlight + Google Internal Testing — without touching the existing site code.

**Architecture:** Monorepo with isolated `app/` directory at repo root. Site stays fully untouched. A sync script copies `pages/` and `assets/` into `app/www/` at build time, injects a `<meta>` tag for the API URL, and a `native-bridge.js` shim that intercepts `localStorage` writes for auth tokens and routes them to native secure storage (Keychain iOS / EncryptedSharedPreferences Android). Backend gets minimal isolated additions: 1 migration (`050_client_push_tokens.sql`), 3 new endpoints (`POST/DELETE /api/client/push-token`, `DELETE /api/client/account`), 1 new service (`pushMobile.js` using FCM v1 OAuth2), 1 hook in the existing notification templates.

**Tech Stack:** Capacitor 6+, TypeScript (config only), 12 official + 1 community Capacitor plugins, FCM v1 (OAuth2 service account via `google-auth-library`), Node.js 18+ Express backend, PostgreSQL 16 (Railway), Vitest for JS unit tests, Jest for backend (existing).

---

## Reference Documents

- **Spec:** `docs/superpowers/specs/2026-05-01-app-mobile-capacitor-design.md`
- **Project guide:** `CLAUDE.md` (root)
- **Backend tests existants:** `backend/tests/` (Jest + helpers)
- **Backend migrations existantes:** `backend/database/migrations/` (jusqu'à `049_tasks.sql`)

---

## Pre-flight Checklist (Nino, à démarrer J1)

These run in parallel with dev work — they have wait times outside our control.

- [ ] **Apple Developer Program enrollment** (~99 €/an, validation 1-2 semaines pour business)
  - https://developer.apple.com/programs/enroll/
  - **Démarrer J1** : si entité business prend 2 semaines, blocage TestFlight au plus tard J14
  - Si urgent : créer compte individuel temporaire, switch business plus tard

- [ ] **Google Play Console signup** (~25 € one-shot, validation 24-48h)
  - https://play.google.com/console/signup

- [ ] **Firebase project** (gratuit, 5 min) — guidé en Task 1.13

- [ ] **Logo source** — me confirmer si `assets/images/common/logo.png` est OK comme source pour les icônes app, ou fournir un PNG 1024×1024

---

## Phase 1 — Foundation (Days 1-5)

**Goal Phase 1:** App qui boot iOS + Android, login client OK avec token Keychain, push notifications end-to-end fonctionnel.

---

### Task 1.1: Setup git/Cloudflare ignores et structure dossier app/

**Files:**
- Modify: `.gitignore`
- Create: `.cloudflareignore`

- [ ] **Step 1.1.1: Ajouter exclusions dans `.gitignore`**

Ajouter à la fin de `.gitignore` :
```
# Capacitor app — generated/native artifacts
app/ios/
app/android/
app/node_modules/
app/www/
app/.gradle/
app/build/
app/*.log
```

- [ ] **Step 1.1.2: Créer `.cloudflareignore` à la racine**

```
# Exclusion du dossier app/ du déploiement Cloudflare Pages
app/
backend/
dashboard/
docs/
*.md
.git/
node_modules/
```

(On exclut aussi `backend/`, `dashboard/`, `docs/` qui ne sont pas servis par Cloudflare Pages mais étaient potentiellement uploadés inutilement.)

- [ ] **Step 1.1.3: Vérifier que le site se déploie toujours pareil**

```bash
cd "BarberClub Site"
npx wrangler pages deploy . --project-name barberclub-site --branch production --commit-dirty=true
```

Expected: Same number of files uploaded as last deploy ± nouveaux fichiers spec/plan. Le site doit toujours répondre normalement sur https://barberclub-site.pages.dev/pages/grenoble/barbers.html

- [ ] **Step 1.1.4: Commit + tag baseline**

```bash
git add .gitignore .cloudflareignore
git commit -m "chore: ignore app/ and non-static dirs from git/cloudflare"
git tag app-phase0-baseline   # référence pour les diffs de code review (Task 1.15)
```

---

### Task 1.2: Init Capacitor projet `app/`

**Files:**
- Create: `app/package.json`
- Create: `app/capacitor.config.ts`
- Create: `app/www/index.html` (placeholder temporaire)

- [ ] **Step 1.2.1: Vérifier prérequis**

Run:
```bash
node --version    # >= 18
npm --version     # >= 9
xcode-select -p   # Doit retourner /Applications/Xcode.app/...
```

Si Xcode pas installé : prompter Nino.

- [ ] **Step 1.2.2: Init projet `app/`**

```bash
cd "BarberClub Site"
mkdir -p app
cd app
npm init -y
npm install @capacitor/core@^6 @capacitor/cli@^6
```

- [ ] **Step 1.2.3: Init Capacitor**

```bash
cd app
npx cap init "BarberClub" "fr.barberclub.app" --web-dir=www
```

Cela crée `capacitor.config.ts`. Vérifier le contenu :

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'fr.barberclub.app',
  appName: 'BarberClub',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  }
};

export default config;
```

- [ ] **Step 1.2.4: Placeholder `www/index.html`**

Cap exige un `index.html` au minimum dans `webDir`. Créer placeholder :

```bash
mkdir -p www
echo '<!DOCTYPE html><html><body><h1>Loading…</h1></body></html>' > www/index.html
```

- [ ] **Step 1.2.5: Ajouter scripts `package.json`**

Modifier `app/package.json` pour ajouter dans `scripts` :

```json
{
  "scripts": {
    "sync": "bash scripts/sync-from-site.sh",
    "build:ios": "npm run sync && npx cap sync ios && npx cap open ios",
    "build:android": "npm run sync && npx cap sync android && npx cap open android",
    "doctor": "npx cap doctor"
  }
}
```

- [ ] **Step 1.2.6: Commit**

```bash
git add app/package.json app/package-lock.json app/capacitor.config.ts app/www/index.html
git commit -m "feat(app): init Capacitor project structure"
```

---

### Task 1.3: Ajouter plateformes iOS + Android

**Files:**
- Generated: `app/ios/` (Xcode project)
- Generated: `app/android/` (Android Studio project)

- [ ] **Step 1.3.1: Ajouter iOS**

```bash
cd app
npm install @capacitor/ios@^6
npx cap add ios
```

- [ ] **Step 1.3.2: Ajouter Android**

```bash
npm install @capacitor/android@^6
npx cap add android
```

- [ ] **Step 1.3.3: Ouvrir iOS dans Xcode pour première compilation**

```bash
npx cap open ios
```

Dans Xcode : sélectionner un simulateur (iPhone 15 par défaut), Cmd+R.
Expected: app boot sur le simulateur avec le placeholder "Loading…".

- [ ] **Step 1.3.4: Vérifier Android**

```bash
npx cap open android
```

Dans Android Studio : laisser Gradle sync, puis Run sur émulateur.
Expected: même placeholder.

Si Android Studio pas installé : skip cette étape, prompter Nino.

- [ ] **Step 1.3.5: Vérifier que le `.gitignore` exclut bien `ios/` et `android/`**

```bash
cd "BarberClub Site"
git status
```

Expected: `app/ios/` et `app/android/` n'apparaissent pas comme untracked. Si oui, OK.

- [ ] **Step 1.3.6: Commit (`.gitignore` est déjà en place, donc rien à add ici sauf package.json)**

```bash
git add app/package.json app/package-lock.json
git commit -m "feat(app): add iOS and Android platforms"
```

---

### Task 1.4: Script de sync site → app

**Files:**
- Create: `app/scripts/sync-from-site.sh`
- Create: `app/scripts/inject-meta.sh` (helper)

- [ ] **Step 1.4.1: Créer script `sync-from-site.sh`**

Path: `app/scripts/sync-from-site.sh`

```bash
#!/bin/bash
# Sync site web vers app/www/ pour build Capacitor.
# Usage : npm run sync
# Idempotent : wipe et recopie à chaque fois.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$APP_DIR/.." && pwd)"
WWW="$APP_DIR/www"

echo "→ Sync from $ROOT into $WWW"

# 1. Wipe www/
rm -rf "$WWW"
mkdir -p "$WWW"

# 2. Copy site assets (sauf vidéos lourdes — restent sur Cloudflare CDN)
cp "$ROOT/index.html" "$WWW/index.html"
cp "$ROOT/sw.js" "$WWW/sw.js" 2>/dev/null || true
cp -R "$ROOT/pages" "$WWW/pages"
mkdir -p "$WWW/assets"
cp -R "$ROOT/assets/css" "$WWW/assets/" 2>/dev/null || true
cp -R "$ROOT/assets/js" "$WWW/assets/"
cp -R "$ROOT/assets/fonts" "$WWW/assets/" 2>/dev/null || true
cp -R "$ROOT/assets/icons" "$WWW/assets/"
cp -R "$ROOT/assets/images" "$WWW/assets/"

# Vidéos NON copiées : trop lourdes (limite Apple 150 MB)
# Elles restent sur Cloudflare CDN, le site les charge via URL absolue.

mkdir -p "$WWW/config"
cp "$ROOT/config/manifest.json" "$WWW/config/" 2>/dev/null || true

# 3. Inject native-bridge.js dans toutes les pages HTML
SRC_BRIDGE="$APP_DIR/src/native-bridge.js"
DST_BRIDGE="$WWW/native-bridge.js"
cp "$SRC_BRIDGE" "$DST_BRIDGE"

# 4. Inject meta api-base-url + script bridge in <head> de chaque HTML
API_URL="${APP_API_URL:-https://fortunate-benevolence-production-7df2.up.railway.app/api}"
META_TAG="<meta name=\"api-base-url\" content=\"$API_URL\">"
SCRIPT_TAG="<script src=\"/native-bridge.js\"></script>"

find "$WWW" -name "*.html" -type f | while read -r html; do
  # Inject avant </head> — utilise un marker pour éviter double-injection
  if ! grep -q '<meta name="api-base-url"' "$html"; then
    # Use awk for portable in-place injection (sed -i diffère macOS/Linux)
    awk -v meta="$META_TAG" -v script="$SCRIPT_TAG" '
      /<\/head>/ && !injected { print "  " meta; print "  " script; injected=1 }
      { print }
    ' "$html" > "$html.tmp" && mv "$html.tmp" "$html"
  fi
done

echo "✅ Sync done. $(find "$WWW" -type f | wc -l | xargs) files."
```

- [ ] **Step 1.4.2: Make executable**

```bash
chmod +x app/scripts/sync-from-site.sh
```

- [ ] **Step 1.4.3: Test dry-run (sans bridge file encore)**

Créer un placeholder bridge pour tester :
```bash
mkdir -p app/src
echo "// placeholder" > app/src/native-bridge.js
cd app && npm run sync
```

Expected: `✅ Sync done. <N> files.` et `app/www/pages/grenoble/barbers.html` doit contenir `<meta name="api-base-url"` et `<script src="/native-bridge.js">` dans `<head>`.

- [ ] **Step 1.4.4: Vérifier injection meta**

```bash
grep "api-base-url" app/www/pages/grenoble/barbers.html
grep "native-bridge" app/www/pages/grenoble/barbers.html
```

Expected: les 2 lignes présentes.

- [ ] **Step 1.4.5: Commit**

```bash
git add app/scripts/sync-from-site.sh app/src/native-bridge.js
git commit -m "feat(app): add sync-from-site script with meta+bridge injection"
```

---

### Task 1.5: Premier sync iOS et boot du site dans l'app

**Files:**
- Modify: `assets/js/api-config.js` (rendre meta-aware) — **mais sans casser le site web**

- [ ] **Step 1.5.1: Lire le contenu actuel de `api-config.js`**

```bash
cat "assets/js/api-config.js"
```

État actuel (vérifié 2026-05-01) :
```javascript
(function () {
  const API_PROD = 'https://api.barberclub-grenoble.fr/api';
  const API_DEV = 'http://localhost:3000/api';
  window.BARBERCLUB_API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? API_DEV
    : API_PROD;
})();
```

Le global est `window.BARBERCLUB_API`. **Toute modif doit garder ce nom** (le code applicatif l'utilise déjà partout).

- [ ] **Step 1.5.2: Modifier `api-config.js` pour supporter la `<meta>` injectée**

Remplacer le contenu actuel par :

```javascript
// ============================================
// BarberClub — API URL Configuration (shared)
// ============================================
// Single source of truth for the API URL.
// Used by all frontend pages (site vitrine + Capacitor app).
//
// Priority:
//   1. <meta name="api-base-url" content="..."> — injected by app/scripts/sync-from-site.sh
//   2. localhost detection → API_DEV
//   3. Default → API_PROD

(function () {
  const API_PROD = 'https://api.barberclub-grenoble.fr/api';
  const API_DEV = 'http://localhost:3000/api';

  // Priority 1 : meta tag (Capacitor app build only)
  const meta = document.querySelector('meta[name="api-base-url"]');
  if (meta && meta.content) {
    window.BARBERCLUB_API = meta.content;
    return;
  }

  // Priority 2 : localhost dev
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    window.BARBERCLUB_API = API_DEV;
    return;
  }

  // Priority 3 : prod
  window.BARBERCLUB_API = API_PROD;
})();
```

**Important :**
- Le global reste `window.BARBERCLUB_API` (zéro changement pour le site web déployé)
- Le site web déployé n'a pas la balise meta → fallback localhost/prod marche pareil qu'avant
- Aucune régression possible

- [ ] **Step 1.5.3: Tester le site web régression (smoke test + view-source)**

```bash
cd "BarberClub Site"
npx serve -l 5500
```

Tests :
1. Ouvrir http://localhost:5500/pages/grenoble/reserver.html → login client doit marcher comme avant
2. View source : `curl -s http://localhost:5500/pages/grenoble/reserver.html | grep "api-base-url"` doit retourner **rien** (la meta n'est PAS injectée hors-build app)
3. Console browser : `window.BARBERCLUB_API` doit retourner `http://localhost:3000/api`

- [ ] **Step 1.5.4: Resync app et boot iOS**

```bash
cd app
npm run sync
npm run build:ios
```

Expected: Xcode s'ouvre, app boot, affiche la landing (`index.html`) du site BarberClub avec choix Meylan/Grenoble.

- [ ] **Step 1.5.5: Vérifier dans Safari Web Inspector**

Avec le simulateur iOS lancé, ouvrir Safari Mac → Develop → Simulator → ton app. Console doit montrer :
- `window.BARBERCLUB_API` = URL Railway prod (`https://api.barberclub-grenoble.fr/api`)
- Pas d'erreur 404 sur les assets CSS/JS

- [ ] **Step 1.5.6: Commit**

```bash
git add assets/js/api-config.js
git commit -m "feat: support meta api-base-url tag for app build"
```

---

### Task 1.6: `native-bridge.js` core — détection plateforme + storage shim

**Files:**
- Modify: `app/src/native-bridge.js`

- [ ] **Step 1.6.1: Installer plugin Preferences**

```bash
cd app
npm install @capacitor/preferences@^6
npx cap sync
```

- [ ] **Step 1.6.2: Écrire le bridge complet**

Path: `app/src/native-bridge.js`

```javascript
/**
 * Native bridge — fait le pont entre le site web (HTML/CSS/JS vanilla)
 * et les APIs natives Capacitor sans toucher au code source du site.
 *
 * Stratégie : override transparent de localStorage pour les clés sensibles.
 * Le code applicatif (api.js, etc.) continue d'appeler localStorage.setItem
 * normalement, ce bridge intercepte et redirige vers Capacitor Preferences
 * (Keychain iOS / EncryptedSharedPreferences Android).
 */
(function() {
  'use strict';

  if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
    console.log('[bridge] non-native env, skip');
    return;
  }

  const { Preferences } = window.Capacitor.Plugins;
  if (!Preferences) {
    console.error('[bridge] Preferences plugin missing — did you run cap sync?');
    return;
  }

  // Clés à rediriger vers stockage natif sécurisé
  const SENSITIVE_KEYS = new Set([
    'bc_access_token',
    'bc_refresh_token',
    'bc_user',
    'bc_salon',
    'bc_client_token',
    'bc_client_user'
  ]);

  // Cache mémoire pour les lectures synchrones (localStorage est sync, Preferences est async)
  // On hydrate au boot puis on garde en sync.
  const memCache = new Map();

  // Override localStorage pour les clés sensibles
  const origSetItem = localStorage.setItem.bind(localStorage);
  const origGetItem = localStorage.getItem.bind(localStorage);
  const origRemoveItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = function(key, value) {
    if (SENSITIVE_KEYS.has(key)) {
      memCache.set(key, value);
      Preferences.set({ key, value }).catch(err => console.error('[bridge] set', key, err));
      return;
    }
    return origSetItem(key, value);
  };

  localStorage.getItem = function(key) {
    if (SENSITIVE_KEYS.has(key)) {
      return memCache.has(key) ? memCache.get(key) : null;
    }
    return origGetItem(key);
  };

  localStorage.removeItem = function(key) {
    if (SENSITIVE_KEYS.has(key)) {
      memCache.delete(key);
      Preferences.remove({ key }).catch(err => console.error('[bridge] remove', key, err));
      return;
    }
    return origRemoveItem(key);
  };

  // Hydrate cache au boot pour permettre lecture sync (avant qu'app fasse ses calls)
  async function hydrate() {
    for (const key of SENSITIVE_KEYS) {
      try {
        const { value } = await Preferences.get({ key });
        if (value !== null) memCache.set(key, value);
      } catch (e) {
        console.error('[bridge] hydrate', key, e);
      }
    }
    console.log('[bridge] hydrated, keys:', [...memCache.keys()]);
    document.dispatchEvent(new CustomEvent('bridge:ready'));
  }

  // Hydrate avant que les scripts applicatifs lisent localStorage
  hydrate();

  // Expose helper global pour debug
  window.__bcBridge = { memCache, hydrate };
})();
```

- [ ] **Step 1.6.3: Resync et test**

```bash
cd app
npm run sync
npm run build:ios
```

Dans Xcode → run sur simulateur. Ouvrir Safari Web Inspector → Console.
Expected:
- `[bridge] hydrated, keys: []` au boot (cache vide)
- Tester login : aller sur reserver.html, login → console doit montrer `[bridge]` lors des set/get

- [ ] **Step 1.6.4: Vérifier que le token est dans le Keychain natif**

Dans Xcode → Window → Devices and Simulators → choisir simulateur → l'app → "Container" pour explorer.
Alternativement, en code : tester `Preferences.get({ key: 'bc_client_token' })` doit retourner la valeur après login.

- [ ] **Step 1.6.5: Vérifier régression site web**

```bash
cd "BarberClub Site"
npx serve -l 5500
```

Ouvrir http://localhost:5500 — login client doit marcher exactement pareil qu'avant (la balise meta n'est pas présente, donc le bridge skip).

- [ ] **Step 1.6.6: Commit**

```bash
git add app/src/native-bridge.js app/package.json app/package-lock.json
git commit -m "feat(app): native-bridge with secure token storage via Preferences"
```

---

### Task 1.7: Backend — Migration `050_client_push_tokens.sql`

**Files:**
- Create: `backend/database/migrations/050_client_push_tokens.sql`

- [ ] **Step 1.7.1: Écrire le test (TDD)**

Path: `backend/tests/migrations/050_client_push_tokens.test.js`

```javascript
const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

describe('Migration 050 — client_push_tokens', () => {
  let pool;
  beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL }); });
  afterAll(() => pool.end());

  test('table exists', async () => {
    const r = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'client_push_tokens'
    `);
    expect(r.rows.length).toBe(1);
  });

  test('has expected columns', async () => {
    const r = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'client_push_tokens'
      ORDER BY ordinal_position
    `);
    const cols = r.rows.map(c => c.column_name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'client_id', 'device_token', 'platform', 'created_at', 'last_used_at'
    ]));
  });

  test('platform CHECK constraint enforces ios/android only', async () => {
    await expect(pool.query(`
      INSERT INTO client_push_tokens (client_id, device_token, platform)
      VALUES (gen_random_uuid(), 'tok123', 'windows')
    `)).rejects.toThrow(/check constraint/);
  });

  test('unique device_token', async () => {
    const c = await pool.query("SELECT id FROM clients LIMIT 1");
    if (!c.rows.length) return; // skip si pas de client
    const cid = c.rows[0].id;
    await pool.query(`DELETE FROM client_push_tokens WHERE device_token = 'duptest'`);
    await pool.query(`INSERT INTO client_push_tokens (client_id, device_token, platform) VALUES ($1, 'duptest', 'ios')`, [cid]);
    await expect(pool.query(`INSERT INTO client_push_tokens (client_id, device_token, platform) VALUES ($1, 'duptest', 'ios')`, [cid]))
      .rejects.toThrow(/unique/i);
    await pool.query(`DELETE FROM client_push_tokens WHERE device_token = 'duptest'`);
  });
});
```

- [ ] **Step 1.7.2: Run test, expect FAIL**

```bash
cd backend && npm test -- migrations/050
```

Expected: tous les tests fail (table n'existe pas).

- [ ] **Step 1.7.3: Écrire la migration**

Path: `backend/database/migrations/050_client_push_tokens.sql`

```sql
-- Migration 050: Client push tokens (FCM device registrations for mobile app)
-- Created 2026-05-01

BEGIN;

CREATE TABLE IF NOT EXISTS client_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  UNIQUE(device_token)
);

CREATE INDEX IF NOT EXISTS idx_client_push_tokens_client ON client_push_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_client_push_tokens_last_used ON client_push_tokens(last_used_at DESC);

-- Enable RLS to match security policy of other tables (cf migration 014)
ALTER TABLE client_push_tokens ENABLE ROW LEVEL SECURITY;

COMMIT;
```

- [ ] **Step 1.7.4: Appliquer la migration**

⚠️ **Attention** : `DATABASE_URL` pointe sur Railway prod (cf MEMORY). Confirmer avec Nino avant.

```bash
cd backend
node database/migrate.js
```

Expected: `Migration 050_client_push_tokens.sql applied`.

- [ ] **Step 1.7.5: Run tests, expect PASS**

```bash
npm test -- migrations/050
```

Expected: tous PASS.

- [ ] **Step 1.7.6: Commit**

```bash
git add backend/database/migrations/050_client_push_tokens.sql backend/tests/migrations/050_client_push_tokens.test.js
git commit -m "feat(backend): add client_push_tokens table (migration 050)"
```

---

### Task 1.8: Backend — Test helpers manquants pour client auth

**Files:**
- Modify: `backend/tests/helpers.js`

État actuel (vérifié 2026-05-01) : `helpers.js` a `loginAsBarber()` et `createTestBooking()` mais **PAS** `loginTestClient()`. On l'ajoute avant les tests d'endpoints client (Task 1.9 et suivantes).

- [ ] **Step 1.8.1: Ajouter `loginTestClient()` dans `helpers.js`**

Ajouter dans `backend/tests/helpers.js`, avant `module.exports` :

```javascript
/**
 * Crée un client test (via /auth/register) et retourne ses credentials login.
 * Idempotent : si l'email existe déjà, fait un login direct.
 * Returns { accessToken, refreshToken, clientId, email, phone }
 */
async function loginTestClient() {
  testCounter++;
  const phone = `${TEST_PHONE_PREFIX}cli${String(testCounter).padStart(3, '0')}`;
  const email = `clitest${testCounter}@test.barberclub.fr`;
  const password = 'TestPassword123!';

  // Try register first
  let res = await request(app)
    .post('/api/auth/register')
    .send({ email, password, phone, first_name: 'CliTest', last_name: 'CliTest' });

  if (res.status !== 200 && res.status !== 201) {
    // Already exists → login
    res = await request(app)
      .post('/api/auth/login')
      .send({ email, password, type: 'client' });
  }

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`loginTestClient failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  // Récupérer client_id depuis la BDD (basé sur email)
  const c = await db.query('SELECT id FROM clients WHERE email = $1', [email]);
  const clientId = c.rows[0]?.id;

  return {
    accessToken: res.body.access_token,
    refreshToken: res.body.refresh_token,
    clientId,
    email,
    phone
  };
}

/**
 * Crée une booking test ET enregistre un push token pour son client.
 * Returns { bookingId, clientId, deviceToken }
 */
async function createTestBookingWithPushToken(platform = 'ios') {
  const booking = await createTestBooking();
  const clientId = booking.client_id || (await db.query('SELECT client_id FROM bookings WHERE id = $1', [booking.id])).rows[0].client_id;
  const deviceToken = `test-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.query(
    'INSERT INTO client_push_tokens (client_id, device_token, platform) VALUES ($1, $2, $3)',
    [clientId, deviceToken, platform]
  );
  return { bookingId: booking.id, clientId, deviceToken };
}

/**
 * Crée une booking test sans push token (pour tests negatifs).
 */
async function createTestBookingNoPushToken() {
  const booking = await createTestBooking();
  return { bookingId: booking.id };
}
```

- [ ] **Step 1.8.2: Mettre à jour `module.exports`**

```javascript
module.exports = {
  app,
  loginAsBarber,
  loginTestClient,                  // 🆕
  getNextWorkingDate,
  getLucasDayOff,
  createTestBooking,
  createTestBookingWithPushToken,   // 🆕
  createTestBookingNoPushToken,     // 🆕
  cleanupBooking,
  cleanupTestClients,
};
```

- [ ] **Step 1.8.3: Smoke test des nouveaux helpers**

Créer `backend/tests/helpers-self.test.js` (test des helpers eux-mêmes) :

```javascript
const { loginTestClient, createTestBookingWithPushToken } = require('./helpers');
const { db } = require('./setup');

describe('test helpers', () => {
  test('loginTestClient creates and logs in a client', async () => {
    const c = await loginTestClient();
    expect(c.accessToken).toBeTruthy();
    expect(c.clientId).toBeTruthy();
    expect(c.email).toMatch(/@test\.barberclub\.fr/);
  });
});
```

⚠️ Le helper `createTestBookingWithPushToken` ne peut être testé qu'APRÈS Task 1.7 (migration `client_push_tokens` appliquée). Skip ce test pour l'instant si la table n'existe pas, on l'activera après Task 1.7.

- [ ] **Step 1.8.4: Run, expect PASS**

```bash
cd backend && npm test -- helpers-self
```

- [ ] **Step 1.8.5: Commit**

```bash
git add backend/tests/helpers.js backend/tests/helpers-self.test.js
git commit -m "test(backend): add loginTestClient + createTestBookingWithPushToken helpers"
```

---

### Task 1.9: Backend — Endpoints `/api/client/push-token` (POST + DELETE)

**Files:**
- Modify: `backend/src/routes/client.js`
- Create or extend: `backend/tests/client.test.js`

- [ ] **Step 1.9.1: Écrire les tests (TDD)**

Ajouter à `backend/tests/client.test.js` :

```javascript
const { loginTestClient } = require('./helpers');

describe('POST /api/client/push-token', () => {
  let accessToken, clientId;
  beforeAll(async () => {
    ({ accessToken, clientId } = await loginTestClient());
  });

  test('rejects without auth', async () => {
    const r = await request(app)
      .post('/api/client/push-token')
      .send({ device_token: 'tok1', platform: 'ios' });
    expect(r.status).toBe(401);
  });

  test('rejects invalid platform', async () => {
    const r = await request(app)
      .post('/api/client/push-token')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ device_token: 'tok1', platform: 'windows' });
    expect(r.status).toBe(400);
  });

  test('upserts token on first call', async () => {
    const r = await request(app)
      .post('/api/client/push-token')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ device_token: 'tok-test-1', platform: 'ios' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  test('upserts on duplicate token (updates last_used_at)', async () => {
    await request(app).post('/api/client/push-token')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ device_token: 'tok-test-2', platform: 'ios' });
    const r = await request(app).post('/api/client/push-token')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ device_token: 'tok-test-2', platform: 'ios' });
    expect(r.status).toBe(200);
  });
});

describe('DELETE /api/client/push-token', () => {
  test('removes the token', async () => {
    const { accessToken } = await loginTestClient();
    await request(app).post('/api/client/push-token')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ device_token: 'tok-test-3', platform: 'ios' });
    const r = await request(app).delete('/api/client/push-token')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ device_token: 'tok-test-3' });
    expect(r.status).toBe(200);
  });
});
```

(Helpers `loginTestClient()` créés en Task 1.8.)

- [ ] **Step 1.9.2: Run tests, expect FAIL**

```bash
cd backend && npm test -- client
```

- [ ] **Step 1.9.3: Implémenter les endpoints**

Modifier `backend/src/routes/client.js`. Ajouter (en suivant les patterns existants — utilise `requireAuth`, `requireClient`, `body()` de express-validator, `pool.query`, `ApiError`) :

```javascript
const { body, validationResult } = require('express-validator');
const ApiError = require('../utils/errors');
const pool = require('../config/database');

// POST /api/client/push-token — Upsert FCM device token
router.post('/push-token',
  requireAuth, requireClient,
  [
    body('device_token').isString().isLength({ min: 1, max: 1024 }),
    body('platform').isIn(['ios', 'android'])
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new ApiError(400, 'Invalid input', errors.array());

      const { device_token, platform } = req.body;
      const clientId = req.user.id;

      await pool.query(`
        INSERT INTO client_push_tokens (client_id, device_token, platform)
        VALUES ($1, $2, $3)
        ON CONFLICT (device_token) DO UPDATE
          SET client_id = EXCLUDED.client_id,
              platform = EXCLUDED.platform,
              last_used_at = NOW()
      `, [clientId, device_token, platform]);

      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// DELETE /api/client/push-token — Remove FCM device token (logout)
router.delete('/push-token',
  requireAuth, requireClient,
  [body('device_token').isString().isLength({ min: 1, max: 1024 })],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new ApiError(400, 'Invalid input', errors.array());

      await pool.query(
        'DELETE FROM client_push_tokens WHERE device_token = $1 AND client_id = $2',
        [req.body.device_token, req.user.id]
      );
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 1.9.4: Run tests, expect PASS**

```bash
npm test -- client
```

- [ ] **Step 1.9.5: Commit**

```bash
git add backend/src/routes/client.js backend/tests/client.test.js
git commit -m "feat(backend): add POST/DELETE /api/client/push-token endpoints"
```

---

### Task 1.10: Backend — Endpoint `DELETE /api/client/account` (RGPD Apple)

**Files:**
- Modify: `backend/src/routes/client.js`
- Modify or extend: `backend/tests/client.test.js`
- Create: `backend/database/migrations/051_clients_soft_delete.sql` (si `deleted_at` n'existe pas déjà)

- [ ] **Step 1.10.1: Écrire les tests**

```javascript
describe('DELETE /api/client/account', () => {
  test('rejects without auth', async () => {
    const r = await request(app).delete('/api/client/account');
    expect(r.status).toBe(401);
  });

  test('soft-deletes client and anonymizes', async () => {
    const { accessToken, clientId, email } = await loginTestClient();
    const r = await request(app).delete('/api/client/account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(r.status).toBe(200);

    // Vérifier que le client est anonymisé en BDD
    const c = await db.query('SELECT email, phone, deleted_at FROM clients WHERE id = $1', [clientId]);
    expect(c.rows[0].deleted_at).not.toBeNull();
    expect(c.rows[0].email).not.toBe(email);
    expect(c.rows[0].email).toMatch(/deleted_/);
  });

  test('cascades to push_tokens and refresh_tokens', async () => {
    const { accessToken, clientId } = await loginTestClient();
    await request(app).post('/api/client/push-token')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ device_token: 'cascade-test', platform: 'ios' });
    await request(app).delete('/api/client/account')
      .set('Authorization', `Bearer ${accessToken}`);

    const tokens = await db.query('SELECT * FROM client_push_tokens WHERE client_id = $1', [clientId]);
    expect(tokens.rows.length).toBe(0);
  });
});
```

- [ ] **Step 1.10.2: Run tests, expect FAIL**

- [ ] **Step 1.10.3: Implémenter l'endpoint**

Vérifier d'abord : la table `clients` a-t-elle un champ `deleted_at` ? Si non, ajouter une mini-migration `051_clients_soft_delete.sql` :

```sql
-- Migration 051: Soft delete pour clients (RGPD Apple)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
```

Puis dans `client.js` :

```javascript
// DELETE /api/client/account — Suppression compte client (RGPD, requis Apple)
router.delete('/account',
  requireAuth, requireClient,
  async (req, res, next) => {
    try {
      const clientId = req.user.id;
      const anonStr = `deleted_${clientId.slice(0, 8)}_${Date.now()}`;

      await pool.query('BEGIN');
      try {
        // Anonymisation (pas hard-delete pour préserver intégrité bookings historiques)
        await pool.query(`
          UPDATE clients SET
            email = $1 || '@deleted.local',
            phone = $1,
            first_name = 'Deleted',
            last_name = 'User',
            password_hash = NULL,
            has_account = false,
            deleted_at = NOW()
          WHERE id = $2
        `, [anonStr, clientId]);

        // Cascade : push tokens, refresh tokens
        await pool.query('DELETE FROM client_push_tokens WHERE client_id = $1', [clientId]);
        await pool.query("DELETE FROM refresh_tokens WHERE user_type = 'client' AND user_id = $1", [clientId]);

        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }

      res.json({ success: true, message: 'Account deleted' });
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 1.10.4: Run tests, expect PASS**

```bash
cd backend && npm test -- client
```

- [ ] **Step 1.10.5: Commit**

```bash
git add backend/src/routes/client.js backend/tests/client.test.js backend/database/migrations/051_clients_soft_delete.sql
git commit -m "feat(backend): add DELETE /api/client/account (RGPD compliance)"
```

---

### Task 1.11: Setup Firebase + récupérer service account JSON

**Files:**
- Manual setup, no code changes
- Update `backend/.env` (locally)
- Update Railway env vars

- [ ] **Step 1.10.1: Nino crée projet Firebase**

Guidé en live :
1. Aller sur https://console.firebase.google.com/
2. "Add project" → nom "BarberClub" → désactiver Analytics (pas besoin) → Create
3. Project Settings → General → Your apps → Add app
   - **iOS** : bundle ID `fr.barberclub.app`. Télécharger `GoogleService-Info.plist`
   - **Android** : package name `fr.barberclub.app`. Télécharger `google-services.json`

- [ ] **Step 1.10.2: Coller les configs natives**

```bash
# iOS
cp ~/Downloads/GoogleService-Info.plist app/ios/App/App/GoogleService-Info.plist
# (ajouter à Xcode : ouvrir Xcode → drag&drop dans le projet App)

# Android
cp ~/Downloads/google-services.json app/android/app/google-services.json
```

- [ ] **Step 1.10.3: Service account pour backend**

1. Firebase Console → Project Settings → Service accounts
2. "Generate new private key" → télécharge un JSON
3. **NE PAS COMMIT CE FICHIER**

```bash
# Coller son contenu dans backend/.env (1 ligne)
# FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"...",...}'
```

Aussi `FCM_PROJECT_ID=barberclub-xxx` (le project_id du JSON).

- [ ] **Step 1.10.4: Synchroniser sur Railway**

```bash
railway variables set FCM_PROJECT_ID="barberclub-xxx"
railway variables set FCM_SERVICE_ACCOUNT_JSON="$(cat ~/Downloads/firebase-adminsdk-xxx.json | jq -c .)"
```

- [ ] **Step 1.10.5: Vérifier `.gitignore` n'expose pas le JSON**

```bash
grep -E "(firebase|service-account|google-services)" .gitignore
```

Si pas présent, ajouter :
```
# Firebase secrets
**/firebase-adminsdk*.json
backend/firebase-*.json
```

- [ ] **Step 1.10.6: Commit (uniquement les fichiers natifs si l'app les ajoute)**

Le `google-services.json` Android est OK à commit (clé publique). Le `GoogleService-Info.plist` iOS aussi (clé publique). Le service account JSON, **JAMAIS**.

```bash
git add app/android/app/google-services.json app/ios/App/App/GoogleService-Info.plist .gitignore
git commit -m "chore: add Firebase config files for iOS+Android"
```

---

### Task 1.12: Backend — Service `pushMobile.js` (FCM v1)

**Files:**
- Create: `backend/src/services/pushMobile.js`
- Create: `backend/tests/pushMobile.test.js`
- Modify: `backend/package.json` (add `google-auth-library`)

- [ ] **Step 1.11.1: Installer dépendance**

```bash
cd backend
npm install google-auth-library
```

- [ ] **Step 1.11.2: Écrire les tests (mocks de FCM)**

Path: `backend/tests/pushMobile.test.js`

```javascript
jest.mock('google-auth-library', () => {
  return {
    GoogleAuth: jest.fn().mockImplementation(() => ({
      getClient: jest.fn().mockResolvedValue({
        request: jest.fn().mockResolvedValue({ data: { name: 'projects/x/messages/123' } })
      })
    }))
  };
});

const { sendPushMobile } = require('../src/services/pushMobile');

describe('pushMobile.sendPushMobile', () => {
  beforeEach(() => {
    process.env.FCM_PROJECT_ID = 'test-project';
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      type: 'service_account',
      project_id: 'test-project',
      private_key: 'fake',
      client_email: 'fake@test.iam.gserviceaccount.com'
    });
  });

  test('returns success when FCM accepts', async () => {
    const result = await sendPushMobile({
      deviceToken: 'tok123',
      title: 'RDV confirmé',
      body: 'Demain 14h',
      data: { bookingId: 'abc' }
    });
    expect(result.success).toBe(true);
  });

  test('returns failure (does not throw) on FCM error', async () => {
    const { GoogleAuth } = require('google-auth-library');
    GoogleAuth.mockImplementationOnce(() => ({
      getClient: jest.fn().mockRejectedValue(new Error('FCM down'))
    }));
    const result = await sendPushMobile({
      deviceToken: 'tok123',
      title: 't', body: 'b', data: {}
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/FCM down/);
  });
});
```

- [ ] **Step 1.11.3: Run tests, expect FAIL**

```bash
npm test -- pushMobile
```

- [ ] **Step 1.11.4: Implémenter le service**

Path: `backend/src/services/pushMobile.js`

```javascript
const { GoogleAuth } = require('google-auth-library');
const logger = require('../utils/logger');

let cachedAuth = null;

function getAuth() {
  if (cachedAuth) return cachedAuth;
  const credentials = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
  cachedAuth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging']
  });
  return cachedAuth;
}

/**
 * Envoie un push FCM v1 à un device.
 * Fail-safe : log + return { success: false, error } sans throw.
 *
 * @param {Object} opts
 * @param {string} opts.deviceToken FCM registration token
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {Object} opts.data Custom data payload (string keys+values per FCM spec)
 * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
 */
async function sendPushMobile({ deviceToken, title, body, data = {} }) {
  if (!process.env.FCM_PROJECT_ID || !process.env.FCM_SERVICE_ACCOUNT_JSON) {
    logger.warn('FCM not configured, skipping push');
    return { success: false, error: 'FCM not configured' };
  }
  try {
    const auth = getAuth();
    const client = await auth.getClient();
    const projectId = process.env.FCM_PROJECT_ID;

    // Stringify data values (FCM spec : tous les data values doivent être strings)
    const stringifiedData = {};
    for (const [k, v] of Object.entries(data)) {
      stringifiedData[k] = String(v);
    }

    const response = await client.request({
      url: `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      method: 'POST',
      data: {
        message: {
          token: deviceToken,
          notification: { title, body },
          data: stringifiedData
        }
      }
    });
    return { success: true, messageId: response.data.name };
  } catch (err) {
    logger.error('FCM send failed', { err: err.message, deviceToken });
    return { success: false, error: err.message };
  }
}

module.exports = { sendPushMobile };
```

- [ ] **Step 1.11.5: Run tests, expect PASS**

```bash
npm test -- pushMobile
```

- [ ] **Step 1.11.6: Commit**

```bash
git add backend/src/services/pushMobile.js backend/tests/pushMobile.test.js backend/package.json backend/package-lock.json
git commit -m "feat(backend): add FCM v1 push mobile service (OAuth2 service account)"
```

---

### Task 1.13: Backend — Hook push mobile dans `notification/templates.js`

**Files:**
- Modify: `backend/src/services/notification/templates.js`
- Modify or extend: `backend/tests/notification.test.js`

- [ ] **Step 1.12.1: Lire `templates.js` actuel**

```bash
cat backend/src/services/notification/templates.js | head -80
```

Identifier la fonction `sendReminder` (ou équivalent) pour savoir où hooker.

- [ ] **Step 1.12.2: Écrire test**

Ajouter à `notification.test.js` :

```javascript
const pushMobile = require('../src/services/pushMobile');

describe('sendReminder hooks push mobile', () => {
  test('calls sendPushMobile when client has push token', async () => {
    const sendPushSpy = jest.spyOn(pushMobile, 'sendPushMobile').mockResolvedValue({ success: true });
    // Setup booking + client with push_token
    const { bookingId } = await createTestBookingWithPushToken();
    await sendReminder(bookingId);
    expect(sendPushSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Rappel'),
      data: expect.objectContaining({ bookingId })
    }));
    sendPushSpy.mockRestore();
  });

  test('does not call sendPushMobile when no push token', async () => {
    const sendPushSpy = jest.spyOn(pushMobile, 'sendPushMobile');
    const { bookingId } = await createTestBookingNoPushToken();
    await sendReminder(bookingId);
    expect(sendPushSpy).not.toHaveBeenCalled();
    sendPushSpy.mockRestore();
  });

  test('SMS is sent even when push fails', async () => {
    jest.spyOn(pushMobile, 'sendPushMobile').mockResolvedValue({ success: false, error: 'down' });
    const sendSmsSpy = jest.spyOn(brevoMod, 'sendSms').mockResolvedValue({ success: true });
    const { bookingId } = await createTestBookingWithPushToken();
    await sendReminder(bookingId);
    expect(sendSmsSpy).toHaveBeenCalled();
  });
});
```

(Helpers `createTestBookingWithPushToken` à créer dans `tests/helpers.js`.)

- [ ] **Step 1.12.3: Run tests, expect FAIL**

- [ ] **Step 1.12.4: Hook dans `templates.js`**

Dans `sendReminder` (ou la fonction qui envoie le rappel J-1), ajouter après l'envoi SMS :

```javascript
const { sendPushMobile } = require('../pushMobile');

async function sendReminder(bookingId) {
  // ... code existant qui envoie SMS

  // Hook push mobile : récupérer device tokens du client
  try {
    const { rows: tokens } = await pool.query(
      'SELECT device_token FROM client_push_tokens WHERE client_id = $1',
      [booking.client_id]
    );
    for (const { device_token } of tokens) {
      await sendPushMobile({
        deviceToken: device_token,
        title: 'Rappel BarberClub',
        body: `RDV demain à ${formatTime(booking.start_time)} chez ${booking.barber_name}`,
        data: { bookingId, type: 'reminder' }
      });
    }
  } catch (e) {
    logger.warn('push mobile hook failed (non-critical)', { err: e.message });
  }
}
```

Faire pareil dans les fonctions `sendConfirmation`, `sendCancellation`, `sendReschedule`.

- [ ] **Step 1.12.5: Run tests, expect PASS**

```bash
npm test -- notification
```

- [ ] **Step 1.12.6: Commit**

```bash
git add backend/src/services/notification/templates.js backend/tests/notification.test.js
git commit -m "feat(backend): hook FCM push mobile in notification flows"
```

---

### Task 1.14: App — Plugin Push Notifications + register flow

**Files:**
- Modify: `app/src/native-bridge.js`
- Install: `@capacitor/push-notifications`

- [ ] **Step 1.13.1: Installer plugin**

```bash
cd app
npm install @capacitor/push-notifications@^6
npx cap sync
```

- [ ] **Step 1.13.2: Configurer iOS — capabilities**

Ouvrir Xcode :
1. Project navigator → `App` → Signing & Capabilities
2. "+ Capability" → "Push Notifications"
3. "+ Capability" → "Background Modes" → cocher "Remote notifications"

- [ ] **Step 1.13.3: Configurer Android — manifest**

Vérifier `app/android/app/src/main/AndroidManifest.xml` contient :

```xml
<service
  android:name="com.google.firebase.messaging.FirebaseMessagingService"
  android:exported="false">
  <intent-filter>
    <action android:name="com.google.firebase.MESSAGING_EVENT" />
  </intent-filter>
</service>
```

- [ ] **Step 1.14.4: Étendre `native-bridge.js` — push setup avec hook post-login**

Le challenge : il faut déclencher le push setup à 2 moments distincts :
1. **Au boot** si un token existe déjà (utilisateur déjà connecté)
2. **Au moment du login** quand le code applicatif fait `localStorage.setItem('bc_client_token', ...)` pour la première fois

Pour gérer (2), on étend l'override de `localStorage.setItem` (déjà en place dans Task 1.6). On déclenche `setupPushNotifications()` quand un token auth est écrit pour la 1ère fois.

**Étape A — Modifier l'override `localStorage.setItem` dans `native-bridge.js`** (déjà existant, on l'augmente) :

```javascript
const AUTH_TOKEN_KEYS = new Set(['bc_client_token', 'bc_access_token']);

localStorage.setItem = function(key, value) {
  if (SENSITIVE_KEYS.has(key)) {
    const wasNew = !memCache.has(key) || memCache.get(key) !== value;
    memCache.set(key, value);
    Preferences.set({ key, value }).catch(err => console.error('[bridge] set', key, err));

    // Hook post-login : si on vient de set un token auth (nouveau ou rotation)
    if (wasNew && AUTH_TOKEN_KEYS.has(key)) {
      setupPushNotifications().catch(e => console.error('[bridge] push register on login', e));
    }
    return;
  }
  return origSetItem(key, value);
};
```

**Étape B — Ajouter à la fin du bridge (avant `})()`) le code de push** :

```javascript
// === Push notifications setup ===
let pushSetupRunning = false;

async function setupPushNotifications() {
  // Idempotent : si déjà en cours, skip
  if (pushSetupRunning) return;
  pushSetupRunning = true;
  try {
    const { PushNotifications } = window.Capacitor.Plugins;
    if (!PushNotifications) return;

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') {
      console.log('[bridge] push permission denied');
      return;
    }

    // Register (déclenche un event 'registration' avec le device token)
    await PushNotifications.register();
  } finally {
    pushSetupRunning = false;
  }
}

// Listener registration : enregistre le token côté backend
window.Capacitor.Plugins.PushNotifications?.addListener('registration', async (token) => {
  console.log('[bridge] push token received:', token.value);
  const accessToken = memCache.get('bc_client_token') || memCache.get('bc_access_token');
  if (!accessToken) {
    console.log('[bridge] no auth token yet, skipping push-token registration');
    return;
  }
  const platform = window.Capacitor.getPlatform(); // 'ios' or 'android'
  const apiUrl = document.querySelector('meta[name="api-base-url"]')?.content
    || window.BARBERCLUB_API; // fallback
  try {
    const r = await fetch(`${apiUrl}/client/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ device_token: token.value, platform })
    });
    if (!r.ok) console.error('[bridge] push-token register failed:', r.status);
    else console.log('[bridge] push-token registered');
  } catch (e) {
    console.error('[bridge] failed to register push token', e);
  }
});

// Listener tap : deep link vers RDV
window.Capacitor.Plugins.PushNotifications?.addListener('pushNotificationActionPerformed', (action) => {
  const data = action.notification.data || {};
  if (data.bookingId) {
    const salon = memCache.get('bc_salon') || 'grenoble';
    window.location.href = `/pages/${salon}/mon-rdv.html?id=${data.bookingId}`;
  }
});

// Boot trigger : si user déjà connecté au lancement, lance push setup
document.addEventListener('bridge:ready', () => {
  if (memCache.has('bc_client_token') || memCache.has('bc_access_token')) {
    setupPushNotifications();
  }
});
```

**Important** : grâce au hook dans `localStorage.setItem` (étape A), un user qui se connecte pour la première fois après install verra le push setup déclenché automatiquement au moment du login — pas besoin de redémarrer l'app. Cela débloque la DoD "Push reçu à création RDV".

- [ ] **Step 1.14.5: Resync, build iOS, test sur device réel**

⚠️ Push ne marche **pas** sur simulateur iOS. Test sur iPhone physique requis.

```bash
cd app
npm run sync
npm run build:ios
```

Dans Xcode : connecter iPhone via USB, sélectionner comme target, Run.

Sur l'app : login client. Console (Safari Web Inspector iPhone) doit montrer `[bridge] push token: ...`.

- [ ] **Step 1.14.6: Vérifier en BDD que le token est enregistré**

```bash
railway run psql -c "SELECT * FROM client_push_tokens ORDER BY created_at DESC LIMIT 5;"
```

Expected: 1 nouvelle ligne avec le token vu en console.

- [ ] **Step 1.14.7: Test push end-to-end**

Créer manuellement un RDV pour ce client, lancer le cron de rappel manuellement (ou attendre 18h). Vérifier que le push arrive sur l'iPhone.

Alternative pour test : déclencher manuellement via curl avec un script de test, ou ajouter un script `tools/test-push.js` qui envoie un push à un device test.

- [ ] **Step 1.14.8: Commit**

```bash
git add app/src/native-bridge.js app/package.json app/package-lock.json app/ios app/android
git commit -m "feat(app): integrate Capacitor push notifications + backend register"
```

---

### Task 1.15: Code Review J5 (fin Phase 1)

- [ ] **Step 1.15.1: Diff des changements depuis le début**

Au début de Task 1.1 on a posé un tag `app-phase0-baseline`. On compare depuis ce tag :

```bash
# Au tout début (Task 1.1) avoir lancé : git tag app-phase0-baseline
git log --oneline app-phase0-baseline..HEAD
git diff --stat app-phase0-baseline..HEAD
```

Si pas de tag, fallback : trouver le SHA du dernier commit avant le début du dev app via `git log` et l'utiliser à la place.

- [ ] **Step 1.15.2: Lancer code-review**

Invoke skill `code-review:code-review` avec contexte :
- Branch en cours
- Fichiers modifiés depuis Task 1.1
- Focus areas : sécurité tokens (Keychain), endpoints client (auth check, validation, RGPD), service FCM (mocks tests, fail-safe), régression site (toujours intact)

- [ ] **Step 1.15.3: Fix issues HIGH/CRITICAL**

Itérer jusqu'à 0 HIGH/CRITICAL.

- [ ] **Step 1.15.4: Tag fin Phase 1**

```bash
git tag app-phase1-foundation
git push origin app-phase1-foundation 2>/dev/null || true  # si remote
```

---

## Phase 2 — Native features + finitions (Days 6-14)

**Goal Phase 2:** Toutes les features natives MVP, splash + icons, deep links, tests multi-device, TestFlight + Internal Testing prêts.

---

### Task 2.1: Plugin biometric — install + flux UI

**Files:**
- Modify: `app/src/native-bridge.js`
- Install: `capacitor-native-biometric`

- [ ] **Step 2.1.1: Install**

```bash
cd app
npm install capacitor-native-biometric
npx cap sync
```

- [ ] **Step 2.1.2: iOS Info.plist**

Ouvrir Xcode → `App/Info.plist`. Ajouter :

```xml
<key>NSFaceIDUsageDescription</key>
<string>Pour te reconnecter rapidement à BarberClub avec Face ID</string>
```

- [ ] **Step 2.1.3: Étendre `native-bridge.js`**

Ajouter en haut (avant push setup) :

```javascript
// === Biometric login ===
async function isBiometricAvailable() {
  const { NativeBiometric } = window.Capacitor.Plugins;
  if (!NativeBiometric) return false;
  try {
    const r = await NativeBiometric.isAvailable();
    return r.isAvailable;
  } catch { return false; }
}

async function saveCredentialsBiometric(email, refreshToken) {
  const { NativeBiometric } = window.Capacitor.Plugins;
  await NativeBiometric.setCredentials({
    username: email,
    password: refreshToken,
    server: 'fr.barberclub.app'
  });
}

async function loadCredentialsBiometric() {
  const { NativeBiometric } = window.Capacitor.Plugins;
  await NativeBiometric.verifyIdentity({
    reason: 'Pour te reconnecter à BarberClub',
    title: 'BarberClub'
  });
  const creds = await NativeBiometric.getCredentials({ server: 'fr.barberclub.app' });
  return creds;
}

async function clearCredentialsBiometric() {
  const { NativeBiometric } = window.Capacitor.Plugins;
  try { await NativeBiometric.deleteCredentials({ server: 'fr.barberclub.app' }); } catch {}
}

window.bcBiometric = {
  isAvailable: isBiometricAvailable,
  save: saveCredentialsBiometric,
  load: loadCredentialsBiometric,
  clear: clearCredentialsBiometric
};
```

- [ ] **Step 2.1.4: Toggle UI "Activer Face ID" (overlay injecté par le bridge)**

Le code source du site **n'est pas touché**. À la place, le bridge injecte un mini-toast après chaque login client réussi (utiliser `createElement` + `textContent`, pas `innerHTML`, pour pas exposer de XSS dans la WebView) :

```javascript
// === Biometric enable prompt après login ===
async function maybePromptBiometricEnable() {
  if (memCache.get('bc_biometric_enabled') === 'true') return;
  if (memCache.get('bc_biometric_declined') === 'true') return;
  if (!(await isBiometricAvailable())) return;

  const refreshToken = memCache.get('bc_refresh_token') || memCache.get('bc_client_refresh_token');
  if (!refreshToken) return;
  let email = '';
  try {
    const userStr = memCache.get('bc_user') || memCache.get('bc_client_user');
    if (userStr) email = JSON.parse(userStr).email || '';
  } catch {}

  // Build overlay safely with createElement (no innerHTML on user data)
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;bottom:24px;left:16px;right:16px;padding:16px;background:#1C1917;color:#FAFAF9;border-radius:12px;z-index:99999;display:flex;gap:12px;align-items:center;box-shadow:0 8px 32px rgba(0,0,0,0.5);';

  const label = document.createElement('div');
  label.style.cssText = 'flex:1;font-size:14px;';
  label.textContent = 'Activer Face ID pour les prochaines connexions ?';
  overlay.appendChild(label);

  const yesBtn = document.createElement('button');
  yesBtn.style.cssText = 'padding:8px 14px;background:#FAFAF9;color:#0C0A09;border:0;border-radius:8px;font-weight:600;';
  yesBtn.textContent = 'Oui';
  overlay.appendChild(yesBtn);

  const noBtn = document.createElement('button');
  noBtn.style.cssText = 'padding:8px 14px;background:transparent;color:#A8A29E;border:0;';
  noBtn.textContent = 'Non';
  overlay.appendChild(noBtn);

  document.body.appendChild(overlay);

  yesBtn.addEventListener('click', async () => {
    try {
      await saveCredentialsBiometric(email, refreshToken);
      localStorage.setItem('bc_biometric_enabled', 'true');
    } catch (e) { console.error(e); }
    overlay.remove();
  });
  noBtn.addEventListener('click', () => {
    localStorage.setItem('bc_biometric_declined', 'true');
    overlay.remove();
  });
}
```

**Mettre à jour le hook `localStorage.setItem`** (Task 1.6 + 1.14) pour appeler aussi `maybePromptBiometricEnable()` après login :

```javascript
if (wasNew && AUTH_TOKEN_KEYS.has(key)) {
  setupPushNotifications().catch(e => console.error('[bridge] push register on login', e));
  setTimeout(() => maybePromptBiometricEnable(), 500); // 🆕 toast biometric
}
```

- [ ] **Step 2.1.5: Boot intercept biometric — UNE FOIS par session app, pas à chaque navigation**

Le piège : `DOMContentLoaded` se déclenche à chaque navigation interne dans la WebView. Solution : utiliser `App.addListener('appStateChange')` de Capacitor, qui ne se déclenche que quand l'app revient au foreground (= cold launch ou resume).

```javascript
// === Boot intercept : si biometric activé ET pas connecté, propose unlock ===
let biometricBootChecked = false;

async function tryBiometricUnlock() {
  if (biometricBootChecked) return;
  biometricBootChecked = true;

  if (memCache.get('bc_biometric_enabled') !== 'true') return;
  if (memCache.has('bc_client_token') || memCache.has('bc_access_token')) return;

  try {
    const { password: refreshToken } = await loadCredentialsBiometric();
    if (!refreshToken) return;
    const apiUrl = document.querySelector('meta[name="api-base-url"]')?.content || window.BARBERCLUB_API;
    const r = await fetch(`${apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (r.ok) {
      const data = await r.json();
      localStorage.setItem('bc_client_token', data.access_token);
      window.location.reload();
    }
  } catch (e) {
    console.warn('[bridge] biometric unlock failed (user cancelled or error)', e);
  }
}

document.addEventListener('bridge:ready', tryBiometricUnlock);
window.Capacitor.Plugins.App?.addListener('appStateChange', ({ isActive }) => {
  if (isActive) {
    biometricBootChecked = false;
    tryBiometricUnlock();
  }
});
```

**Si biometric n'est PAS activé** : ces fonctions ne font rien (early return), le flow login normal du site continue à marcher exactement comme sur le web. Aucun blocage.

- [ ] **Step 2.1.6: Hook logout pour clear creds biometric**

Étendre l'override `localStorage.removeItem` (Task 1.6) :

```javascript
localStorage.removeItem = function(key) {
  if (SENSITIVE_KEYS.has(key)) {
    memCache.delete(key);
    Preferences.remove({ key }).catch(err => console.error('[bridge] remove', key, err));

    if (key === 'bc_refresh_token' || key === 'bc_client_refresh_token') {
      clearCredentialsBiometric();
      localStorage.removeItem('bc_biometric_enabled');
    }
    return;
  }
  return origRemoveItem(key);
};
```

- [ ] **Step 2.1.7: Test sur device réel**

Build iPhone, login → toast "Activer Face ID" s'affiche. Cliquer "Oui" → confirmer Face ID. Logout, fermer app totalement, rouvrir → biometric prompt s'affiche → unlock OK.

Tester aussi : "Non" → toast disparaît, plus jamais re-proposé.

- [ ] **Step 2.1.8: Test biometric DÉSACTIVÉ → flow login normal**

Désinstaller + réinstaller l'app : login normal doit marcher sans aucun prompt biometric.

- [ ] **Step 2.1.9: Commit**

```bash
git add app/src/native-bridge.js app/package.json app/package-lock.json app/ios
git commit -m "feat(app): biometric login (Face ID/Touch ID/fingerprint) with safe overlay UI"
```

---

### Task 2.2: Plugins natifs additionnels (Share, Calendar, Haptics, StatusBar, Network)

**Files:**
- Modify: `app/src/native-bridge.js`

- [ ] **Step 2.2.1: Install plugins**

```bash
cd app
npm install @capacitor/share @capacitor/haptics @capacitor/status-bar @capacitor/network @capacitor-community/calendar @capacitor/browser
npx cap sync
```

- [ ] **Step 2.2.2: Bridge bindings**

Ajouter à `native-bridge.js` :

```javascript
// === Share natif ===
window.bcShare = async (title, text, url) => {
  const { Share } = window.Capacitor.Plugins;
  try { await Share.share({ title, text, url }); } catch (e) { console.warn(e); }
};

// === Haptics ===
window.bcHaptics = {
  success: () => window.Capacitor.Plugins.Haptics?.notification({ type: 'SUCCESS' }),
  error: () => window.Capacitor.Plugins.Haptics?.notification({ type: 'ERROR' }),
  light: () => window.Capacitor.Plugins.Haptics?.impact({ style: 'LIGHT' })
};

// === Status bar (force black bg + light text) ===
(async () => {
  const { StatusBar } = window.Capacitor.Plugins;
  if (StatusBar) {
    try {
      await StatusBar.setStyle({ style: 'DARK' });
      await StatusBar.setBackgroundColor({ color: '#000000' });
    } catch {}
  }
})();

// === Network detection ===
window.bcNetwork = {
  status: async () => (await window.Capacitor.Plugins.Network.getStatus()).connected,
  onChange: (cb) => window.Capacitor.Plugins.Network.addListener('networkStatusChange', cb)
};

// === Calendar (add event) ===
window.bcCalendar = {
  addEvent: async ({ title, startDate, endDate, location, notes }) => {
    const { Calendar } = window.Capacitor.Plugins;
    if (!Calendar) return false;
    try {
      await Calendar.createEvent({ title, startDate, endDate, location, notes });
      return true;
    } catch (e) {
      console.warn('calendar add failed', e);
      return false;
    }
  }
};

// === Hijack ICS download to native calendar ===
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a[href*=".ics"], a[href*="/ics"]');
  if (!a || !window.Capacitor.isNativePlatform()) return;
  e.preventDefault();
  // Parse query params from booking
  const id = new URLSearchParams(window.location.search).get('id');
  // Récupérer details RDV via API et appeler bcCalendar.addEvent
  // (Implémentation détaillée dans la suite)
});
```

- [ ] **Step 2.2.3: Resync + test**

```bash
npm run sync && npm run build:ios
```

Test : ouvrir mon-rdv.html, cliquer "Ajouter au calendrier" → calendrier natif s'ouvre.

- [ ] **Step 2.2.4: Commit**

```bash
git add app/src/native-bridge.js app/package.json app/package-lock.json app/ios app/android
git commit -m "feat(app): add Share, Haptics, StatusBar, Network, Calendar bridges"
```

---

### Task 2.3: Splash screen + icons + branding

**Files:**
- Generated by `@capacitor/assets`
- Source: `app/resources/icon.png` + `app/resources/splash.png`

- [ ] **Step 2.3.1: Préparer assets**

Nino fournit ou génère depuis `assets/images/common/logo.png` :
- `app/resources/icon.png` (1024×1024 transparent PNG)
- `app/resources/splash.png` (2732×2732 fond noir + logo centré)

- [ ] **Step 2.3.2: Install + run @capacitor/assets**

```bash
cd app
npm install -D @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor '#000000' --splashBackgroundColor '#000000'
```

Cela génère toutes les tailles iOS + Android automatiquement.

- [ ] **Step 2.3.3: Splash screen plugin**

```bash
npm install @capacitor/splash-screen
npx cap sync
```

Modifier `capacitor.config.ts` :

```typescript
plugins: {
  SplashScreen: {
    launchShowDuration: 1500,
    backgroundColor: '#000000',
    showSpinner: false
  }
}
```

- [ ] **Step 2.3.4: Test build et lancement**

```bash
npm run build:ios
```

Expected: au lancement, splash noir avec logo s'affiche 1.5s puis disparait.

- [ ] **Step 2.3.5: Commit**

```bash
git add app/resources app/ios app/android app/capacitor.config.ts app/package.json
git commit -m "feat(app): splash screen + app icons (1024 source, all sizes generated)"
```

---

### Task 2.4: Universal Links (iOS) + App Links (Android)

**Files:**
- Create: `.well-known/apple-app-site-association`
- Create: `.well-known/assetlinks.json`
- Modify: `app/ios/App/App/Info.plist` (associated domains)
- Modify: `app/android/app/src/main/AndroidManifest.xml` (intent filter)
- Modify: `_headers` (Cloudflare) pour Content-Type JSON

> ⚠️ **DÉPENDANCE BLOQUANTE** : cette task **nécessite** que l'enrollment Apple Developer soit terminé (cf Pre-flight Checklist). Sans Team ID valide, le fichier `apple-app-site-association` ne peut pas être créé. Si l'enrollment business est encore en cours à J8, soit basculer sur compte individuel temporaire pour débloquer, soit reporter cette task à J11-12 (dans le buffer).

- [ ] **Step 2.4.1: Récupérer Team ID Apple**

Dans Apple Developer → Membership → Team ID (10 caractères alphanumériques, ex `ABC1234DEF`).
**Si pas encore validé**, STOP — voir note bloquante ci-dessus.

- [ ] **Step 2.4.2: Créer `.well-known/apple-app-site-association`**

Path: `.well-known/apple-app-site-association` (à la racine du site, sans extension)

⚠️ **REMPLACER `<TEAM_ID>` par le vrai Team ID 10-char récupéré au Step 2.4.1**. Ne PAS commit avec le placeholder — Apple rejette le parser sinon, et le fichier est public.

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "<TEAM_ID>.fr.barberclub.app",
        "paths": ["/r/rdv/*", "/pages/*/mon-rdv.html"]
      }
    ]
  }
}
```

Vérifier après création :
```bash
grep -E "<TEAM_ID>|TEAMID" .well-known/apple-app-site-association
# Expected: aucun match (si match → placeholder pas remplacé)
```

- [ ] **Step 2.4.3: Récupérer SHA-256 fingerprint Android**

Quand le build Android est fait :
```bash
cd app/android
./gradlew signingReport
```

Cherche `SHA-256` du keystore debug ET release.

- [ ] **Step 2.4.4: Créer `.well-known/assetlinks.json`**

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "fr.barberclub.app",
    "sha256_cert_fingerprints": ["AA:BB:CC:..."]
  }
}]
```

- [ ] **Step 2.4.5: Vérifier que `.well-known/` est servi correctement**

Cloudflare Pages sert tout par défaut. Vérifier après deploy :
```bash
curl -I https://barberclub-grenoble.fr/.well-known/apple-app-site-association
# Expected: 200 OK, content-type application/json (ou text/plain)
```

Si pas application/json : ajouter à `_headers` Cloudflare :
```
/.well-known/apple-app-site-association
  Content-Type: application/json
```

- [ ] **Step 2.4.6: Configure iOS Associated Domains**

Xcode → App → Signing & Capabilities → "+ Capability" → Associated Domains → ajouter :
```
applinks:barberclub-grenoble.fr
applinks:barberclub-site.pages.dev
```

- [ ] **Step 2.4.7: Configure Android intent filter**

Modifier `app/android/app/src/main/AndroidManifest.xml`, dans `<activity>` MainActivity :

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="barberclub-grenoble.fr" />
</intent-filter>
```

- [ ] **Step 2.4.8: Hook deep link dans bridge**

Ajouter à `native-bridge.js` :

```javascript
const { App } = window.Capacitor.Plugins;
App.addListener('appUrlOpen', (event) => {
  // event.url = "https://barberclub-grenoble.fr/r/rdv/abc/token123"
  const url = new URL(event.url);
  if (url.pathname.startsWith('/r/rdv/')) {
    const [, , , id, token] = url.pathname.split('/');
    const salon = memCache.get('bc_salon') || 'grenoble';
    window.location.href = `/pages/${salon}/mon-rdv.html?id=${id}&token=${token}`;
  }
});
```

- [ ] **Step 2.4.9: Deploy Cloudflare + Test**

```bash
cd "BarberClub Site"
npx wrangler pages deploy . --project-name barberclub-site --branch production --commit-dirty=true
```

Sur iPhone : ouvrir un email contenant un lien `r/rdv/...` → l'app doit s'ouvrir.

- [ ] **Step 2.4.10: Commit**

```bash
git add .well-known/ _headers app/ios app/android app/src/native-bridge.js
git commit -m "feat: universal links iOS + app links Android for /r/rdv/ deep links"
```

---

### Task 2.5: Privacy manifest iOS + métadonnées App Store

**Files:**
- Create: `app/ios/App/App/PrivacyInfo.xcprivacy`

- [ ] **Step 2.5.1: Créer `PrivacyInfo.xcprivacy`**

Path: `app/ios/App/App/PrivacyInfo.xcprivacy`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyCollectedDataTypes</key>
  <array>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeEmailAddress</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypePhoneNumber</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeName</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
  </array>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>CA92.1</string></array>
    </dict>
  </array>
</dict>
</plist>
```

- [ ] **Step 2.5.2: Ajouter au target Xcode**

Dans Xcode → drag `PrivacyInfo.xcprivacy` dans le projet → "Add to targets: App" → cocher.

- [ ] **Step 2.5.3: Commit**

```bash
git add app/ios/App/App/PrivacyInfo.xcprivacy app/ios/App/App.xcodeproj
git commit -m "feat(app): add iOS privacy manifest"
```

---

### Task 2.6: Tests multi-device + régression site

- [ ] **Step 2.6.0: Créer app record dans App Store Connect (pré-requis TestFlight)**

Avant le premier upload TestFlight, App Store Connect exige :
1. Aller sur https://appstoreconnect.apple.com → My Apps → "+" → New App
2. Plateforme : iOS
3. Nom : BarberClub
4. Langue principale : Français
5. Bundle ID : sélectionner `fr.barberclub.app` (créé dans Apple Developer Portal au préalable)
6. SKU : `barberclub-app-2026`
7. Validation : créer

Pour la soumission publique (V2) il faudra aussi : screenshots iPhone 6.7" et 6.5", description, mots-clés, copyright, catégorie. Pour TestFlight V1 : pas besoin (TestFlight n'exige pas tout ça).

- [ ] **Step 2.6.1: Build production iOS pour TestFlight**

Dans Xcode :
1. Sélectionner "Any iOS Device" (pas simulateur)
2. Product → Archive
3. Quand l'archive est créée → "Distribute App" → "App Store Connect" → "Upload"
4. Attendre le processing dans App Store Connect (15-30 min)

- [ ] **Step 2.6.2: Build APK Android pour Internal Testing**

```bash
cd app/android
./gradlew bundleRelease
```

Output: `app/android/app/build/outputs/bundle/release/app-release.aab`

Upload sur Google Play Console → Internal Testing → Create release.

- [ ] **Step 2.6.3: Inviter testeurs**

iOS : App Store Connect → TestFlight → Internal Testing → ajouter Nino + barbers
Android : Play Console → Internal Testing → ajouter emails Google

- [ ] **Step 2.6.4: Checklist multi-device**

Tester sur :
- [ ] iPhone SE (small screen, iOS 16+)
- [ ] iPhone 15 Pro (Dynamic Island)
- [ ] Samsung Galaxy S22+ (Android récent)
- [ ] Xiaomi entry-level (Android 9-10)
- [ ] iPad (mode portrait obligatoire dans manifest)

Pour chaque device, valider :
- [ ] App boot < 3s
- [ ] Login client OK
- [ ] Réservation 4 étapes complète OK
- [ ] Push reçu après création RDV
- [ ] Clic push → ouvre mon-rdv.html
- [ ] Biometric login marche (sauf iPhone SE 1ère gén : Touch ID)
- [ ] Add to calendar OK
- [ ] Share natif OK
- [ ] Tap-to-call vers numéro salon OK
- [ ] Universal Link depuis email OK

- [ ] **Step 2.6.5: Régression site web**

```bash
npx serve "BarberClub Site" -l 5500
```

Tester http://localhost:5500/pages/grenoble/reserver.html : login client, réservation, mon-rdv → tout doit marcher exactement comme avant.

Aussi tester en prod : https://barberclub-site.pages.dev/pages/grenoble/barbers.html

- [ ] **Step 2.6.6: Documenter bugs trouvés**

Créer `docs/superpowers/plans/2026-05-01-app-mobile-bugs.md` avec :
- Device
- Steps to reproduce
- Expected / Actual
- Severity (HIGH / MED / LOW)

- [ ] **Step 2.6.7: Fix HIGH/MED, log LOW pour V2**

Itérer jusqu'à zéro HIGH.

---

### Task 2.7: Doc `app/README.md` + final code review

**Files:**
- Create: `app/README.md`

- [ ] **Step 2.7.1: Écrire `app/README.md`**

Contenu :
- Setup (Node 18+, Xcode, Android Studio, signing)
- Workflow Nino : modif site → `npm run sync` → `npm run build:ios`
- Variables d'env (FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_JSON)
- TestFlight upload step-by-step
- Internal Testing Play Store step-by-step
- Troubleshooting (push pas reçu, deep link pas pris, etc.)

- [ ] **Step 2.7.2: Final code review**

Invoke skill `code-review:code-review` pour la branche complète depuis le début.

Focus :
- Sécurité : tokens never in localStorage côté app, push token register only after auth
- Régression site : fichiers `pages/`, `assets/`, `backend/src/routes/` (sauf client.js qui a 3 nouveaux endpoints + templates.js qui a 1 hook) — pas d'autres modifs
- Tests : tous les tests backend passent, code coverage acceptable
- Workflow : `npm run sync` reproductible, `.well-known/` servi correctement

- [ ] **Step 2.7.3: Fix issues HIGH/CRITICAL**

- [ ] **Step 2.7.4: Tag fin V1**

```bash
git tag app-v1-mvp
```

- [ ] **Step 2.7.5: Commit final**

```bash
git add app/README.md
git commit -m "docs: app/README.md with workflow + troubleshooting"
```

---

## Definition of Done V1

Cocher chaque item AVANT de considérer V1 livrée :

- [ ] App iOS build + tourne sur iPhone réel sans crash (test sur 2+ modèles)
- [ ] App Android build + tourne sans crash (test sur 2+ devices)
- [ ] Login client → token Keychain (vérifié via Xcode)
- [ ] Réservation 4 étapes → RDV créé en BDD
- [ ] Push reçu à création RDV (device test physique)
- [ ] Biometric login marche (Face ID + fingerprint Android)
- [ ] Click sur push notif → deep link vers RDV
- [ ] Universal Link `r/rdv/.../...` ouvre l'app (sinon site)
- [ ] Endpoint `DELETE /api/client/account` opérationnel
- [ ] Site web 100% inchangé en prod (régression check) sauf 2 fichiers `.well-known/`
- [ ] Message offline propre si pas de réseau
- [ ] TestFlight build uploaded + invitable
- [ ] Internal Testing build uploaded + invitable
- [ ] `app/README.md` complet
- [ ] Code reviews J5 + final passés sans HIGH/CRITICAL ouverts

---

## Out of scope (V2 ou plus tard)

- Programme fidélité avec récompenses + dépense de points
- Soumission App Store / Play Store publique
- Sign in with Apple / Google
- Certificate pinning, App Attestation
- Mode offline avec queue de réservations
- Apple Watch / Wear OS

---

## Notes pour exécution

- **Code reviews systématiques** : skill `code-review` à J5 (fin Phase 1) et J14 (final). Si bug critique en cours de route, lancer code-review immédiatement.
- **TDD strict côté backend** : tests d'abord, puis implémentation, puis tests passent avant commit.
- **TDD pragmatique côté app** : tests JS unit pour la logique pure (utils), smoke tests sur device pour le reste. E2E testing (Detox/Appium) hors scope V1.
- **DATABASE_URL pointe sur Railway prod** (cf MEMORY) : toute migration locale = manip prod. Confirmer avec Nino avant `node migrate.js`.
- **Push iOS = device physique uniquement** (pas simulateur).
- **Apple Developer enrollment démarre J1** (validation peut prendre 2 semaines pour business).
