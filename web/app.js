// Le Fauteuil Rouge — app.
// Données : /api/catalog (sorties France sur l'année + box-office de la semaine, d'après JP's Box-Office),
// gardées sur le téléphone pour l'ouverture instantanée et le hors-ligne.
const KEYS = { catalog: 'lfr_catalog', tab: 'lfr_tab', filter: 'lfr_filter' };
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const BIG_SCREENS = 250; // au-delà : « grosse sortie »

let cat = null;
let tab = 'week';
let filter = 'big';      // calendrier : big | all
let boWeek = 'last';     // box-office : last | prev

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
const short = n => n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n);

// Semaine ciné « en cours » : du mercredi au mardi. Lundi et mardi, on regarde déjà le mercredi qui vient.
function featuredWednesday() {
  const d = new Date();
  const wd = d.getDay();
  const back = (wd - 3 + 7) % 7;               // jours depuis le dernier mercredi
  if (wd === 1 || wd === 2) d.setDate(d.getDate() + (3 - wd));
  else d.setDate(d.getDate() - back);
  return isoDay(d);
}

// Les films d'une date, les plus gros d'abord ; « gros » = beaucoup de salles (ou les 3 premiers si inconnu)
function filmsOn(date) {
  return cat.films.filter(f => f.date === date).sort((a, b) => (b.screens || 0) - (a.screens || 0));
}
function isBig(f, list) {
  if (f.screens != null) return f.screens >= BIG_SCREENS;
  const known = list.some(x => x.screens != null);
  return !known && list.indexOf(f) < 3;
}

// ---------------------------------------------------------------- composants
function poster(f, cls = 'poster') {
  return f.poster ? `<img class="${cls}" src="${esc(f.poster)}" alt="" loading="lazy">` : `<div class="${cls} ph">${esc((f.title || '?')[0])}</div>`;
}

function ticket(f) {
  const meta = [f.genre, f.country, f.duration].filter(Boolean).join(' · ');
  return `<button class="ticket" type="button" data-film="${esc(f.id)}">
    ${poster(f)}
    <div class="t-body">
      <div class="badges">${f.screens ? `<span class="badge">${fmt(f.screens)} salles</span>` : ''}</div>
      <div class="t-title">${esc(f.title)}</div>
      ${f.original ? `<div class="t-orig">${esc(f.original)}</div>` : ''}
      ${meta ? `<div class="t-meta">${esc(meta)}</div>` : ''}
      ${f.director || f.cast?.length ? `<div class="t-people">${f.director ? `De ${esc(f.director)}` : ''}${f.director && f.cast?.length ? ' · ' : ''}${f.cast?.length ? `Avec ${esc(f.cast.slice(0, 3).join(', '))}` : ''}</div>` : ''}
      ${f.synopsis ? `<div class="t-syn">${esc(f.synopsis)}</div>` : ''}
    </div>
  </button>`;
}

function mini(f) {
  return `<button class="mini" type="button" data-film="${esc(f.id)}">${poster(f)}<b>${esc(f.title)}</b>${f.screens ? `<small>${fmt(f.screens)} salles</small>` : ''}</button>`;
}

function boRow(r) {
  const move = r.isNew ? '<small class="new">NEW</small>' : r.move ? `<small class="${r.move > 0 ? 'up' : 'down'}">${r.move > 0 ? '▲' : '▼'}${Math.abs(r.move)}</small>` : '<small>=</small>';
  return `<div class="bo">
    <div class="rk">${r.rank}${move}</div>
    ${poster(r)}
    <div class="name"><b>${esc(r.title)}</b><small>${esc(r.distributor || '')}${r.weeks ? `${r.distributor ? ' · ' : ''}${r.weeks === 1 ? '1re semaine' : `${r.weeks}e semaine`}` : ''}</small></div>
    <div class="num"><b>${fmt(r.entries)}</b><small class="${r.change && r.change.startsWith('-') ? 'down' : ''}">${r.change ? esc(r.change) : r.weeks > 1 ? '' : 'entrées'}</small><br><small>Total ${short(r.total || 0)}</small></div>
  </div>`;
}

