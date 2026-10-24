// Complète les fiches que JP's Box-Office laisse vides (genre, durée, réalisation, casting, pays, titre original,
// synopsis, affiche), en croisant Wikidata et Wikipédia. Écrit data/enrich.json, que /api/catalog fusionne
// (sans jamais écraser une donnée de JP's Box-Office). Lancé chaque nuit par .github/workflows/enrich.yml.
//   node scripts/enrich.js            # films sans fiche ou fiche de plus de 7 jours
//   node scripts/enrich.js --all      # tout refaire
const fs = require('fs');
const path = require('path');
const { wikidata, about, get } = require('../lib/ratings');
const { filmPage } = require('../lib/jpbox');
const { showingNotes } = require('../lib/seances');

const APP_URL = process.env.APP_URL || 'https://lefauteuilrouge.vercel.app';
const FILE = path.join(__dirname, '..', 'data', 'enrich.json');
const ALL = process.argv.includes('--all');
const WEEK = 7 * 864e5;
const FIELDS = ['genre', 'duration', 'director', 'cast', 'country', 'original', 'synopsis', 'poster'];

// « film d'horreur » → « Horreur », « film dramatique » → « Drame »…
const GENRES = { 'film dramatique': 'Drame', 'drame': 'Drame', 'film biographique': 'Biopic', 'film de super-héros': 'Super-héros', 'film documentaire': 'Documentaire', 'comédie dramatique': 'Comédie dramatique', 'comédie romantique': 'Comédie romantique', 'film d\'animation': 'Animation', 'film musical': 'Comédie musicale', 'film de guerre': 'Guerre', 'film policier': 'Policier', 'film historique': 'Historique', 'film d\'aventure': 'Aventure', 'film fantastique': 'Fantastique', 'film d\'horreur': 'Horreur', 'film d\'action': 'Action', 'film de science-fiction': 'Science-fiction', 'thriller': 'Thriller', 'comédie': 'Comédie', 'film familial': 'Famille' };
const genreName = l => GENRES[l] || (l.replace(/^film (d'|de |du |des )?/i, '').replace(/^./, c => c.toUpperCase()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ids = (c, p, n = 9) => (c[p] || []).map(x => x.mainsnak?.datavalue?.value?.id).filter(Boolean).slice(0, n);

async function labels(qids) {
  const out = {};
  for (let i = 0; i < qids.length; i += 50) {
    const r = await get(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: qids.slice(i, i + 50).join('|'), props: 'labels', languages: 'fr|en', format: 'json' })}`);
    Object.entries(r?.entities || {}).forEach(([q, e]) => { out[q] = e.labels?.fr?.value || e.labels?.en?.value; });
  }
  return out;
}

async function poster(wd) {
  for (const [lang, page] of [['fr', wd.frwiki], ['en', wd.enwiki]]) {
    if (!page) continue;
    const r = await get(`https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', titles: page, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '500', pilicense: 'any', format: 'json' })}`);
    const src = Object.values(r?.query?.pages || {})[0]?.thumbnail?.source;
    if (src) return src;
  }
  return null;
}

async function enrichFilm(f) {
  const wd = await wikidata(f.title, f.original, +(f.date || '').slice(0, 4) || null);
  if (!wd) return { found: false };
  const c = wd.claims || {};
  const g = ids(c, 'P136', 3), d = ids(c, 'P57', 2), cast = ids(c, 'P161', 4), country = ids(c, 'P495', 2);
  const names = await labels([...g, ...d, ...cast, ...country]);
  const dur = c.P2047?.[0]?.mainsnak?.datavalue?.value;
  let minutes = dur ? Math.round(+dur.amount * (/Q25235$/.test(dur.unit) ? 60 : 1)) : null; // Q25235 = heure
  if (minutes && (minutes < 40 || minutes > 400)) minutes = null;
  const orig = (c.P1476 || []).map(x => x.mainsnak?.datavalue?.value?.text).find(Boolean);
  const summary = await about(wd);
  return {
    found: true,
    genre: g.map(q => names[q]).filter(Boolean).map(genreName)[0] || null,
    duration: minutes ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}` : null,
    minutes,
    director: d.map(q => names[q]).filter(Boolean).join(', ') || null,
    cast: cast.map(q => names[q]).filter(Boolean),
    country: country.map(q => names[q]).filter(Boolean).join(', ') || null,
    original: orig && orig.toLowerCase() !== f.title.toLowerCase() ? orig : null,
    synopsis: summary?.text || null,
    poster: f.poster ? null : await poster(wd),
  };
}

async function main() {
  const cat = await (await fetch(`${APP_URL}/api/catalog`)).json();
  const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  const films = cat.films.filter(f => FIELDS.some(k => !f[k] || (Array.isArray(f[k]) && !f[k].length)));
  const todo = films.filter(f => ALL || !old[f.id] || Date.now() - old[f.id].at > WEEK);
  console.log(`${cat.films.length} films, ${films.length} incomplets, ${todo.length} à compléter`);
  const out = {};
  // On ne garde que les films encore au catalogue
  cat.films.forEach(f => { if (old[f.id]) out[f.id] = old[f.id]; });
  for (const f of todo) {
    try {
      const e = await enrichFilm(f);
      // Introuvable (ou Wikidata qui nous limite) : rien d'enregistré, on retentera au prochain passage
      if (e.found) out[f.id] = { ...Object.fromEntries(Object.entries(e).filter(([k, v]) => k !== 'found' && v != null && !(Array.isArray(v) && !v.length))), at: Date.now() };
      console.log(`${e.found ? '✓' : '·'} ${f.title}${e.found ? ` : ${FIELDS.filter(k => e[k] && !(Array.isArray(e[k]) && !e[k].length)).join(', ')}` : ' (introuvable sur Wikidata)'}`);
    } catch (err) { console.log(`✗ ${f.title} : ${err.message}`); }
    await sleep(1500); // Wikidata et Wikipédia limitent le nombre de requêtes : on y va doucement
  }
  // Fiche du film sur JP's Box-Office : résumé complet (celui des listes est coupé), réalisation, titre original,
  // pays et genre, connus même avant la sortie. Revue au plus une fois par semaine.
  const jpTodo = cat.films.filter(f => (ALL || !out[f.id]?.jpAt || Date.now() - out[f.id].jpAt > WEEK)
    && (!f.synopsis || /…$/.test(f.synopsis) || !f.director || !f.genre || !f.country || !f.original));
  console.log(`${jpTodo.length} fiches à compléter sur JP's Box-Office`);
  for (const f of jpTodo) {
    const p = await filmPage(f.id).catch(() => null);
    if (p) {
      const e = { ...(out[f.id] || { at: Date.now() }), jpAt: Date.now() };
      if (p.synopsis) e.synopsisFull = p.synopsis;
      ['director', 'genre', 'country', 'original'].forEach(k => { if (p[k] && !e[k]) e[k] = p[k]; });
      out[f.id] = e;
      console.log(`✓ JP : ${f.title}`);
    }
    await sleep(800);
  }
  // Films à l'affiche à Paris : réalisation, durée et casting d'après paris-cine.info (une seule requête)
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const showing = await showingNotes().catch(() => []);
  let pc = 0;
  for (const f of cat.films) {
    const e = out[f.id] || {};
    if ((f.director || e.director) && (f.duration || e.duration) && (f.cast?.length || e.cast?.length)) continue;
    const want = [norm(f.title), norm(f.original)].filter(Boolean);
    const m = showing.find(x => [norm(x.ti), norm(x.o_ti)].some(t => t && want.includes(t)));
    if (!m) continue;
    const add = {};
    if (!f.director && !e.director && m.di) add.director = m.di;
    if (!f.duration && !e.duration && /\dh/.test(m.du || '')) add.duration = m.du;
    if (!f.cast?.length && !e.cast?.length && m.ac) add.cast = m.ac.split(',').map(x => x.trim()).filter(Boolean).slice(0, 4);
    if (Object.keys(add).length) { out[f.id] = { ...(out[f.id] || { at: Date.now() }), ...add }; pc++; }
  }
  console.log(`${pc} fiches complétées par paris-cine.info`);
  fs.writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`data/enrich.json : ${Object.keys(out).length} fiches`);
}

main().catch(e => { console.error(e); process.exit(1); });
