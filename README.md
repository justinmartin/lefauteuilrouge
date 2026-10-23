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

Ta liste, tes tickets et tes cinémas sont gardés **sur le téléphone** (localStorage), sans compte.

## La newsletter

`scripts/newsletter.js` envoie :

- la sortie phare (notes, « En bref », bande-annonce) et les autres sorties de la semaine ;
- les 3 semaines suivantes ;
- le box-office France, US et monde ;
- les sorties streaming, les festivals et cérémonies ;
- la **séance de rattrapage** : 3 classiques par semaine sans répétition (`data/classiques.json`, rotation dans `lib/reco.js`).

GitHub lance les tâches planifiées du matin avec des heures de retard. Le workflow (`.github/workflows/newsletter.yml`) démarre donc le **dimanche soir**, attend sur place (5 h 40 au plus par run), puis **se relance lui-même** jusqu'au lundi 7 h 40 à Paris avant d'envoyer. Les déclenchements du lundi matin servent de filet, et une marque « déjà envoyée » évite les doublons. Le bouton « Run workflow » (case « relais » décochée) envoie tout de suite.

## Quand une source casse

Les données viennent de pages publiques (JP's Box-Office, paris-cine.info) qui peuvent changer de format. Trois filets :

1. **Contrôle chaque soir** (`.github/workflows/check.yml`, `scripts/check.js`). Il vérifie ce que voit l'app : sorties à venir, box-office France / US / monde, fraîcheur du catalogue, notes du n° 1, liste des cinémas. Si quelque chose manque, un **mail d'alerte** part à `EMAIL_USER`.
2. **Côté serveur** : si une section du catalogue revient vide, `api/catalog.js` ne la met en cache que 15 min au lieu de 6 h, pour réessayer vite.
3. **Côté app** : une section vide est remplacée par celle gardée sur le téléphone lors du chargement précédent.

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

Pathé bloque toute lecture automatique de son site (403 anti-robots) : il n'est pas utilisé, et il ne faut pas le contourner. Ses séances passent par paris-cine.info.

## Fonctions Vercel (`api/`)

| Route | Rôle | Cache CDN |
|---|---|---|
| `/api/catalog` | Sorties, box-office, streaming, événements | 6 h (15 min si une section est vide) |
| `/api/ratings?t=&o=&y=` | Notes, « En bref », bande-annonce | 12 h |
| `/api/seances?c=ids` · `?list=cinemas` · `?c=&t=` | Séances des cinémas choisis, liste des cinémas, séances d'un film | 6 h |
| `/api/ics` | Fichier agenda (sortie, séance, ou flux de toutes les grosses sorties) | — |
| `/api/img?u=` | Relais d'affiches (JP's Box-Office, Wikipédia), pour lire leurs couleurs | 30 jours |

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
