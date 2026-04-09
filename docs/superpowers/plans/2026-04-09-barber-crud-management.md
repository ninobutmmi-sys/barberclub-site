# Gestion CRUD Barbers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre aux admins d'ajouter, désactiver et supprimer des barbers depuis le dashboard, avec un wizard de création complet (profil + horaires + prestations).

**Architecture:** Nouveau endpoint POST + DELETE sur le backend, migration BDD pour photo_url TEXT, et refonte de la page Barbers.jsx avec toggle switch, card fantôme, modal création, et zone danger dans la modal Modifier.

**Tech Stack:** React 19, Node.js/Express, PostgreSQL, React Query, bcrypt

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `backend/database/migrations/044_barber_crud.sql` | Migration photo_url VARCHAR→TEXT |
| Modify | `backend/src/index.js` | Body parser limit 5mb pour route barbers |
| Modify | `backend/src/routes/admin/barbers.js` | POST (créer), DELETE (supprimer), GET (retirer filtre is_active) |
| Modify | `dashboard/src/api.js` | createBarber(), deleteBarber() |
| Modify | `dashboard/src/hooks/useApi.js` | useCreateBarber(), useDeleteBarber() |
| Modify | `dashboard/src/pages/Barbers.jsx` | Header enrichi, toggle switch, card fantôme, CreateBarberModal, zone danger, DeleteBarberDialog |
| Modify | `dashboard/src/index.css` | Styles card fantôme, zone danger, dialog suppression |

---

### Task 1: Migration BDD — photo_url TEXT

**Files:**
- Create: `backend/database/migrations/044_barber_crud.sql`

- [ ] **Step 1: Créer le fichier migration**

```sql
-- Migration 044: Barber CRUD support
-- photo_url: VARCHAR(500) -> TEXT (pour base64 data URLs)

ALTER TABLE barbers ALTER COLUMN photo_url TYPE TEXT;
```

- [ ] **Step 2: Appliquer la migration**

```bash
cd backend && node database/migrate.js
```

Expected: `Migration 044_barber_crud.sql applied successfully`

- [ ] **Step 3: Commit**

```bash
git add backend/database/migrations/044_barber_crud.sql
git commit -m "migration(044): photo_url VARCHAR -> TEXT for base64 support"
```

---

### Task 2: Backend — POST /api/admin/barbers (créer)

**Files:**
- Modify: `backend/src/routes/admin/barbers.js` (ajouter route POST avant les routes /:id)
- Modify: `backend/src/index.js:189` (body parser limit)

- [ ] **Step 1: Augmenter la limite body-parser pour la route barbers**

Dans `backend/src/index.js`, la ligne 189 est :
```js
app.use(express.json({ limit: '100kb' }));
```

Ajouter un middleware spécifique AVANT le router admin pour la route barbers. Modifier dans `backend/src/routes/admin/barbers.js` en ajoutant un middleware local au début du fichier, en important express :

```js
const express = require('express');
```

Et sur la route POST, utiliser `express.json({ limit: '5mb' })` comme middleware inline.

- [ ] **Step 2: Ajouter la route POST dans barbers.js**

Insérer APRÈS la route `GET /guest-assignments/list` (ligne 61) et AVANT la route `PUT /:id` (ligne 66) :

