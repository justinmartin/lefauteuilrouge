// Le Fauteuil Rouge — app.
// Données : /api/catalog (sorties France sur l'année, box-office France / US / monde, d'après JP's Box-Office)
// et /api/ratings (IMDb, Rotten Tomatoes, Letterboxd), gardées sur le téléphone pour l'ouverture instantanée.
const KEYS = { catalog: 'lfr_catalog', tab: 'lfr_tab', list: 'lfr_list', ratings: 'lfr_ratings', view: 'lfr_calview', filter: 'lfr_filter', cines: 'lfr_cines', cinemas: 'lfr_cinemas' };
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const SHORT_DAYS = ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const BIG_SCREENS = 250; // au-delà : « grosse sortie »

let cat = null;
let tab = 'week';
let calView = 'month';   // month | weeks | list
let filter = 'big';      // big | all | mine | genre:<nom>
let selDay = null;
let monthOffset = 0;
let boView = 'fr';       // fr | fr-prev | us | world
let myList = {};         // { id: { title, date, poster } }
let ratingsCache = {};
let myCines = null;      // identifiants paris-cine.info des cinémas choisis
let cinemas = [];        // tous les cinémas de Paris et petite couronne
let seanceDate = null;
let seanceFilter = 'all'; // all | vo | vf | soir
let pickCard = 'pass';    // filtre du choix des cinémas : pass | ugc | all
const seancesCache = {};
let shownSeances = [];   // séances affichées (pour la feuille Réserver / Agenda)

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); };
const dayLabel = s => { const d = parseDay(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = n => n == null ? '–' : n.toLocaleString('fr-FR');
const short = n => n == null ? '–' : n >= 1e9 ? `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Md` : n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n);
const cleanTitle = t => String(t || '').replace(/\s*\(\d{4}\)\s*$/, '');
const today = () => isoDay(new Date());

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// Semaine ciné : du mercredi au mardi. Lundi et mardi, on regarde déjà le mercredi qui vient.
function featuredWednesday() {
  const d = new Date(), wd = d.getDay();
  if (wd === 1 || wd === 2) d.setDate(d.getDate() + (3 - wd));
  else d.setDate(d.getDate() - ((wd - 3 + 7) % 7));
  return isoDay(d);
}

const filmsOn = date => cat.films.filter(f => f.date === date).sort((a, b) => (b.screens || 0) - (a.screens || 0));
function isBig(f, list) {
  if (f.screens != null) return f.screens >= BIG_SCREENS;
  return !list.some(x => x.screens != null) && list.indexOf(f) < 3;
}
const findFilm = id => cat.films.find(f => f.id === id)
  || [...(cat.boxoffice?.rows || []), ...(cat.boxoffice_prev?.rows || []), ...(cat.boxoffice_us?.rows || []), ...(cat.world?.rows || [])].find(f => f.id === id);

// ---------------------------------------------------------------- notes (IMDb, RT, Letterboxd)
const yearOf = f => +(f.date || '').slice(0, 4) || new Date().getFullYear();
async function getRatings(f) {
  const key = f.id;
  const hit = ratingsCache[key];
  if (hit && Date.now() - hit.at < 24 * 3600e3) return hit.data;
  try {
    const r = await fetch(`/api/ratings?${new URLSearchParams({ t: cleanTitle(f.title), o: f.original || '', y: yearOf(f) })}`);
    const data = r.ok ? await r.json() : null;
    if (data) { ratingsCache[key] = { at: Date.now(), data }; write(KEYS.ratings, ratingsCache); }
    return data;
  } catch (e) { return null; }
}
function notesLine(r) {
  if (!r || !r.found) return '<span class="na">Pas encore de notes</span>';
  const parts = [];
  if (r.imdb?.rating) parts.push(`IMDb <b>${r.imdb.rating.toLocaleString('fr-FR')}</b>`);
  if (r.rt?.critics != null) parts.push(`RT <b>${r.rt.critics} %</b>`);
  if (r.letterboxd?.rating) parts.push(`Letterboxd <b>${r.letterboxd.rating.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</b>`);
  return parts.join(' · ') || '<span class="na">Pas encore de notes</span>';
}
function fillNotes(f, el) {
  getRatings(f).then(r => { if (el.isConnected) el.innerHTML = notesLine(r); });
}

// ---------------------------------------------------------------- composants
const poster = (f, cls = 'poster') => f.poster ? `<img class="${cls}" src="${esc(f.poster)}" alt="" loading="lazy">` : `<div class="${cls} ph">${esc((f.title || '?')[0])}</div>`;
const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>';
const TICKET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.5a2.5 2.5 0 0 0 0-5z"/></svg>';
const meta = f => [f.genre, f.duration, f.screens ? `${fmt(f.screens)} salles` : ''].filter(Boolean).join(' · ');
const showtimesUrl = f => `https://www.google.com/search?q=${encodeURIComponent(`séances ${cleanTitle(f.title)}`)}`;

function hero(f, label) {
  return `<article class="hero">
    <button type="button" data-film="${esc(f.id)}" aria-label="${esc(f.title)}">${poster(f)}</button>
    <div class="hero-body">
      <span class="eyebrow">${esc(label)}</span>
      <h2>${esc(cleanTitle(f.title))}</h2>
      <span class="meta">${esc(meta(f))}</span>
      <span class="notes" data-notes="${esc(f.id)}"><span class="na">Notes…</span></span>
      <div class="hero-actions">
        <a class="pill-btn red" href="${showtimesUrl(f)}" target="_blank" rel="noopener">${TICKET_ICON}Séances</a>
        <button class="pill-btn" type="button" data-cal="${esc(f.id)}">${CAL_ICON}Agenda</button>
      </div>
    </div>
  </article>`;
}

function ticket(f, list) {
  const big = isBig(f, list);
  return `<button class="ticket" type="button" data-film="${esc(f.id)}">
    ${poster(f)}
    <div class="t-body"><div class="t-title">${esc(cleanTitle(f.title))}</div><div class="t-meta">${esc([f.genre, f.director || f.cast?.[0], f.duration].filter(Boolean).join(' · '))}</div></div>
    <div class="stub${big ? ' big' : ''}">${f.screens ? `${fmt(f.screens)}<br>salles` : big ? 'Grosse<br>sortie' : '—'}</div>
    ${myList[f.id] ? '<span class="star" aria-label="Dans ma liste">★</span>' : ''}
  </button>`;
}

const mini = f => `<button class="mini${myList[f.id] ? ' mine' : ''}" type="button" data-film="${esc(f.id)}">${poster(f)}<b>${esc(cleanTitle(f.title))}</b>${f.screens ? `<small>${fmt(f.screens)} salles</small>` : f.genre ? `<small>${esc(f.genre)}</small>` : ''}</button>`;

function head(kicker, title, sub = '', right = '') {
  return `<header class="page-head${right ? ' row' : ''}"><div><div class="kicker">${esc(kicker)}</div><h1 class="page-title">${esc(title)}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>${right}</header>`;
}
const source = () => `<p class="source">Sorties et box-office : JP's Box-Office · notes : IMDb, Rotten Tomatoes, Letterboxd · séances : paris-cine.info</p>`;

// ---------------------------------------------------------------- Semaine
function renderWeek() {
  const wed = featuredWednesday();
  const list = filmsOn(wed);
  const bigCount = list.filter(f => isBig(f, list)).length;
  let html = head(dayLabel(wed), 'Cette semaine', list.length ? `${list.length} sortie${list.length > 1 ? 's' : ''}${bigCount ? ` · ${bigCount} grosse${bigCount > 1 ? 's' : ''}` : ''}` : '');
  if (!list.length) html += '<p class="empty">Pas encore de sorties annoncées pour cette semaine.</p>';
  else {
    html += hero(list[0], 'La sortie de la semaine');
    if (list.length > 1) html += `<div class="section-title">Aussi mercredi</div>${list.slice(1).map(f => ticket(f, list)).join('')}`;
  }
  for (let i = 1; i <= 3; i++) {
    const d = addDays(wed, 7 * i), l = filmsOn(d);
    if (!l.length) continue;
    const top = l.filter(f => isBig(f, l));
    html += `<div class="section-title">${esc(dayLabel(d))} · ${l.length} sortie${l.length > 1 ? 's' : ''}</div><div class="posters">${(top.length ? top : l.slice(0, 4)).map(mini).join('')}</div>`;
  }
  const bo = cat.boxoffice;
  if (bo?.rows?.length) {
    html += `<div class="section-title">Box-office France</div><div class="podium">${bo.rows.slice(0, 3).map(r => `
      <button class="pod" type="button" data-film="${esc(r.id || '')}">${poster(r)}<span class="rk">${r.rank}</span><b>${esc(cleanTitle(r.title))}</b><small>${short(r.entries)} entrées</small></button>`).join('')}</div>`;
  }
  return html + source();
}

// ---------------------------------------------------------------- Calendrier
const genres = () => {
  const count = {};
  cat.films.filter(f => f.date >= today()).forEach(f => { if (f.genre) count[f.genre] = (count[f.genre] || 0) + 1; });
  return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
};
function keep(list) {
  if (filter === 'all') return list;
  if (filter === 'mine') return list.filter(f => myList[f.id]);
  if (filter.startsWith('genre:')) return list.filter(f => f.genre === filter.slice(6));
  const big = list.filter(f => isBig(f, list));
  return big;
}
const visibleOn = d => keep(filmsOn(d));

function monthView() {
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + monthOffset);
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const cells = [];
  for (let i = 0; i < (first.getDay() + 6) % 7; i++) cells.push('<div class="cal-day out"></div>');
  const t = today();
  for (let n = 1; n <= last.getDate(); n++) {
    const d = isoDay(new Date(y, m, n));
    const l = visibleOn(d);
    const cls = ['cal-day', d === t ? 'today' : '', d === selDay ? 'sel' : '', d < t ? 'past' : ''].filter(Boolean).join(' ');
    cells.push(`<button class="${cls}" type="button" data-day="${d}" aria-label="${esc(dayLabel(d))}${l.length ? `, ${l.length} film${l.length > 1 ? 's' : ''}` : ''}">
      <span class="num">${n}</span>${l.length ? (l[0].poster ? `<img class="thumb" src="${esc(l[0].poster)}" alt="">` : '<span class="thumb"></span>') : ''}${l.length > 1 ? `<span class="thumb more">+${l.length - 1}</span>` : ''}</button>`);
  }
  const lastDate = cat.films.reduce((a, f) => f.date > a ? f.date : a, '');
  const maxOffset = lastDate ? (parseDay(lastDate).getFullYear() - new Date().getFullYear()) * 12 + parseDay(lastDate).getMonth() - new Date().getMonth() : 0;
  let html = `<div class="month-head"><h3>${cap(MONTHS[m])} ${y}</h3><div class="nav">
      <button type="button" data-month="-1" aria-label="Mois précédent"${monthOffset <= -1 ? ' disabled' : ''}>‹</button>
      <button type="button" data-month="1" aria-label="Mois suivant"${monthOffset >= maxOffset ? ' disabled' : ''}>›</button></div></div>
    <div class="cal-head">${WEEKDAYS.map(w => `<span>${w}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div>`;
  if (selDay) {
    const l = visibleOn(selDay);
    html += `<h3 class="day-title">${esc(cap(dayLabel(selDay)))}<small>${l.length} film${l.length > 1 ? 's' : ''}</small></h3>${l.length ? `<div class="posters">${l.map(mini).join('')}</div>` : '<p class="empty">Rien ce jour-là avec ce filtre.</p>'}`;
  }
  return html;
}

function weeksView() {
  const from = featuredWednesday();
  const dates = [...new Set(cat.films.map(f => f.date))].filter(d => d >= from).sort();
  const thisWed = featuredWednesday();
  return dates.map(d => {
    const all = filmsOn(d), l = keep(all);
    if (!l.length) return '';
    return `<h3 class="day-title">${esc(cap(dayLabel(d)))}${d === thisWed ? '<span class="tag-now">Cette semaine</span>' : `<small>${all.length} sortie${all.length > 1 ? 's' : ''}</small>`}</h3><div class="posters">${l.map(mini).join('')}</div>`;
  }).join('') || '<p class="empty">Rien avec ce filtre.</p>';
}

function listView() {
  const dates = [...new Set(cat.films.map(f => f.date))].filter(d => d >= addDays(today(), -6)).sort();
  return dates.map(d => {
    const l = keep(filmsOn(d));
    if (!l.length) return '';
    const dt = parseDay(d);
    return `<div class="ag-day"><div class="ag-date"><span>${SHORT_DAYS[dt.getDay()]}</span><b>${dt.getDate()}</b><small>${MONTHS_SHORT[dt.getMonth()]}</small></div>
      <div class="ag-list">${l.map(f => `<button class="ag-item" type="button" data-film="${esc(f.id)}">${poster(f)}<b>${esc(cleanTitle(f.title))}</b><small>${f.screens ? `${fmt(f.screens)} s.` : esc(f.genre || '')}</small></button>`).join('')}</div></div>`;
  }).join('') || '<p class="empty">Rien avec ce filtre.</p>';
}

function renderCalendar() {
  const listCount = Object.keys(myList).length;
  let html = head(`${new Date().getFullYear()} – ${new Date().getFullYear() + 1}`, 'Calendrier', '', `<a class="sub-pill" href="webcal://${location.host}/api/ics?all=1" aria-label="S'abonner aux grosses sorties dans mon agenda">${CAL_ICON}S'abonner</a>`);
  html += `<div class="seg" role="tablist" aria-label="Affichage">${[['month', 'Mois'], ['weeks', 'Semaines'], ['list', 'Liste']].map(([v, l]) =>
    `<button type="button" role="tab" aria-selected="${calView === v}" class="${calView === v ? 'on' : ''}" data-view="${v}">${l}</button>`).join('')}</div>`;
  const chips = [['big', 'Grosses sorties'], ['all', 'Toutes'], ['mine', `Ma liste${listCount ? ` · ${listCount}` : ''}`], ...genres().map(g => [`genre:${g}`, g])];
  html += `<div class="chips" role="group" aria-label="Filtrer">${chips.map(([v, l]) => `<button class="chip${filter === v ? ' on' : ''}" type="button" data-filter="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  html += calView === 'weeks' ? weeksView() : calView === 'list' ? listView() : monthView();
  return html + source();
}

