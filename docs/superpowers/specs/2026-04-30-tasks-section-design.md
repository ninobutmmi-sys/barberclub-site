# Section Tâches — Design Spec

**Date** : 2026-04-30
**Auteur** : Nino (avec Claude)
**Statut** : Approuvé en brainstorm, à implémenter

---

## Contexte

Le boss a demandé une section **Tâches** dans le dashboard pour pouvoir affecter des tâches à son alternant (Meylan), cocher fait/pas fait, et configurer des tâches récurrentes (ex : paie fin du mois).

L'alternant n'a pas de compte barber — l'assignation doit pouvoir cibler soit un barber existant, soit un nom libre (texte). Les tâches sont scopées par salon (alignées avec l'archi multi-salon actuelle).

## Décisions de cadrage

| # | Sujet | Décision |
|---|-------|----------|
| 1 | Assignés | **Mix** : barber_id existant OU nom libre (texte) |
| 2 | Scope | **Par salon** (`salon_id` aligné sur le reste du dashboard) |
| 3 | Récurrence | **Flexible** : "tous les X jours/semaines/mois" + jour spécifique |
| 4 | Date d'échéance | **Optionnelle** (some tasks "à faire quand possible", d'autres deadline) |
| 5 | Notifications | **Cloche dashboard uniquement** (pas d'email, pas de SMS) |
| 6 | Historique | **Stocké complet en BDD**, vue UI simple par défaut + drill-down |
| 7 | Permissions | **Tout barber connecté du salon** peut créer/éditer/cocher/supprimer |

## Architecture

Pattern standard du projet : 2 tables (définition + complétions), comme `bookings` + `notification_queue`.

### Data model

**Migration** : `backend/database/migrations/023_tasks.sql`

```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id TEXT NOT NULL REFERENCES salons(id),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    description TEXT,
    assigned_to_barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    assigned_to_name TEXT,
    due_date DATE,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    recurrence_config JSONB,
    next_due_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL REFERENCES barbers(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT tasks_assignee_xor CHECK (
        NOT (assigned_to_barber_id IS NOT NULL AND assigned_to_name IS NOT NULL)
    ),
    CONSTRAINT tasks_recurrence_consistency CHECK (
        (is_recurring = false AND recurrence_config IS NULL)
        OR (is_recurring = true AND recurrence_config IS NOT NULL)
    )
);

CREATE INDEX idx_tasks_salon_active_due ON tasks(salon_id, is_active, next_due_date);
CREATE INDEX idx_tasks_assigned_barber ON tasks(assigned_to_barber_id) WHERE assigned_to_barber_id IS NOT NULL;

CREATE TABLE task_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    completed_by_barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_date_at_completion DATE,
    notes TEXT,

    UNIQUE (task_id, due_date_at_completion)
);

CREATE INDEX idx_task_completions_task ON task_completions(task_id, completed_at DESC);

-- RLS (cohérent avec migration 014)
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;
```

### Recurrence config (JSONB)

```json
// tous les 3 jours
{ "unit": "day", "interval": 3 }

// tous les lundis
{ "unit": "week", "interval": 1, "days_of_week": [1] }

// tous les lundis et jeudis
{ "unit": "week", "interval": 1, "days_of_week": [1, 4] }

// le 15 de chaque mois
{ "unit": "month", "interval": 1, "day_of_month": 15 }

// dernier jour de chaque mois (paie)
{ "unit": "month", "interval": 1, "day_of_month": "last" }
```

Convention `days_of_week` : 0=Lundi, 6=Dimanche (cohérent avec `schedules.day_of_week` du projet).

## Backend

### Routes

Fichier : `backend/src/routes/admin/tasks.js`, wired dans `backend/src/index.js`.

Auth : `requireAuth + requireBarber`, rate limit `adminLimiter` (200/min).

```
GET    /api/admin/tasks?status=todo|done|all&due=overdue|today|week|later|none
GET    /api/admin/tasks/:id
POST   /api/admin/tasks
PUT    /api/admin/tasks/:id
DELETE /api/admin/tasks/:id
POST   /api/admin/tasks/:id/complete
POST   /api/admin/tasks/:id/uncomplete
GET    /api/admin/tasks/overdue/count
```

`salon_id` injecté côté dashboard via `api.js` (pattern existant).

### Service

Fichier : `backend/src/services/tasks.js`.

Fonction pure exportée :

```js
/**
 * Calcule la prochaine échéance d'une tâche récurrente.
 * @param {object} config - recurrence_config
 * @param {Date} fromDate - date de référence (ex: today, ou last completion date)
 * @returns {Date} prochaine due_date
 */
function computeNextDueDate(config, fromDate) { ... }
```

Cas couverts :
- `unit:day, interval:N` → fromDate + N jours
- `unit:week, interval:N, days_of_week:[...]` → prochain jour matchant la liste, à fromDate + (N-1) semaines minimum
- `unit:month, interval:N, day_of_month:D` → fromDate + N mois, jour D (clamp si mois trop court)
- `unit:month, interval:N, day_of_month:'last'` → dernier jour du mois cible

Edge case "fin du mois" : `new Date(year, month+1, 0).getDate()` retourne 28/29/30/31 selon mois.

### Validation (express-validator)

```js
body('title').isString().isLength({ min: 1, max: 200 }),
body('description').optional().isString(),
body('assigned_to_barber_id').optional().matches(uuidRegex),
body('assigned_to_name').optional().isString().isLength({ max: 100 }),
body('due_date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
body('is_recurring').isBoolean(),
body('recurrence_config').if(body('is_recurring').equals(true))
    .isObject()
    .custom(validateRecurrenceConfig),
```

Custom validator `validateRecurrenceConfig` : vérifie unit ∈ ['day','week','month'], interval ≥ 1, et selon unit les champs requis (days_of_week pour week, day_of_month pour month).

XOR enforcement côté JS aussi (pas seulement BDD) : soit `assigned_to_barber_id`, soit `assigned_to_name`, jamais les deux.

### Logique POST /complete

1. Validate task exists, salon match, is_active
2. Compute `due_date_at_completion` (current `next_due_date` si récurrent, sinon current `due_date`)
3. INSERT INTO `task_completions` (idempotent via UNIQUE constraint — si conflit, retourne 200 avec data existante)
4. Si récurrent : recompute `next_due_date = computeNextDueDate(recurrence_config, due_date_at_completion)`, UPDATE
5. Si one-shot : pas de mise à jour, c'est juste "fait"
6. Renvoie task à jour

### Logique POST /uncomplete

1. Find latest completion for this task
2. DELETE this completion
3. Si récurrent : recompute `next_due_date` à partir de la nouvelle dernière completion (ou date initiale si plus aucune)
4. Renvoie task à jour

## Frontend

### Sidebar (Layout.jsx)

Nouvelle entrée "Tâches" entre **Planning** et **Analytics**, icône clipboard-check (SVG inline).

### Page Tasks.jsx

Lazy-loaded dans `App.jsx`, route `/tasks`.

**Layout** :
- Header : titre + bouton `+ Nouvelle tâche`
- Tabs : `À faire` (default) | `Faites` | `Toutes`
- Sections collapsibles groupées par échéance :
  - **EN RETARD** (rouge)
  - **AUJOURD'HUI** (orange)
  - **CETTE SEMAINE** (jaune)
  - **PLUS TARD**
  - **SANS ÉCHÉANCE**

**Carte tâche** :
- Checkbox grand format (44×44 min cible iOS)
- Titre + description tronquée
- Pastille assigné : photo barber (pattern existant `getPhotoUrl`) ou initiale en pastille colorée pour nom libre
- Badge due date colorée (rouge/orange/vert selon urgence)
- Badge ⟳ si récurrent (avec tooltip recurrence pattern)
- Menu `…` : Éditer / Supprimer / Voir historique

**Optimistic UI** sur cocher : animation barre + grisage immédiat, POST `/complete`, si erreur revert + toast erreur. Pour récurrent → toast "Prochaine échéance : 31/05/2026".

### Modal Create/Edit

Champs :
- Titre (input requis)
- Description (textarea optionnel, 500 chars max)
- Assigné à : 2 modes radio
  - `Barber` → select barbers du salon (avec photo)
  - `Personne libre` → input texte (placeholder "Alternant")
- Date d'échéance (date picker, optionnel, bouton "effacer")
- Toggle "Tâche récurrente" → dévoile bloc :
  - `Tous les [N]` → select unit `jours / semaines / mois`
  - Si **semaine** : multi-select chips `Lun Mar Mer Jeu Ven Sam Dim`
  - Si **mois** : `Le [jour]` dropdown 1-31 + option "dernier jour du mois"
- Si récurrent et pas de due_date initiale : champ "À partir du" (date picker)

Validation côté client (mêmes règles que backend, message inline).

### Drawer Historique

Click sur `…` → "Voir historique" → side drawer (right slide-in) avec :
- Liste chronologique des completions (date, "par [Barber]" ou "par compte salon" si pas barber_id, notes optionnel)
- Pagination 12 par page
- Bouton "Annuler la dernière complétion" si on est dans la dernière (warning : "Cela va aussi recalculer la prochaine échéance")

### Cloche notification

`useNotifications.js` : nouveau type `tasks_overdue`.

Polling toutes les 60s → `GET /api/admin/tasks/overdue/count`.

Affichage badge dans `Layout.jsx` (cloche existante) : compteur rouge si > 0.

Click → navigate vers `/tasks?filter=overdue`.

### API client

`dashboard/src/api.js` : nouveau objet `tasks` avec méthodes :

```js
api.tasks.list({ status, due })
api.tasks.get(id)
api.tasks.create(payload)
api.tasks.update(id, payload)
api.tasks.delete(id)
api.tasks.complete(id, { notes })
api.tasks.uncomplete(id)
api.tasks.overdueCount()
```

`salon_id` auto-injecté via le wrapper existant.

## Edge cases

| Cas | Comportement |
|-----|--------------|
| `day_of_month=31` pour février | Clamp à 28/29 (dernier jour) |
| Hebdo multi-jours (Lun + Jeu) | Prochain jour matchant ≥ fromDate+1 |
| Edit recurrence existante | `next_due_date` recalculé depuis aujourd'hui |
| 2 barbers cliquent "fait" simultanément | UNIQUE `(task_id, due_date_at_completion)` → 2e requête idempotente |
| Barber supprimé | FK ON DELETE SET NULL → tâche reste assignée à "Aucun" |
| Tâche soft-deletée | Cachée des listes mais completions conservées |
| Récurrent sans due_date initiale | Modal demande "À partir de quelle date ?" |
| Drift complétion (cochée 3j après deadline) | `due_date_at_completion` capture deadline d'origine ; `completed_at` = timestamp réel |
| Uncomplete arbitraire | Seule la dernière completion peut être annulée |

## Tests

**Unit (backend)** — fichier `backend/src/services/tasks.test.js` (à créer, premier test du projet) :
- `computeNextDueDate` : 12 cas
  - day×3 : interval 1, 3, 30
  - week×3 : single jour, multi-jours, week interval=2
  - month×4 : day_of_month 15, day_of_month 31 mois court, 'last', interval 3
  - edge : 31 janvier → "last day February" en année non-bissextile (28) puis bissextile (29)

**API smoke (manuel via curl ou Postman)** :
1. POST one-shot → 201 → check BDD
2. POST /complete → 200 → check `task_completions` + `tasks.completed_at` si applicable
3. POST recurring monthly fin de mois → /complete → check `next_due_date` = fin du mois suivant
4. POST /uncomplete → check completion supprimée + `next_due_date` revert

**Frontend smoke (manuel)** :
- Crée tâche pour alternant → coche → drawer historique → édite recurrence → revérifie next_due_date

## Déploiement

1. **Backend** :
   - `git push origin main` (Railway auto-deploy)
   - `railway run node database/migrate.js` (applique 023)
2. **Dashboard** :
   - `cd dashboard && npm run build`
   - `wrangler pages deploy dist --project-name barberclub-dashboard --branch production --commit-dirty=true`
3. **Vérif post-deploy** : créer une tâche test, cocher, vérifier cloche, supprimer la tâche test.

Pas d'impact sur le site vitrine ni les flows clients existants.

## Estimation effort

| Étape | Durée |
|-------|-------|
| Migration + service récurrence + tests unit | ~2h |
| Routes admin/tasks.js + validation | ~2h |
| Page Tasks.jsx + modal + drawer historique | ~5h |
| Sidebar + cloche notif intégration | ~1h |
| Tests manuels + bug fixes | ~1h |
| **Total** | **~11h ≈ 1.5 journée solo** |

## Hors scope (V1)

- Pas d'accès alternant direct (il n'a pas de compte ; le boss coche pour lui — peut-être V2 via lien magique token-based)
- Pas de notifications email/SMS (cloche dashboard uniquement)
- Pas de sous-tâches / checklist imbriquée
- Pas de pièces jointes (photos, fichiers)
- Pas de commentaires sur tâches
- Pas de priorité (haute/moyenne/basse) — juste due date qui ordonne naturellement
- Pas de dashboard "stats tâches" dans Analytics (peut s'ajouter V2)
- Pas de tâches transverses cross-salon (option C de la Q2 rejetée)
