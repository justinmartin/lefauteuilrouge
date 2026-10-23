// Le Fauteuil Rouge — app.
// Données : /api/catalog (sorties France sur l'année, box-office France / US / monde, d'après JP's Box-Office),
// /api/ratings (IMDb, Rotten Tomatoes, Letterboxd, bande-annonce) et /api/seances (paris-cine.info),
// gardées sur le téléphone pour l'ouverture instantanée.
// Trois onglets : À l'affiche (semaine, à venir, box-office), Ce soir (frise des séances), Mes films (liste, tickets, vus).
const KEYS = { catalog: 'lfr_catalog', tab: 'lfr_tab', sub: 'lfr_sub', list: 'lfr_list', ratings: 'lfr_ratings', view: 'lfr_calview', filter: 'lfr_filter', cines: 'lfr_cines', cinemas: 'lfr_cinemas', tickets: 'lfr_tickets', seances: 'lfr_seances', account: 'lfr_account', updated: 'lfr_updated', onboarded: 'lfr_onboarded', reprises: 'lfr_reprises', notified: 'lfr_notified' };
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const SHORT_DAYS = ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const BIG_SCREENS = 250; // au-delà : « grosse sortie »
const PX = 74;           // frise du soir : pixels par heure

let cat = null;
let tab = 'affiche';
let sub = { affiche: 'semaine', films: 'avoir' };
let calView = 'year';    // year (frise) | month
let filter = 'big';      // big | all | mine | genre:<nom>
let selDay = null;
let monthOffset = 0;
let boView = 'fr';       // fr | fr-prev | us | world
let myList = {};         // { id: { title, date, poster } }
let tickets = [];        // séances où l'on va : { id, title, filmId, poster, start, end, cinema, version, book }
let ratingsCache = {};
let myCines = null;      // identifiants paris-cine.info des cinémas choisis
let cinemas = [];        // tous les cinémas de Paris et petite couronne
let seanceDate = null;
let seanceFilter = 'all'; // all | vo | vf
let pickCard = 'pass';    // filtre du choix des cinémas : pass | ugc | mk2 | all
const seancesCache = {};
let shownSeances = [];   // séances affichées (pour la feuille Réserver / J'y vais / Agenda)
let curSeance = null;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoMin = d => `${isoDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); };
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
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
let found = {};          // résultats de la recherche « tous les films » (Wikidata), par id
const oldFilm = id => found[id] || (myList[id]?.old ? { id, ...myList[id] } : null);
const findFilm = id => oldFilm(id) || cat.films.find(f => f.id === id)
  || [...(cat.boxoffice?.rows || []), ...(cat.boxoffice_prev?.rows || []), ...(cat.boxoffice_us?.rows || []), ...(cat.world?.rows || [])].find(f => f.id === id);

// ---------------------------------------------------------------- notes (IMDb, RT, Letterboxd)
const yearOf = f => f.year || +(f.date || '').slice(0, 4) || new Date().getFullYear();
async function getRatings(f) {
  const key = f.id;
  const hit = ratingsCache[key];
  if (hit && Date.now() - hit.at < 24 * 3600e3 && 'trailer' in (hit.data || {})) return hit.data;
  try {
    const r = await fetch(`/api/ratings?${new URLSearchParams({ t: cleanTitle(f.title), o: f.original || '', y: yearOf(f) })}`);
    const data = r.ok ? await r.json() : null;
    if (data) { ratingsCache[key] = { at: Date.now(), data }; write(KEYS.ratings, ratingsCache); }
    return data;
  } catch (e) { return null; }
}

// La note du Fauteuil : moyenne des notes disponibles ramenées sur 10 (Rotten Tomatoes % ÷ 10, IMDb tel quel,
// Letterboxd × 2), et une phrase qui dit si critiques et spectateurs sont d'accord.
function score(r) {
  if (!r?.found) return null;
  const parts = [];
  if (r.rt?.critics != null) parts.push({ k: 'critics', v: r.rt.critics / 10 });
  if (r.imdb?.rating) parts.push({ k: 'viewers', v: r.imdb.rating });
  if (r.letterboxd?.rating) parts.push({ k: 'cinephiles', v: r.letterboxd.rating * 2 });
  if (!parts.length) return null;
  const avg = parts.reduce((a, p) => a + p.v, 0) / parts.length;
  const vals = parts.map(p => p.v), spread = Math.max(...vals) - Math.min(...vals);
  const word = avg >= 8 ? 'Excellent' : avg >= 7 ? 'Très bien' : avg >= 6 ? 'Bien' : avg >= 5 ? 'Mitigé' : 'Décevant';
  let agree = '', divided = false;
  const crit = parts.find(p => p.k === 'critics'), pub = parts.filter(p => p.k !== 'critics');
  const pubAvg = pub.length ? pub.reduce((a, p) => a + p.v, 0) / pub.length : null;
  if (crit && pubAvg != null && Math.abs(crit.v - pubAvg) >= 2) { divided = true; agree = crit.v > pubAvg ? 'la presse aime plus que le public' : 'le public aime plus que la presse'; }
  else if (parts.length >= 2 && spread <= 1.5) agree = 'critiques et spectateurs d’accord';
  return { avg, txt: avg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), word, agree, divided };
}
const scoreTag = s => s ? `<b>${s.txt}</b><small>${esc(s.divided ? 'presse ≠ public' : s.word.toLowerCase())}</small>` : '';

function fillScores() {
  document.querySelectorAll('[data-score]').forEach(el => {
    const f = findFilm(el.dataset.score);
    if (!f) return;
    getRatings(f).then(r => {
      if (!el.isConnected) return;
      const s = score(r);
      el.innerHTML = scoreTag(s);
      el.classList.toggle('div', !!s?.divided);
      const b = document.querySelector(`[data-brief="${CSS.escape(f.id)}"]`);
      if (b && r?.about?.text) b.textContent = r.about.text;
    });
  });
}

// Sorties streaming et festivals
function streamingRows(list) {
  return `<div class="bo-list">${list.map(s => `<a class="bo" href="${esc(s.url)}" target="_blank" rel="noopener">
    ${PLATFORM_LOGOS[s.platform] ? `<img class="plat-logo" src="/logos/${PLATFORM_LOGOS[s.platform]}.svg" alt="${esc(s.platform)}" width="38" height="38">` : `<span class="plat" style="background:${PLATFORM_COLORS[s.platform] || '#3a3836'}">${esc(s.platform)}</span>`}
    <span class="name"><b>${esc(s.title)}</b><small>${esc(s.platform)} · ${esc(s.genre || 'film original')}</small></span>
    <span class="num"><b>${shortDate(s.date)}</b></span></a>`).join('')}</div>`;
}
function eventCards(list) {
  return `<div class="events">${list.map(e => `<a class="event" href="${esc(e.url)}" target="_blank" rel="noopener">
    <span class="ev-kind">${esc(e.kind)}</span><b>${esc(e.name)}</b><span>${esc(eventDates(e))} · ${esc(e.place)}</span>${e.confirmed ? '' : '<small>date prévisionnelle</small>'}</a>`).join('')}</div>`;
}

// ---------------------------------------------------------------- composants
const poster = (f, cls = 'poster') => f.poster ? `<img class="${cls}" src="${esc(f.poster)}" alt="" loading="lazy">` : `<div class="${cls} ph">${esc((cleanTitle(f.title) || '?')[0])}</div>`;
const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>';
const TICKET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.5a2.5 2.5 0 0 0 0-5z"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const SLIDERS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const meta = f => [f.genre, f.duration, f.screens ? `${fmt(f.screens)} salles` : ''].filter(Boolean).join(' · ');
const showtimesUrl = f => `https://www.google.com/search?q=${encodeURIComponent(`séances ${cleanTitle(f.title)}`)}`;
const trailerUrl = f => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${cleanTitle(f.title)} bande annonce VF ${(f.date || '').slice(0, 4)}`)}`;
const PLATFORM_COLORS = { Netflix: '#e50914', 'Prime Video': '#1f8fff', 'Apple TV': '#6b6b70', 'Disney+': '#1b3fa3' };
// Logos des plateformes (web/logos/*.svg, et *.png pour les mails)
const PLATFORM_LOGOS = { Netflix: 'netflix', 'Prime Video': 'prime', 'Apple TV': 'appletv', 'Disney+': 'disney', 'Canal+': 'canal' };
const shortDate = d => { const x = parseDay(d); return `${x.getDate()} ${MONTHS_SHORT[x.getMonth()]}`; };
const eventDates = e => e.start === e.end ? shortDate(e.start) : `${parseDay(e.start).getDate()}–${shortDate(e.end)}`;

function hero(f, label) {
  return `<article class="hero">
    <button type="button" data-film="${esc(f.id)}" aria-label="${esc(f.title)}">${poster(f)}</button>
    <div class="hero-body">
      <span class="eyebrow">${esc(label)}</span>
      <h2>${esc(cleanTitle(f.title))}</h2>
      <span class="meta">${esc(meta(f))}</span>
      <span class="score-tag" data-score="${esc(f.id)}"></span>
      <span class="brief" data-brief="${esc(f.id)}"></span>
      <div class="hero-actions">
        <button class="pill-btn red" type="button" data-film="${esc(f.id)}">${TICKET_ICON}Voir la fiche</button>
        <button class="pill-btn" type="button" data-cal="${esc(f.id)}">${CAL_ICON}Agenda</button>
      </div>
    </div>
  </article>`;
}