```js
// ============================================
// POST /api/admin/barbers — Create a new barber
// ============================================
router.post('/',
  express.json({ limit: '5mb' }),
  [
    body('name').trim().notEmpty().withMessage('Nom requis').isLength({ max: 100 }),
    body('role').optional().trim().isLength({ max: 200 }),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Email invalide'),
    body('photo_url').optional({ values: 'falsy' }).isLength({ max: 3_000_000 }),
    body('schedules').isArray({ min: 7, max: 7 }).withMessage('7 jours requis'),
    body('schedules.*.day_of_week').isInt({ min: 0, max: 6 }),
    body('schedules.*.is_working').isBoolean(),
    body('schedules.*.start_time').optional({ values: 'falsy' }).matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('schedules.*.end_time').optional({ values: 'falsy' }).matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('service_ids').optional().isArray(),
    body('service_ids.*').optional().matches(uuidRegex),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { name, role, photo_url, schedules, service_ids } = req.body;
      let { email } = req.body;

      // Auto-generate email if not provided
      if (!email) {
        const slug = name.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]/g, '');
        email = `${slug}@barberclub-${salonId === 'grenoble' ? 'grenoble' : 'meylan'}.fr`;
      }

      // Check email uniqueness
      const existing = await db.query(
        'SELECT id FROM barbers WHERE email = $1 AND deleted_at IS NULL',
        [email]
      );
      if (existing.rows.length > 0) {
        throw ApiError.conflict('Cet email est déjà utilisé');
      }

      // Generate random password (barbers don't login individually)
      const bcrypt = require('bcrypt');
      const crypto = require('crypto');
      const passwordHash = await bcrypt.hash(crypto.randomUUID(), 12);

      // Get next sort_order
      const sortResult = await db.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM barbers WHERE salon_id = $1 AND deleted_at IS NULL',
        [salonId]
      );
      const sortOrder = sortResult.rows[0].next_order;

      // Transaction: create barber + schedules + services
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        const barberResult = await client.query(
          `INSERT INTO barbers (name, role, email, photo_url, password_hash, is_active, sort_order, salon_id)
           VALUES ($1, $2, $3, $4, $5, false, $6, $7)
           RETURNING id, name, role, photo_url, email, is_active, sort_order, salon_id`,
          [name, role || 'Barber', email, photo_url || null, passwordHash, sortOrder, salonId]
        );
        const barber = barberResult.rows[0];

        // Insert schedules
        for (const s of schedules) {
          await client.query(
            `INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working, salon_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [barber.id, s.day_of_week, s.is_working ? s.start_time : null, s.is_working ? s.end_time : null, s.is_working, salonId]
          );
        }

        // Insert barber_services
        if (service_ids && service_ids.length > 0) {
          for (const sid of service_ids) {
            await client.query(
              'INSERT INTO barber_services (barber_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [barber.id, sid]
            );
          }
        }

        await client.query('COMMIT');
        res.status(201).json(barber);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  }
);
```

- [ ] **Step 3: Modifier GET / pour inclure les barbers inactifs**

Ligne 19 du fichier, remplacer :
```sql
WHERE deleted_at IS NULL AND is_active = true AND salon_id = $1
```
par :
```sql
WHERE deleted_at IS NULL AND salon_id = $1
```

- [ ] **Step 4: Tester manuellement**

```bash
cd backend && npm run dev
# Dans un autre terminal :
curl -X POST http://localhost:3000/api/admin/barbers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"Test","schedules":[{"day_of_week":0,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":1,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":2,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":3,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":4,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":5,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":6,"is_working":false}]}'
```

Expected: 201 avec le barber créé, `is_active: false`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin/barbers.js backend/src/index.js
git commit -m "feat: POST /api/admin/barbers — create barber with schedules and services"
```

---

### Task 3: Backend — DELETE /api/admin/barbers/:id (supprimer)

**Files:**
- Modify: `backend/src/routes/admin/barbers.js`

- [ ] **Step 1: Ajouter la route DELETE**

Insérer après la route PUT (après la ligne 110) :

```js
// ============================================
// DELETE /api/admin/barbers/:id — Soft delete a barber
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const salonId = req.user.salon_id;

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Verify barber belongs to this salon
        const barberCheck = await client.query(
          'SELECT id, name FROM barbers WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL',
          [id, salonId]
        );
        if (barberCheck.rows.length === 0) {
          throw ApiError.notFound('Barber introuvable');
        }

        // Soft delete
        await client.query(
          'UPDATE barbers SET deleted_at = NOW(), is_active = false WHERE id = $1',
          [id]
        );

        // Cancel future confirmed bookings (not in-progress ones)
        const cancelled = await client.query(
          `UPDATE bookings SET status = 'cancelled'
           WHERE barber_id = $1 AND deleted_at IS NULL AND status = 'confirmed'
             AND (date > CURRENT_DATE OR (date = CURRENT_DATE AND start_time > LOCALTIME))
           RETURNING id, client_id, date, start_time`,
          [id]
        );

        // Queue cancellation notifications
        const { queueNotification } = require('../../services/notification');
        for (const booking of cancelled.rows) {
          if (booking.client_id) {
            await queueNotification(client, {
              type: 'booking_cancelled',
              booking_id: booking.id,
              salon_id: salonId,
            });
          }
        }

        // Cleanup orphaned data
        await client.query('DELETE FROM guest_assignments WHERE barber_id = $1 AND date >= CURRENT_DATE', [id]);
        await client.query('DELETE FROM blocked_slots WHERE barber_id = $1 AND date >= CURRENT_DATE', [id]);
        await client.query('DELETE FROM barber_services WHERE barber_id = $1', [id]);

        await client.query('COMMIT');

        res.json({ deleted: true, cancelled_bookings: cancelled.rows.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  }
);
```

