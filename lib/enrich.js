// Fiches complétées (data/enrich.json, produit chaque nuit par scripts/enrich.js) : lues sur GitHub pour être
// à jour sans redéployer, avec la copie déployée en secours. Ne remplit que les champs vides de JP's Box-Office.
const RAW = 'https://raw.githubusercontent.com/justinmartin/lefauteuilrouge/main/data/enrich.json';
const FIELDS = ['genre', 'duration', 'minutes', 'director', 'cast', 'country', 'original', 'synopsis', 'poster'];
let memo = null;

async function loadEnrich() {
  if (memo && Date.now() - memo.at < 3600e3) return memo.data;
  let data = null;
  try {
    const r = await fetch(RAW, { signal: AbortSignal.timeout(4000) });
    if (r.ok) data = await r.json();
  } catch (e) { /* GitHub injoignable : copie déployée */ }
  if (!data) { try { data = require('../data/enrich.json'); } catch (e) { data = {}; } }
  memo = { at: Date.now(), data };
  return data;
}

const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
function mergeFilm(f, e) {
  if (!e) return f;
  const out = { ...f };
  FIELDS.forEach(k => { if (empty(out[k]) && !empty(e[k])) out[k] = e[k]; });
  return out;
}

async function enrichCatalog(cat) {
  const data = await loadEnrich();
  return { ...cat, films: cat.films.map(f => mergeFilm(f, data[f.id])) };
}

module.exports = { enrichCatalog };