function ticket(f, list) {
  const big = isBig(f, list);
  return `<button class="ticket" type="button" data-film="${esc(f.id)}">
    ${poster(f)}
    <div class="t-body"><div class="t-title">${esc(cleanTitle(f.title))}</div><div class="t-meta">${esc([f.genre, f.director || f.cast?.[0], f.duration].filter(Boolean).join(' · '))}</div><span class="score-tag" data-score="${esc(f.id)}"></span></div>
    <div class="stub${big ? ' big' : ''}">${f.screens ? `${fmt(f.screens)}<br>salles` : big ? 'Grosse<br>sortie' : '—'}</div>
    ${myList[f.id] ? '<span class="star" aria-label="Dans ma liste">★</span>' : ''}
  </button>`;
}

const mini = f => `<button class="mini${myList[f.id] ? ' mine' : ''}" type="button" data-film="${esc(f.id)}">${poster(f)}<b>${esc(cleanTitle(f.title))}</b>${f.screens ? `<small>${fmt(f.screens)} salles</small>` : f.genre ? `<small>${esc(f.genre)}</small>` : ''}</button>`;

function head(title, right = '', sub = '') {
  return `<header class="page-head${right ? ' row' : ''}"><div><h1 class="page-title">${title}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>${right}</header>`;
}
// Sélecteur en haut de page (onglet + sous-vue)
const seg = (key, items, cur) => `<div class="seg" role="tablist" style="grid-template-columns:repeat(${items.length},minmax(0,1fr))">${items.map(([v, l]) =>
  `<button type="button" role="tab" aria-selected="${cur === v}" class="${cur === v ? 'on' : ''}" data-${key}="${v}">${l}</button>`).join('')}</div>`;
const source = () => `<p class="source">Sorties et box-office : JP's Box-Office · notes : IMDb, Rotten Tomatoes, Letterboxd · séances : paris-cine.info</p>`;
const skeleton = (n = 3) => `<div class="skel-list" aria-hidden="true">${'<div class="skel-row"><span class="skel sk-poster"></span><span class="skel-lines"><span class="skel"></span><span class="skel short"></span></span></div>'.repeat(n)}</div>`;

// ================================================================ À l'affiche
function renderAffiche() {
  let html = head('À l’affiche', sub.affiche === 'avenir' ? `<a class="sub-pill" href="webcal://${location.host}/api/ics?all=1" aria-label="S’abonner aux grosses sorties dans mon agenda">${CAL_ICON}S’abonner</a>` : '');
  html += seg('sub', [['semaine', 'Cette semaine'], ['avenir', 'À venir'], ['bo', 'Box-office']], sub.affiche);
  html += sub.affiche === 'avenir' ? renderAvenir() : sub.affiche === 'bo' ? renderBoxOffice() : renderWeek();
  return html + source();
}

function renderWeek() {
  const wed = featuredWednesday();
  const list = filmsOn(wed);
  const bigCount = list.filter(f => isBig(f, list)).length;
  let html = repriseBanner() + `<div class="section-title" style="margin-top:16px">${esc(dayLabel(wed))}${list.length ? ` · ${list.length} sortie${list.length > 1 ? 's' : ''}${bigCount ? `, ${bigCount} grosse${bigCount > 1 ? 's' : ''}` : ''}` : ''}</div>`;
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
  const t = today(), in3w = addDays(t, 21);
  const stream = (cat.streaming || []).filter(s => s.date >= addDays(t, -7) && s.date <= in3w);
  if (stream.length) html += `<div class="section-title">En streaming</div>${streamingRows(stream)}`;
  const ev = (cat.events || []).filter(e => e.start <= addDays(t, 45));
  if (ev.length) html += `<div class="section-title">Festivals et cérémonies</div>${eventCards(ev)}`;
  return html;
}

// ---------------------------------------------------------------- À venir : la frise de l'année et le mois
const genres = () => {
  const count = {};
  cat.films.filter(f => f.date >= today()).forEach(f => { if (f.genre) count[f.genre] = (count[f.genre] || 0) + 1; });
  return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
};
function keep(list) {
  if (filter === 'all') return list;
  if (filter === 'mine') return list.filter(f => myList[f.id]);
  if (filter.startsWith('genre:')) return list.filter(f => f.genre === filter.slice(6));
  return list.filter(f => isBig(f, list));
}
const visibleOn = d => keep(filmsOn(d));

// Taille de l'affiche selon le nombre de salles (ou, avant qu'il soit connu, selon le rang du film ce jour-là)
function frSize(f, list) {
  if (f.screens != null) return f.screens >= 400 ? 'l' : f.screens >= 150 ? 'm' : 's';
  const i = list.indexOf(f);
  return i === 0 ? 'l' : i < 3 ? 'm' : 's';
}
function friseView() {
  const from = featuredWednesday();
  const dates = [...new Set(cat.films.map(f => f.date))].filter(d => d >= from).sort();
  const months = new Map();
  dates.forEach(d => {
    const all = filmsOn(d), l = keep(all);
    if (!l.length) return;
    const k = d.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    l.forEach(f => months.get(k).push({ f, d, size: frSize(f, all) }));
  });
  if (!months.size) return '<p class="empty">Rien avec ce filtre.</p>';
  const thisYear = new Date().getFullYear();
  return `<div class="frise">${[...months].map(([k, items]) => {
    const [y, m] = k.split('-').map(Number);
    return `<section class="fr-col"><h3>${cap(MONTHS_SHORT[m - 1])}${y !== thisYear ? ` <small>${y}</small>` : ''}</h3><div class="fr-grid">${items.map(({ f, d, size }) =>
      `<button class="fr-item ${size}${myList[f.id] ? ' mine' : ''}" type="button" data-film="${esc(f.id)}" aria-label="${esc(cleanTitle(f.title))}, ${esc(dayLabel(d))}">${poster(f)}${size !== 's' ? `<span class="fr-cap"><small>${shortDate(d)}</small><b>${esc(cleanTitle(f.title))}</b></span>` : `<span class="fr-day">${parseDay(d).getDate()}</span>`}</button>`).join('')}</div></section>`;
  }).join('')}</div><p class="page-sub" style="text-align:center">Plus l’affiche est grande, plus le film sort dans de salles · glisse vers la droite</p>`;
}

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

function renderAvenir() {
  const listCount = Object.keys(myList).length;
  const chips = [['big', 'Grosses sorties'], ['all', 'Toutes'], ['mine', `Ma liste${listCount ? ` · ${listCount}` : ''}`], ...genres().map(g => [`genre:${g}`, g])];
  let html = `<div class="row-between"><div class="chips" role="group" aria-label="Filtrer">${chips.map(([v, l]) => `<button class="chip${filter === v ? ' on' : ''}" type="button" data-filter="${esc(v)}">${esc(l)}</button>`).join('')}</div></div>`;
  html += `<div class="zoom" role="group" aria-label="Affichage">${[['year', 'Année'], ['month', 'Mois']].map(([v, l]) => `<button type="button" class="${calView === v ? 'on' : ''}" data-view="${v}">${l}</button>`).join('')}</div>`;
  html += calView === 'month' ? monthView() : friseView();
  if (cat.events?.length) html += `<div class="section-title">Festivals et cérémonies</div>${eventCards(cat.events)}`;
  if (cat.streaming?.length) html += `<div class="section-title">À venir en streaming</div>${streamingRows(cat.streaming.filter(s => s.date >= addDays(today(), -7)))}`;
  return html;
}

