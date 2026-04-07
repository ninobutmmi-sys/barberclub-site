# Landing Page — Teaser 3e salon Voiron

**Date:** 2026-04-07
**Status:** Approved

## Context

BarberClub a 2 salons (Grenoble, Meylan). Un 3e salon à Voiron est en négociation. On veut ajouter un teaser mystérieux sur la landing page sans révéler trop d'infos.

## Design

### Layout mobile (vertical stack)

- Grenoble : ~45vh (inchangé)
- Séparateur lumineux horizontal (inchangé)
- Meylan : ~45vh (inchangé)
- Séparateur secondaire horizontal (subtil)
- **Voiron teaser : ~10-12vh, bandeau en bas**

Total > 100vh → la page scrolle. Le `overflow-y: auto` existant sur mobile (max-width: 767px, ligne 588) couvre ce cas. Le Voiron est sous le fold, visible au scroll.

### Layout desktop (colonnes)

- Grenoble : flex principal (~45%)
- Séparateur vertical lumineux (inchangé)
- Meylan : flex principal (~45%)
- Séparateur vertical secondaire (subtil)
- **Voiron teaser : `flex: none; width: 10%`** — taille fixe, ne participe PAS au hover expand

### Classe CSS

Le panneau Voiron utilise une classe **`.salon-teaser`**, PAS `.salon`. Cela garantit :
- Pas de participation au flex hover expand (`.salons:hover .salon`)
- Pas de page transition au clic (JS cible `.salon`)
- Pas de parallax gyroscope/souris (cible `.salon-bg` dans `.salon`)
- Pas de particules (générées uniquement pour `.salon`)
- `pointer-events: none` — pas cliquable, cursor par défaut

### Bandeau Voiron — style visuel

- **Image** : convertir `Gemini_Generated_Image_swn7p9swn7p9swn7.png` → `salon-voiron-facade.webp` (max 600px large, < 200KB)
- **Filtre** : `brightness(0.15) saturate(0.3)` — nette mais très sombre
- **Overlay** : `linear-gradient(0deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 100%)`
- **Texte principal** : "? ? ?" en Orbitron 13px, `rgba(255,255,255,0.35)`, letter-spacing 0.35em
- **Texte secondaire** : "coming soon" en 7px, `rgba(255,255,255,0.12)`, letter-spacing 0.2em — volontairement sous le seuil de lecture confortable, subliminal
- **Ken Burns** : `kenBurns3` — zoom lent très subtil, plus lent que les deux autres (scale 1 → 1.06, 30s), renforce le côté "dormant"
- **Entrée animée** : opacity 0 → 1, delay 1.2s (après Meylan qui finit à ~1.05s)
- **`prefers-reduced-motion`** : reset opacity à 1, pas d'animation Ken Burns
- **`prefers-color-scheme: light`** : reste sombre (exception volontaire — renforce le mystère)

### Séparateur secondaire (avant Voiron)

Même structure HTML que le séparateur principal mais plus discret :
- Opacité globale ~50% du principal
- Pas de traveling light orb (pas de `::after`)
- Glow plus faible (opacity 0.2 au lieu de 0.4)
- Mobile : horizontal, 2px de haut (au lieu de 3px)
- Desktop : vertical, 2px de large, même switch via media query

### Ce qui ne change pas

- Intro cinématique (logo glow focus)
- Header (logo, couronne, compte)
- Curseur custom desktop
- Grain overlay
- Animations d'entrée Grenoble et Meylan
- Touch hint mobile (position inchangée, se cache au scroll existant)
- Séparateur principal entre Grenoble et Meylan
- Booking modal

### Exclusions JS explicites

Le panneau `.salon-teaser` n'est PAS ciblé par :
- Page transition click handler (cible `.salon` uniquement)
- Parallax gyroscope/souris (cible `.salon-bg` dans `.salon`)
- Particle generation (cible `.salon .particles`)
- Booking modal interception

## Image

Avant implémentation :
1. Renommer `Gemini_Generated_Image_swn7p9swn7p9swn7.png` → `salon-voiron-facade.webp`
2. Redimensionner à 600px de large max
3. Convertir en WebP (qualité 75)
4. Vérifier < 200KB

## Fichiers impactés

- `index.html` — ajout du panneau `.salon-teaser`, séparateur secondaire, CSS associé, keyframe `kenBurns3`

## Hors scope

- Aucune page Voiron (pas de /pages/voiron/)
- Aucun backend (pas de salon_id voiron)
- Aucun lien, formulaire, ou interaction