// ---------------------------------------------------------------- Box-office
function renderBoxOffice() {
  let html = head(boView === 'world' ? `Cumul ${cat.world?.year || ''}` : 'Classement de la semaine', 'Box-office');
  html += `<div class="seg" role="tablist" aria-label="Pays">${[['fr', 'France'], ['us', 'États-Unis'], ['world', 'Monde']].map(([v, l]) =>
    `<button type="button" class="${boView.startsWith(v) ? 'on' : ''}" data-bo="${v}">${l}</button>`).join('')}</div>`;
  if (boView === 'world') {
    const rows = cat.world?.rows || [];
    if (!rows.length) return html + '<p class="empty">Box-office mondial indisponible.</p>';
    html += `<div class="podium">${rows.slice(0, 3).map(r => `<button class="pod" type="button" data-film="${esc(r.id)}">${poster(r)}<span class="rk">${r.rank}</span><b>${esc(cleanTitle(r.title))}</b><small>${short(r.world)} $</small></button>`).join('')}</div>`;
    html += `<div class="bo-list">${rows.slice(3).map(r => `<button class="bo" type="button" data-film="${esc(r.id)}"><span class="rk">${r.rank}</span>
      <span class="name"><b>${esc(cleanTitle(r.title))}</b><small>US ${short(r.us)} $ · international ${short(r.intl)} $</small></span>
      <span class="num"><b>${short(r.world)} $</b><small>monde</small></span></button>`).join('')}</div>`;
    return html + source();
  }
  const bo = boView === 'us' ? cat.boxoffice_us : boView === 'fr-prev' ? cat.boxoffice_prev : cat.boxoffice;
  if (!bo?.rows?.length) return html + '<p class="empty">Box-office indisponible pour le moment.</p>';
  const usd = bo.unit === 'usd';
  const label = (bo.label || '').replace(/^(Semaine|Week-?end) \d+ - /i, '').replace(/^DU/i, 'du').toLowerCase();
  if (boView !== 'us') html += `<div class="chips"><button class="chip${boView === 'fr' ? ' on' : ''}" type="button" data-bo="fr">Cette semaine</button><button class="chip${boView === 'fr-prev' ? ' on' : ''}" type="button" data-bo="fr-prev">Semaine d'avant</button></div>`;
  html += `<p class="page-sub">${usd ? 'Week-end ' : 'Semaine '}${esc(label)}${bo.days && bo.days < 7 ? ` · ${bo.days} premiers jours` : ''}</p>`;
  const unit = n => usd ? `${short(n)} $` : `${short(n)}`;
  html += `<div class="podium">${bo.rows.slice(0, 3).map(r => `<button class="pod" type="button" data-film="${esc(r.id || '')}">${poster(r)}<span class="rk">${r.rank}</span><b>${esc(cleanTitle(r.title))}</b><small>${unit(r.entries)}${usd ? '' : ' entrées'} · ${r.isNew ? 'nouveau' : r.change || ''}</small></button>`).join('')}</div>`;
  html += `<div class="bo-list">${bo.rows.slice(3).map(r => `<button class="bo" type="button" data-film="${esc(r.id || '')}"><span class="rk">${r.rank}</span>
    <span class="name"><b>${esc(cleanTitle(r.title))}</b><small>${esc([r.distributor, r.weeks > 1 ? `${r.weeks}e semaine` : '', `total ${unit(r.total)}`].filter(Boolean).join(' · '))}</small></span>
    <span class="num"><b>${usd ? unit(r.entries) : fmt(r.entries)}</b><small class="${r.isNew ? 'new' : r.change?.startsWith('-') ? 'down' : ''}">${r.isNew ? 'nouveau' : esc(r.change || '')}</small></span></button>`).join('')}</div>`;
  return html + source();
}