// ---------------------------------------------------------------- Box-office
function renderBoxOffice() {
  let html = `<div class="chips">${[['fr', 'France'], ['us', 'États-Unis'], ['world', 'Monde']].map(([v, l]) =>
    `<button type="button" class="chip${boView.startsWith(v) ? ' on' : ''}" data-bo="${v}">${l}</button>`).join('')}</div>`;
  if (boView === 'world') {
    const rows = cat.world?.rows || [];
    if (!rows.length) return html + '<p class="empty">Box-office mondial indisponible.</p>';
    html += `<p class="page-sub">Cumul ${esc(cat.world?.year || '')}</p>`;
    html += `<div class="podium">${rows.slice(0, 3).map(r => `<button class="pod" type="button" data-film="${esc(r.id)}">${poster(r)}<span class="rk">${r.rank}</span><b>${esc(cleanTitle(r.title))}</b><small>${short(r.world)} $</small></button>`).join('')}</div>`;
    html += `<div class="bo-list">${rows.slice(3).map(r => `<button class="bo" type="button" data-film="${esc(r.id)}"><span class="rk">${r.rank}</span>
      <span class="name"><b>${esc(cleanTitle(r.title))}</b><small>US ${short(r.us)} $ · international ${short(r.intl)} $</small></span>
      <span class="num"><b>${short(r.world)} $</b><small>monde</small></span></button>`).join('')}</div>`;
    return html;
  }
  const bo = boView === 'us' ? cat.boxoffice_us : boView === 'fr-prev' ? cat.boxoffice_prev : cat.boxoffice;
  if (!bo?.rows?.length) return html + '<p class="empty">Box-office indisponible pour le moment.</p>';
  const usd = bo.unit === 'usd';
  const label = (bo.label || '').replace(/^(Semaine|Week-?end) \d+ - /i, '').replace(/^DU/i, 'du').toLowerCase();
  html += `<p class="page-sub">${usd ? 'Week-end ' : 'Semaine '}${esc(label)}${bo.days && bo.days < 7 ? ` · ${bo.days} premiers jours` : ''}${boView !== 'us' ? ` · <button class="link-btn" type="button" data-bo="${boView === 'fr' ? 'fr-prev' : 'fr'}">${boView === 'fr' ? 'semaine d’avant' : 'cette semaine'}</button>` : ''}</p>`;
  const unit = n => usd ? `${short(n)} $` : `${short(n)}`;
  html += `<div class="podium">${bo.rows.slice(0, 3).map(r => `<button class="pod" type="button" data-film="${esc(r.id || '')}">${poster(r)}<span class="rk">${r.rank}</span><b>${esc(cleanTitle(r.title))}</b><small>${unit(r.entries)}${usd ? '' : ' entrées'} · ${r.isNew ? 'nouveau' : r.change || ''}</small></button>`).join('')}</div>`;
  html += `<div class="bo-list">${bo.rows.slice(3).map(r => `<button class="bo" type="button" data-film="${esc(r.id || '')}"><span class="rk">${r.rank}</span>
    <span class="name"><b>${esc(cleanTitle(r.title))}</b><small>${esc([r.distributor, r.weeks > 1 ? `${r.weeks}e semaine` : '', `total ${unit(r.total)}`].filter(Boolean).join(' · '))}</small></span>
    <span class="num"><b>${usd ? unit(r.entries) : fmt(r.entries)}</b><small class="${r.isNew ? 'new' : r.change?.startsWith('-') ? 'down' : ''}">${r.isNew ? 'nouveau' : esc(r.change || '')}</small></span></button>`).join('')}</div>`;
  return html;
}

// ================================================================ Ce soir (séances via paris-cine.info)
const normT = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const catalogFilm = (title, original) => { const w = [normT(title), normT(original)].filter(Boolean); return cat?.films.find(f => w.includes(normT(f.title)) || (f.original && w.includes(normT(f.original)))); };
const hm = iso => iso.slice(11, 16);
const minsOf = iso => +iso.slice(11, 13) * 60 + +iso.slice(14, 16);

async function loadCinemas() {
  if (cinemas.length && myCines) return;
  cinemas = cinemas.length ? cinemas : read(KEYS.cinemas) || [];
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
// Les séances sont aussi gardées sur le téléphone (3 h) : « Ce soir » s'affiche tout de suite, puis se met à jour.
function fetchSeances(key) {
  return fetch(`/api/seances?c=${key}`).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status))).then(d => {
    const films = d.films || [];
    write(KEYS.seances, { key, at: Date.now(), films });
    return films;
  });
}
async function loadDay(date) {
  const key = [...myCines].sort((a, b) => a - b).join('.');
  if (!seancesCache[key]) {
    const saved = read(KEYS.seances);
    if (saved?.key === key && Date.now() - saved.at < 3 * 3600e3) {
      seancesCache[key] = Promise.resolve(saved.films);
      if (Date.now() - saved.at > 20 * 60e3) fetchSeances(key).then(films => { seancesCache[key] = Promise.resolve(films); if (tab === 'soir') fillSoir(); }).catch(() => {});
    } else {
      seancesCache[key] = fetchSeances(key).catch(e => { delete seancesCache[key]; throw e; });
    }
  }
  const films = await seancesCache[key];
  return films.map(f => ({ ...f, showtimes: f.showtimes.filter(st => st.start.startsWith(date)) })).filter(f => f.showtimes.length)
    .sort((a, b) => b.showtimes.length - a.showtimes.length);
}

const keepShowtime = st => seanceFilter === 'vo' ? /VO|VOST/i.test(st.version) : seanceFilter === 'vf' ? /VF/i.test(st.version) : true;

function showtimeButtons(film, list) {
  const now = isoMin(new Date());
  const byCine = new Map();
  list.forEach(st => { if (!byCine.has(st.cinema)) byCine.set(st.cinema, []); byCine.get(st.cinema).push(st); });
  return [...byCine].map(([cine, sts]) => `<div class="sc-cine"><span>${esc(cine)}</span><div class="times">${sts.map(st => {
    const i = shownSeances.push({ film, st }) - 1;
    const past = st.start.slice(0, 16) < now;
    return `<button class="time${past ? ' past' : ''}" type="button" data-seance="${i}">${hm(st.start)}<small>${esc(st.version)}${st.format ? ' ' + esc(st.format) : ''}</small></button>`;
  }).join('')}</div></div>`).join('');
}

function renderSoir() {
  const t = today();
  if (!seanceDate || seanceDate < t) seanceDate = t;
  const title = seanceDate === t ? 'Ce soir' : cap(dayLabel(seanceDate).split(' ').slice(0, 2).join(' '));
  let html = head(esc(title), '<button class="icon-btn" type="button" data-open-pick aria-label="Choisir mes cinémas">' + SLIDERS_ICON + '</button>');
  html += `<div class="days">${[...Array(7)].map((_, i) => { const d = addDays(t, i), dt = parseDay(d);
    return `<button type="button" class="${d === seanceDate ? 'on' : ''}" data-sday="${d}"><span>${i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : SHORT_DAYS[dt.getDay()].toLowerCase()}</span><b>${dt.getDate()}</b></button>`; }).join('')}</div>`;
  html += `<div class="chips">${[['all', 'Toutes les versions'], ['vo', 'VO'], ['vf', 'VF']].map(([v, l]) => `<button class="chip${seanceFilter === v ? ' on' : ''}" type="button" data-sfilter="${v}">${l}</button>`).join('')}</div>`;
  html += `<div id="seances">${skeleton(4)}<p class="page-sub" style="text-align:center">Recherche des séances… jusqu’à 30 secondes la première fois</p></div>`;
  return html + '<p class="source">Séances : <a href="https://paris-cine.info" target="_blank" rel="noopener">paris-cine.info</a> (données Allociné) · réservation sur le site du cinéma</p>';
}

// La frise : une ligne par cinéma, chaque séance posée sur son heure, aussi large que le film est long
async function fillSoir() {
  const box = $('#seances');
  if (!box) return;
  if (!myCines?.length) { box.innerHTML = '<p class="empty">Choisis tes cinémas avec le bouton réglages, en haut à droite.</p>'; return; }
  const date = seanceDate;
  let films;
  try { films = await loadDay(date); } catch (e) { films = null; }
  if (!$('#seances') || date !== seanceDate || tab !== 'soir') return;
  if (!films) { $('#seances').innerHTML = '<p class="empty">Séances indisponibles pour le moment.</p>'; return; }
  shownSeances = [];
  const isToday = date === today();
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const items = [];
  films.forEach(f => f.showtimes.filter(keepShowtime).forEach(st => {
    let s = minsOf(st.start);
    if (s < 5 * 60) s += 24 * 60; // séances après minuit : au bout de la soirée
    if (isToday && s < nowMin - 10) return;
    items.push({ f, st, s, e: s + (f.minutes || 110) });
  }));
  if (!items.length) { $('#seances').innerHTML = `<p class="empty">${isToday ? 'Plus de séance aujourd’hui dans tes cinés avec ce filtre.' : 'Aucune séance ce jour-là avec ce filtre.'}</p>`; return; }
  const h0 = Math.floor(Math.min(...items.map(i => i.s), isToday ? nowMin : Infinity) / 60);
  const h1 = Math.ceil(Math.max(...items.map(i => i.e)) / 60);
  const x = m => Math.round((m - h0 * 60) / 60 * PX);
  const W = x(h1 * 60);
  const byCine = new Map();
  items.sort((a, b) => a.s - b.s).forEach(it => { if (!byCine.has(it.st.cinema)) byCine.set(it.st.cinema, []); byCine.get(it.st.cinema).push(it); });
  const ticks = [...Array(h1 - h0 + 1)].map((_, k) => `<span class="tl-tick" style="left:${k * PX}px">${(h0 + k) % 24}h</span>`).join('');
  const lanes = [...byCine].sort((a, b) => a[0].localeCompare(b[0])).map(([cine, list]) => {
    const rows = [];
    const pills = list.map(it => {
      const left = x(it.s), width = Math.max(x(it.e) - left - 3, 58);
      let r = rows.findIndex(end => end <= left - 3);
      if (r < 0) { rows.push(0); r = rows.length - 1; }
      rows[r] = left + width;
      const c = catalogFilm(it.f.title, it.f.original);
      const i = shownSeances.push({ film: it.f, st: it.st }) - 1;
      const soon = isToday && it.s - nowMin <= 60;
      return `<button class="tl-pill${c && myList[c.id] ? ' mine' : ''}${soon ? ' soon' : ''}" type="button" data-seance="${i}" style="left:${left}px;width:${width}px;top:${r * 40}px"><b>${esc(it.f.title)}</b> ${hm(it.st.start)} ${esc(it.st.version)}</button>`;
    }).join('');
    return `<div class="tl-lane"><div class="tl-name">${esc(cine)}</div><div class="tl-rows" style="height:${rows.length * 40}px">${pills}</div></div>`;
  }).join('');
  $('#seances').innerHTML = `<div class="tl"><div class="tl-in" style="width:${W + 8}px">
    <div class="tl-axis">${ticks}</div>
    ${[...Array(h1 - h0 + 1)].map((_, k) => `<span class="tl-grid" style="left:${k * PX}px"></span>`).join('')}
    ${isToday ? `<span class="tl-now" style="left:${x(nowMin)}px"><i>${pad(now.getHours())}:${pad(now.getMinutes())}</i></span>` : ''}
    ${lanes}</div></div>
    <p class="tl-legend"><span class="lg mine"></span>dans ma liste <span class="lg soon"></span>commence dans moins d’1 h</p>`;
}

