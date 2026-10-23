// Recherche dans tous les films (pas seulement les sorties de l'année), d'après Wikidata :
// titre français, titre original, année, réalisation, identifiant IMDb et affiche (Wikipédia).
const { get } = require('./ratings');

const val = (c, p) => c[p]?.[0]?.mainsnak?.datavalue?.value;

async function posters(lang, titles) {
  if (!titles.length) return {};
  const r = await get(`https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', titles: titles.join('|'), prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '300', pilicense: 'any', format: 'json', redirects: '1' })}`);
  const norm = Object.fromEntries((r?.query?.normalized || []).concat(r?.query?.redirects || []).map(x => [x.to, x.from]));
  const out = {};
  Object.values(r?.query?.pages || {}).forEach(p => { if (p.thumbnail?.source) out[norm[p.title] || p.title] = p.thumbnail.source; });
  return out;
}

async function findFilms(q) {
  const s = await get(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: `${q} haswbstatement:P31=Q11424`, srlimit: '12', format: 'json' })}`);
  const ids = (s?.query?.search || []).map(x => x.title);
  if (!ids.length) return [];
  const e = await get(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|claims|sitelinks', languages: 'fr|en', sitefilter: 'frwiki|enwiki', format: 'json' })}`);
  const ents = ids.map(id => [id, e?.entities?.[id]]).filter(([, x]) => x);
  const dirIds = [...new Set(ents.flatMap(([, x]) => (x.claims?.P57 || []).slice(0, 2).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean)))];
  const names = {};
  if (dirIds.length) {
    const d = await get(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: dirIds.slice(0, 50).join('|'), props: 'labels', languages: 'fr|en', format: 'json' })}`);
    Object.entries(d?.entities || {}).forEach(([k, v]) => { names[k] = v.labels?.fr?.value || v.labels?.en?.value; });
  }
  const fr = await posters('fr', ents.map(([, x]) => x.sitelinks?.frwiki?.title).filter(Boolean));
  const en = await posters('en', ents.filter(([, x]) => !fr[x.sitelinks?.frwiki?.title]).map(([, x]) => x.sitelinks?.enwiki?.title).filter(Boolean));
  return ents.map(([id, x]) => {
    const c = x.claims || {};
    const years = (c.P577 || []).map(v => +((v.mainsnak?.datavalue?.value?.time || '').slice(1, 5))).filter(Boolean);
    const title = x.labels?.fr?.value || x.labels?.en?.value;
    const original = (c.P1476 || []).map(v => v.mainsnak?.datavalue?.value?.text).find(Boolean) || x.labels?.en?.value || '';
    return {
      id: `wd-${id}`, title, original: original !== title ? original : '', year: years.length ? Math.min(...years) : null,
      director: (c.P57 || []).slice(0, 2).map(v => names[v.mainsnak?.datavalue?.value?.id]).filter(Boolean).join(', '),
      imdb: val(c, 'P345') || '', poster: fr[x.sitelinks?.frwiki?.title] || en[x.sitelinks?.enwiki?.title] || '',
    };
  }).filter(f => f.title);
}

module.exports = { findFilms };