// ---------------------------------------------------------------- Mes cinés (séances via paris-cine.info)
const normT = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const catalogFilm = (title, original) => { const w = [normT(title), normT(original)].filter(Boolean); return cat?.films.find(f => w.includes(normT(f.title)) || (f.original && w.includes(normT(f.original)))); };
const hm = iso => iso.slice(11, 16);

async function loadCinemas() {
  if (cinemas.length) return;
  cinemas = read(KEYS.cinemas) || [];
  try {
    const r = await fetch('/api/seances?list=cinemas');
    if (r.ok) { const d = await r.json(); if (d.cinemas?.length) { cinemas = d.cinemas; write(KEYS.cinemas, cinemas); } }
  } catch (e) { /* hors-ligne */ }
  if (!myCines) {
    // Par défaut : les Pathé de Paris (réseau de la carte Pathé)
    myCines = cinemas.filter(c => c.pathe && c.zip.startsWith('75') && !/Fondation/.test(c.name)).map(c => c.id);
    write(KEYS.cines, myCines);
  }
}

// La semaine de séances des cinémas choisis (une requête, gardée en mémoire), filtrée ensuite par jour
async function loadDay(date) {
  const key = [...myCines].sort((a, b) => a - b).join('.');
  if (!seancesCache[key]) {
    seancesCache[key] = fetch(`/api/seances?c=${key}`).then(r => r.ok ? r.json() : { films: [] }).then(d => d.films || [])
      .catch(e => { delete seancesCache[key]; throw e; });
  }
  const films = await seancesCache[key];
  return films.map(f => ({ ...f, showtimes: f.showtimes.filter(st => st.start.startsWith(date)) })).filter(f => f.showtimes.length)
    .sort((a, b) => b.showtimes.length - a.showtimes.length);
}