function openSeance(i) {
  const s = shownSeances[i];
  if (!s) return;
  curSeance = s;
  const { film, st } = s;
  const start = st.start.slice(0, 16);
  const endD = new Date(`${start}:00`); endD.setMinutes(endD.getMinutes() + (film.minutes || 120) + 20);
  const end = isoMin(endD);
  const title = `🍿 ${film.title}`;
  const details = [`${st.cinema} · ${st.version}`, st.book].filter(Boolean).join('\n');
  const q = o => new URLSearchParams(o).toString();
  const g = x => x.replace(/[-:]/g, '') + '00';
  const going = tickets.some(k => k.id === ticketId(film, st));
  $('#cal-title').textContent = film.title;
  $('#cal-sub').textContent = `${st.cinema} · ${cap(dayLabel(start.slice(0, 10)))} à ${hm(st.start)} · ${st.version} · sortie vers ${hm(end)}`;
  $('#cal-options').innerHTML = `<button class="as-option go${going ? ' done' : ''}" type="button" data-going>${going ? '✓ Ticket créé · voir Mes films' : 'J’y vais · créer mon ticket'}</button>` + [
    st.book ? [`Réserver chez ${st.cinema}`, st.book] : null,
    ['Ajouter à Calendrier Apple', `/api/ics?${q({ t: film.title, s: start, e: end, l: st.cinema, u: st.book || '' })}`],
    ['Ajouter à Google Agenda', `https://calendar.google.com/calendar/render?${q({ action: 'TEMPLATE', text: title, dates: `${g(start)}/${g(end)}`, ctz: 'Europe/Paris', location: st.cinema, details })}`],
    ['Ajouter à Outlook', `https://outlook.live.com/calendar/0/deeplink/compose?${q({ path: '/calendar/action/compose', rru: 'addevent', subject: title, startdt: start, enddt: end, location: st.cinema, body: details })}`],
  ].filter(Boolean).map(([l, h], k) => `<a class="as-option${k === 0 && st.book ? ' red' : ''}" href="${esc(h)}"${h.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(l)}</a>`).join('');
  $('#cal').hidden = false;
}

// ---------------------------------------------------------------- tickets (« J'y vais »)
const ticketId = (film, st) => `${st.start.slice(0, 16)}|${st.cinema}|${normT(film.title)}`;
function addTicket(s) {
  const { film, st } = s;
  const id = ticketId(film, st);
  if (tickets.some(k => k.id === id)) { tab = 'films'; sub.films = 'seances'; saveNav(); $('#cal').hidden = true; closeSheets(); render(); window.scrollTo(0, 0); return; }
  const start = st.start.slice(0, 16);
  const endD = new Date(`${start}:00`); endD.setMinutes(endD.getMinutes() + (film.minutes || 120) + 20);
  const c = catalogFilm(film.title, film.original);
  tickets.push({ id, title: film.title, filmId: c?.id || '', poster: c?.poster || '', start, end: isoMin(endD), cinema: st.cinema, version: [st.version, st.format].filter(Boolean).join(' '), book: st.book || '' });
  write(KEYS.tickets, tickets); markChanged();
  $('#cal').hidden = true;
  toast('Ticket créé · onglet Mes films');
}
function untilLabel(start) {
  const mins = Math.round((new Date(`${start}:00`) - new Date()) / 60000);
  if (mins <= 0) return ['C’est', 'maintenant'];
  if (mins < 60) return ['Dans', `${mins} min`];
  const days = daysBetween(today(), start.slice(0, 10));
  if (days === 0) return ['Dans', `${Math.floor(mins / 60)} h ${pad(mins % 60)}`];
  if (days === 1) return ['C’est', 'demain'];
  return ['Dans', `${days} jours`];
}
// Partage : un lien vers une page ticket (/t/…) lisible sans l'app, les données de la séance dans le lien
const b64url = str => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ticketLink = k => `${location.origin}/t/${b64url(JSON.stringify({ t: k.title, f: k.filmId, p: k.poster, s: k.start, e: k.end, c: k.cinema, v: k.version, b: k.book }))}`;
async function shareTicket(id) {
  const k = tickets.find(x => x.id === id);
  if (!k) return;
  const url = ticketLink(k);
  const text = `On va voir ${cleanTitle(k.title)} ? ${cap(dayLabel(k.start.slice(0, 10)))} à ${hm(k.start)}, ${k.cinema}.`;
  try {
    if (navigator.share) await navigator.share({ title: cleanTitle(k.title), text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Lien copié, prêt à envoyer'); }
  } catch (e) { /* partage annulé */ }
}

// ================================================================ films guettés et reprises
// Un vieux film mis en favori est « guetté » : dès qu'il repasse dans une salle de Paris (reprise, ressortie,
// rétrospective, d'après paris-cine.info) ou qu'une ressortie nationale est annoncée, l'app prévient.
let reprises = null; // [{ title, original, year, director, imdb, cinemas }]
const repKey = t => normT(String(t || '').replace(/\(\s*(rep|ressortie)[^)]*\)/i, ''));
function showing(f) {
  if (!f) return null;
  const keys = [repKey(f.title), repKey(f.original)].filter(Boolean);
  const r = (reprises || []).find(x => (f.imdb && x.imdb === f.imdb) || ([repKey(x.title), repKey(x.original)].some(k => k && keys.includes(k)) && (!f.year || !x.year || Math.abs(x.year - f.year) <= 1)));
  if (r) return { paris: true, cinemas: r.cinemas };
  const c = (cat?.films || []).find(x => /\(\s*rep/i.test(x.title) && keys.includes(repKey(x.title)));
  return c ? { national: c } : null;
}
async function loadReprises() {
  if (!Object.values(myList).some(v => v.old)) return;
  const saved = read(KEYS.reprises);
  if (saved && Date.now() - saved.at < 6 * 3600e3) reprises = saved.films;
  else {
    try { const r = await fetch('/api/reprises'); if (r.ok) { reprises = (await r.json()).films || []; write(KEYS.reprises, { at: Date.now(), films: reprises }); } }
    catch (e) { reprises = saved?.films || null; }
  }
  // Boom : un film guetté vient de ressortir
  const seen = read(KEYS.notified) || {};
  const fresh = Object.entries(myList).filter(([id, v]) => v.old && showing({ id, ...v }) && !seen[id]);
  if (fresh.length) {
    fresh.forEach(([id]) => { seen[id] = Date.now(); });
    write(KEYS.notified, seen);
    toast(`🎬 Ça ressort : ${fresh.map(([, v]) => cleanTitle(v.title)).join(', ')}`);
  }
  render();
}
function repriseBanner() {
  const list = Object.entries(myList).filter(([, v]) => v.old).map(([id, v]) => ({ id, ...v, show: showing({ id, ...v }) })).filter(f => f.show);
  if (!list.length) return '';
  return `<div class="reprise-banner"><span class="ev-kind">Ça ressort</span>${list.map(f => `<button class="rb-item" type="button" data-film="${esc(f.id)}">${poster(f)}<span><b>${esc(cleanTitle(f.title))}</b><small>${f.show.paris ? `en salle à Paris${f.show.cinemas ? ` · ${f.show.cinemas} salle${f.show.cinemas > 1 ? 's' : ''}` : ''}` : `ressortie le ${shortDate(f.show.national.date)}`}</small></span></button>`).join('')}</div>`;
}

// ================================================================ compte et synchronisation
// Pseudo + mot de passe (empreinte scrypt côté serveur). Synchronise la liste, les tickets et les cinémas :
// le plus récent gagne ; à la connexion, ce qui est sur le téléphone et sur le compte est fusionné.
let account = null; // { pseudo, token }
let pushTimer = null;
const localData = () => ({ list: myList, tickets, cines: myCines, updated: read(KEYS.updated) || 0 });
async function api(body) {
  const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || 'Erreur, réessaie.'); e.status = r.status; throw e; }
  return d;
}
function applyData(d) {
  if (!d) return;
  myList = d.list || {}; tickets = d.tickets || [];
  if (d.cines?.length) { myCines = d.cines; write(KEYS.cines, myCines); }
  write(KEYS.list, myList); write(KEYS.tickets, tickets); write(KEYS.updated, d.updated || Date.now());
}
function merge(a, b) {
  const ids = new Set();
  return {
    list: { ...(b?.list || {}), ...(a?.list || {}) },
    tickets: [...(a?.tickets || []), ...(b?.tickets || [])].filter(k => !ids.has(k.id) && ids.add(k.id)),
    cines: a?.cines?.length ? a.cines : b?.cines || null,
    updated: Date.now(),
  };
}
function markChanged() {
  write(KEYS.updated, Date.now());
  if (!account) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 1200);
}
async function pushNow() {
  if (!account) return;
  try { await api({ action: 'push', pseudo: account.pseudo, token: account.token, data: localData() }); }
  catch (e) { if (e.status === 401) signOutLocal('Session expirée : reconnecte-toi dans Mes films.'); }
}
async function pullOnOpen() {
  if (!account) return;
  try {
    const { data } = await api({ action: 'pull', pseudo: account.pseudo, token: account.token });
    const mine = localData();
    if (data && (data.updated || 0) > (mine.updated || 0)) { applyData(data); render(); }
    else if ((mine.updated || 0) > (data?.updated || 0)) pushNow();
  } catch (e) { if (e.status === 401) signOutLocal('Session expirée : reconnecte-toi dans Mes films.'); }
}
function signOutLocal(msg) { account = null; write(KEYS.account, null); if (msg) toast(msg); }
async function authSubmit(mode, form) {
  const pseudo = form.pseudo.value.trim(), password = form.password.value;
  const msg = $('#acc-msg');
  msg.textContent = mode === 'signup' ? 'Création du compte…' : 'Connexion…';
  try {
    const res = await api({ action: mode, pseudo, password });
    account = { pseudo: res.pseudo, token: res.token }; write(KEYS.account, account);
    const merged = merge(localData(), res.data);
    applyData(merged);
    await pushNow();
    write(KEYS.onboarded, true);
    toast(mode === 'signup' ? `Bienvenue ${res.pseudo} : tout est synchronisé` : 'Connecté, tout est synchronisé');
    renderAccount(); render();
  } catch (e) { msg.textContent = e.message; }
}
let accMode = 'login';
// Premier lancement : proposer un pseudo, ou continuer sans compte (tout marche pareil, rien n'est sauvegardé en ligne)
function welcome() {
  if (account || read(KEYS.onboarded)) return;
  accMode = 'signup';
  renderAccount(true);
  $('#account-title').textContent = 'Bienvenue';
  $('#account').hidden = false; document.body.classList.add('sheet-open');
}
function renderAccount(first = false) {
  const body = $('#account-body');
  $('#account-title').textContent = first ? 'Bienvenue' : 'Mon compte';
  if (account) {
    const n = Object.keys(myList).length;
    body.innerHTML = `<div class="acc-box"><p class="acc-who">Connecté en tant que <b>${esc(account.pseudo)}</b></p>
      <p class="page-sub">Ta liste (${n} film${n > 1 ? 's' : ''}), tes ${tickets.length} ticket${tickets.length > 1 ? 's' : ''} et tes cinémas sont synchronisés sur tous les appareils où tu te connectes.</p>
      <button class="btn" type="button" data-acc-sync>Synchroniser maintenant</button>
      <button class="btn" type="button" data-acc-logout>Se déconnecter de cet appareil</button>
      <button class="link-btn center" type="button" data-acc-delete>Supprimer mon compte</button></div>`;
    return;
  }
  body.innerHTML = `<div class="acc-box">
    <div class="seg" style="grid-template-columns:repeat(2,minmax(0,1fr))"><button type="button" class="${accMode === 'login' ? 'on' : ''}" data-acc-mode="login">Se connecter</button><button type="button" class="${accMode === 'signup' ? 'on' : ''}" data-acc-mode="signup">Créer un compte</button></div>
    <form id="acc-form" class="acc-form" autocomplete="on">
      <label>Pseudo<input name="pseudo" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required minlength="3" maxlength="24" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,23}"></label>
      <label>Mot de passe<input name="password" type="password" autocomplete="${accMode === 'signup' ? 'new-password' : 'current-password'}" required minlength="8"></label>
      <button class="btn accent-red" type="submit">${accMode === 'signup' ? 'Créer mon compte' : 'Me connecter'}</button>
      <p class="page-sub" id="acc-msg" role="status"></p>
    </form>
    <button class="btn" type="button" data-acc-skip>Continuer sans compte</button>
    <p class="people">Sans compte, tout fonctionne pareil, mais ta liste, tes tickets et tes cinémas restent seulement sur ce téléphone. Tu pourras créer un compte plus tard depuis « Mes films ».</p>
    <p class="people">Pas d'e-mail demandé. Le mot de passe n'est jamais stocké en clair (seulement son empreinte). Sans e-mail, pas de récupération possible : garde-le dans ton trousseau.</p></div>`;
}

