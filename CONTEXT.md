# BarberClub - Contexte Projet

## Description

Site vitrine pour BarberClub, barbier et coiffeur homme premium avec 2 salons en Isere (Grenoble et Meylan/Corenc). Le site est une PWA (Progressive Web App) full HTML/CSS/JS sans framework, optimise pour mobile.

---

## Structure du site

```
BarberClub Site/
├── index.html                          # Landing page (choix Grenoble / Meylan)
├── sw.js                               # Service Worker PWA
├── .htaccess                           # Config Apache (cache, gzip, securite)
│
├── pages/
│   ├── grenoble/                       # Salon Grenoble
│   │   ├── index.html                  # Page principale salon
│   │   ├── barbers.html                # Equipe (Tom, Alan, Nathan, Clement)
│   │   ├── prestations.html            # Services & tarifs
│   │   ├── galerie.html                # Galerie photos/videos coupes
│   │   ├── contact.html                # Adresse, horaires, carte Leaflet
│   │   └── reserver.html               # Redirection vers Planity
│   │
│   ├── meylan/                         # Salon Meylan
│   │   ├── index.html                  # Page principale salon
│   │   ├── barbers.html                # Equipe (Lucas, Julien)
│   │   ├── prestations.html            # Services & tarifs
│   │   ├── galerie.html                # Galerie photos/videos coupes
│   │   ├── contact.html                # 26 Av. du Gresivaudan, 38700 Corenc
│   │   └── reserver.html               # Redirection vers Timify
│   │
│   ├── barbers/                        # Profils individuels des barbers
│   │   ├── barber-tom.html             # Tom - Salon Grenoble
│   │   ├── barber-alan.html            # Alan - Salon Grenoble
│   │   ├── barber-nathan.html          # Nathan - Salon Grenoble
│   │   ├── barber-clement.html         # Clement - Salon Grenoble
│   │   ├── barber-lucas.html           # Lucas - Co-fondateur, Salon Meylan
│   │   └── barber-julien.html          # Julien - Salon Meylan
│   │
│   └── legal/                          # Pages legales
│       ├── cgu.html                    # Conditions generales
│       ├── mentions-legales.html       # Mentions legales
│       └── politique-confidentialite.html
│
├── assets/
│   ├── fonts/
│   │   ├── Orbitron-ExtraBold.ttf      # Police titres (GRENOBLE, MEYLAN, boutons)
│   │   └── Orbitron-VariableFont_wght.ttf
│   │
│   ├── icons/
│   │   └── favicon.png
│   │
│   ├── images/
│   │   ├── common/                     # Logo, favicon, couronne
│   │   │   ├── logo.png
│   │   │   ├── logo-blanc.png
│   │   │   ├── favicon.png
│   │   │   └── couronne.png
│   │   ├── barbers/                    # Photos portraits des barbers
│   │   │   ├── tom.png, alan.png, nathan.png
│   │   │   ├── clement.png, lucas.png
│   │   │   └── julien.jpg
│   │   └── salons/                     # Photos des salons
│   │       ├── grenoble/               # JPG + WebP optimises
│   │       └── meylan/                 # JPG + WebP optimises
│   │
│   ├── videos/
│   │   ├── barbers/                    # Videos presentation (MP4 compresses)
│   │   │   ├── tom.mp4, alan.mp4, nathan.mp4
│   │   │   ├── clement.mp4, lucas.mp4
│   │   ├── Barbers-coupes/             # Videos/photos des coupes
│   │   │   ├── Coupes TOM/
│   │   │   ├── Coupe Alan/
│   │   │   ├── Coupe Nathan/
│   │   │   ├── Coupe Lucas/
│   │   │   └── Coupe Ju/
│   │   └── coupes-clement/             # Coupes de Clement
│   │
│   └── js/
│       └── booking-modal.js            # Modal de reservation
│
├── config/
│   ├── manifest.json                   # Configuration PWA
│   ├── robots.txt                      # Regles crawlers SEO
│   └── sitemap.xml                     # Plan du site (a mettre a jour)
│
└── docs/
    └── generate-icons.html             # Utilitaire generation icones PWA
```

---

## Chemins relatifs (conventions)

Depuis les pages dans `pages/*/` :
- Assets : `../../assets/...`
- Config : `../../config/...`
- Retour accueil : `../../`
- Autre section meme salon : `barbers.html`, `prestations.html` (meme dossier)
- Barber individuel : `../barbers/barber-tom.html`
- Pages legales : `../legal/cgu.html`

---

## Stack technique

- **HTML/CSS/JS** pur, pas de framework
- **CSS inline** dans chaque page (pas de fichier CSS externe)
- **Polices** : Orbitron ExtraBold (titres), Inter + Oswald via Google Fonts
- **Cartes** : Leaflet.js (CDN) pour les pages contact
- **PWA** : Service Worker + manifest.json
- **Serveur** : Apache (.htaccess avec gzip, cache, securite)

---

## Systemes de reservation

| Salon | Plateforme | URL |
|-------|-----------|-----|
| Grenoble | Planity | https://www.planity.com/barber-club-38000-grenoble |
| Meylan | Timify | https://book.timify.com/?accountId=68e13d325845e16b4feb0d4c |

---

## Equipe

### Salon Grenoble
| Barber | Role | Page |
|--------|------|------|
| Tom | Barber | pages/barbers/barber-tom.html |
| Alan | Barber | pages/barbers/barber-alan.html |
| Nathan | Barber | pages/barbers/barber-nathan.html |
| Clement | Barber | pages/barbers/barber-clement.html |

### Salon Meylan
| Barber | Role | Page |
|--------|------|------|
| Lucas | Co-Fondateur & Barber | pages/barbers/barber-lucas.html |
| Julien | Barber | pages/barbers/barber-julien.html |

---

## SEO

- **Schema.org** : BarberShop markup sur les pages salon
- **Open Graph** : Balises OG pour partage social
- **Twitter Cards** : summary_large_image
- **Canonical URLs** : https://barberclub.fr/...
- **Meta geo** : region FR-38, Grenoble / Meylan
- **Sitemap** : config/sitemap.xml (URLs a mettre a jour apres restructuration)

---

## Reseaux sociaux

- Instagram Grenoble : https://www.instagram.com/barberclub.grenoble
- Instagram Meylan : https://www.instagram.com/barberclub.meylan

---

## Optimisations appliquees

- Videos compressees de MOV vers MP4 (H.264, CRF 28) : 92 MB -> 13 MB
- Images WebP generees pour les photos salon
- Image salon-meylan-interieur.jpg : 2.8 MB -> 378 KB
- Dossier legacy supprime (234 MB de doublons)
- preload="none" sur les videos pour chargement differe
- Taille totale du site : 594 MB -> 83 MB

---

## Points a corriger (TODO)

- [x] Mettre a jour sitemap.xml avec les nouvelles URLs (/pages/...)
- [x] Mettre a jour sw.js PRECACHE_ASSETS avec les nouveaux chemins
- [x] Generer les icones PWA manquantes (72x72 a 512x512)
- [x] Supprimer fichiers inutiles a la racine (SALON MEYLAN INTERIEUR.HEIC 44MB, site ju.pdf)
- [x] Activer la redirection HTTPS dans .htaccess pour la production
- [x] Completer les numeros de telephone dans le schema.org