const keepShowtime = st => seanceFilter === 'vo' ? /VO|VOST/i.test(st.version) : seanceFilter === 'vf' ? /VF/i.test(st.version) : seanceFilter === 'soir' ? hm(st.start) >= '19:00' : true;

function showtimeButtons(film, list) {
  const now = new Date().toISOString().slice(0, 16);
  const byCine = new Map();
  list.forEach(st => { if (!byCine.has(st.cinema)) byCine.set(st.cinema, []); byCine.get(st.cinema).push(st); });
  return [...byCine].map(([cine, sts]) => `<div class="sc-cine"><span>${esc(cine.replace(/^Pathé /, 'Pathé · '))}</span><div class="times">${sts.map(st => {
    const i = shownSeances.push({ film, st }) - 1;
    const past = st.start.slice(0, 16) < now;
    return `<button class="time${past ? ' past' : ''}" type="button" data-seance="${i}">${hm(st.start)}<small>${esc(st.version)}${st.format ? ' ' + esc(st.format) : ''}</small></button>`;
  }).join('')}</div></div>`).join('');
}

function renderCines() {
  if (!myCines) return head('Paris', 'Mes cinés') + '<p class="loading">Chargement des cinémas…</p>';
  const t = today();
  if (!seanceDate) seanceDate = t;
  const names = cinemas.filter(c => myCines.includes(c.id)).map(c => c.name.replace(/^Pathé /, ''));
  let html = head('Séances à Paris', 'Mes cinés', names.length ? esc(names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : '')) : 'Aucun cinéma choisi',
    '<button class="sub-pill" type="button" data-open-pick>Choisir</button>');
  html += `<div class="days">${[...Array(7)].map((_, i) => { const d = addDays(t, i), dt = parseDay(d);
    return `<button type="button" class="${d === seanceDate ? 'on' : ''}" data-sday="${d}"><span>${i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : SHORT_DAYS[dt.getDay()].toLowerCase()}</span><b>${dt.getDate()}</b></button>`; }).join('')}</div>`;
  html += `<div class="chips">${[['all', 'Toutes'], ['vo', 'VO'], ['vf', 'VF'], ['soir', 'Après 19 h']].map(([v, l]) => `<button class="chip${seanceFilter === v ? ' on' : ''}" type="button" data-sfilter="${v}">${l}</button>`).join('')}</div>`;
  html += '<div id="seances"><p class="loading">Recherche des séances…<br><small>jusqu'à 30 secondes la première fois, puis instantané</small></p></div>';
  return html + '<p class="source">Séances : <a href="https://paris-cine.info" target="_blank" rel="noopener">paris-cine.info</a> (données Allociné) · réservation sur le site du cinéma</p>';
}