- [ ] **Step 2: Vérifier l'import de queueNotification**

Vérifier que `require('../../services/notification')` exporte bien `queueNotification`. Si ce n'est pas le cas, utiliser le pattern du fichier `booking.js` pour queue les notifications. Sinon, simplifier en skippant les notifications (on les ajoutera après si besoin — le barber est supprimé, les clients seront notifiés par le batch cron si les notifications sont dans la queue).

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/admin/barbers.js
git commit -m "feat: DELETE /api/admin/barbers/:id — soft delete with booking cancellation"
```

---

### Task 4: Dashboard — API + Hooks

**Files:**
- Modify: `dashboard/src/api.js:213-232`
- Modify: `dashboard/src/hooks/useApi.js:77-83`

- [ ] **Step 1: Ajouter les fonctions dans api.js**

Après la ligne `export const updateBarber = ...` (ligne 216), insérer :

```js
export const createBarber = (body) =>
  request('/admin/barbers', { method: 'POST', body: JSON.stringify(body) });
export const deleteBarber = (id) =>
  request(`/admin/barbers/${id}`, { method: 'DELETE' });
```

- [ ] **Step 2: Ajouter les hooks dans useApi.js**

Après `useUpdateBarber` (après la ligne 83), insérer :

```js
export function useCreateBarber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.createBarber(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.barbers });
      qc.invalidateQueries({ queryKey: keys.services });
    },
  });
}

export function useDeleteBarber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteBarber(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.barbers });
      qc.invalidateQueries({ queryKey: keys.services });
    },
  });
}
```

- [ ] **Step 3: Modifier useUpdateBarber pour invalider services aussi**

Ligne 81, remplacer :
```js
onSuccess: () => qc.invalidateQueries({ queryKey: keys.barbers }),
```
par :
```js
onSuccess: () => {
  qc.invalidateQueries({ queryKey: keys.barbers });
  qc.invalidateQueries({ queryKey: keys.services });
},
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/api.js dashboard/src/hooks/useApi.js
git commit -m "feat: createBarber/deleteBarber API + hooks with cache invalidation"
```

---

### Task 5: Dashboard — CSS pour les nouveaux composants

**Files:**
- Modify: `dashboard/src/index.css`

- [ ] **Step 1: Ajouter les styles après le bloc `.toggle` (après ligne 1798)**

```css
/* ---- BARBER CARD GHOST ---- */
.barber-ghost-card {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.15s;
}
.barber-ghost-card:hover {
  border-color: var(--success);
  background: rgba(34,197,94,0.04);
}
.barber-ghost-card .ghost-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(34,197,94,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: var(--success);
  margin-bottom: 8px;
  transition: transform 0.2s;
}
.barber-ghost-card:hover .ghost-icon {
  transform: scale(1.1);
}