// ================================================================ Mes films
function renderFilms() {
  const now = isoMin(new Date());
  const upcoming = tickets.filter(k => k.end >= now).sort((a, b) => a.start.localeCompare(b.start));
  const past = tickets.filter(k => k.end < now).sort((a, b) => b.start.localeCompare(a.start));
  const n = Object.keys(myList).length;
  let html = head('Mes films', `<button class="acc-btn" type="button" data-open-account>${account ? esc(account.pseudo) : 'Synchroniser'}</button>`);
  html += seg('fsub', [['avoir', `À voir${n ? ` · ${n}` : ''}`], ['seances', `Mes séances${upcoming.length ? ` · ${upcoming.length}` : ''}`], ['vus', `Vus${past.length ? ` · ${past.length}` : ''}`]], sub.films);
  if (sub.films === 'seances') {
    if (!upcoming.length) return html + '<p class="empty">Aucune séance prévue.<br><small>Choisis une séance dans « Ce soir » ou dans une fiche film, puis « J’y vais ».</small></p>';
    const [k, ...rest] = upcoming;
    const [w1, w2] = untilLabel(k.start);
    html += `<article class="big-ticket">
      <div class="bt-main">
        <div class="bt-top"><span>LE FAUTEUIL ROUGE</span><span>ADMIT ONE</span></div>
        ${k.filmId ? `<button class="bt-title" type="button" data-film="${esc(k.filmId)}">${esc(cleanTitle(k.title))}</button>` : `<div class="bt-title">${esc(cleanTitle(k.title))}</div>`}
        <div class="bt-grid"><div><small>JOUR</small><b>${esc(cap(SHORT_DAYS[parseDay(k.start.slice(0, 10)).getDay()].toLowerCase()))} ${parseDay(k.start.slice(0, 10)).getDate()}</b></div><div><small>HEURE</small><b>${hm(k.start)}</b></div><div><small>VERSION</small><b>${esc(k.version || '—')}</b></div></div>
        <div class="bt-place">${esc(k.cinema)} · sortie vers ${hm(k.end)}</div>
      </div>
      <div class="bt-perf" aria-hidden="true"></div>
      <div class="bt-stub">
        <div><small>${w1.toUpperCase()}</small><b>${w2}</b></div>
        <div class="bt-actions">
          <button type="button" data-share="${esc(k.id)}" aria-label="Partager le ticket">${SHARE_ICON}</button>
          <a href="https://maps.apple.com/?q=${encodeURIComponent(k.cinema)}" target="_blank" rel="noopener" aria-label="Itinéraire vers ${esc(k.cinema)}">${PIN_ICON}</a>
          ${k.book ? `<a href="${esc(k.book)}" target="_blank" rel="noopener" aria-label="Réserver">${TICKET_ICON}</a>` : ''}
        </div>
      </div>
    </article>
    <button class="link-btn center" type="button" data-unticket="${esc(k.id)}">Retirer ce ticket</button>`;
    if (rest.length) html += `<div class="section-title">Ensuite</div>${rest.map(t => `<div class="mini-ticket"><div><b>${esc(cleanTitle(t.title))}</b><small>${esc(cap(dayLabel(t.start.slice(0, 10))))} · ${hm(t.start)} · ${esc(t.cinema)}</small></div>
      <button type="button" data-unticket="${esc(t.id)}" aria-label="Retirer ce ticket">×</button><span class="mt-stub"></span></div>`).join('')}`;
    return html;
  }
  if (sub.films === 'vus') {
    if (!past.length) return html + '<p class="empty">Tes séances passées s’afficheront ici.</p>';
    const year = String(new Date().getFullYear());
    html += `<p class="page-sub">${past.filter(k => k.start.startsWith(year)).length} séance${past.length > 1 ? 's' : ''} cette année</p>`;
    html += `<div class="posters">${past.map(k => `<button class="mini" type="button"${k.filmId ? ` data-film="${esc(k.filmId)}"` : ''}>${poster(k)}<b>${esc(cleanTitle(k.title))}</b><small>${shortDate(k.start.slice(0, 10))} · ${esc(k.cinema.replace(/^Pathé /, ''))}</small></button>`).join('')}</div>`;
    return html;
  }
  // À voir : en salle d'abord, puis par date de sortie avec le compte à rebours
  const t = today();
  const all = Object.entries(myList).map(([id, v]) => ({ id, ...v, ...(findFilm(id) || {}) }));
  const guettes = all.filter(f => f.old);
  const items = all.filter(f => !f.old).sort((a, b) => (a.date || '0').localeCompare(b.date || '0'));
  if (!all.length) return html + '<p class="empty">Ajoute des films avec l’étoile, dans leur fiche ou dans la recherche (même les vieux films : l’app te prévient s’ils ressortent).</p>';
  const inTheaters = items.filter(f => !f.date || f.date <= t), soon = items.filter(f => f.date && f.date > t);
  const row = f => {
    const days = f.date && f.date > t ? daysBetween(t, f.date) : null;
    return `<button class="list-row" type="button" data-film="${esc(f.id)}">${poster(f)}<span class="lr-body"><b>${esc(cleanTitle(f.title))}</b><small>${f.date ? (days != null ? esc(cap(dayLabel(f.date))) : `En salle depuis le ${shortDate(f.date)}`) : 'En salle'}</small></span>${days != null ? `<span class="countdown"><b>${days}</b><small>${days > 1 ? 'JOURS' : 'JOUR'}</small></span>` : ''}</button>`;
  };
  if (inTheaters.length) html += `<div class="section-title">En salle</div>${inTheaters.map(row).join('')}`;
  if (soon.length) html += `<div class="section-title">Bientôt</div>${soon.map(row).join('')}`;
  if (guettes.length) html += `<div class="section-title">Films guettés</div><p class="page-sub" style="margin:-4px 0 6px">Prévenu dès qu’ils repassent en salle à Paris.</p>${guettes.map(f => { const sh = showing(f);
    return `<button class="list-row" type="button" data-film="${esc(f.id)}">${poster(f)}<span class="lr-body"><b>${esc(cleanTitle(f.title))}</b><small>${esc([f.year, f.director].filter(Boolean).join(' · '))}</small></span>${sh ? '<span class="pill-on">En salle</span>' : '<span class="pill-off">Guetté</span>'}</button>`; }).join('')}`;
  return html;
}

