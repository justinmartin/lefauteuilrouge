// Contrôle quotidien des données de l'app, telles que les voient les utilisateurs (avec le cache du CDN).
// Si une source casse (JP's Box-Office, paris-cine.info, notes), un mail d'alerte part à EMAIL_USER.
//   node scripts/check.js            # contrôle + alerte si besoin
//   node scripts/check.js --dry-run  # contrôle seulement
const { alert } = require('./alert');

const APP_URL = process.env.APP_URL || 'https://lefauteuilrouge.vercel.app';
const DRY = process.argv.includes('--dry-run');

async function getJson(path) {
  const r = await fetch(APP_URL + path);
  if (!r.ok) throw new Error(`${path} : HTTP ${r.status}`);
  return r.json();
}
const rows = v => v?.rows?.length || 0;

async function main() {
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };

  let cat = null;
  try { cat = await getJson('/api/catalog'); } catch (e) { problems.push(`Catalogue indisponible (${e.message})`); }
  if (cat) {
    const today = new Date().toISOString().slice(0, 10);
    const in5w = new Date(Date.now() + 35 * 864e5).toISOString().slice(0, 10);
    const soon = cat.films.filter(f => f.date >= today && f.date <= in5w).length;
    const ageH = (Date.now() - new Date(cat.generated_at)) / 36e5;
    check(cat.films?.length >= 20, `Sorties : seulement ${cat.films?.length || 0} films dans le calendrier (JP's Box-Office a-t-il changé ?)`);
    check(soon >= 3, `Sorties : ${soon} film(s) annoncé(s) sur les 5 prochaines semaines`);
    check(rows(cat.boxoffice) >= 5, 'Box-office France vide');
    check(rows(cat.boxoffice_us) >= 5, 'Box-office US vide');
    check(rows(cat.world) >= 5, 'Box-office monde vide');
    check(ageH < 48, `Catalogue figé : généré il y a ${Math.round(ageH)} h`);
    const top = cat.boxoffice?.rows?.[0];
    if (top) {
      try {
        const r = await getJson(`/api/ratings?${new URLSearchParams({ t: top.title.replace(/\s*\(\d{4}\)$/, ''), y: (top.date || today).slice(0, 4) })}`);
        check(r.found && (r.imdb || r.rt || r.letterboxd), `Notes introuvables pour le n° 1 du box-office (« ${top.title} »)`);
      } catch (e) { problems.push(`Notes indisponibles (${e.message})`); }
    }
  }
  try {
    const c = await getJson('/api/seances?list=cinemas');
    check(c.cinemas?.length >= 20, `Séances : seulement ${c.cinemas?.length || 0} cinémas (paris-cine.info a-t-il changé ?)`);
  } catch (e) { problems.push(`Liste des cinémas indisponible (${e.message})`); }

  if (!problems.length) { console.log('✅ Données OK'); return; }
  console.log(`❌ ${problems.length} problème(s) :\n- ${problems.join('\n- ')}`);
  if (!DRY) await alert(`${problems.length} problème(s) dans les données`, `Contrôle du ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} :\n\n- ${problems.join('\n- ')}\n\nApp : ${APP_URL}`);
  process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