/* ---- DANGER ZONE ---- */
.danger-zone {
  border-top: 1px solid rgba(220,38,38,0.2);
  margin-top: 20px;
  padding-top: 16px;
}
.danger-zone-label {
  font-size: 11px;
  color: #dc2626;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
  margin-bottom: 10px;
}
.danger-zone-card {
  background: rgba(220,38,38,0.06);
  border: 1px solid rgba(220,38,38,0.2);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.danger-zone-card .danger-title {
  font-size: 13px;
  font-weight: 600;
  color: #fca5a5;
}
.danger-zone-card .danger-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* ---- DELETE CONFIRM DIALOG ---- */
.delete-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  animation: fadeIn 0.15s ease;
}
.delete-dialog {
  background: var(--bg-card);
  border: 1px solid rgba(220,38,38,0.3);
  border-radius: 14px;
  max-width: 400px;
  width: 90%;
  overflow: hidden;
  animation: slideUp 0.2s ease;
}
.delete-dialog-header {
  background: rgba(220,38,38,0.08);
  padding: 16px 20px;
  border-bottom: 1px solid rgba(220,38,38,0.2);
  display: flex;
  align-items: center;
  gap: 12px;
}
.delete-dialog-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(220,38,38,0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.delete-dialog-body {
  padding: 20px;
}
.delete-dialog-body .confirm-input {
  border-color: rgba(220,38,38,0.3);
}
.delete-dialog-body .confirm-input:focus {
  border-color: #dc2626;
  box-shadow: 0 0 0 2px rgba(220,38,38,0.15);
}

/* ---- CREATE BARBER MODAL SECTIONS ---- */
.create-section-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
  margin-bottom: 12px;
}
.photo-upload-zone {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--bg);
  border: 2px dashed var(--border);
  margin: 0 auto 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.2s;
  overflow: hidden;
}
.photo-upload-zone:hover {
  border-color: var(--text-secondary);
}
.photo-upload-zone img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.schedule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg);
  border-radius: 8px;
  border: 1px solid var(--border);
  margin-bottom: 6px;
}
.schedule-row .day-name {
  font-size: 13px;
  flex: 1;
}
.schedule-row .time-inputs {
  font-size: 12px;
  color: var(--text-secondary);
}
.service-pill {
  display: inline-flex;
  padding: 5px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
}
.service-pill.selected {
  background: rgba(34,197,94,0.12);
  border-color: rgba(34,197,94,0.3);
  color: var(--success);
}
.service-pill:hover {
  border-color: var(--text-secondary);
}

