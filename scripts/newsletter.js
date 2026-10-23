// Newsletter du lundi : la sortie phare de mercredi (avec ses notes), les autres sorties, les grosses
// sorties des 3 semaines suivantes, le box-office France / États-Unis / monde et la séance de rattrapage.
// Données : l'API de l'app (sinon JP's Box-Office en direct).
// Usage : node scripts/newsletter.js [--dry-run]   (dry-run : écrit out/newsletter.html sans envoyer)
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { catalog } = require('../lib/jpbox');
const { weeklyPicks } = require('../lib/reco');
const { ratings } = require('../lib/ratings');

const APP_URL = process.env.APP_URL || 'https://lefauteuilrouge.vercel.app';
// Liens vers l'app : ?film=<id> ouvre la fiche, &add=1 l'ajoute aussi à « À voir »
const filmUrl = (f, add) => `${APP_URL}/?film=${encodeURIComponent(f.id)}${add ? '&add=1' : ''}`;
const LOGOS = { Netflix: 'netflix', 'Prime Video': 'prime', 'Apple TV': 'appletv', 'Disney+': 'disney', 'Canal+': 'canal' };
const DRY = process.argv.includes('--dry-run');
const BIG_SCREENS = 250;
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '–' : n.toLocaleString('fr-FR').replace(/ /g, ' ');
const short = n => n == null ? '–' : n >= 1e9 ? `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Md` : n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n);
const day = s => { const d = new Date(`${s}T12:00:00Z`); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clean = t => String(t || '').replace(/\s*\(\d{4}\)\s*$/, '');

async function loadCatalog() {
  try {
    const r = await fetch(`${APP_URL}/api/catalog`);
    if (r.ok) { const c = await r.json(); if (c.films?.length) return c; }
  } catch (e) { /* l'app ne répond pas : on lit la source directement */ }
  return catalog();
}

// Le mercredi qui suit (la newsletter part le lundi)
function nextWednesday(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

// DA : papier, encre, rouge fauteuil ; Instrument Serif si la messagerie charge la police, sinon Georgia
const SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif";
const SANS = "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const PAPER = '#f4f1ea', INK = '#141414', RED = '#d7262e', GREY = '#6b665f', LINE = '#d6d0c4';

const sectionTitle = (t, sub = '') => `<tr><td style="padding:24px 24px 6px;border-top:1px solid ${LINE}">
  <div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${RED}">${t}</div>
  ${sub ? `<div style="font-family:${SANS};font-size:12.5px;color:${GREY};margin-top:3px">${sub}</div>` : ''}</td></tr>`;

function notesLine(r) {
  if (!r?.found) return '';
  const parts = [];
  if (r.imdb?.rating) parts.push(`IMDb <b>${r.imdb.rating.toLocaleString('fr-FR')}</b>`);
  if (r.rt?.critics != null) parts.push(`Rotten Tomatoes <b>${r.rt.critics} %</b>`);
  if (r.letterboxd?.rating) parts.push(`Letterboxd <b>${r.letterboxd.rating.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</b>`);
  return parts.join(' · ');
}

function featured(f, r) {
  const meta = [f.genre, f.country, f.duration, f.screens ? `${fmt(f.screens)} salles` : ''].filter(Boolean).join(' · ');
  const people = [f.director ? `De ${f.director}` : '', f.cast?.length ? `avec ${f.cast.slice(0, 3).join(', ')}` : ''].filter(Boolean).join(', ');
  const notes = notesLine(r);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="140" style="vertical-align:top;padding:4px 0">${f.poster ? `<a href="${filmUrl(f)}"><img src="${esc(f.poster)}" width="130" style="display:block;width:130px;border-radius:8px;border:0" alt=""></a>` : ''}</td>
    <td style="vertical-align:top;padding:0 0 0 14px;font-family:${SANS}">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${RED}">La sortie de la semaine</div>
      <a href="${filmUrl(f)}" style="text-decoration:none"><div style="font-family:${SERIF};font-size:34px;line-height:1;color:${INK};margin-top:6px">${esc(clean(f.title))}</div></a>
      ${meta ? `<div style="font-size:13px;color:${GREY};margin-top:6px">${esc(meta)}</div>` : ''}
      ${notes ? `<div style="font-size:13px;color:${INK};margin-top:4px">${notes}</div>` : ''}
      ${people ? `<div style="font-size:12.5px;color:${GREY};margin-top:4px">${esc(people)}</div>` : ''}
      ${r?.about?.text ? `<div style="font-size:13px;line-height:1.5;color:${INK};margin-top:8px;padding:8px 10px;background:#fffdf8;border-radius:8px"><b style="font-size:10px;letter-spacing:1.5px;color:${RED}">EN BREF</b><br>${esc(r.about.text)}</div>` : ''}
      ${f.synopsis ? `<div style="font-size:13.5px;line-height:1.5;color:#2a2826;margin-top:8px">${esc(f.synopsis.length > 260 ? f.synopsis.slice(0, 257).replace(/\s\S*$/, '') + '…' : f.synopsis)}</div>` : ''}
      <div style="margin-top:12px"><a href="${filmUrl(f, true)}" style="display:inline-block;font-size:12.5px;font-weight:700;color:#fff;background:${RED};border-radius:8px;padding:7px 12px;text-decoration:none">☆ À voir</a>&nbsp;&nbsp;<a href="${filmUrl(f)}" style="font-size:12.5px;font-weight:700;color:${INK}">Séances et fiche ›</a>&nbsp;&nbsp;<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(clean(f.title) + ' bande annonce VF')}" style="font-size:12.5px;font-weight:700;color:${RED}">▶ Bande-annonce</a></div>
    </td></tr></table>`;
}

// Les autres sorties du mercredi, en « tickets » (souche rouge pour les grosses)
function ticketRow(f, big, r) {
  const notes = notesLine(r);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;border:1px solid ${LINE};border-radius:10px;background:#fffdf8"><tr>
    <td width="50" style="padding:0">${f.poster ? `<a href="${filmUrl(f)}"><img src="${esc(f.poster)}" width="50" style="display:block;width:50px;border-radius:10px 0 0 10px;border:0" alt=""></a>` : ''}</td>
    <td style="padding:8px 12px;font-family:${SANS}">
      <a href="${filmUrl(f)}" style="text-decoration:none"><div style="font-family:${SERIF};font-size:20px;line-height:1.1;color:${INK}">${esc(clean(f.title))}</div></a>
      <div style="font-size:12px;color:${GREY};margin-top:2px">${esc([f.genre, f.director || f.cast?.[0], f.duration].filter(Boolean).join(' · '))} · <a href="${filmUrl(f, true)}" style="color:${RED};font-weight:700;text-decoration:none">☆ À voir</a></div>
      ${notes ? `<div style="font-size:11.5px;color:${INK};margin-top:2px">${notes}</div>` : ''}
    </td>
    <td width="58" style="border-left:1.5px dashed ${big ? '#fffdf8' : LINE};background:${big ? RED : '#fffdf8'};color:${big ? '#fff' : GREY};text-align:center;font-family:${SANS};font-size:10.5px;font-weight:700;border-radius:0 10px 10px 0;line-height:1.2">${f.screens ? `${fmt(f.screens)}<br>salles` : big ? 'Grosse<br>sortie' : '—'}</td>
  </tr></table>`;
}

function posterStrip(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${list.slice(0, 4).map(f => `
    <td width="25%" style="padding:4px;vertical-align:top;font-family:${SANS}">
      ${f.poster ? `<a href="${filmUrl(f)}"><img src="${esc(f.poster)}" width="120" style="display:block;width:100%;max-width:120px;border-radius:6px;border:0" alt=""></a>` : ''}
      <a href="${filmUrl(f)}" style="text-decoration:none"><div style="font-size:12.5px;font-weight:600;color:${INK};margin-top:6px;line-height:1.25">${esc(clean(f.title))}</div></a>
      ${f.screens ? `<div style="font-size:11px;color:${GREY}">${fmt(f.screens)} salles</div>` : f.genre ? `<div style="font-size:11px;color:${GREY}">${esc(f.genre)}</div>` : ''}
    </td>`).join('')}${'<td width="25%"></td>'.repeat(Math.max(0, 4 - list.length))}</tr></table>`;
}

function boRows(rows, value) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${SANS}">${rows.map(r => `
    <tr><td width="30" style="padding:7px 0;border-bottom:1px solid ${LINE};font-family:${SERIF};font-size:20px;color:${r.rank === 1 ? RED : GREY}">${r.rank}</td>
      <td style="padding:7px 6px;border-bottom:1px solid ${LINE};font-size:13.5px;color:${INK}">${esc(clean(r.title))}${r.isNew ? ` <span style="font-size:9.5px;font-weight:700;color:#fff;background:${RED};border-radius:3px;padding:1px 4px;vertical-align:middle">NOUVEAU</span>` : ''}</td>
      <td style="padding:7px 0;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap;font-size:13px;color:${INK}">${value(r)}</td></tr>`).join('')}</table>`;
}

function recoSection(picks) {
  if (!picks?.length) return '';
  return sectionTitle('La séance de rattrapage', '3 films à voir, piochés dans les grands classements') + `<tr><td style="padding:6px 20px 8px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${picks.map(f => `
      <td width="33%" style="padding:4px;vertical-align:top;font-family:${SANS}">
        ${f.poster ? `<a href="${esc(f.link)}"><img src="${esc(f.poster)}" width="160" style="display:block;width:100%;max-width:160px;border-radius:6px" alt=""></a>` : ''}
        <a href="${esc(f.link)}" style="text-decoration:none"><div style="font-family:${SERIF};font-size:19px;line-height:1.1;color:${INK};margin-top:6px">${esc(f.title)}</div></a>
        <div style="font-size:11.5px;color:${GREY};margin-top:2px">${f.year} · ${esc(f.director)}</div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${RED};margin-top:4px">${esc(f.sourceLabels.join(' · '))}</div>
      </td>`).join('')}</tr></table></td></tr>`;
}

function render(cat, wed, picks = [], notes = {}) {
  const on = d => cat.films.filter(f => f.date === d).sort((a, b) => (b.screens || 0) - (a.screens || 0));
  const bigOf = l => { const b = l.filter(f => (f.screens || 0) >= BIG_SCREENS); return b.length ? b : l.slice(0, 3); };
  const thisWeek = on(wed), big = bigOf(thisWeek);
  const wedDate = new Date(`${wed}T12:00:00Z`);
  let body = sectionTitle(`Mercredi ${wedDate.getUTCDate()} ${MONTHS[wedDate.getUTCMonth()]} au cinéma`, `${thisWeek.length} sortie${thisWeek.length > 1 ? 's' : ''}`);
  body += `<tr><td style="padding:8px 24px 4px">${thisWeek.length ? featured(thisWeek[0], notes[thisWeek[0].id])
    + thisWeek.slice(1).map(f => ticketRow(f, big.includes(f), notes[f.id])).join('') : `<p style="font-family:${SANS};color:${GREY}">Pas encore de sorties annoncées.</p>`}</td></tr>`;

  const next = [1, 2, 3].map(i => addDays(wed, 7 * i)).map(d => ({ d, l: on(d) })).filter(x => x.l.length);
  if (next.length) {
    body += sectionTitle('Les 3 semaines suivantes');
    body += next.map(({ d, l }) => `<tr><td style="padding:8px 20px 4px"><div style="font-family:${SERIF};font-size:22px;color:${INK};padding:0 4px 4px">${esc(cap(day(d)))} <span style="font-family:${SANS};font-size:12px;color:${GREY}">· ${l.length} sortie${l.length > 1 ? 's' : ''}</span></div>${posterStrip(bigOf(l))}</td></tr>`).join('');
  }

  const fr = cat.boxoffice?.rows?.length ? cat.boxoffice : cat.boxoffice_prev;
  if (fr?.rows?.length) {
    const label = (fr.label || '').replace(/^Semaine \d+ - DU /i, 'du ').toLowerCase();
    body += sectionTitle('Box-office France', `${esc(label)}${fr.days && fr.days < 7 ? ` · ${fr.days} premiers jours` : ''}`)
      + `<tr><td style="padding:6px 24px">${boRows(fr.rows.slice(0, 10), r => `<b>${fmt(r.entries)}</b> <span style="color:${GREY};font-size:11.5px">· total ${short(r.total)}</span>`)}</td></tr>`;
  }
  const us = cat.boxoffice_us, world = cat.world;
  if (us?.rows?.length || world?.rows?.length) {
    body += sectionTitle('Ailleurs dans le monde', 'Week-end aux États-Unis · cumul mondial de l\'année');
    body += `<tr><td style="padding:6px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" style="vertical-align:top;padding-right:10px">${us?.rows?.length ? `<div style="font-family:${SANS};font-size:11px;font-weight:700;color:${GREY};margin-bottom:2px">ÉTATS-UNIS</div>${boRows(us.rows.slice(0, 5), r => `${short(r.entries)} $`)}` : ''}</td>
      <td width="50%" style="vertical-align:top;padding-left:10px">${world?.rows?.length ? `<div style="font-family:${SANS};font-size:11px;font-weight:700;color:${GREY};margin-bottom:2px">MONDE ${world.year}</div>${boRows(world.rows.slice(0, 5), r => `${short(r.world)} $`)}` : ''}</td>
    </tr></table></td></tr>`;
  }
  // Streaming : sorties des 10 prochains jours ; festivals et cérémonies des 30 prochains jours
  const today = new Date().toISOString().slice(0, 10);
  const stream = (cat.streaming || []).filter(x => x.date >= today && x.date <= addDays(today, 10));
  if (stream.length) {
    body += sectionTitle('En streaming', 'Films originaux des plateformes') + `<tr><td style="padding:6px 24px">${stream.map(x => `
      <div style="padding:7px 0;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:13.5px;color:${INK}">
        ${LOGOS[x.platform] ? `<img src="${APP_URL}/logos/${LOGOS[x.platform]}.png" width="28" height="28" alt="${esc(x.platform)}" style="border-radius:7px;vertical-align:middle;margin-right:10px;border:0">` : `<span style="display:inline-block;min-width:76px;font-size:10px;font-weight:700;color:#fff;background:${GREY};border-radius:4px;padding:2px 5px;text-align:center;margin-right:8px">${esc(x.platform)}</span>`}
        <b style="font-weight:600">${esc(x.title)}</b> <span style="color:${GREY};font-size:12px">· ${esc(cap(day(x.date)))}${x.genre ? ' · ' + esc(x.genre) : ''}</span></div>`).join('')}</td></tr>`;
  }
  const events = (cat.events || []).filter(e => e.start <= addDays(today, 30));
  if (events.length) {
    body += sectionTitle('Festivals et cérémonies') + `<tr><td style="padding:6px 24px;font-family:${SANS};font-size:13.5px;color:${INK}">${events.map(e =>
      `<div style="padding:6px 0;border-bottom:1px solid ${LINE}"><b style="font-family:${SERIF};font-size:19px;font-weight:400">${esc(e.name)}</b> <span style="color:${GREY};font-size:12px">· ${esc(cap(day(e.start)))}${e.end !== e.start ? ' → ' + esc(day(e.end)) : ''} · ${esc(e.place)}${e.confirmed ? '' : ' · date prévisionnelle'}</span></div>`).join('')}</td></tr>`;
  }
  body += recoSection(picks);

  const subject = `🍿 Le Fauteuil Rouge — les sorties du ${day(wed)}`;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Le Fauteuil Rouge</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;background:#e9e4d9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9e4d9"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:${PAPER};border-radius:16px;overflow:hidden">
<tr><td style="background:${INK};padding:20px 24px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:12px"><img src="${APP_URL}/icon-192.png" width="48" height="48" alt="" style="display:block;border-radius:12px"></td>
    <td><div style="font-family:${SERIF};font-size:30px;line-height:1;color:${PAPER}">le fauteuil <i style="color:#ff4a50">rouge</i></div>
      <div style="font-family:${SANS};font-size:11px;letter-spacing:3px;color:#a8a29a;margin-top:5px">VOTRE SEMAINE AU CINÉMA</div></td>
  </tr></table></td></tr>
${body}
<tr><td style="padding:22px 24px;border-top:1px solid ${LINE};text-align:center;font-family:${SANS};font-size:12px;color:${GREY};line-height:1.7">
  <a href="${APP_URL}" style="color:${INK};font-weight:700">Ouvrir l'app</a> pour le calendrier de l'année, les notes et votre liste.<br>Chiffres : JP's Box-Office · notes : IMDb, Rotten Tomatoes, Letterboxd.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

async function main() {
  const cat = await loadCatalog();
  const wed = nextWednesday();
  // Notes des films de mercredi (une requête à la fois, pour ne pas brusquer les sites)
  const notes = {};
  for (const f of cat.films.filter(x => x.date === wed).slice(0, 8)) {
    notes[f.id] = await ratings({ title: f.title, original: f.original, year: +wed.slice(0, 4) }).catch(() => null);
  }
  const picks = await weeklyPicks().catch(() => []);
  const { subject, html } = render(cat, wed, picks, notes);
  const out = path.join(__dirname, '..', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'newsletter.html'), html);
  if (DRY) { console.log(`${subject}\n→ out/newsletter.html`); return; }
  const { EMAIL_USER, EMAIL_PASSWORD, EMAIL_TO } = process.env;
  if (!EMAIL_USER || !EMAIL_PASSWORD || !EMAIL_TO) throw new Error('EMAIL_USER / EMAIL_PASSWORD / EMAIL_TO manquants');
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD } });
  await t.sendMail({ from: `Le Fauteuil Rouge <${EMAIL_USER}>`, to: EMAIL_TO, subject, html });
  console.log(`Envoyé à ${EMAIL_TO.split(',').length} destinataire(s) : ${subject}`);
}

main().catch(e => { console.error(e); process.exit(1); });