// Choix des cinémas
function renderPick() {
  const list = cinemas.filter(c => pickCard === 'all' || c.cards.includes(pickCard) || myCines.includes(c.id));
  const groups = new Map();
  list.sort((a, b) => a.zip.localeCompare(b.zip)).forEach(c => { const n = +c.zip.slice(3); const g = c.zip === '75123' ? 'Paris Centre (1er – 4e)' : c.zip.startsWith('75') ? `Paris ${n === 1 ? '1er' : `${n}e`}` : c.area; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
  $('#pick-body').innerHTML = `<div style="padding:8px 16px 0"><div class="chips" style="margin:0">${[['pass', 'Carte Pathé'], ['ugc', 'UGC Illimité'], ['mk2', 'MK2'], ['all', 'Tous les cinémas']].map(([v, l]) =>
    `<button class="chip${pickCard === v ? ' on' : ''}" type="button" data-pcard="${v}">${l}</button>`).join('')}</div>
    <p class="page-sub">${myCines.length} cinéma${myCines.length > 1 ? 's' : ''} choisi${myCines.length > 1 ? 's' : ''} · 15 au plus</p>
    ${[...groups].map(([g, cs]) => `<div class="cine-group">${esc(g)}</div>${cs.map(c => `<button class="cine-row${myCines.includes(c.id) ? ' on' : ''}" type="button" data-cine="${c.id}">
      <span class="box">${myCines.includes(c.id) ? '✓' : ''}</span><b>${esc(c.name)}</b><small>${[c.cards.includes('pass') && 'Carte Pathé', c.cards.includes('ugc') && 'UGC Illimité', c.cards.includes('mk2') && 'MK2'].filter(Boolean).join(' · ')}</small></button>`).join('')}`).join('')}</div>`;
}

// ================================================================ recherche
const starBtn = f => `<button class="star-btn${myList[f.id] ? ' on' : ''}" type="button" data-mylist="${esc(f.id)}" aria-label="${myList[f.id] ? 'Retirer de ma liste' : 'Ajouter à ma liste'} : ${esc(cleanTitle(f.title))}">${myList[f.id] ? '★' : '☆'}</button>`;
function searchRow(f) {
  const t = today();
  const days = f.date && f.date > t ? daysBetween(t, f.date) : null;
  const when = f.date ? (days != null ? `Sort le ${dayLabel(f.date)} · dans ${days} jour${days > 1 ? 's' : ''}` : `En salle depuis le ${shortDate(f.date)}`) : [f.genre, f.director].filter(Boolean).join(' · ');
  return `<div class="sr-row"><button class="list-row" type="button" data-film="${esc(f.id)}">${poster(f)}<span class="lr-body"><b>${esc(cleanTitle(f.title))}</b><small>${esc(when)}</small></span></button>${starBtn(f)}</div>`;
}
function renderSearch() {
  const q = normT($('#q').value);
  const box = $('#search-body');
  if (!cat) { box.innerHTML = ''; return; }
  if (q.length < 2) {
    // Sans recherche : les grosses sorties à venir, à garder d'une étoile
    const t = today(), soon = [];
    [...new Set(cat.films.map(f => f.date))].filter(d => d > t).sort().forEach(d => { const l = filmsOn(d); l.filter(f => isBig(f, l)).forEach(f => soon.push(f)); });
    box.innerHTML = `<p class="page-sub" style="margin-top:12px">Un titre ou un réalisateur. L'étoile garde le film dans « À voir », avec le compte à rebours jusqu'à sa sortie.</p><div class="section-title">Les grosses sorties à venir</div>${soon.slice(0, 15).map(searchRow).join('')}`;
    return;
  }
  const seen = new Set(), films = [];
  [...cat.films, ...(cat.boxoffice?.rows || []), ...(cat.boxoffice_us?.rows || []), ...(cat.world?.rows || [])].forEach(f => {
    if (!f.id || seen.has(f.id)) return;
    if ([f.title, f.original, f.director].some(v => normT(v).includes(q))) { seen.add(f.id); films.push(f); }
  });
  const directors = [...new Set(cat.films.map(f => f.director).filter(d => d && normT(d).includes(q)))].slice(0, 4);
  let html = '';
  if (films.length) html += `<div class="section-title">Films</div>${films.slice(0, 20).map(searchRow).join('')}`;
  if (directors.length) html += `<div class="section-title">Réalisateurs</div>${directors.map(d => { const n = cat.films.filter(f => f.director === d).length;
    return `<button class="list-row" type="button" data-director="${esc(d)}"><span class="avatar">${esc(d.split(' ').map(w => w[0]).join('').slice(0, 2))}</span><span class="lr-body"><b>${esc(d)}</b><small>${n} film${n > 1 ? 's' : ''} cette année</small></span></button>`; }).join('')}`;
  box.innerHTML = (html || '') + `<div id="find-res"><div class="section-title">Tous les films</div>${q.length >= 3 ? skeleton(2) : '<p class="page-sub">Tape au moins 3 lettres pour chercher dans tous les films, même les vieux.</p>'}</div>`;
  if (q.length >= 3) findAll($('#q').value.trim(), films);
}
// Tous les films (Wikidata), pour les vieux films : avec un petit délai pour ne pas chercher à chaque lettre
let findTimer = null;
function findAll(query, local) {
  clearTimeout(findTimer);
  findTimer = setTimeout(async () => {
    let list = [];
    try { const r = await fetch(`/api/find?${new URLSearchParams({ q: query })}`); if (r.ok) list = (await r.json()).films || []; } catch (e) { /* hors-ligne */ }
    const box = $('#find-res');
    if (!box || $('#q').value.trim() !== query) return;
    // Pas de doublon avec les sorties de l'année déjà affichées
    const have = new Set(local.map(f => `${normT(cleanTitle(f.title))}|${yearOf(f)}`));
    list = list.filter(f => !have.has(`${normT(f.title)}|${f.year}`));
    list.forEach(f => { found[f.id] = { ...f, old: true }; });
    box.innerHTML = `<div class="section-title">Tous les films</div>${list.length ? list.map(f => { const sh = showing(f);
      return `<div class="sr-row"><button class="list-row" type="button" data-film="${esc(f.id)}">${poster(f)}<span class="lr-body"><b>${esc(f.title)}</b><small>${esc([f.year, f.director].filter(Boolean).join(' · '))}${sh ? ' · 🎬 en salle à Paris' : ''}</small></span></button>${starBtn(f)}</div>`; }).join('') : '<p class="page-sub">Rien trouvé.</p>'}`;
  }, 350);
}

// ================================================================ rendu
const saveNav = () => { write(KEYS.tab, tab); write(KEYS.sub, sub); };
function render() {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (!cat) { $('#view').innerHTML = `<p class="empty">On éteint la lumière, la séance commence…</p>${skeleton(5)}`; return; }
  $('#view').innerHTML = { affiche: renderAffiche, soir: renderSoir, films: renderFilms }[tab]();
  if (tab === 'soir') { if (myCines) fillSoir(); else loadCinemas().then(render); }
  fillScores();
}

// ---------------------------------------------------------------- fiche film immersive
// La fiche prend la couleur de l'affiche : couleur dominante (pondérée par la saturation), en fond très sombre et en accent clair.
function tintFrom(src) {
  return new Promise(res => {
    if (!src) return res(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 16; c.height = 24;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, 16, 24);
        const d = x.getImageData(0, 0, 16, 24).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const wt = (mx - mn) / 255 + 0.04;
          r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
        }
        r /= w * 255; g /= w * 255; b /= w * 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
        let h = 0, s = 0;
        if (mx !== mn) {
          const dd = mx - mn; s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
          h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h *= 60;
        }
        res({ bg: `hsl(${h.toFixed(0)} ${(Math.min(s, 0.45) * 100).toFixed(0)}% 12%)`, accent: `hsl(${h.toFixed(0)} ${(Math.max(Math.min(s, 0.75), s > 0.08 ? 0.4 : 0) * 100).toFixed(0)}% 72%)` });
      } catch (e) { res(null); }
    };
    img.onerror = () => res(null);
    img.src = `/api/img?u=${encodeURIComponent(src)}`; // même domaine : couleurs lisibles
  });
}

