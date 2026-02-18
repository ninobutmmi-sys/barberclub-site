# PROMPT SAAS — Système de Réservation BarberClub Meylan

> **Ce fichier est le prompt à donner à Claude Code pour créer le système de réservation.**
> Copie-colle l'intégralité de ce document au début de ta conversation avec Claude Code.

---

## CONTEXTE

Je suis le gérant de BarberClub, un barbershop premium avec 2 salons en Isère (Grenoble et Meylan). J'ai déjà un site vitrine en HTML/CSS/JS vanilla (PWA) hébergé sur Apache.

Actuellement, le salon de Meylan utilise Timify pour la réservation en ligne (intégré via iframe dans `pages/meylan/reserver.html`). Je veux **remplacer Timify par mon propre système de réservation** intégré directement dans mon site.

Le site est hébergé sur **Cloudflare** (pas Apache/OVH). Avant, on payait ~200$/mois pour Timify, donc on a de la marge budgétaire pour les services nécessaires.

**Je ne suis pas développeur.** Je ne code pas. Claude Code doit tout faire : architecture, base de données, backend, frontend, déploiement. Explique-moi les choses simplement quand il y a des décisions à prendre.

---

## OBJECTIF

Créer un système de réservation en ligne complet pour le salon BarberClub de Meylan qui remplace Timify. Le système doit inclure :

