# Le Fauteuil Rouge 🍿

Les sorties ciné de la semaine, le calendrier de l'année et le box-office France — en app (PWA) et en newsletter du lundi.

- **App** : https://lefauteuilrouge.vercel.app (onglets Cette semaine / Calendrier / Box-office)
- **Données** : JP's Box-Office (calendrier des sorties France, box-office hebdomadaire), lues par `api/catalog.js` et mises en cache 6 h par Vercel.
- **Newsletter** : `.github/workflows/newsletter.yml`, chaque lundi matin. Secrets GitHub : `EMAIL_USER`, `EMAIL_PASSWORD` (mot de passe d'application Gmail), `EMAIL_TO` (adresses séparées par des virgules).

```bash
npm install
npm run test-newsletter   # écrit out/newsletter.html sans envoyer
```
