# Le Fauteuil Rouge 🍿

Les sorties ciné, les séances du soir et le box-office, en **app** (PWA) et en **newsletter du lundi**.

- **App** : https://lefauteuilrouge.vercel.app, à ajouter à l'écran d'accueil.
- **Newsletter** : chaque lundi vers 7 h 45, par GitHub Actions.

## L'app

Trois onglets :

- **À l'affiche**
  - *Cette semaine* : la sortie phare et les autres sorties du mercredi, avec la note du Fauteuil, les 3 semaines suivantes, les sorties streaming, les festivals et cérémonies.
  - *À venir* : la frise de l'année (affiche plus grande = plus de salles), ou la vue Mois. Filtres : grosses sorties, toutes, ma liste, genres. Abonnement webcal aux grosses sorties.
  - *Box-office* : France (semaine en cours et précédente), week-end US, cumul mondial de l'année.
- **Ce soir** : la frise horaire des séances dans les cinémas choisis (carte Pathé par défaut), sur 7 jours, en VO ou VF. Une séance ouvre « J'y vais », la réservation et l'ajout à l'agenda.
- **Mes films** : *À voir* (avec compte à rebours avant la sortie), *Mes séances* (les tickets « J'y vais » : partage, itinéraire, réservation), *Vus*.

La **fiche film** prend la couleur de l'affiche. Elle affiche la bande-annonce intégrée quand Wikidata la connaît, la **note du Fauteuil**, l'« En bref » tiré de Wikipédia et les séances dans tes cinés. La **recherche** (loupe) trouve un titre ou un réalisateur.

**La note du Fauteuil** est la moyenne des notes disponibles, ramenées sur 10 : Rotten Tomatoes (critiques) % ÷ 10, IMDb (spectateurs) tel quel, Letterboxd (cinéphiles) × 2. Elle est suivie d'un mot (Excellent, Très bien, Bien, Mitigé, Décevant). Une phrase indique si critiques et public sont d'accord : 2 points d'écart ou plus, et c'est « la presse aime plus que le public » ou l'inverse.

Ta liste, tes tickets et tes cinémas sont gardés **sur le téléphone** (localStorage). Avec un **compte** (pseudo + mot de passe, bouton en haut de « Mes films »), ils se synchronisent entre appareils : le plus récent gagne, et à la connexion ce qui est sur le téléphone et sur le compte est fusionné. Le mot de passe n'est jamais stocké, seulement son empreinte scrypt avec un sel. Les sessions sont des jetons aléatoires (seule leur empreinte est gardée), et un compte est bloqué 15 min après 8 essais ratés. Il n'y a pas d'e-mail, donc pas de récupération de mot de passe. Les comptes vivent dans le store Vercel Blob privé `lefauteuilrouge-comptes` (un fichier par compte).

**Partager un ticket** envoie un lien `/t/…`. Il ouvre une page lisible sans l'app, avec l'affiche en aperçu dans iMessage / WhatsApp et trois boutons : agenda, réservation, itinéraire. Les données de la séance voyagent dans le lien, rien n'est stocké. Seuls les liens de réservation des sites de cinéma connus sont gardés.

Les sorties streaming affichent le logo de la plateforme (`web/logos/`, en SVG, avec une copie PNG pour les mails).

## La newsletter

`scripts/newsletter.js` envoie :

- la sortie phare (notes, « En bref », bande-annonce) et les autres sorties de la semaine ;
- les 3 semaines suivantes ;
- le box-office France, US et monde ;
- les sorties streaming, les festivals et cérémonies ;
- la **séance de rattrapage** : 3 classiques par semaine sans répétition (`data/classiques.json`, rotation dans `lib/reco.js`).

Chaque affiche et chaque titre ouvre la fiche du film dans l'app (`/?film=<id>`). « ☆ À voir » l'ajoute aussi à la liste (`&add=1`).

GitHub lance les tâches planifiées du matin avec des heures de retard. Le workflow (`.github/workflows/newsletter.yml`) démarre donc le **dimanche soir**, attend sur place (5 h 40 au plus par run), puis **se relance lui-même** jusqu'au lundi 7 h 40 à Paris avant d'envoyer. Les déclenchements du lundi matin servent de filet, et une marque « déjà envoyée » évite les doublons. Le bouton « Run workflow » (case « relais » décochée) envoie tout de suite.

## Quand une source casse

Les données viennent de pages publiques (JP's Box-Office, paris-cine.info) qui peuvent changer de format. Les filets :

1. **Contrôle chaque soir** (`.github/workflows/check.yml`, `scripts/check.js`). Il vérifie ce que voit l'app : sorties à venir, box-office France / US / monde, fraîcheur du catalogue, notes du n° 1, liste des cinémas. Si quelque chose manque, un **mail d'alerte** part à `EMAIL_USER`.
2. **Côté app, au démarrage** : les séances de tes cinés se chargent en arrière-plan dès l'ouverture et restent gardées 3 h sur le téléphone, ce qui affiche « Ce soir » tout de suite.
3. **Côté serveur** : si une section du catalogue revient vide, `api/catalog.js` ne la met en cache que 15 min au lieu de 6 h, pour réessayer vite.
4. **Côté app** : une section vide est remplacée par celle gardée sur le téléphone lors du chargement précédent.

Si la newsletter échoue, une alerte part aussi à `EMAIL_USER`.

## Sources

| Données | Source | Fichier |
|---|---|---|
| Sorties France, salles, box-office France / US / monde | JP's Box-Office (pages publiques) | `lib/jpbox.js` |
| Notes IMDb, Rotten Tomatoes, Letterboxd, bande-annonce | Wikidata (identifiants), jeu de données IMDb, pages RT et Letterboxd | `lib/ratings.js` |
| « En bref » | Wikipédia (fr, sinon en) | `lib/ratings.js` |
| Séances, cinémas, cartes acceptées, liens de réservation | paris-cine.info (cache 6 h, 3 requêtes à la fois au plus, crédité dans l'app) | `lib/seances.js` |
| Sorties streaming | Listes Wikipédia (Prime Video, Apple TV, Disney+) et Wikidata (Netflix) | `lib/streaming.js` |
| Festivals et cérémonies | Fichier maintenu à la main | `data/evenements.json` |
| Fiches complétées (genre, durée, réalisation, casting, pays, titre original, synopsis, affiche) | Wikidata et Wikipédia, chaque nuit (`enrich.yml`), sans écraser JP's Box-Office. Chaque film est revu au plus une fois par semaine, et un film introuvable est retenté la nuit suivante. | `scripts/enrich.js` → `data/enrich.json`, fusionné par `lib/enrich.js` |

Pathé bloque toute lecture automatique de son site (403 anti-robots) : il n'est pas utilisé, et il ne faut pas le contourner. Ses séances passent par paris-cine.info.

## Fonctions Vercel (`api/`)

| Route | Rôle | Cache CDN |
|---|---|---|
| `/api/catalog` | Sorties, box-office, streaming, événements | 6 h (15 min si une section est vide) |
| `/api/ratings?t=&o=&y=` | Notes, « En bref », bande-annonce | 12 h |
| `/api/seances?c=ids` · `?list=cinemas` · `?c=&t=` | Séances des cinémas choisis, liste des cinémas, séances d'un film | 6 h |
| `/api/ics` | Fichier agenda (sortie, séance, ou flux de toutes les grosses sorties) | — |
| `/api/img?u=` | Relais d'affiches (JP's Box-Office, Wikipédia), pour lire leurs couleurs | 30 jours |
| `/api/account` (POST) | Compte : `signup`, `login`, `pull`, `push`, `logout` | aucun |
| `/t/<données>` → `/api/t` | Page du ticket partagé | 1 jour |

Région `cdg1`, déploiement manuel : `npx vercel --prod`.

## Secrets GitHub

`EMAIL_USER`, `EMAIL_PASSWORD` (mot de passe d'application Gmail), `EMAIL_TO` (destinataires de la newsletter, séparés par des virgules). Les alertes vont seulement à `EMAIL_USER`.

## En local

```bash
npm install
npm run test-newsletter          # écrit out/newsletter.html sans envoyer
node scripts/check.js --dry-run  # contrôle des données, sans alerte
```

`web/` est servi tel quel (pas de build). Pense à changer la version du cache dans `web/sw.js` à chaque modification de l'app.