1. **Interface client** : page de réservation intégrée au site existant (remplace l'iframe Timify)
2. **Dashboard admin/barber** : tableau de bord pour gérer les RDV, voir le planning, gérer les prestations
3. **Analytics & données** : base de données complète des clients et RDV, graphiques de performance, profils clients, tendances
4. **Système de notifications** : confirmation par email + rappel par SMS la veille du RDV
5. **Système d'avis** : redirection vers Google Reviews après le RDV

---

## LE SALON DE MEYLAN

### Infos générales
- **Adresse** : 26 Av. du Grésivaudan, 38700 Corenc
- **Horaires** : 9h - 19h, tous les jours
- **Instagram** : https://www.instagram.com/barberclub.meylan

### L'équipe (2 barbers)

| Barber | Rôle | Prestations |
|--------|------|-------------|
| Lucas | Co-fondateur & Barber | Toutes les prestations |
| Julien | Barber | Toutes sauf "Coupe enfant -12 ans" |

### Catalogue des prestations

| Prestation | Prix | Durée |
|-----------|------|-------|
| Coupe Homme | 27,00 € | 30 min |
| Coupe Homme + Contours de Barbe | 33,00 € | 30 min |
| Coupe Homme + Barbe | 38,00 € | 30 min |
| Coupe Études Supérieures / Collège / Lycée (1) | 24,00 € | 30 min |
| Coupe Études Supérieures / Collège / Lycée (2) | 24,00 € | 20 min |
| Coupe Homme + Barbe (avec serviette chaude) | 48,00 € | 40 min |
| Barbe Uniquement | 20,00 € | 20 min |
| Barbe + Serviette Chaude + Soin Visage | 30,00 € | 30 min |
| Coupe Homme Partenaire Comité d'Entreprise | 24,00 € | 30 min |
| Coupe Homme + Contours de Barbe (CE) | 29,00 € | 30 min |
| Coupe Homme + Barbe Partenaire CE | 33,00 € | 30 min |
| Coupe Enfant -12 ans | 20,00 € | 20 min |

---

## FONCTIONNALITÉS DÉTAILLÉES

### 1. Interface de réservation (côté client)

Le parcours de réservation du client doit être **simple, rapide et beau** — inspiré de l'expérience Planity (fluide, moderne) tout en gardant le look sombre et premium de BarberClub.

**Étapes du parcours client (5 étapes) :**

1. **Choix du barber** — Le client choisit d'abord son barber : Lucas, Julien, ou "Peu importe" (= premier disponible). Afficher la photo de chaque barber. Beaucoup de clients ont LEUR barber habituel, c'est le premier réflexe.
2. **Choix de la prestation** — Le client voit la liste des prestations avec prix et durée. Seules les prestations que le barber sélectionné peut faire sont affichées (ex: si Julien est choisi, "Coupe enfant -12 ans" n'apparaît pas). Si "Peu importe" a été choisi, toutes les prestations sont affichées.
3. **Choix de la date et du créneau** — Calendrier visuel avec les jours disponibles. Puis affichage des créneaux horaires disponibles pour le barber choisi (ou les deux si "peu importe"). Les créneaux déjà pris ne sont pas affichés.
4. **Infos client + Confirmation** — Sur le même écran :
   - En haut : récapitulatif complet (barber, prestation, date, heure, prix)
   - En dessous : formulaire d'infos client
     - **Réservation rapide** : nom, prénom, téléphone (obligatoire), email (optionnel)
     - **Création de compte** (optionnel) : checkbox "Créer un compte" → affiche champs email + mot de passe → permet de voir l'historique des RDV, modifier/annuler un RDV, retrouver son barber préféré
   - Si le client est **connecté à son compte** : champs pré-remplis automatiquement. IMPORTANT : le pré-remplissage ne fonctionne QUE si le client s'est connecté. Pas de reconnaissance automatique par numéro de téléphone sans connexion (RGPD)
   - Bouton "Confirmer mon rendez-vous" en bas
5. **Page de succès** — Message de confirmation + résumé + "Ajoutez ce RDV à votre calendrier" (lien .ics)

**Règles métier :**
- Un créneau est bloqué dès qu'un client le réserve (pas de double réservation)
- Durée minimum entre deux RDV : 0 min (les créneaux s'enchaînent)
- Le client peut annuler jusqu'à 2h avant le RDV (via un lien dans l'email/SMS de confirmation)
- Pas de paiement en ligne — tout se paie sur place

### 2. Dashboard Admin / Barber

Interface web protégée par login (email + mot de passe) pour gérer le salon.

**Vue planning :**
- Affichage journalier et hebdomadaire du planning de chaque barber
- Vue côte à côte des 2 barbers (comme un agenda Google)
- Chaque RDV est un bloc coloré avec : nom du client, prestation, heure début/fin
- Clic sur un RDV → détails + possibilité d'annuler ou modifier
- Possibilité d'ajouter un RDV manuellement (pour les clients qui appellent ou viennent sans réserver)

**Gestion des prestations :**
- Ajouter / modifier / supprimer des prestations (nom, prix, durée)
- Activer/désactiver une prestation temporairement
- Assigner quels barbers peuvent faire quelle prestation

**Gestion des barbers :**
- Modifier les horaires de chaque barber (horaires par défaut + exceptions)
- Ajouter des jours de congé / indisponibilité
- Chaque barber a son propre login

**Accès au dashboard :**
- **Tous les barbers (Lucas, Julien) et le gérant ont accès complet** à tout le dashboard : planning, prestations, clients, analytics
- Pas de niveaux d'accès différenciés — tout le monde voit tout
- Chaque personne a son propre compte (email + mot de passe)

### 5. Analytics & Données (section dédiée du dashboard)

Le dashboard doit avoir un **onglet Analytics** complet avec des graphiques visuels et interactifs. C'est un outil de pilotage pour le gérant. Toutes les données de réservation doivent être stockées en base de données (ne rien perdre) pour permettre des analyses dans le temps.

**A. Performance business :**
- Chiffre d'affaires par jour / semaine / mois (graphique en barres ou courbe)
- Panier moyen (CA total ÷ nombre de RDV)
- Nombre de RDV par jour / semaine / mois (courbe d'évolution)
- Comparaison mois par mois (ex: février 2026 vs janvier 2026)
- Heures de pointe : quels créneaux horaires sont les plus réservés (heatmap ou graphique)
- Jours les plus rentables de la semaine
- Taux de remplissage : % de créneaux réservés vs créneaux disponibles

**B. Profil clients :**
- Base de données clients complète : nom, téléphone, email, historique de visites
- Fiche client individuelle : toutes ses réservations passées, prestation préférée, barber préféré, date de dernière visite, montant total dépensé
- Clients fidèles vs nouveaux clients (graphique en camembert + évolution)
- Fréquence de visite moyenne des clients
- Top 10 des meilleurs clients (par nombre de visites ou CA généré)
- Clients inactifs : ceux qui ne sont pas revenus depuis X semaines (pour relance)

**C. Analyse par prestation :**
- Répartition des RDV par type de prestation (graphique camembert)
- CA généré par prestation
- Prestation la plus populaire / la plus rentable
- Évolution dans le temps (est-ce qu'une prestation monte ou baisse ?)

**D. Analyse par barber :**
- Nombre de RDV par barber
- CA généré par barber
- Taux de fidélité par barber (% de clients qui reviennent chez le même barber)
- Note moyenne par barber (si avis internes activés plus tard)

**E. Tendances & prévisions :**
- Courbe d'évolution du CA sur les 6-12 derniers mois
- Prévision du mois en cours basée sur les réservations déjà prises
- Identification des périodes creuses vs chargées
- Taux de no-show (RDV non honorés) avec évolution

**F. Tableau de bord résumé (page d'accueil du dashboard) :**
- KPIs en un coup d'œil : RDV aujourd'hui, CA du jour, CA du mois, nombre de nouveaux clients ce mois
- Prochain RDV pour chaque barber
- Alertes : clients qui ont annulé, créneaux vides dans la journée

**Stockage des données :**
- Chaque réservation (passée et future) doit être conservée en base de données indéfiniment
- Historique complet des clients (même s'ils ne créent pas de compte — on les identifie par téléphone)
- Les données de no-show doivent être trackées (le barber marque si le client est venu ou pas)
- Utiliser une base de données robuste (Supabase PostgreSQL recommandé) capable de gérer des requêtes analytiques sur des mois/années de données

### 3. Notifications

**Email de confirmation** (immédiat après réservation) :
- Récapitulatif : prestation, barber, date, heure, adresse du salon
- Lien pour annuler le RDV
- Lien pour ajouter au calendrier (.ics)
- Design cohérent avec le branding BarberClub (sombre, premium)

**SMS de rappel** (la veille du RDV) :
- Texte court : "Rappel : votre RDV chez BarberClub Meylan demain à [HEURE] avec [BARBER]. Pour annuler : [LIEN]"
- Utiliser un service SMS comme Twilio ou OVH SMS (prévoir l'intégration, me guider pour la configuration)

**Demande d'avis Google** (24h après le RDV) :
- Email avec un lien direct vers la page Google Reviews de BarberClub Meylan
- Message sympa : "Merci pour votre visite ! Votre avis compte pour nous."

### 4. Comptes clients (optionnel)

Si le client crée un compte, il peut :
- Voir son historique de RDV
- Re-réserver la même prestation en 2 clics
- Modifier/annuler ses RDV à venir
- Avoir son barber préféré pré-sélectionné

---

## DIRECTION ARTISTIQUE

Le système de réservation doit s'intégrer parfaitement dans le site existant BarberClub.

**EXIGENCE CRITIQUE : le résultat doit être BEAU.** Pas de calendrier basique, pas d'interface qui fait "appli gratuite". Chaque écran doit donner l'impression d'un produit premium, comme si c'était fait par une startup tech avec des vrais designers.

### Style visuel — Interface de réservation (client)
- **Fond** : noir (#000) avec éléments sombres
- **Texte** : blanc (#fff) et gris clair (rgba(255,255,255,0.6))
- **Accents** : à déterminer mais dans l'esprit premium/doré ou blanc pur
- **Polices** : Orbitron ExtraBold pour les titres, Inter pour le corps de texte
- **Effets** : backdrop-filter blur, transitions douces, animations subtiles
- **Mobile-first** : le site est une PWA pensée pour mobile
- **Calendrier** : PAS un calendrier HTML basique. Un calendrier custom, élégant, avec des transitions entre les mois, des jours qui s'animent au tap, des créneaux horaires visuellement travaillés (cards avec glassmorphism, pas des boutons carrés moches)
- **Sélection du barber** : cards avec photo, glassmorphism, hover/tap effect élégant — pas juste un bouton radio avec un nom
- **Sélection de prestation** : cards bien designées avec le prix et la durée bien mis en forme, séparateur subtil, animation de sélection
- **Transitions entre étapes** : slide fluide entre chaque étape (pas un rechargement de page sec)
- **Loading states** : skeleton loaders ou spinners élégants pendant les chargements API, jamais un écran vide ou figé

### Style visuel — Dashboard (admin/barbers)
- **Look professionnel** : le dashboard doit ressembler à une vraie appli SaaS pro (style Notion, Linear, ou Cal.com), pas à un admin panel bricolé
- **Planning** : affichage type Google Calendar avec les 2 barbers côte à côte, blocs de RDV colorés, drag possible pour modifier, zoom smooth
- **Graphiques** : propres, avec des couleurs cohérentes, des tooltips, des transitions d'animation quand les données changent
- **Navigation** : sidebar claire, breadcrumbs, transitions entre les pages
- **Responsive** : utilisable sur tablette au salon

### Inspirations
- **Timify** : le système de créneaux horaires, la gestion des barbers
- **Planity** : l'expérience de réservation côté client (fluide, rapide, moderne)
- **Cal.com** : le design du calendrier de réservation (clean, moderne, animations)
- **Linear.app** : le design du dashboard (sobre, pro, rapide)
- **Le site BarberClub existant** : fond noir, Orbitron, ambiance premium

### Intégration dans le site existant
- La page `pages/meylan/reserver.html` doit être modifiée pour charger le nouveau système de réservation au lieu de l'iframe Timify
- Le header du site existant (bouton retour + titre "Réserver" + "Salon de Meylan") doit être conservé
- La réservation doit ressembler à une page native du site, pas à un widget externe

---

## STACK TECHNIQUE

### Ce que je sais
- Le site actuel est en HTML/CSS/JS vanilla, hébergé sur **Cloudflare**
- Je ne connais rien au backend, aux bases de données, aux serveurs
- Budget : on payait ~200$/mois pour Timify, donc on est prêt à investir si ça apporte un meilleur résultat

### Ce que j'attends de Claude Code
- **Choisis la stack technique la plus simple et adaptée** pour ce projet
- Explique-moi tes choix en termes simples
- Propose une solution qui soit facile à maintenir et pas chère à héberger
- Le backend doit gérer : les créneaux, les RDV, les comptes clients, les notifications

### Suggestions de stack (à valider par Claude Code)
- **Frontend** : La priorité est le **meilleur rendu visuel possible** pour les clients ET pour le dashboard des barbers. Si un framework comme React ou Vue donne un meilleur résultat (transitions plus fluides, interactions plus réactives, dashboard plus pro), alors utilise-le. Si le vanilla JS suffit pour un résultat équivalent, reste en vanilla. Le critère n°1 est la qualité visuelle et l'expérience utilisateur, pas la cohérence technique avec le site existant
- **Backend** : Node.js (Express) ou Python (Flask/FastAPI) — à toi de recommander
- **Base de données** : Supabase (PostgreSQL managé) est une option intéressante — on est prêt à payer un abonnement si nécessaire. Sinon PostgreSQL, MySQL, ou autre — à toi de recommander. La base doit pouvoir gérer des requêtes analytiques lourdes (agrégations sur des mois/années de données clients et RDV)
- **SMS** : Twilio ou OVH SMS
- **Email** : Nodemailer, Resend, ou SendGrid
- **Hébergement** : le site est actuellement sur Cloudflare, mais on est ouvert à d'autres solutions si c'est mieux pour la sécurité ou la simplicité. Le backend peut être ailleurs (Railway, Render, Fly.io, Cloudflare Workers, ou autre). On est prêt à payer un hébergement si nécessaire. **Guide-moi étape par étape pour la configuration DNS et le déploiement**, je ne suis pas à l'aise avec la partie infra

---

## WORKFLOW

On va travailler en phases séquentielles. **Ne passe à la phase suivante que quand je te le dis.**

### Phase 1 : Architecture & Choix techniques
- Propose l'architecture complète du système (schéma)
- Recommande la stack technique avec des justifications simples
- Définis le schéma de base de données (tables, relations)
- Définis les endpoints API (routes)
- Explique comment ça s'intègre avec le site existant
- **NE CODE RIEN.** Juste la stratégie et la structure.

### Phase 2 : Base de données & Backend
- Crée la base de données avec toutes les tables
- Code les endpoints API (CRUD pour les RDV, prestations, barbers, clients)
- Gestion de l'authentification (admin, barbers, clients)
- Logique métier : vérification des disponibilités, gestion des conflits de créneaux

### Phase 3 : Interface de réservation (client)
- Code le parcours de réservation complet (les 5 étapes : barber → prestation → date/créneau → infos+confirmation → succès)
- Intègre dans le design BarberClub existant
- Mobile-first, animations fluides
- Connecte au backend (API)

### Phase 4 : Dashboard Admin
- Interface de gestion complète
- Vue planning avec gestion des RDV
- Gestion des prestations et des barbers
- Système de marquage : le barber indique si le client est venu ou pas (pour tracker les no-shows)

### Phase 5 : Analytics & Données
- Page d'accueil dashboard avec KPIs en un coup d'œil
- Graphiques de performance business (CA, RDV, heures de pointe)
- Base de données clients avec fiches individuelles (historique, préférences)
- Analyses par prestation et par barber
- Tendances et prévisions
- Identification des clients fidèles et des clients inactifs

### Phase 6 : Notifications
- Emails de confirmation (design BarberClub)
- SMS de rappel (intégration service SMS)
- Email de demande d'avis Google (24h après RDV)
- Guide-moi pour configurer les services (Twilio, etc.)

### Phase 7 : Tests & Déploiement
- Teste tout le parcours de réservation
- Teste le dashboard admin
- Teste les notifications
- Guide-moi pour déployer le tout
- Connecte avec le site existant (remplacement de l'iframe Timify)

---

## SÉCURITÉ — EXIGENCE CRITIQUE

**Ce système gère des données personnelles de vrais clients (noms, téléphones, emails). Il ne doit PAS être hackable.** La sécurité n'est pas optionnelle, c'est une priorité absolue.

### Authentification & Accès
- Mots de passe hashés avec **bcrypt (12 rounds minimum)** — jamais stockés en clair
- Sessions via **JWT signés** (secret fort, 256 bits minimum) avec expiration courte (15 min) + refresh tokens (7 jours)
- Refresh tokens stockés en base, révocables individuellement
- Brute force protection : **verrouillage temporaire après 5 tentatives échouées** (lockout 15 min)
- Déconnexion = suppression du refresh token en base (pas juste côté client)

### Protection API
- **CORS strict** : seuls barberclub.fr et admin.barberclub.fr peuvent appeler l'API
- **Rate limiting** : 60 req/min par IP sur les routes publiques, 200/min sur le dashboard
- **Helmet.js** : headers de sécurité HTTP (X-Frame-Options, X-Content-Type-Options, CSP, etc.)
- **Validation de TOUTES les entrées** côté serveur (express-validator ou joi) : format téléphone FR, email, dates, longueurs max — ne jamais faire confiance au frontend
- **Requêtes SQL paramétrées** uniquement — zéro concaténation de chaînes (prévention injection SQL)
- **Protection XSS** : échapper toutes les sorties, Content-Security-Policy strict
- **Protection CSRF** : tokens sur les formulaires sensibles
- **Token d'annulation** : UUID v4 cryptographiquement aléatoire par RDV — impossible à deviner

### Données & RGPD
- Pas de pré-remplissage sans connexion (respect RGPD)
- Les mots de passe ne transitent jamais en clair (HTTPS obligatoire partout)
- Logs d'erreur côté serveur mais **jamais de données sensibles dans les logs** (pas de mots de passe, pas de tokens)
- Possibilité future de suppression de données client sur demande (droit à l'oubli)

### Environnement
- Variables sensibles (clés API Twilio, Resend, Supabase, JWT secret) dans des **variables d'environnement**, jamais en dur dans le code
- Fichier `.env.example` avec les noms des variables (sans les valeurs)
- `.env` dans `.gitignore`

---

## FIABILITÉ — EXIGENCE CRITIQUE

**Ce système gère les RDV d'un vrai salon. S'il plante, les barbers ne savent plus qui vient et les clients ne peuvent plus réserver. Il ne doit JAMAIS tomber en panne sans raison, et en cas de problème il doit se récupérer seul.**

### Gestion des erreurs
- **Chaque appel API doit avoir un try/catch** avec un message d'erreur clair
- Côté client : si l'API ne répond pas, afficher un message "Service temporairement indisponible, réessayez dans quelques instants" — pas un écran blanc ou une erreur technique
- **Retry automatique** : si un appel API échoue (timeout réseau), le frontend retente 2 fois avant d'afficher une erreur
- Les emails/SMS qui échouent doivent être re-tentés (queue de retry) et ne pas bloquer la réservation

### Disponibilité
- **La réservation doit fonctionner même si le dashboard est en panne** (ce sont des systèmes séparés)
- Si Twilio est en panne, le RDV se crée quand même — le SMS sera envoyé plus tard
- Si Resend est en panne, le RDV se crée quand même — l'email sera envoyé plus tard
- **Le backend doit redémarrer automatiquement** en cas de crash (Railway le gère nativement)

### Intégrité des données
- **Pas de double réservation** : utiliser une transaction SQL ou un verrou pour bloquer un créneau de manière atomique (si 2 clients réservent le même créneau en même temps, un seul passe)
- **Les prix sont figés** au moment de la réservation (dans la table bookings) — si tu changes un tarif, les anciennes résas gardent l'ancien prix
- **Sauvegardes automatiques** de la base de données (Supabase Pro le fait, vérifier la fréquence)
- Jamais de suppression physique des données : utiliser des **soft deletes** (un champ `deleted_at`) pour pouvoir récupérer en cas d'erreur

### Monitoring
- **Logs structurés** côté backend (avec horodatage, route, méthode, code de réponse)
- En cas d'erreur serveur (500), logger le détail pour pouvoir diagnostiquer
- Prévoir un endpoint `/api/health` qui retourne "ok" — utilisable pour monitorer que l'API est en vie

---

## RÈGLES GÉNÉRALES

### Code
- Code propre, commenté, bien structuré
- Noms de variables et commentaires en anglais (convention standard)
- Interface utilisateur et textes en français
- Gestion des erreurs robuste (pas de crash silencieux)
- Toutes les règles de sécurité ci-dessus sont obligatoires, pas optionnelles

### UX
- Parcours rapide et intuitif : barber → prestation → créneau → confirmer (4 taps maximum)
- Temps de chargement rapide
- Feedback visuel sur chaque action (loading, succès, erreur)
- Messages d'erreur clairs et humains (pas de codes techniques)
- **Skeleton loaders** pendant les chargements (pas de spinner blanc sur fond noir)

### Accessibilité
- Navigation au clavier fonctionnelle
- Contraste suffisant (4.5:1 minimum)
- Aria-labels sur les éléments interactifs
- Compatible lecteurs d'écran

---

## COMMENCE MAINTENANT

Lance la **Phase 1 : Architecture & Choix techniques**.

Propose-moi :
1. La stack technique recommandée avec tes justifications
2. Le schéma de base de données complet
3. La liste des endpoints API
4. Comment le système s'intègre avec le site BarberClub existant
5. Un schéma du parcours de réservation côté client

Ne code rien. Explique-moi tout simplement. J'approuverai avant de passer à la suite.
