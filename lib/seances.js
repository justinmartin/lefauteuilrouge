// Séances des cinémas parisiens via paris-cine.info (données Allociné, liens de réservation directs
// Pathé / UGC / MK2…). Petit site tenu par un particulier : peu de requêtes, une à la fois, et les
// réponses sont gardées 6 h par le CDN de Vercel. Crédité dans l'app.
const BASE = 'https://paris-cine.info/';
const UA = 'lefauteuilrouge (app perso ; github.com/justinmartin)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, as = 'json') {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(BASE + path, { headers: { 'User-Agent': UA } });
      if (r.ok) return as === 'json' ? r.json() : r.text();
    } catch (e) { /* on réessaie */ }
    await sleep(1500 * (attempt + 1));
  }
  return null;
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const CARDS = { pass: 'Carte Pathé', ugc: 'UGC Illimité', mk2: 'MK2', cip: 'CIP', librepass: 'LibrePass', cinecarte: 'Pathé CinéCarte', multicine: 'Multiciné', dulac: 'Dulac', cinecheques: 'Cinéchèques' };

// Cinémas de Paris et de la petite couronne (liste publiée dans la page d'accueil du site)
let theatersCache = null, theatersAt = 0;
async function theaters() {
  if (theatersCache && Date.now() - theatersAt < 24 * 3600e3) return theatersCache;
  const html = await get('', 'text');
  const m = html && /cineOptions\s*=\s*(\[\{"label":[\s\S]*?\])\s*;/.exec(html);
  if (!m) return theatersCache || [];
  const groups = JSON.parse(m[1]);
  theatersCache = groups.flatMap(g => (g.options || []).map(o => ({
    id: o.value, name: o.label, zip: g.value, area: g.label,
    cards: (o.cards || []).map(c => c.cardname), pathe: /^Pathé|Pathé$/.test(o.label),
  })));
  theatersAt = Date.now();
  return theatersCache;
}

const durationMin = d => { const m = /(\d+)h(\d*)/.exec(d || ''); return m ? +m[1] * 60 + (+m[2] || 0) : null; };

function cleanShowtime(s) {
  return { cinema: s.title, start: s.start, version: s.type || '', format: s.format || '', book: s.book || '', extra: !!s.extra, com: s.com || '' };
}

// Toutes les séances de la semaine dans une sélection de cinémas, regroupées par film.
// Une seule passe (3 films à la fois) : l'appli filtre ensuite le jour choisi.
async function week(cineIds) {
  const ids = cineIds.join('.');
  const list = await get(`get_movies.php?${new URLSearchParams({ cine: ids })}`);
  const movies = (list?.data || []).slice(0, 60);
  const today = new Date().toISOString().slice(0, 10);
  const films = [];
  let i = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (i < movies.length) {
      const m = movies[i++];
      const st = await get(`get_showtimes.php?${new URLSearchParams({ mov_id: m.id, mov_lang: m.la || '', cine: ids })}`);
      const showtimes = (st?.showtimes || []).filter(x => x.start?.slice(0, 10) >= today).map(cleanShowtime).sort((a, b) => a.start.localeCompare(b.start));
      if (showtimes.length) films.push({ id: m.id, title: m.ti, original: m.o_ti || '', duration: m.du || '', minutes: durationMin(m.du), year: m.ye, genre: m.ge || '', imdb: m.im_r ?? null, rt: m.rt_r ?? null, letterboxd: m.lb_r ?? null, showtimes });
      await sleep(150);
    }
  }));
  return films.sort((a, b) => b.showtimes.length - a.showtimes.length);
}

// Les prochaines séances d'un film dans une sélection de cinémas
async function film(cineIds, title, original) {
  const ids = cineIds.join('.');
  const list = await get(`get_movies.php?${new URLSearchParams({ cine: ids })}`);
  const want = [norm(title), norm(original)].filter(Boolean);
  const m = (list?.data || []).find(x => [norm(x.ti), norm(x.o_ti), norm(x.en_ti)].some(t => t && want.includes(t)));
  if (!m) return null;
  const st = await get(`get_showtimes.php?${new URLSearchParams({ mov_id: m.id, mov_lang: m.la || '', cine: ids })}`);
  return { id: m.id, title: m.ti, duration: m.du || '', minutes: durationMin(m.du), showtimes: (st?.showtimes || []).map(cleanShowtime).sort((a, b) => a.start.localeCompare(b.start)) };
}

module.exports = { theaters, week, film, CARDS };
