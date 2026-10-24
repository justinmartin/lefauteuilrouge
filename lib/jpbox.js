// Données ciné France depuis JP's Box-Office (jpbox-office.com) :
// - calendrier des sorties (vue mensuelle : affiche + nombre de salles prévu ; vue semaine : fiche complète)
// - box-office hebdomadaire France (top de la semaine : entrées, évolution, salles, cumul).
// Client poli : identifiant explicite, 3 requêtes en parallèle au plus, résultats mis en cache par Vercel.
const BASE = 'https://www.jpbox-office.com/';
const UA = 'lefauteuilrouge (newsletter perso ; github.com/justinmartin)';

async function get(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR' } });
      if (r.ok) return await r.text();
      if (r.status === 404) return '';
    } catch (e) { /* réseau : on réessaie */ }
    await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
  }
  return '';
}

// N tâches à la fois
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', icirc: 'î', ucirc: 'û', ugrave: 'ù', iuml: 'ï', euml: 'ë', rsquo: '’', lsquo: '‘', hellip: '…', oelig: 'œ', Eacute: 'É' };
const decode = s => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
const text = s => decode(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const abs = src => !src || /nophoto/.test(src) ? '' : src.startsWith('http') ? src : BASE + src.replace(/^\//, '');
const num = s => { const n = parseInt(String(s || '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const iso = d => d.toISOString().slice(0, 10);
const frDate = s => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// ── Calendrier : un mois ────────────────────────────────────
// [{ date, id, title, poster, screens }]
async function month(dateIso) {
  const html = await get(`v9_avenir.php?date=${dateIso}&view=2`);
  const films = [];
  for (const table of html.split('<table class="tablesmall tablesmall3">').slice(1)) {
    const date = frDate((/class="celluletitre">([^<]*)/.exec(table) || [])[1]);
    if (!date) continue;
    for (const row of table.split('<tr>').slice(1)) {
      // Le titre peut tenir sur deux lignes : « Dune : Troisième partie<br/>Dune: Part Three » (français, puis original)
      const link = /fichfilm\.php\?id=(\d+)[^"]*">([\s\S]*?)<\/a>/.exec(row);
      if (!link) continue;
      const [fr, orig] = link[2].split(/<br\s*\/?>/i).map(x => decode(x.replace(/<[^>]+>/g, '')).trim());
      if (!fr) continue;
      const screens = /Nb Salles\s*:\s*([^<]*)/.exec(row);
      films.push({
        date, id: link[1], title: fr, ...(orig && orig !== fr ? { original: orig } : {}),
        poster: abs((/<img src="([^"]+)"/.exec(row) || [])[1]),
        screens: screens ? num(screens[1]) : null,
      });
    }
  }
  return films;
}

// ── Calendrier : détail d'une semaine ───────────────────────
// { id: { original, genre, country, duration, cast: [], director, synopsis } }
async function weekDetails(dateIso) {
  const html = await get(`v9_avenir.php?fixe=1&date=${dateIso}`);
  const out = {};
  for (const block of html.split('<table class="tablesmall tablesmall3">').slice(1)) {
    const end = block.indexOf('</table>');
    const b = end > 0 ? block.slice(0, end) : block;
    const id = (/fichfilm\.php\?id=(\d+)/.exec(b) || [])[1];
    if (!id) continue;
    const titleCell = (/class="celluletitre">([\s\S]*?)<\/td>/.exec(b) || [])[1] || '';
    const titleLines = text(titleCell).split('\n').map(s => s.trim()).filter(Boolean);
    const cells = [...b.matchAll(/class="col_poster_titre">([\s\S]*?)<\/td>/g)].map(m => m[1]);
    const [kind = '', duration = ''] = text(cells[0] || '').split('\n');
    const [genre, country] = kind.split(/\s+-\s+/);
    const people = cells.slice(1).map(text).join('\n');
    const cast = (/Avec\s*\n?([\s\S]*?)(?:Réalisation|$)/.exec(people) || [])[1];
    const director = (/Réalisation\s*\n?([\s\S]*)$/.exec(people) || [])[1];
    const link = /fichfilm\.php\?id=\d+[^"]*">([^<]+)<\/a>/.exec(b);
    out[id] = {
      id, date: dateIso, title: link ? decode(link[1]).trim() : (titleLines[0] || ''), poster: abs((/<img src="([^"]+)"/.exec(b) || [])[1]),
      original: titleLines.length > 1 ? titleLines.slice(1).join(' ') : '',
      genre: (genre || '').trim(), country: (country || '').trim(), duration: /\dh/.test(duration) ? duration.trim() : '',
      cast: cast ? cast.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4) : [],
      director: director ? director.split('\n').map(s => s.trim()).filter(Boolean).join(', ') : '',
      synopsis: text((/class="col_poster_contenu_mineur">([\s\S]*?)<\/td>/.exec(b) || [])[1]).replace(/[\s.…]*(\.\.\.|…)\s*$/, '…'),
    };
  }
  return out;
}

// ── Box-office hebdomadaire ─────────────────────────────────
async function latestWeekId() {
  // Le mercredi, la nouvelle semaine n'a pas encore de classement : on remonte d'une semaine si besoin
  for (const back of [0, 7]) {
    const d = new Date(); d.setDate(d.getDate() - back);
    const html = await get(`v9_avenir.php?fixe=1&date=${iso(d)}`);
    const id = num((/tophebdo\.php\?idsem=(\d+)/.exec(html) || [])[1]);
    if (id) return id;
  }
  return null;
}

// { id, label, days, rows: [{ rank, isNew, move, id, title, distributor, info, poster, weeks, entries, change, screens, perScreen, total }] }
// view : 2 = France (entrées), 1 = États-Unis (recettes du week-end, en $)
async function boxOffice(idsem, view = 2) {
  const html = await get(`v9_tophebdo.php?idsem=${idsem}&view=${view}`);
  const head = text((/((?:Semaine|Week-?end) \d+ - DU[^<(]*)/i.exec(html) || [])[1] || '').replace(/\s+/g, ' ');
  const days = num((/\((\d) Jours?\)/i.exec(html) || [])[1]);
  const rows = [];
  for (const tr of html.split(/<tr[^>]*>/).slice(1)) {
    if (!tr.includes('class="compteur"')) continue;
    const cells = [...tr.matchAll(/<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)].map(m => ({ cls: m[1], html: m[2] }));
    const counter = cells.find(c => c.cls.startsWith('col_poster_compteur'));
    const titleCell = cells.find(c => c.cls.startsWith('col_poster_titre'));
    const vals = cells.filter(c => c.cls.startsWith('col_poster_contenu_majeur')).map(c => text(c.html));
    const rank = num((/class="compteur">\s*(\d+)/.exec(counter?.html || '') || [])[1]);
    if (!rank || !titleCell || rows.some(r => r.rank === rank)) continue;
    const counterText = text(counter.html);
    const link = /fichfilm\.php\?id=(\d+)[^"]*"[^>]*>([^<]+)</.exec(titleCell.html);
    const h3 = text((/<h3>([\s\S]*?)<\/h3>/.exec(titleCell.html) || [])[1] || '');
    const after = text(titleCell.html.split('</h3>')[1] || '');
    const meta = /\(([^)]*)\)\s*(.*)/s.exec(after) || /\(([^)]*)\)\s*(.*)/s.exec(text(titleCell.html));
    const [weeks, entries, change, screens, perScreen, total] = vals;
    rows.push({
      rank, isNew: /\bN\b/.test(counterText), move: num((/[+-]\d+/.exec(counterText) || [])[0]) ? +(/[+-]\d+/.exec(counterText)[0]) : null,
      id: link ? link[1] : null, title: link ? decode(link[2]).trim() : h3.split('\n')[0],
      distributor: meta ? meta[1].trim() : '', info: meta ? meta[2].replace(/\s+/g, ' ').trim() : '',
      poster: abs((/<img src="([^"]+)"/.exec(tr) || [])[1]),
      weeks: num(weeks), entries: num(entries), change: change || null,
      screens: num((screens || '').split('(')[0]), perScreen: num(perScreen), total: num(total),
    });
  }
  rows.sort((a, b) => a.rank - b.rank);
  return { id: idsem, label: head, days, rows, unit: view === 1 ? 'usd' : 'entries' };
}

// ── Box-office mondial cumulé de l'année (recettes monde / US / international) ──
async function worldYear(year = new Date().getFullYear()) {
  const html = await get(`v9_charts_total.php?view=6&filtre=production&infla=0&variable=${year}`);
  const rows = [];
  for (const tr of html.split(/<tr[^>]*>/).slice(1)) {
    if (!tr.includes('fichfilm')) continue;
    const cells = [...tr.matchAll(/<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)].map(m => ({ cls: m[1], html: m[2] }));
    const rank = num(text(cells.find(c => c.cls.startsWith('col_poster_compteur'))?.html || ''));
    const link = /fichfilm\.php\?id=(\d+)[^"]*"[^>]*>([^<]+)</.exec(tr);
    const money = cells.filter(c => c.cls.startsWith('col_poster_contenu')).map(c => text(c.html)).filter(v => /\$/.test(v)).map(num);
    if (!rank || !link) continue;
    rows.push({ rank, id: link[1], title: decode(link[2]).trim(), poster: abs((/<img src="([^"]+)"/.exec(tr) || [])[1]), world: money[0] ?? null, us: money[1] ?? null, intl: money[2] ?? null });
    if (rows.length >= 20) break;
  }
  return { year, rows };
}

// ── Catalogue complet pour l'app et la newsletter ───────────
const wednesday = d => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + ((3 - x.getUTCDay() + 7) % 7)); return x; };

async function catalog({ monthsAhead = 12, detailWeeks = 5 } = {}) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const months = Array.from({ length: monthsAhead + 2 }, (_, i) => iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1))));
  const thisWed = wednesday(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)));
  const weeks = Array.from({ length: detailWeeks }, (_, i) => iso(new Date(thisWed.getTime() + i * 7 * 864e5)));

  const idsem = await latestWeekId();
  const [monthLists, details, bo, boPrev, boUs, world] = await Promise.all([
    pool(months, 3, month),
    pool(weeks, 2, weekDetails),
    idsem ? boxOffice(idsem) : null,
    idsem ? boxOffice(idsem - 1) : null,
    idsem ? boxOffice(idsem, 1) : null,
    worldYear(now.getUTCFullYear()),
  ]);
  const detail = Object.assign({}, ...details);
  const seen = new Set();
  // La vue mensuelle n'a pas toujours tous les films de la semaine : on complète avec la vue semaine
  const listed = monthLists.flat();
  Object.values(detail).forEach(d => { if (d.title && !listed.some(f => f.id === d.id)) listed.push({ date: d.date, id: d.id, title: d.title, poster: d.poster, screens: null }); });
  const films = listed.filter(f => !seen.has(f.id) && seen.add(f.id))
    .map(f => { const d = detail[f.id] || {}; return { ...f, ...d, date: f.date, title: f.title || d.title, poster: f.poster || d.poster }; })
    .sort((a, b) => a.date.localeCompare(b.date) || (b.screens || 0) - (a.screens || 0));
  // La semaine en cours du box-office peut être partielle (chiffres du mardi) : on garde aussi la précédente
  return { generated_at: new Date().toISOString(), source: 'JP\'s Box-Office (jpbox-office.com)', films, boxoffice: bo, boxoffice_prev: boPrev, boxoffice_us: boUs, world };
}

// ── Fiche d'un film : résumé complet (celui des listes est coupé), réalisation, titre original, pays, genre ──
async function filmPage(id) {
  const html = await get(`fichfilm.php?id=${encodeURIComponent(id)}`);
  if (!html) return null;
  const head = (/<td class="texte_2022titre"[\s\S]*?<\/td>/.exec(html) || [''])[0];
  const syn = /<p>\s*SYNOPSIS\s*<\/p>([\s\S]*?)<\/div>/i.exec(html);
  const links = re => [...head.matchAll(re)].map(m => text(m[1])).filter(Boolean);
  return {
    synopsis: syn ? text(syn[1]) || null : null,
    original: text((/<h2>([\s\S]*?)<\/h2>/.exec(head) || [])[1]) || null,
    director: links(/fichacteur\.php\?id=\d+[^"]*">([\s\S]*?)<\/a>/g).slice(0, 2).join(', ') || null,
    country: links(/fichepays\.php\?idpays=\d+">([\s\S]*?)<\/a>/g).slice(0, 2).join(', ') || null,
    genre: links(/fichgenres\.php\?idgenre=\d+">([\s\S]*?)<\/a>/g)[0] || null,
  };
}
const fullSynopsis = async id => (await filmPage(id))?.synopsis || null;

module.exports = { catalog, month, weekDetails, boxOffice, latestWeekId, worldYear, fullSynopsis, filmPage };
