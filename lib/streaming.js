// Sorties en streaming : films originaux des plateformes (Prime Video, Apple TV, Disney+ d'après les
// listes de Wikipédia anglais ; Netflix d'après Wikidata, faute de liste 2026 sur Wikipédia).
// Dates de sortie mondiales (souvent identiques en France).
const UA = 'lefauteuilrouge (app perso ; github.com/justinmartin)';
const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
const LISTS = [
  { platform: 'Prime Video', page: 'List_of_Amazon_Prime_Video_original_films' },
  { platform: 'Apple TV', page: 'List_of_Apple_TV_original_films' },
  { platform: 'Disney+', page: 'List_of_Disney%2B_original_films' },
];
const WIKIDATA = [{ platform: 'Netflix', qid: 'Q907311' }];

async function get(url, accept) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, ...(accept ? { Accept: accept } : {}) } });
      if (r.ok) return r.json();
      if (r.status !== 429) return null;
    } catch (e) { /* on réessaie */ }
    await new Promise(res => setTimeout(res, 3000 * (attempt + 1)));
  }
  return null;
}

const cleanWiki = s => s
  .replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '')
  .replace(/\{\{sort\|[^|}]*\|([^}]*)\}\}/gi, '$1').replace(/\{\{[^}]*\}\}/g, '')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/''+/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const toIso = s => { const m = /(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})/.exec(s); return m ? `${m[3]}-${String(MONTHS[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };

async function fromWikipedia({ platform, page }, from, to) {
  const d = await get(`https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=wikitext&format=json&formatversion=2`);
  const text = d?.parse?.wikitext || '';
  // Seulement les tableaux de longs métrages (pas les documentaires ni les spéciaux)
  const parts = text.split(/\n===?\s*/).filter(p => /^Feature films/i.test(p));
  const out = [];
  for (const part of parts) {
    for (const row of part.split(/\n\|-/).slice(1)) {
      const cells = row.replace(/\|\|/g, '\n|').split(/\n[|!](?!\})/).slice(1).map(c => c.replace(/^\|/, '').replace(/^[^|\[{']*\|(?!\|)/, ''));
      if (cells.length < 2) continue;
      const date = cells.map(c => toIso(c.replace(/<ref[\s\S]*?<\/ref>/g, ''))).find(Boolean);
      if (!date || date < from || date > to) continue;
      const title = cleanWiki(cells[0]);
      if (!title || /^Untitled/i.test(title) || toIso(title)) continue;
      out.push({ title, platform, date, genre: (cells.slice(1).map(cleanWiki).find(c => c && !toIso(c) && !/^(English|French|Spanish|German|Italian|Japanese|Korean|Hindi|Portuguese|TBA)$/i.test(c)) || '').replace(/\b\w/, c => c.toUpperCase()).slice(0, 60), url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` });
    }
  }
  return out;
}

async function fromWikidata({ platform, qid }, from, to) {
  const q = `SELECT ?film ?fr ?en ?date WHERE { ?film wdt:P750 wd:${qid} ; wdt:P31 wd:Q11424 ; wdt:P577 ?date .
    FILTER(?date >= "${from}T00:00:00Z"^^xsd:dateTime && ?date <= "${to}T00:00:00Z"^^xsd:dateTime)
    OPTIONAL { ?film rdfs:label ?fr FILTER(lang(?fr) = "fr") } OPTIONAL { ?film rdfs:label ?en FILTER(lang(?en) = "en") } } LIMIT 60`;
  const d = await get(`https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}`, 'application/sparql-results+json');
  const seen = new Set();
  return (d?.results?.bindings || []).map(b => ({ title: b.fr?.value || b.en?.value, platform, date: b.date.value.slice(0, 10), genre: '', url: b.film.value }))
    .filter(f => f.title && !seen.has(f.title) && seen.add(f.title));
}

async function streaming(today = new Date()) {
  const from = new Date(today.getTime() - 14 * 864e5).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 120 * 864e5).toISOString().slice(0, 10);
  const lists = [];
  for (const l of LISTS) lists.push(await fromWikipedia(l, from, to).catch(() => []));
  for (const w of WIKIDATA) lists.push(await fromWikidata(w, from, to).catch(() => []));
  // Une même sortie peut avoir plusieurs dates (avant-première) : on garde la première
  const byTitle = new Map();
  lists.flat().sort((a, b) => a.date.localeCompare(b.date)).forEach(f => { const k = `${f.platform}|${f.title.toLowerCase()}`; if (!byTitle.has(k)) byTitle.set(k, f); });
  return [...byTitle.values()];
}

module.exports = { streaming };
