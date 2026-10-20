// « La séance de rattrapage » : 3 films à voir, piochés dans IMDb Top 250, les 100 du XXIe siècle
// du New York Times et les classiques Rotten Tomatoes (data/classiques.json).
// Sans répétition, comme le bot Spotify : la liste est mélangée une fois par cycle (graine fixe)
// et chaque semaine prend les 3 suivants, jusqu'à en avoir fait le tour. Rien à mémoriser ailleurs.
const { films, sources } = require('../data/classiques.json');

const EPOCH = Date.UTC(2026, 9, 19); // lundi de la première newsletter
const UA = 'lefauteuilrouge (newsletter perso ; github.com/justinmartin)';

// Mélange déterministe (mulberry32) : même graine → même ordre
function shuffled(items, seed) {
  let h = 1779033703 ^ seed.length;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
  let a = h >>> 0;
  const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

function pick(date = new Date(), n = 3) {
  const weeks = Math.max(0, Math.floor((date.getTime() - EPOCH) / (7 * 864e5)));
  const perCycle = Math.max(1, Math.floor(films.length / n));
  const cycle = Math.floor(weeks / perCycle), slot = weeks % perCycle;
  return shuffled(films, `classiques-${cycle}`).slice(slot * n, slot * n + n);
}

// Wikipédia limite le débit : une requête à la fois, et on patiente si on se fait freiner (429)
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function json(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.status === 429) { await sleep((+r.headers.get('retry-after') || 5 * (attempt + 1)) * 1000); continue; }
      return r.ok ? r.json() : null;
    } catch (e) { await sleep(2000); }
  }
  return null;
}

// Affiche (Wikipédia anglais) + résumé en français (Wikipédia français)
async function enrich(f) {
  const q = new URLSearchParams({ action: 'query', titles: f.wiki.replace(/_/g, ' '), prop: 'pageimages|langlinks', piprop: 'thumbnail', pithumbsize: '400', pilicense: 'any', lllang: 'fr', redirects: '1', format: 'json' });
  const page = Object.values((await json(`https://en.wikipedia.org/w/api.php?${q}`))?.query?.pages || {})[0] || {};
  const frTitle = page.langlinks?.[0]?.['*'];
  const fr = frTitle ? await json(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(frTitle.replace(/ /g, '_'))}`) : null;
  let synopsis = (fr?.extract || '').replace(/\s+/g, ' ').trim();
  if (synopsis.length > 320) synopsis = synopsis.slice(0, 317).replace(/\s\S*$/, '') + '…';
  return {
    ...f, poster: (page.thumbnail?.source || '').split('?')[0], synopsis,
    link: frTitle ? `https://fr.wikipedia.org/wiki/${encodeURIComponent(frTitle.replace(/ /g, '_'))}` : `https://en.wikipedia.org/wiki/${f.wiki}`,
    sourceLabels: f.sources.map(s => sources[s]),
  };
}

async function weeklyPicks(date = new Date()) {
  const out = [];
  for (const f of pick(date)) { out.push(await enrich(f)); await sleep(1000); }
  return out;
}

module.exports = { pick, weeklyPicks };