function ratingBlock(r) {
  const s = score(r);
  if (!s) return '<div class="rating"><p class="people">Pas encore de notes pour ce film.</p></div>';
  const row = (label, src, val, pct, url) => val == null ? '' : `<a class="r-row" href="${esc(url || '#')}" target="_blank" rel="noopener"><span class="r-l"><b>${label}</b><small>${src}</small></span><span class="r-bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span><span class="r-v">${val}</span></a>`;
  return `<div class="rating"><div class="r-top"><div class="r-big"><b>${s.txt}</b><span>/10</span></div><div class="r-word"><b>${esc(s.word)}</b>${s.agree ? `<small>${esc(s.agree)}</small>` : ''}</div></div>
    ${row('Critiques', 'Rotten Tomatoes', r.rt?.critics != null ? `${r.rt.critics} %` : null, r.rt?.critics, r.rt?.url)}
    ${row('Spectateurs', 'IMDb', r.imdb?.rating ? r.imdb.rating.toLocaleString('fr-FR') : null, (r.imdb?.rating || 0) * 10, r.imdb?.url)}
    ${row('Cinéphiles', 'Letterboxd', r.letterboxd?.rating ? r.letterboxd.rating.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : null, (r.letterboxd?.rating || 0) * 20, r.letterboxd?.url)}
    <small class="r-note">Moyenne des notes disponibles, ramenées sur 10.</small></div>`;
}

