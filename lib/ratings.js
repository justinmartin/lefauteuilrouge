// Notes d'un film : IMDb (jeu de données officiel title.ratings, usage personnel), Rotten Tomatoes
// (Tomatometer) et Letterboxd. Le pont entre le titre français et ces sites, c'est Wikidata
// (identifiants IMDb P345, Rotten Tomatoes P1258, Letterboxd P6127).
const zlib = require('zlib');
const UA = 'lefauteuilrouge (newsletter perso ; github.com/justinmartin)';

async function get(url, as = 'json') {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en' } });
      if (r.status === 429) { await new Promise(res => setTimeout(res, 3000 * (attempt + 1))); continue; }
      if (!r.ok) return null;
      return as === 'json' ? r.json() : as === 'buffer' ? Buffer.from(await r.arrayBuffer()) : r.text();
    } catch (e) { await new Promise(res => setTimeout(res, 1000)); }
  }
  return null;
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ── Wikidata : retrouver le film et ses identifiants ────────
async function wikidata(title, original, year) {
  const ids = new Set();
  const queries = [title, original].filter(Boolean).map(q => q.replace(/\s*\(\d{4}\)\s*$/, ''));
  if (year) queries.push(...queries.map(q => `${q} ${year}`));  // homonymes (remakes) : l'année aide
  for (const clean of [...new Set(queries)]) {
    const r = await get(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: `${clean} haswbstatement:P31=Q11424`, srlimit: '6', format: 'json' })}`);
    (r?.query?.search || []).forEach(x => ids.add(x.title));
  }
  if (!ids.size) return null;
  const r = await get(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: [...ids].slice(0, 40).join('|'), props: 'labels|claims', languages: 'fr|en', format: 'json' })}`);
  const want = [norm(title), norm(original)].filter(Boolean);
  let best = null;
  for (const [qid, e] of Object.entries(r?.entities || {})) {
    const c = e.claims || {};
    const val = p => c[p]?.[0]?.mainsnak?.datavalue?.value;
    const years = (c.P577 || []).map(x => +((x.mainsnak?.datavalue?.value?.time || '').slice(1, 5))).filter(Boolean);
    const labels = Object.values(e.labels || {}).map(l => norm(l.value));
    // année : +3 si elle colle, neutre si inconnue, éliminatoire si elle ne colle pas
    const yearScore = !year || !years.length ? 0 : years.some(y => Math.abs(y - year) <= 1) ? 3 : -6;
    const nameOk = labels.some(l => want.includes(l));
    const score = (nameOk ? 2 : 0) + yearScore + (val('P345') ? 1 : 0);
    if (score >= 3 && (!best || score > best.score)) best = { score, qid, imdb: val('P345'), rt: val('P1258'), lb: val('P6127') };
  }
  return best;
}

// ── IMDb : jeu de données officiel (≈ 9 Mo), gardé en mémoire tant que la fonction est chaude ──
let imdbText = null, imdbAt = 0;
async function imdbRating(tt) {
  if (!tt) return null;
  if (!imdbText || Date.now() - imdbAt > 12 * 3600e3) {
    const gz = await get('https://datasets.imdbws.com/title.ratings.tsv.gz', 'buffer');
    if (gz) { imdbText = zlib.gunzipSync(gz).toString('utf8'); imdbAt = Date.now(); }
  }
  if (!imdbText) return null;
  const i = imdbText.indexOf(`\n${tt}\t`);
  if (i < 0) return null;
  const [, rating, votes] = imdbText.slice(i + 1, imdbText.indexOf('\n', i + 1)).split('\t');
  return { rating: +rating, votes: +votes, url: `https://www.imdb.com/title/${tt}/` };
}

async function rottenTomatoes(path) {
  if (!path) return null;
  const html = await get(`https://www.rottentomatoes.com/${path}`, 'text');
  const critics = html && /"criticsScore":\{[^}]*?"score":"?(\d+)/.exec(html);
  const audience = html && /"audienceScore":\{[^}]*?"score":"?(\d+)/.exec(html);
  if (!critics && !audience) return null;
  return { critics: critics ? +critics[1] : null, audience: audience ? +audience[1] : null, url: `https://www.rottentomatoes.com/${path}` };
}

async function letterboxd(slug) {
  if (!slug) return null;
  const html = await get(`https://letterboxd.com/film/${slug}/`, 'text');
  const m = html && /twitter:data2" content="([\d.]+) out of 5"/.exec(html);
  return m ? { rating: +m[1], url: `https://letterboxd.com/film/${slug}/` } : { rating: null, url: `https://letterboxd.com/film/${slug}/` };
}

async function ratings({ title, original, year }) {
  const wd = await wikidata(title, original, year);
  if (!wd) return { found: false };
  const [imdb, rt, lb] = await Promise.all([imdbRating(wd.imdb), rottenTomatoes(wd.rt), letterboxd(wd.lb)]);
  return { found: true, wikidata: wd.qid, imdb, rt, letterboxd: lb };
}

module.exports = { ratings };