function marquee(kicker, title) {
  return `<header class="marquee"><div class="kicker">${esc(kicker)}</div><h1>${esc(title)}</h1><div class="bulbs"></div></header>`;
}

// ---------------------------------------------------------------- pages
function renderWeek() {
  const wed = featuredWednesday();
  const list = filmsOn(wed);
  const big = list.filter(f => isBig(f, list)), rest = list.filter(f => !isBig(f, list));
  let html = marquee(`Sorties du ${dayLabel(wed)}`, 'Cette semaine');
  html += big.length ? big.map(ticket).join('') : list.slice(0, 3).map(ticket).join('');
  const others = big.length ? rest : list.slice(3);
  if (others.length) html += `<div class="section"><h2>Aussi en salles</h2><span>${others.length} film${others.length > 1 ? 's' : ''}</span></div><div class="posters">${others.map(mini).join('')}</div>`;
  if (!list.length) html += '<p class="empty">Pas encore de sorties annoncées pour cette semaine.</p>';
  // Les 3 semaines suivantes : les grosses sorties
  for (let i = 1; i <= 3; i++) {
    const d = addDays(wed, 7 * i), l = filmsOn(d);
    if (!l.length) continue;
    const top = l.filter(f => isBig(f, l));
    html += `<div class="section"><h2>${cap(dayLabel(d))}</h2><span>${l.length} sortie${l.length > 1 ? 's' : ''}</span></div>
      <div class="posters">${(top.length ? top : l.slice(0, 4)).map(mini).join('')}</div>`;
  }
  const bo = cat.boxoffice;
  if (bo?.rows?.length) {
    html += `<div class="section"><h2>Box-office France</h2><a href="#" data-goto="boxoffice">Tout le top ›</a></div>
      <div class="bo-top3">${bo.rows.slice(0, 5).map(boRow).join('')}</div>`;
  }
  return html + source();
}