async function fillCines() {
  const box = $('#seances');
  if (!box || !myCines?.length) { if (box) box.innerHTML = '<p class="empty">Choisis tes cinémas pour voir leurs séances.</p>'; return; }
  const date = seanceDate;
  let films;
  try { films = await loadDay(date); } catch (e) { films = null; }
  if (!$('#seances') || date !== seanceDate) return;
  if (!films) { $('#seances').innerHTML = '<p class="empty">Séances indisponibles pour le moment.</p>'; return; }
  shownSeances = [];
  const html = films.map(f => {
    const list = f.showtimes.filter(keepShowtime);
    if (!list.length) return '';
    const c = catalogFilm(f.title, f.original);
    const notes = [f.duration, f.imdb ? `IMDb ${String(f.imdb).replace('.', ',')}` : '', f.rt ? `RT ${f.rt} %` : '', f.letterboxd ? `Letterboxd ${String(f.letterboxd).replace('.', ',')}` : ''].filter(Boolean).join(' · ');
    return `<article class="sc-film">${c ? `<button type="button" data-film="${esc(c.id)}">${poster(c)}</button>` : `<div class="poster ph">${esc(f.title[0] || '?')}</div>`}
      <div><h3>${esc(f.title)}</h3><p class="meta">${esc(notes)}</p>${showtimeButtons(f, list)}</div></article>`;
  }).join('');
  $('#seances').innerHTML = html || '<p class="empty">Aucune séance avec ce filtre.</p>';
}