/* ---- RECAP SCREEN ---- */
.recap-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  text-align: center;
}
.recap-warning {
  background: rgba(245,158,11,0.08);
  border: 1px solid rgba(245,158,11,0.2);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 12px;
  color: #f59e0b;
  margin-top: 16px;
  text-align: left;
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/index.css
git commit -m "style: CSS for barber CRUD — ghost card, danger zone, delete dialog, create modal"
```

---

### Task 6: Dashboard — Page Barbers refonte (header + toggle + card fantôme)

**Files:**
- Modify: `dashboard/src/pages/Barbers.jsx:1-226` (composant principal)

- [ ] **Step 1: Ajouter les imports nécessaires**

Ligne 1-13, remplacer les imports par :

```js
import { useState, useCallback, useRef, useEffect } from 'react';
import useMobile from '../hooks/useMobile';
import {
  useBarbers,
  useBarberSchedule,
  useBarberGuestDays,
  useUpdateBarber,
  useUpdateBarberSchedule,
  useAddBarberOverride,
  useDeleteBarberOverride,
  useAddBarberGuestDay,
  useDeleteBarberGuestDay,
  useCreateBarber,
  useDeleteBarber,
  useServices,
} from '../hooks/useApi';
```

- [ ] **Step 2: Refondre le composant Barbers (header + toggle + card fantôme)**

Remplacer le composant `Barbers()` (lignes 65-226) par la version avec :
- Header enrichi avec compteur + bouton "+ Ajouter"
- Toggle switch visible sur chaque card (utilise la classe CSS `.toggle.active` existante)
- Card fantôme en dernière position
- State pour `showCreate` (modal création) et `deleteBarber` (dialog suppression)
- Appel `useUpdateBarber` pour le toggle inline

Le composant conserve les 3 states existants (`editBarber`, `scheduleBarber`, `guestBarber`) et ajoute `showCreate` (bool) et `deleteTarget` (barber object ou null).

L'implémentation exacte est longue (~200 lignes) mais suit le pattern des cards existantes. Les changements clés :
- `page-header` : ajouter `<span>` compteur + `<button>` vert
- Chaque card : remplacer le `<span className="badge ...">` par un `<button className="toggle ...">` qui appelle `toggleActive(b)`
- Card inactive : `style={{ opacity: 0.45 }}`
- Dernière card : `<div className="barber-ghost-card">` qui ouvre `showCreate`

- [ ] **Step 3: Tester visuellement**

```bash
cd dashboard && npm run dev
# Ouvrir http://localhost:5174/#/barbers
```

Vérifier :
1. Bouton "+ Ajouter" visible en haut à droite
2. Toggle switch sur chaque card (vert = actif)
3. Cliquer le toggle → appel API → card grisée si inactif
4. Card fantôme "+" visible en dernière position
5. Compteur "X barbers · Y actifs" dans le header

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Barbers.jsx
git commit -m "feat: Barbers page — header with counter, toggle switch, ghost card"
```

---

### Task 7: Dashboard — Modal "Nouveau barber" (CreateBarberModal)

**Files:**
- Modify: `dashboard/src/pages/Barbers.jsx` (ajouter le composant CreateBarberModal)

- [ ] **Step 1: Créer le composant CreateBarberModal**

Ajouter dans Barbers.jsx un nouveau composant `CreateBarberModal({ onClose })` avec :

**State :**
- `name`, `role` (défaut "Barber"), `email` (auto-généré), `photoPreview` (data URL), `photoFile`
- `schedules` : array de 7 objets `{ day_of_week, is_working, start_time, end_time }` pré-rempli Lun-Sam 9h-19h, Dim repos
- `selectedServices` : Set d'IDs, pré-rempli avec toutes les prestations
- `showRecap` : bool
- `status` : InlineStatus

**Sections :**
1. Photo : `<div className="photo-upload-zone">` + `<input type="file" accept="image/*" hidden>` + FileReader preview
2. Infos : 3 inputs (nom, rôle, email) — email auto-généré à partir du nom
3. Horaires : 7 `<div className="schedule-row">` avec checkbox + inputs time
4. Prestations : `useServices()` pour charger la liste, pills `.service-pill` toggleables

**Bouton "Vérifier et créer →"** : valide les champs, passe en `showRecap = true`

**Écran récap** : affiche le résumé + warning "créé en mode INACTIF" + bouton "Confirmer"

**Bouton "Confirmer"** : appelle `useCreateBarber().mutateAsync(body)` puis `onClose()`

Le body envoyé contient `{ name, role, email, photo_url: photoPreview, schedules, service_ids: [...selectedServices] }`.

- [ ] **Step 2: Brancher dans le composant principal**

Dans `Barbers()`, ajouter :
```jsx
{showCreate && <CreateBarberModal onClose={() => setShowCreate(false)} />}
```

- [ ] **Step 3: Tester le flow complet**

1. Cliquer "+ Ajouter" → modal s'ouvre
2. Remplir "Louay", rôle "Barber"
3. Email auto-généré "louay@barberclub-grenoble.fr"
4. Horaires pré-remplis, décocher Dimanche
5. Prestations toutes cochées
6. Cliquer "Vérifier et créer →" → récap
7. Cliquer "Confirmer" → barber créé, modal se ferme
8. Le nouveau barber apparaît dans la grille (grisé, toggle OFF = inactif)

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Barbers.jsx
git commit -m "feat: CreateBarberModal — wizard with photo upload, schedules, services"
```

---

### Task 8: Dashboard — Zone danger + Dialog suppression

**Files:**
- Modify: `dashboard/src/pages/Barbers.jsx` (modifier EditBarberModal + ajouter DeleteBarberDialog)

- [ ] **Step 1: Ajouter la zone danger dans EditBarberModal**

Dans `EditBarberModal`, après le dernier `</div>` du `modal-body` (avant `modal-footer`), ajouter :

```jsx
{/* Zone danger */}
<div className="danger-zone">
  <div className="danger-zone-label">Zone danger</div>
  <div className="danger-zone-card">
    <div>
      <div className="danger-title">Supprimer ce barber</div>
      <div className="danger-desc">Suppression définitive. Cette action est irréversible.</div>
    </div>
    <button
      type="button"
      className="btn btn-sm"
      style={{ background: '#dc2626', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}
      onClick={() => setShowDelete(true)}
    >
      Supprimer
    </button>
  </div>
</div>
```

Ajouter un state `showDelete` dans EditBarberModal.

- [ ] **Step 2: Créer le composant DeleteBarberDialog**

```jsx
function DeleteBarberDialog({ barber, onClose, onDeleted }) {
  const mutation = useDeleteBarber();
  const [confirmName, setConfirmName] = useState('');
  const nameMatch = confirmName.trim().toLowerCase() === barber.name.toLowerCase();

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync(barber.id);
      onDeleted();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="delete-dialog-overlay" onClick={onClose}>
      <div className="delete-dialog" onClick={e => e.stopPropagation()}>
        <div className="delete-dialog-header">
          <div className="delete-dialog-icon">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#dc2626" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fca5a5' }}>Supprimer {barber.name} ?</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Cette action est irréversible</div>
          </div>
        </div>
        <div className="delete-dialog-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Tous les futurs RDV de ce barber seront annulés et les clients notifiés.
            L'historique des RDV passés sera conservé.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Pour confirmer, écrivez <strong style={{ color: '#fca5a5' }}>{barber.name}</strong> ci-dessous :
          </p>
          <input
            className="input confirm-input"
            value={confirmName}
            onChange={e => setConfirmName(e.target.value)}
            placeholder={barber.name}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={onClose}>Annuler</button>
            <button
              className="btn btn-sm"
              style={{
                flex: 1,
                background: nameMatch ? '#dc2626' : '#333',
                color: nameMatch ? '#fff' : '#555',
                border: 'none',
                cursor: nameMatch ? 'pointer' : 'not-allowed',
              }}
              disabled={!nameMatch || mutation.isPending}
              onClick={handleDelete}
            >
              {mutation.isPending ? 'Suppression...' : 'Supprimer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Brancher le dialog dans EditBarberModal**

Quand `showDelete` est true, afficher `<DeleteBarberDialog barber={barber} onClose={() => setShowDelete(false)} onDeleted={() => { setShowDelete(false); onClose(); }} />`

- [ ] **Step 4: Tester le flow de suppression**

1. Ouvrir "Modifier" sur un barber de test
2. Scroller en bas → zone danger visible
3. Cliquer "Supprimer" → dialog s'ouvre
4. Taper un mauvais nom → bouton grisé
5. Taper le bon nom → bouton rouge
6. Cliquer "Supprimer" → barber disparaît de la liste
7. Vérifier en BDD : `deleted_at` rempli, bookings futurs annulés

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/Barbers.jsx
git commit -m "feat: danger zone in edit modal + delete confirmation dialog with name typing"
```

---

### Task 9: Test complet end-to-end + deploy

- [ ] **Step 1: Test création Louay**

1. Dashboard Grenoble → Barbers → "+ Ajouter"
2. Nom: Louay, Rôle: Barber, Photo: upload une photo
3. Horaires: Lun-Sam 9h-19h, Dim repos
4. Prestations: tout cocher
5. Vérifier le récap → Confirmer
6. Louay apparaît grisé (inactif) dans la grille
7. Toggle switch ON → Louay devient actif et visible sur le planning

- [ ] **Step 2: Test suppression (barber de test)**

1. Créer un barber "Test" temporaire
2. Modifier → zone danger → Supprimer
3. Taper "Test" → confirmer
4. Le barber disparaît de la liste

- [ ] **Step 3: Test mobile**

Ouvrir le dashboard en 375px (DevTools). Vérifier :
- Bouton "+ Ajouter" visible et utilisable
- Toggle switch cliquable (touch targets 44px)
- Modal de création scrollable
- Card fantôme visible

- [ ] **Step 4: Commit final + deploy**

```bash
git add -A
git commit -m "feat: barber CRUD management — create, toggle active, delete with confirmation"

# Deploy backend (auto via git push)
git push

# Deploy dashboard
cd dashboard && npm run build && npx wrangler pages deploy dist --project-name barberclub-dashboard --branch production --commit-dirty=true
```