function openFilm(id) {
  const f = findFilm(id);
  if (!f) return;
  const sheet = $('#film');
  sheet.style.removeProperty('--tint-bg'); sheet.style.removeProperty('--tint-accent');
  const inList = !!myList[f.id];
  const subl = f.old ? [[f.year, f.director && `de ${f.director}`].filter(Boolean).join(' · ')] : [f.date ? `Sortie le ${dayLabel(f.date)}` : '', [f.genre, f.country, f.duration].filter(Boolean).join(' · ') || f.info || '', f.screens ? `${fmt(f.screens)} salles` : ''].filter(Boolean);
  $('#film-body').innerHTML = `
    <div class="film-hero">
      <div class="bar">
        <button class="back" type="button" data-close-film><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Retour</button>
      </div>
      <div class="trailer" id="trailer" hidden></div>
      <div class="film-top">${poster(f)}<div><h2 id="film-title">${esc(cleanTitle(f.title))}</h2>${f.original ? `<p class="orig">${esc(f.original)}</p>` : ''}<p class="meta">${subl.map(esc).join('<br>')}</p></div></div>
    </div>
    <div class="film-main">
      <div id="scores"><div class="rating">${skeleton(1)}</div></div>
      <div class="actions">
        <button class="btn accent${inList ? ' on' : ''}" type="button" data-mylist="${esc(f.id)}">${inList ? '★ Dans ma liste' : f.old ? '☆ Guetter sa ressortie' : '☆ À voir plus tard'}</button>
        <a class="btn" id="trailer-btn" href="${trailerUrl(f)}" target="_blank" rel="noopener">${PLAY_ICON}Bande-annonce</a>
      </div>
      <div id="brief"></div>
      ${f.synopsis ? `<p class="syn">${esc(f.synopsis)}</p>` : ''}
      ${f.director || f.cast?.length ? `<p class="people">${f.director ? `De ${esc(f.director)}` : ''}${f.director && f.cast?.length ? '<br>' : ''}${f.cast?.length ? `Avec ${esc(f.cast.join(', '))}` : ''}</p>` : ''}
      ${f.old ? '<div class="section-title" style="margin:6px 0 0">Où le voir à Paris</div><div class="film-seances" id="film-seances"><p class="loading" style="padding:10px 0">Recherche dans toutes les salles…</p></div>' : myCines?.length ? '<div class="section-title" style="margin:6px 0 0">Séances dans mes cinés</div><div class="film-seances" id="film-seances"><p class="loading" style="padding:10px 0">Recherche…</p></div>' : ''}
      <div class="actions">
        ${f.date && f.date > today() ? `<button class="btn" type="button" data-cal="${esc(f.id)}">${CAL_ICON}Sortie dans l’agenda</button>` : f.old ? '' : `<a class="btn" href="${showtimesUrl(f)}" target="_blank" rel="noopener">${TICKET_ICON}Autres séances</a>`}
        <a class="btn" href="https://www.allocine.fr/rechercher/?q=${encodeURIComponent(cleanTitle(f.title))}" target="_blank" rel="noopener">Allociné</a>
        ${f.old ? (f.imdb ? `<a class="btn wide" href="https://www.imdb.com/title/${esc(f.imdb)}/" target="_blank" rel="noopener">Fiche IMDb</a>` : '') : `<a class="btn wide" href="https://www.jpbox-office.com/fichfilm.php?id=${esc(f.id)}&view=2" target="_blank" rel="noopener">Chiffres JP's Box-Office</a>`}
      </div>
    </div>`;
  sheet.hidden = false;
  document.body.classList.add('sheet-open');
  $('#film-body').scrollTop = 0;
  tintFrom(f.poster).then(t => { if (t && !sheet.hidden && $('#film-title')?.textContent === cleanTitle(f.title)) { sheet.style.setProperty('--tint-bg', t.bg); sheet.style.setProperty('--tint-accent', t.accent); } });
  if (f.old || myCines?.length) {
    fetch(`/api/seances?${new URLSearchParams(f.old ? { all: '1', t: cleanTitle(f.title), o: f.original || '' } : { c: myCines.join('.'), t: cleanTitle(f.title), o: f.original || '' })}`).then(r => r.ok ? r.json() : {}).then(d => {
      const box = $('#film-seances');
      if (!box) return;
      const now = today();
      const sts = (d.film?.showtimes || []).filter(st => st.start.slice(0, 10) >= now);
      if (!sts.length && f.old && showing(f)?.paris) { box.innerHTML = `<p class="people">À l’affiche dans ${showing(f).cinemas || 'des'} salle${showing(f).cinemas > 1 ? 's' : ''} à Paris, mais les horaires n’ont pas pu être chargés. Réessaie dans un instant.</p>`; return; }
      if (!sts.length) { box.innerHTML = `<p class="people">${f.old ? (myList[f.id] ? 'Pas en salle à Paris en ce moment. Il est guetté : tu seras prévenu à sa ressortie.' : 'Pas en salle à Paris en ce moment. Mets-le en favori pour être prévenu s’il ressort.') : 'Pas de séance prévue dans tes cinémas pour l’instant.'}</p>`; return; }
      shownSeances = [];
      const days = [...new Set(sts.map(st => st.start.slice(0, 10)))].slice(0, 4);
      box.innerHTML = days.map(dd => `<div><div class="day-h">${esc(cap(dayLabel(dd)))}</div>${showtimeButtons(d.film, sts.filter(st => st.start.startsWith(dd)))}</div>`).join('') + '<p class="people">Touche une séance pour « J’y vais », réserver ou l’ajouter à l’agenda.</p>';
    }).catch(() => { const box = $('#film-seances'); if (box) box.innerHTML = '<p class="people">Séances indisponibles.</p>'; });
  }
  getRatings(f).then(r => {
    const box = $('#scores');
    if (!box || sheet.hidden) return;
    box.innerHTML = ratingBlock(r);
    const brief = $('#brief');
    if (brief && r?.about?.text) brief.innerHTML = `<div class="brief-box"><span class="ev-kind">En bref</span><p>${esc(r.about.text)}</p><a href="${esc(r.about.url)}" target="_blank" rel="noopener">Wikipédia ›</a></div>`;
    // Bande-annonce intégrée quand Wikidata la connaît : lecture automatique sans le son
    if (r?.trailer && /^[\w-]{11}$/.test(r.trailer)) {
      const tr = $('#trailer');
      tr.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${r.trailer}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1" title="Bande-annonce de ${esc(cleanTitle(f.title))}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      tr.hidden = false;
      $('#trailer-btn')?.remove();
    }
  });
}
function closeSheets() {
  ['#film', '#search', '#pick'].forEach(s => { $(s).hidden = true; });
  $('#trailer') && ($('#trailer').innerHTML = '');
  document.body.classList.remove('sheet-open');
}
function closeFilm() {
  $('#film').hidden = true;
  $('#film-body').innerHTML = ''; // coupe la bande-annonce
  if ($('#search').hidden) document.body.classList.remove('sheet-open');
  render();
}

function toggleMyList(id) {
  const f = findFilm(id);
  if (!f) return;
  if (myList[id]) { delete myList[id]; toast('Retiré de ma liste'); }
  else if (f.old) { myList[id] = { title: f.title, original: f.original || '', year: f.year || null, director: f.director || '', imdb: f.imdb || '', poster: f.poster || '', old: true }; toast(showing(f) ? '🎬 Bonne nouvelle : il est en salle à Paris !' : 'Guetté : tu seras prévenu s’il ressort'); if (!reprises) loadReprises(); }
  else { myList[id] = { title: f.title, date: f.date || '', poster: f.poster || '' }; toast('Ajouté à « À voir »'); }
  write(KEYS.list, myList); markChanged();
  const b = document.querySelector(`[data-mylist="${CSS.escape(id)}"]`);
  if (b) {
    b.classList.toggle('on', !!myList[id]);
    b.textContent = b.classList.contains('star-btn') ? (myList[id] ? '★' : '☆') : myList[id] ? '★ Dans ma liste' : '☆ À voir plus tard';
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(12);
  }
}

// ---------------------------------------------------------------- agenda (date de sortie)
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
    if (r.ok) {
      const c = await r.json();
      if (c.films?.length) {
        // Une section vide côté serveur (source en panne) : on garde celle de la dernière fois
        const has = v => Array.isArray(v) ? v.length : v?.rows?.length;
        ['boxoffice', 'boxoffice_prev', 'boxoffice_us', 'world', 'streaming'].forEach(k => { if (!has(c[k]) && has(cat?.[k])) c[k] = cat[k]; });
        cat = c; write(KEYS.catalog, c);
      }
    }
  } catch (e) { /* hors-ligne : on garde le programme en mémoire */ }
  render();
  if (!$('#search').hidden) renderSearch();
}

cat = read(KEYS.catalog);
tab = read(KEYS.tab) || 'affiche';
sub = { affiche: 'semaine', films: 'avoir', ...(read(KEYS.sub) || {}) };
// anciens onglets (avant la V2)
if (tab === 'week') tab = 'affiche';
if (tab === 'calendar') { tab = 'affiche'; sub.affiche = 'avenir'; }
if (tab === 'boxoffice') { tab = 'affiche'; sub.affiche = 'bo'; }
if (tab === 'cines') tab = 'soir';
if (!['affiche', 'soir', 'films'].includes(tab)) tab = 'affiche';
calView = read(KEYS.view) === 'month' ? 'month' : 'year';
filter = read(KEYS.filter) || 'big';
myList = read(KEYS.list) || {};
tickets = read(KEYS.tickets) || [];
myCines = read(KEYS.cines);
cinemas = read(KEYS.cinemas) || [];
ratingsCache = read(KEYS.ratings) || {};
account = read(KEYS.account);

$('.tabs').addEventListener('click', ev => {
  const b = ev.target.closest('.tab');
  if (!b) return;
  tab = b.dataset.tab; saveNav(); render(); window.scrollTo(0, 0);
});
document.addEventListener('click', ev => {
  const t = ev.target;
  if (t.closest('[data-going]')) { if (curSeance) addTicket(curSeance); return; }
  const cal = t.closest('[data-cal]'); if (cal) { openCalSheet(cal.dataset.cal); return; }
  const ml = t.closest('[data-mylist]'); if (ml) { toggleMyList(ml.dataset.mylist); return; }
  if (t.closest('[data-close-film]')) { closeFilm(); return; }
  if (t.closest('[data-close-search]')) { $('#search').hidden = true; if ($('#film').hidden) document.body.classList.remove('sheet-open'); return; }
  if (t.closest('#cal [data-close]') || t.closest('.as-option')) { setTimeout(() => { $('#cal').hidden = true; }, 0); return; }
  const film = t.closest('[data-film]'); if (film && film.dataset.film) { openFilm(film.dataset.film); return; }
  const dir = t.closest('[data-director]'); if (dir) { $('#q').value = dir.dataset.director; renderSearch(); return; }
  const sb = t.closest('[data-sub]'); if (sb) { sub.affiche = sb.dataset.sub; saveNav(); render(); return; }
  const fs = t.closest('[data-fsub]'); if (fs) { sub.films = fs.dataset.fsub; saveNav(); render(); return; }
  const v = t.closest('[data-view]'); if (v) { calView = v.dataset.view; write(KEYS.view, calView); render(); return; }
  const f = t.closest('[data-filter]'); if (f) { filter = f.dataset.filter; write(KEYS.filter, filter); render(); return; }
  const d = t.closest('[data-day]'); if (d) { selDay = selDay === d.dataset.day ? null : d.dataset.day; render(); return; }
  const m = t.closest('[data-month]'); if (m) { monthOffset += +m.dataset.month; selDay = null; render(); return; }
  const bo = t.closest('[data-bo]'); if (bo) { boView = bo.dataset.bo; render(); return; }
  const se = t.closest('[data-seance]'); if (se) { openSeance(+se.dataset.seance); return; }
  const sd = t.closest('[data-sday]'); if (sd) { seanceDate = sd.dataset.sday; render(); return; }
  const sf = t.closest('[data-sfilter]'); if (sf) { seanceFilter = sf.dataset.sfilter; render(); return; }
  const sh = t.closest('[data-share]'); if (sh) { shareTicket(sh.dataset.share); return; }
  if (t.closest('[data-open-account]')) { renderAccount(); $('#account').hidden = false; document.body.classList.add('sheet-open'); return; }
  if (t.closest('[data-close-account]')) { write(KEYS.onboarded, true); $('#account').hidden = true; document.body.classList.remove('sheet-open'); render(); return; }
  if (t.closest('[data-acc-skip]')) { write(KEYS.onboarded, true); $('#account').hidden = true; document.body.classList.remove('sheet-open'); render(); return; }
  const am = t.closest('[data-acc-mode]'); if (am) { accMode = am.dataset.accMode; renderAccount(); return; }
  if (t.closest('[data-acc-sync]')) { pushNow().then(pullOnOpen).then(() => toast('Synchronisé')); return; }
  if (t.closest('[data-acc-delete]')) {
    const pw = prompt(`Supprimer définitivement le compte ${account.pseudo} ? Tes films restent sur ce téléphone.\nMot de passe :`);
    if (pw) api({ action: 'delete', pseudo: account.pseudo, password: pw }).then(() => { signOutLocal(); renderAccount(); render(); toast('Compte supprimé'); }).catch(e => toast(e.message));
    return;
  }
  if (t.closest('[data-acc-logout]')) { const a = account; signOutLocal(); api({ action: 'logout', pseudo: a.pseudo, token: a.token }).catch(() => {}); renderAccount(); render(); toast('Déconnecté de cet appareil'); return; }
  const ut = t.closest('[data-unticket]'); if (ut) { tickets = tickets.filter(k => k.id !== ut.dataset.unticket); write(KEYS.tickets, tickets); markChanged(); toast('Ticket retiré'); render(); return; }
  if (t.closest('[data-open-pick]')) { loadCinemas().then(() => { renderPick(); $('#pick').hidden = false; document.body.classList.add('sheet-open'); }); return; }
  if (t.closest('[data-close-pick]')) { $('#pick').hidden = true; document.body.classList.remove('sheet-open'); render(); return; }
  const pc = t.closest('[data-pcard]'); if (pc) { pickCard = pc.dataset.pcard; renderPick(); return; }
  const ci = t.closest('[data-cine]'); if (ci) {
    const id = +ci.dataset.cine;
    if (myCines.includes(id)) myCines = myCines.filter(x => x !== id);
    else if (myCines.length < 15) myCines = [...myCines, id];
    else toast('15 cinémas au plus');
    write(KEYS.cines, myCines); markChanged(); renderPick(); return;
  }
});
$('#open-search').addEventListener('click', () => { $('#search').hidden = false; document.body.classList.add('sheet-open'); renderSearch(); setTimeout(() => $('#q').focus(), 50); });
$('#q').addEventListener('input', renderSearch);
document.addEventListener('submit', ev => { if (ev.target.id === 'acc-form') { ev.preventDefault(); authSubmit(accMode, ev.target); } });

// Par défaut, le mois s'ouvre sur le mercredi de la semaine
selDay = featuredWednesday();
render();

// Lien depuis la newsletter : ?film=<id> ouvre la fiche, &add=1 l'ajoute à « À voir »
const deep = new URLSearchParams(location.search);
function openDeepLink() {
  const id = deep.get('film');
  if (!id || !cat || !findFilm(id)) return false;
  if (deep.get('add') === '1' && !myList[id]) toggleMyList(id);
  openFilm(id);
  history.replaceState(null, '', location.pathname);
  return true;
}
const deepDone = openDeepLink();
pullOnOpen();
loadReprises();
if (!deepDone) welcome();
load().then(() => { if (!deepDone) openDeepLink(); });

// Préchargement des séances dès l'ouverture : « Ce soir » est prêt quand on y arrive
loadCinemas().then(() => { if (myCines?.length) loadDay(today()).catch(() => {}); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