function openSeance(i) {
  const s = shownSeances[i];
  if (!s) return;
  const { film, st } = s;
  const start = st.start.slice(0, 16);
  const endD = new Date(`${start}:00`); endD.setMinutes(endD.getMinutes() + (film.minutes || 120) + 20);
  const end = `${isoDay(endD)}T${pad(endD.getHours())}:${pad(endD.getMinutes())}`;
  const title = `🍿 ${film.title}`;
  const details = [`${st.cinema} · ${st.version}`, st.book].filter(Boolean).join('\n');
  const q = o => new URLSearchParams(o).toString();
  const g = x => x.replace(/[-:]/g, '') + '00';
  $('#cal-title').textContent = film.title;
  $('#cal-sub').textContent = `${st.cinema} · ${cap(dayLabel(start.slice(0, 10)))} à ${hm(st.start)} · ${st.version}`;
  $('#cal-options').innerHTML = [
    st.book ? [`Réserver chez ${st.cinema}`, st.book] : null,
    ['Ajouter à Calendrier Apple', `/api/ics?${q({ t: film.title, s: start, e: end, l: st.cinema, u: st.book || '' })}`],
    ['Ajouter à Google Agenda', `https://calendar.google.com/calendar/render?${q({ action: 'TEMPLATE', text: title, dates: `${g(start)}/${g(end)}`, ctz: 'Europe/Paris', location: st.cinema, details })}`],
    ['Ajouter à Outlook', `https://outlook.live.com/calendar/0/deeplink/compose?${q({ path: '/calendar/action/compose', rru: 'addevent', subject: title, startdt: start, enddt: end, location: st.cinema, body: details })}`],
  ].filter(Boolean).map(([l, h], k) => `<a class="as-option"${k === 0 && st.book ? ' style="background:var(--red);color:#fff"' : ''} href="${esc(h)}"${h.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(l)}</a>`).join('');
  $('#cal').hidden = false;
}

