# Gestion CRUD Barbers — Spec Design

**Date:** 2026-04-09
**Status:** Approved

## Context

Le salon de Grenoble recrute un nouveau barber (Louay, commence en mai). Actuellement la page Barbers du dashboard permet uniquement de modifier les barbers existants — pas de créer ni supprimer. Le logiciel doit être complet : l'admin doit pouvoir gérer entièrement l'équipe depuis le dashboard.

## Décisions validées

| Sujet | Décision |
|-------|----------|
| Layout page | Option C — bouton "+ Ajouter" header + card fantôme + toggle switch visible |
| Formulaire création | Modal classique, 1 page scrollable (4 sections) + récap avant validation |
| Suppression | Zone danger dans modal Modifier + dialog confirmation "écrire le nom" |
| Visibilité inactif | Invisible partout sauf page Barbers dashboard (grisé, opacité 0.45) |
| Upload photo | Fichier direct, converti en base64 data URL côté frontend |
| Mot de passe | Auto-généré (bcrypt d'un UUID random), invisible pour l'admin |
| Barber créé | `is_active = false` par défaut — l'admin l'active quand il est prêt |

---

## 1. Page Barbers — Modifications

### Header

```
┌─────────────────────────────────────────────────┐
│  BARBERS  5 barbers · 4 actifs       [+ Ajouter]│
└─────────────────────────────────────────────────┘
```

- Compteur dynamique : total barbers (non-deleted) + count actifs
- Bouton vert "+ Ajouter" (`background: var(--success)`, `color: #000`)

### Cards barber

Chaque card existante est modifiée :

- **Toggle switch** en haut à droite remplace le badge texte "Actif"/"Inactif"
  - Actif : fond vert `#22c55e`, dot blanc à droite
  - Inactif : fond gris `#444`, dot gris à gauche
  - Au clic : appel `PUT /api/admin/barbers/:id { is_active: true/false }`
  - Feedback : inline toast "Nathan désactivé" / "Nathan activé"
- **Cards inactives** : `opacity: 0.45` sur toute la card
- Boutons Modifier / Horaires / Jours invité : inchangés, toujours cliquables même en inactif

### Card fantôme "+ Ajouter"

- Position : dernière card dans la grille
- Style : `border: 2px dashed var(--border)`, fond transparent
- Contenu : cercle vert avec "+" + texte "Ajouter un barber"
- Hover : `border-color: var(--success)`
- Clic : ouvre la modal "Nouveau barber" (même action que le bouton header)

---

## 2. Modal "Nouveau barber"

### Structure

Modal centrée, max-width 480px, fond `var(--bg-card)`. Header "NOUVEAU BARBER" + bouton fermer. Scrollable. Bouton "Vérifier et créer →" fixe en bas.

### Section 1 — Photo

- Zone circulaire 80px, bordure dashed, icône caméra SVG
- Clic → `<input type="file" accept="image/*">` caché
- Preview immédiate : `FileReader.readAsDataURL()` → affiche dans le cercle
- Validation frontend : max 2MB, types image/jpeg, image/png, image/webp
- Optionnel — si pas de photo, le barber aura l'initiale comme avatar

### Section 2 — Informations

| Champ | Type | Requis | Défaut | Validation |
|-------|------|--------|--------|------------|
| Prénom | text | Oui | — | 1-100 chars |
| Rôle | text | Non | "Barber" | max 200 chars |
| Email | email | Non | Auto `{prenom}@barberclub-{salon}.fr` | Format email, unique |

L'email est auto-généré à partir du prénom (lowercase, sans accents). L'admin peut le modifier.

### Section 3 — Horaires de travail

7 lignes, une par jour (Lundi→Dimanche) :

```
┌──────────────────────────────────────────┐
│ [✓] Lundi                    09:00—19:00 │
│ [✓] Mardi                    09:00—19:00 │
│ [✓] Mercredi                 09:00—19:00 │
│ [✓] Jeudi                    09:00—19:00 │
│ [✓] Vendredi                 09:00—19:00 │
│ [✓] Samedi                   09:00—19:00 │
│ [ ] Dimanche                 Repos       │
└──────────────────────────────────────────┘
```

- Checkbox toggle travaille/repos
- Inputs time `start_time` / `end_time` (type="time")
- Pré-rempli : Lun-Sam 09:00-19:00, Dimanche repos
- Jour décoché → masque les inputs horaires, affiche "Repos"
- Convention BDD : `day_of_week` 0=Lundi, 6=Dimanche

### Section 4 — Prestations assignées

- Liste de toutes les prestations actives du salon (`GET /api/admin/services`)
- Affichées en pills/chips cliquables
- Toggle on/off : vert quand sélectionné, gris quand non
- Pré-sélection : toutes les prestations cochées par défaut
- Chaque pill affiche : nom + durée + prix (ex: "Coupe · 30min · 27€")

### Écran récap

Au clic "Vérifier et créer →", le formulaire est remplacé par un récap :

```
┌──────────────────────────────────────────┐
│         [Photo ou initiale]              │
│            LOUAY                          │
│            Barber                         │
│   louay@barberclub-grenoble.fr           │
│                                          │
│   Horaires                               │
│   Lun-Sam 09:00—19:00 · Dim repos       │
│                                          │
│   Prestations (8/10)                     │
│   Coupe, Coupe+Barbe, Barbe, ...        │
│                                          │
│   ⚠ Le barber sera créé en mode INACTIF │
│   Activez-le depuis la page Barbers      │
│   quand il sera prêt à recevoir des RDV  │
│                                          │
│   [← Retour]        [Confirmer ✓]       │
└──────────────────────────────────────────┘
```

- Bouton "← Retour" : revient au formulaire (état conservé)
- Bouton "Confirmer ✓" : appel API, ferme la modal, refresh la liste
- Message info jaune : le barber est créé inactif

---

## 3. Modal "Modifier" — Zone danger

En bas de la modal `EditBarberModal` existante, après les champs actuels :

```
─── Zone danger ──────────────────────────
┌──────────────────────────────────────────┐
│  Supprimer ce barber                     │
│  Suppression définitive. Irréversible.   │
│                             [Supprimer]  │
└──────────────────────────────────────────┘
```

- Séparateur : `border-top: 1px solid rgba(220,38,38,0.2)`
- Label : "ZONE DANGER" en rouge, uppercase, 11px
- Card : fond `rgba(220,38,38,0.06)`, bordure `rgba(220,38,38,0.2)`
- Bouton rouge `background: #dc2626`

---

## 4. Dialog de suppression

Modal de confirmation superposée (au-dessus de la modal Modifier) :

- **Header rouge** : icône warning + "Supprimer {nom} ?"
- **Texte** : "Tous les futurs RDV de ce barber seront annulés. Les clients seront notifiés. L'historique des RDV passés sera conservé."
- **Input** : "Écrivez **{nom}** pour confirmer"
  - Bordure rouge `rgba(220,38,38,0.3)`
  - Comparaison case-insensitive + trim
- **Bouton "Supprimer"** : grisé (`background: #333`, `cursor: not-allowed`) tant que le nom n'est pas exact. Devient rouge quand match.
- **Bouton "Annuler"** : ferme le dialog, retour à la modal Modifier

---

## 5. Backend

### Nouveau : `POST /api/admin/barbers`

**Body :**
```json
{
  "name": "Louay",
  "role": "Barber",
  "email": "louay@barberclub-grenoble.fr",
  "photo_url": "data:image/jpeg;base64,...",
  "schedules": [
    { "day_of_week": 0, "is_working": true, "start_time": "09:00", "end_time": "19:00" },
    { "day_of_week": 6, "is_working": false }
  ],
  "service_ids": ["uuid1", "uuid2"]
}
```

**Logique :**
1. Validation : name requis, email unique (si fourni), schedules array de 7
2. Générer `password_hash` : `bcrypt.hash(crypto.randomUUID(), 12)`
3. Transaction :
   - `INSERT INTO barbers` (name, role, email, photo_url, password_hash, is_active=false, salon_id, sort_order=dernier+1)
   - `INSERT INTO schedules` × 7 jours
   - `INSERT INTO barber_services` × N prestations
4. Retourner le barber créé

**Validation :**
- `name` : requis, trim, 1-100 chars
- `role` : optionnel, trim, max 200 chars
- `email` : optionnel, format email, unique parmi barbers du salon
- `photo_url` : optionnel, max 2MB en base64 (vérifier taille string < 2.8M chars)
- `schedules` : array, chaque item a day_of_week (0-6), is_working (bool), start_time/end_time (HH:MM si is_working)
- `service_ids` : array d'UUIDs

### Nouveau : `DELETE /api/admin/barbers/:id`

**Logique :**
1. Vérifier que le barber appartient au salon de l'admin
2. Transaction :
   - Soft delete : `UPDATE barbers SET deleted_at = NOW(), is_active = false WHERE id = $1`
   - Récupérer les bookings futurs confirmés du barber
   - Les annuler : `UPDATE bookings SET status = 'cancelled' WHERE barber_id = $1 AND date >= CURRENT_DATE AND status = 'confirmed'`
   - Queue les notifications d'annulation pour chaque booking annulé
3. Retourner `{ deleted: true, cancelled_bookings: N }`

### Modifié : `GET /api/admin/barbers`

Retirer le filtre `is_active = true` pour les barbers résidents. Les barbers inactifs doivent apparaître dans le dashboard.

Changement :
```sql
-- Avant
WHERE deleted_at IS NULL AND is_active = true AND salon_id = $1
-- Après
WHERE deleted_at IS NULL AND salon_id = $1
```

### Migration BDD

**Migration 044 : `photo_url` VARCHAR(500) → TEXT**

```sql
ALTER TABLE barbers ALTER COLUMN photo_url TYPE TEXT;
```

Nécessaire pour stocker les data URLs base64 (>500 chars).

---

## 6. Dashboard — API + Hooks

### api.js — Nouvelles fonctions

```javascript
export const createBarber = (body) =>
  request('/admin/barbers', { method: 'POST', body: JSON.stringify(body) });

export const deleteBarber = (id) =>
  request(`/admin/barbers/${id}`, { method: 'DELETE' });
```

### useApi.js — Nouveaux hooks

```javascript
export function useCreateBarber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.createBarber(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['barbers'] }),
  });
}

export function useDeleteBarber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteBarber(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['barbers'] }),
  });
}
```

---

## 7. Fichiers impactés

| Action | Fichier | Changement |
|--------|---------|------------|
| Modify | `dashboard/src/pages/Barbers.jsx` | Header enrichi, toggle switch, card fantôme, modal Nouveau, zone danger, dialog suppression |
| Modify | `dashboard/src/api.js` | `createBarber()`, `deleteBarber()` |
| Modify | `dashboard/src/hooks/useApi.js` | `useCreateBarber()`, `useDeleteBarber()` |
| Modify | `backend/src/routes/admin/barbers.js` | `POST /` (créer), `DELETE /:id` (supprimer), `GET /` (retirer filtre is_active) |
| Create | `backend/database/migrations/044_barber_crud.sql` | `photo_url` → TEXT |
| Modify | `dashboard/src/index.css` | Styles toggle switch, card fantôme, zone danger, dialog confirmation |

## 8. Hors scope

- Upload photo vers Cloudflare R2 / S3 (base64 suffit pour <10 barbers)
- Modification de l'ordre des barbers (drag & drop sort_order)
- Page barber sur le site vitrine (pages/barbers/) — les photos/infos y sont hardcodées
- Création de compte barber avec login individuel (2 comptes admin suffisent)