function renderCalendar() {
  const from = addDays(featuredWednesday(), -7);
  const dates = [...new Set(cat.films.map(f => f.date))].filter(d => d >= from).sort();
  let html = marquee('Toute l\'année', 'Calendrier des sorties');
  html += `<div class="filters" role="group" aria-label="Filtrer">
    <button class="chip${filter === 'big' ? ' on' : ''}" type="button" data-filter="big">Grosses sorties</button>
    <button class="chip${filter === 'all' ? ' on' : ''}" type="button" data-filter="all">Toutes les sorties</button>
  </div>`;
  let month = '';
  const thisWed = featuredWednesday();
  dates.forEach(d => {
    const l = filmsOn(d);
    const shown = filter === 'big' ? (l.filter(f => isBig(f, l)).length ? l.filter(f => isBig(f, l)) : l.slice(0, 2)) : l;
    if (!shown.length) return;
    const m = MONTHS[parseDay(d).getMonth()] + ' ' + parseDay(d).getFullYear();
    if (m !== month) { month = m; html += `<div class="month">${esc(cap(m))}</div>`; }
    html += `<div class="wk"><b>${esc(cap(dayLabel(d)))}</b>${d === thisWed ? '<span class="today">Cette semaine</span>' : ''}${filter === 'big' && l.length > shown.length ? `<span>+ ${l.length - shown.length} autre${l.length - shown.length > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="posters">${shown.map(mini).join('')}</div>`;
  });
  return html + source();
}

function renderBoxOffice() {
  const bo = boWeek === 'prev' ? cat.boxoffice_prev : cat.boxoffice;
  let html = marquee('France', 'Box-office');
  html += `<div class="seg" role="tablist">
    <button type="button" class="${boWeek === 'last' ? 'on' : ''}" data-bo="last">Cette semaine</button>
    <button type="button" class="${boWeek === 'prev' ? 'on' : ''}" data-bo="prev">Semaine d'avant</button>
  </div>`;
  if (!bo?.rows?.length) return html + '<p class="empty">Box-office indisponible pour le moment.</p>';
  const label = (bo.label || '').replace(/^Semaine (\d+) - DU /i, 'Semaine $1 · du ').replace(/\((\d) Jours?\)/i, '');
  html += `<p class="bo-head">${esc(label.toLowerCase().replace(/^s/, 'S'))}${bo.days && bo.days < 7 ? ` · ${bo.days} premiers jours` : ''}</p>`;
  return html + `<div class="bo-top3">${bo.rows.map(boRow).join('')}</div>` + source();
}

const source = () => `<p class="source">Données : JP's Box-Office · mises à jour ${cat.generated_at ? new Date(cat.generated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>`;

function render() {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (!cat) { $('#view').innerHTML = '<p class="empty">On éteint la lumière, la séance commence…</p>'; return; }
  $('#view').innerHTML = { week: renderWeek, calendar: renderCalendar, boxoffice: renderBoxOffice }[tab]();
}

// ---------------------------------------------------------------- fiche film
function openFilm(id) {
  const f = cat.films.find(x => x.id === id) || [...(cat.boxoffice?.rows || []), ...(cat.boxoffice_prev?.rows || [])].find(x => x.id === id);
  if (!f) return;
  const meta = [f.genre, f.country, f.duration].filter(Boolean).join(' · ') || f.info || '';
  const ics = f.date ? `/api/ics?t=${encodeURIComponent(f.title)}&d=${f.date}` : '';
  $('#film-body').innerHTML = `
    <div class="film-top">${poster(f)}
      <div>
        <h2 id="film-title">${esc(f.title)}</h2>
        ${f.original ? `<p class="t-orig" style="margin-top:4px">${esc(f.original)}</p>` : ''}
        ${f.date ? `<p class="t-meta" style="margin-top:10px">Sortie le ${esc(dayLabel(f.date))}</p>` : ''}
        ${meta ? `<p class="t-meta" style="margin-top:4px">${esc(meta)}</p>` : ''}
        ${f.director ? `<p class="t-people" style="margin-top:8px">De ${esc(f.director)}</p>` : ''}
        ${f.cast?.length ? `<p class="t-people">Avec ${esc(f.cast.join(', '))}</p>` : ''}
        ${f.screens ? `<p class="badges" style="margin-top:10px"><span class="badge">${fmt(f.screens)} salles</span></p>` : ''}
      </div>
    </div>
    ${f.synopsis ? `<p class="film-syn">${esc(f.synopsis)}</p>` : ''}
    <div class="actions">
      ${ics ? `<a class="btn primary" href="${ics}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>Ajouter la sortie à mon agenda</a>` : ''}
      <a class="btn" href="https://www.jpbox-office.com/fichfilm.php?id=${esc(f.id)}&view=2" target="_blank" rel="noopener">Fiche complète</a>
    </div>`;
  $('#film').hidden = false;
  document.body.classList.add('sheet-open');
}
function closeFilm() { $('#film').hidden = true; document.body.classList.remove('sheet-open'); }

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
filter = read(KEYS.filter) || 'big';
$('.tabs').addEventListener('click', ev => {
  const b = ev.target.closest('.tab');
  if (!b) return;
  tab = b.dataset.tab; write(KEYS.tab, tab); render(); window.scrollTo(0, 0);
});
$('#view').addEventListener('click', ev => {
  const film = ev.target.closest('[data-film]');
  if (film) { openFilm(film.dataset.film); return; }
  const f = ev.target.closest('[data-filter]');
  if (f) { filter = f.dataset.filter; write(KEYS.filter, filter); render(); return; }
  const b = ev.target.closest('[data-bo]');
  if (b) { boWeek = b.dataset.bo; render(); return; }
  const g = ev.target.closest('[data-goto]');
  if (g) { ev.preventDefault(); tab = g.dataset.goto; write(KEYS.tab, tab); render(); window.scrollTo(0, 0); }
});
$('#film').addEventListener('click', ev => { if (ev.target.closest('[data-close]')) closeFilm(); });
render();
load();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