// Choix des cinémas
function renderPick() {
  const list = cinemas.filter(c => pickCard === 'all' || c.cards.includes(pickCard) || myCines.includes(c.id));
  const groups = new Map();
  list.sort((a, b) => a.zip.localeCompare(b.zip)).forEach(c => { const n = +c.zip.slice(3); const g = c.zip === '75123' ? 'Paris Centre (1er – 4e)' : c.zip.startsWith('75') ? `Paris ${n === 1 ? '1er' : `${n}e`}` : c.area; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
  $('#pick-body').innerHTML = `<div style="padding:8px 16px 0"><div class="chips" style="margin:0">${[['pass', 'Carte Pathé'], ['ugc', 'UGC Illimité'], ['all', 'Tous les cinémas']].map(([v, l]) =>
    `<button class="chip${pickCard === v ? ' on' : ''}" type="button" data-pcard="${v}">${l}</button>`).join('')}</div>
    <p class="page-sub">${myCines.length} cinéma${myCines.length > 1 ? 's' : ''} choisi${myCines.length > 1 ? 's' : ''} · 15 au plus</p>
    ${[...groups].map(([g, cs]) => `<div class="cine-group">${esc(g)}</div>${cs.map(c => `<button class="cine-row${myCines.includes(c.id) ? ' on' : ''}" type="button" data-cine="${c.id}">
      <span class="box">${myCines.includes(c.id) ? '✓' : ''}</span><b>${esc(c.name)}</b><small>${c.cards.includes('pass') ? 'Carte Pathé' : c.cards.includes('ugc') ? 'UGC Illimité' : ''}</small></button>`).join('')}`).join('')}</div>`;
}

// ---------------------------------------------------------------- rendu
function render() {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const n = Object.keys(myList).length;
  $('#list-count').hidden = !n; $('#list-count').textContent = n;
  if (!cat) { $('#view').innerHTML = '<p class="empty">On éteint la lumière, la séance commence…</p>'; return; }
  $('#view').innerHTML = { week: renderWeek, calendar: renderCalendar, boxoffice: renderBoxOffice, cines: renderCines }[tab]();
  if (tab === 'cines') { if (myCines) fillCines(); else loadCinemas().then(render); }
  document.querySelectorAll('[data-notes]').forEach(el => { const f = findFilm(el.dataset.notes); if (f) fillNotes(f, el); });
}

// ---------------------------------------------------------------- fiche film
function openFilm(id) {
  const f = findFilm(id);
  if (!f) return;
  const inList = !!myList[f.id];
  const sub = [f.date ? `Sortie le ${dayLabel(f.date)}` : '', [f.genre, f.country, f.duration].filter(Boolean).join(' · ') || f.info || '', f.screens ? `${fmt(f.screens)} salles` : ''].filter(Boolean);
  $('#film-body').innerHTML = `
    <div class="film-hero">
      <div class="bar">
        <button class="back" type="button" data-close-film><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Retour</button>
        <button class="mylist-btn${inList ? ' on' : ''}" type="button" data-mylist="${esc(f.id)}">${inList ? '★ Dans ma liste' : '☆ Ma liste'}</button>
      </div>
      <div class="film-top">${poster(f)}<div><h2 id="film-title">${esc(cleanTitle(f.title))}</h2>${f.original ? `<p class="orig">${esc(f.original)}</p>` : ''}<p class="meta">${sub.map(esc).join('<br>')}</p></div></div>
    </div>
    <div class="film-main">
      <div class="scores" id="scores"><div class="na"><b>…</b><span>IMDb</span></div><div class="na"><b>…</b><span>Rotten T.</span></div><div class="na"><b>…</b><span>Letterboxd</span></div></div>
      ${f.synopsis ? `<p class="syn">${esc(f.synopsis)}</p>` : ''}
      ${f.director || f.cast?.length ? `<p class="people">${f.director ? `De ${esc(f.director)}` : ''}${f.director && f.cast?.length ? '<br>' : ''}${f.cast?.length ? `Avec ${esc(f.cast.join(', '))}` : ''}</p>` : ''}
      ${myCines?.length ? '<div class="section-title" style="margin:6px 0 0">Séances dans mes cinés</div><div class="film-seances" id="film-seances"><p class="loading" style="padding:10px 0">Recherche…</p></div>' : ''}
      <div class="actions">
        <a class="btn red" href="${showtimesUrl(f)}" target="_blank" rel="noopener">${TICKET_ICON}Toutes les séances</a>
        ${f.date ? `<button class="btn" type="button" data-cal="${esc(f.id)}">${CAL_ICON}Agenda</button>` : `<a class="btn" href="https://www.pathe.fr/films" target="_blank" rel="noopener">Pathé</a>`}
        <a class="btn" href="https://www.allocine.fr/rechercher/?q=${encodeURIComponent(cleanTitle(f.title))}" target="_blank" rel="noopener">Allociné</a>
        <a class="btn" href="https://www.jpbox-office.com/fichfilm.php?id=${esc(f.id)}&view=2" target="_blank" rel="noopener">Chiffres JP</a>
      </div>
    </div>`;
  $('#film').hidden = false;
  document.body.classList.add('sheet-open');
  $('#film-body').scrollTop = 0;
  if (myCines?.length) {
    fetch(`/api/seances?${new URLSearchParams({ c: myCines.join('.'), t: cleanTitle(f.title), o: f.original || '' })}`).then(r => r.ok ? r.json() : {}).then(d => {
      const box = $('#film-seances');
      if (!box) return;
      const now = new Date().toISOString().slice(0, 10);
      const sts = (d.film?.showtimes || []).filter(st => st.start.slice(0, 10) >= now);
      if (!sts.length) { box.innerHTML = '<p class="people">Pas de séance prévue dans tes cinémas pour l\'instant.</p>'; return; }
      shownSeances = [];
      const days = [...new Set(sts.map(st => st.start.slice(0, 10)))].slice(0, 4);
      box.innerHTML = days.map(dd => `<div><div class="day-h">${esc(cap(dayLabel(dd)))}</div>${showtimeButtons(d.film, sts.filter(st => st.start.startsWith(dd)))}</div>`).join('');
    }).catch(() => { const box = $('#film-seances'); if (box) box.innerHTML = '<p class="people">Séances indisponibles.</p>'; });
  }
  getRatings(f).then(r => {
    const box = $('#scores');
    if (!box || $('#film').hidden) return;
    const cell = (label, val, url) => val != null ? `<a href="${esc(url)}" target="_blank" rel="noopener"><b>${val}</b><span>${label}</span></a>` : `<div class="na"><b>—</b><span>${label}</span></div>`;
    box.innerHTML = cell('IMDb', r?.imdb?.rating?.toLocaleString('fr-FR'), r?.imdb?.url)
      + cell('Rotten T.', r?.rt?.critics != null ? `${r.rt.critics} %` : null, r?.rt?.url)
      + cell('Letterboxd', r?.letterboxd?.rating?.toLocaleString('fr-FR', { maximumFractionDigits: 1 }), r?.letterboxd?.url);
  });
}
function closeFilm() { $('#film').hidden = true; if ($('#list').hidden) document.body.classList.remove('sheet-open'); render(); }

function toggleMyList(id) {
  const f = findFilm(id);
  if (!f) return;
  if (myList[id]) { delete myList[id]; toast('Retiré de ma liste'); }
  else { myList[id] = { title: f.title, date: f.date || '', poster: f.poster || '' }; toast('Ajouté à ma liste'); }
  write(KEYS.list, myList);
  const n = Object.keys(myList).length;
  $('#list-count').hidden = !n; $('#list-count').textContent = n;
  const b = document.querySelector(`[data-mylist="${CSS.escape(id)}"]`);
  if (b) { b.classList.toggle('on', !!myList[id]); b.textContent = myList[id] ? '★ Dans ma liste' : '☆ Ma liste'; }
  if (!$('#list').hidden) renderList();
}

// ---------------------------------------------------------------- Ma liste
function renderList() {
  const items = Object.entries(myList).map(([id, v]) => ({ id, ...v, ...(findFilm(id) || {}) })).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  $('#list-body').innerHTML = items.length ? `<div class="ag-list" style="margin-top:8px">${items.map(f => `
    <button class="ag-item" type="button" data-film="${esc(f.id)}">${poster(f)}<b>${esc(cleanTitle(f.title))}</b><small>${f.date ? (f.date < today() ? 'en salles' : esc(dayLabel(f.date))) : ''}</small></button>`).join('')}</div>`
    : '<p class="empty">Ajoute des films avec ☆ dans leur fiche : ils apparaîtront ici et dans le filtre « Ma liste » du calendrier.</p>';
}

// ---------------------------------------------------------------- agenda
function openCalSheet(id) {
  const f = findFilm(id);
  if (!f?.date) return;
  const d = f.date.replace(/-/g, ''), next = addDays(f.date, 1).replace(/-/g, '');
  const title = `🍿 Sortie : ${cleanTitle(f.title)}`;
  const details = `${[f.genre, f.duration].filter(Boolean).join(' · ')}\n${location.origin}`;
  const q = o => new URLSearchParams(o).toString();
  $('#cal-title').textContent = cleanTitle(f.title);
  $('#cal-sub').textContent = `Sortie le ${dayLabel(f.date)}`;
  $('#cal-options').innerHTML = [
    ['Calendrier Apple', `/api/ics?${q({ t: cleanTitle(f.title), d: f.date })}`],
    ['Google Agenda', `https://calendar.google.com/calendar/render?${q({ action: 'TEMPLATE', text: title, dates: `${d}/${next}`, details })}`],
    ['Outlook', `https://outlook.live.com/calendar/0/deeplink/compose?${q({ path: '/calendar/action/compose', rru: 'addevent', subject: title, startdt: f.date, enddt: addDays(f.date, 1), allday: 'true', body: details })}`],
  ].map(([l, h]) => `<a class="as-option" href="${esc(h)}"${h.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${l}</a>`).join('');
  $('#cal').hidden = false;
}

// ---------------------------------------------------------------- données
async function load() {
  try {
    const r = await fetch('/api/catalog', { cache: 'no-store' });
    if (r.ok) { const c = await r.json(); if (c.films?.length) { cat = c; write(KEYS.catalog, c); } }
  } catch (e) { /* hors-ligne : on garde le programme en mémoire */ }
  render();
}

cat = read(KEYS.catalog);
tab = read(KEYS.tab) || 'week';
calView = read(KEYS.view) || 'month';
filter = read(KEYS.filter) || 'big';
myList = read(KEYS.list) || {};
myCines = read(KEYS.cines);
cinemas = read(KEYS.cinemas) || [];
ratingsCache = read(KEYS.ratings) || {};
if (!['week', 'calendar', 'boxoffice', 'cines'].includes(tab)) tab = 'week';
loadCinemas();

$('.tabs').addEventListener('click', ev => {
  const b = ev.target.closest('.tab');
  if (!b) return;
  tab = b.dataset.tab; write(KEYS.tab, tab); render(); window.scrollTo(0, 0);
});
document.addEventListener('click', ev => {
  const t = ev.target;
  const cal = t.closest('[data-cal]'); if (cal) { openCalSheet(cal.dataset.cal); return; }
  const ml = t.closest('[data-mylist]'); if (ml) { toggleMyList(ml.dataset.mylist); return; }
  if (t.closest('[data-close-film]')) { closeFilm(); return; }
  if (t.closest('[data-close-list]')) { $('#list').hidden = true; document.body.classList.remove('sheet-open'); render(); return; }
  if (t.closest('#cal [data-close]') || t.closest('.as-option')) { setTimeout(() => { $('#cal').hidden = true; }, 0); return; }
  const film = t.closest('[data-film]'); if (film && film.dataset.film) { openFilm(film.dataset.film); return; }
  const v = t.closest('[data-view]'); if (v) { calView = v.dataset.view; write(KEYS.view, calView); render(); return; }
  const f = t.closest('[data-filter]'); if (f) { filter = f.dataset.filter; write(KEYS.filter, filter); render(); return; }
  const d = t.closest('[data-day]'); if (d) { selDay = selDay === d.dataset.day ? null : d.dataset.day; render(); return; }
  const m = t.closest('[data-month]'); if (m) { monthOffset += +m.dataset.month; selDay = null; render(); return; }
  const bo = t.closest('[data-bo]'); if (bo) { boView = bo.dataset.bo; render(); return; }
  const se = t.closest('[data-seance]'); if (se) { openSeance(+se.dataset.seance); return; }
  const sd = t.closest('[data-sday]'); if (sd) { seanceDate = sd.dataset.sday; render(); return; }
  const sf = t.closest('[data-sfilter]'); if (sf) { seanceFilter = sf.dataset.sfilter; render(); return; }
  if (t.closest('[data-open-pick]')) { loadCinemas().then(() => { renderPick(); $('#pick').hidden = false; document.body.classList.add('sheet-open'); }); return; }
  if (t.closest('[data-close-pick]')) { $('#pick').hidden = true; document.body.classList.remove('sheet-open'); render(); return; }
  const pc = t.closest('[data-pcard]'); if (pc) { pickCard = pc.dataset.pcard; renderPick(); return; }
  const ci = t.closest('[data-cine]'); if (ci) {
    const id = +ci.dataset.cine;
    if (myCines.includes(id)) myCines = myCines.filter(x => x !== id);
    else if (myCines.length < 15) myCines = [...myCines, id];
    else toast('15 cinémas au plus');
    write(KEYS.cines, myCines); renderPick(); return;
  }
});
$('#open-list').addEventListener('click', () => { renderList(); $('#list').hidden = false; document.body.classList.add('sheet-open'); });

// Par défaut, le calendrier s'ouvre sur le mercredi de la semaine
selDay = featuredWednesday();
render();
load();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
