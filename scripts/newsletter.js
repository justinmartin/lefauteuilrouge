// Newsletter du lundi : les sorties de mercredi, les grosses sorties des 3 semaines suivantes et le
// box-office France de la semaine. Données : l'API de l'app (sinon JP's Box-Office en direct).
// Usage : node scripts/newsletter.js [--dry-run]   (dry-run : écrit out/newsletter.html sans envoyer)
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { catalog } = require('../lib/jpbox');
const { weeklyPicks } = require('../lib/reco');

const APP_URL = process.env.APP_URL || 'https://lefauteuilrouge.vercel.app';
const DRY = process.argv.includes('--dry-run');
const BIG_SCREENS = 250;
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '–' : n.toLocaleString('fr-FR').replace(/ /g, ' ');
const day = s => { const d = new Date(`${s}T12:00:00Z`); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

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

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const GOLD = '#e8b54d', CREAM = '#f6e7c8', VELVET = '#b3141e';

const title = (t, sub = '') => `<tr><td style="padding:26px 22px 8px">
  <div style="font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:${GOLD}">${t}</div>
  ${sub ? `<div style="font-family:${FONT};font-size:13px;color:#cdb9a5;margin-top:3px">${sub}</div>` : ''}
  <div style="height:1px;background:rgba(232,181,77,.25);margin-top:10px"></div></td></tr>`;

function filmCard(f) {
  const meta = [f.genre, f.country, f.duration].filter(Boolean).join(' · ');
  const people = [f.director ? `De ${f.director}` : '', f.cast?.length ? `Avec ${f.cast.slice(0, 3).join(', ')}` : ''].filter(Boolean).join(' · ');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#2a0f13;border:1px solid rgba(232,181,77,.22);border-radius:12px;margin:10px 0"><tr>
    <td width="96" style="padding:12px;vertical-align:top">${f.poster ? `<img src="${esc(f.poster)}" width="90" style="display:block;width:90px;border-radius:6px" alt="">` : ''}</td>
    <td style="padding:12px 14px 12px 4px;vertical-align:top;font-family:${FONT}">
      <div style="font-family:${SERIF};font-size:20px;line-height:1.15;color:${CREAM}">${esc(f.title)}</div>
      ${meta ? `<div style="font-size:13px;color:#cdb9a5;margin-top:5px">${esc(meta)}${f.screens ? ` · <b style="color:${GOLD}">${fmt(f.screens)} salles</b>` : ''}</div>` : ''}
      ${people ? `<div style="font-size:12.5px;color:#8f7a6c;margin-top:3px">${esc(people)}</div>` : ''}
      ${f.synopsis ? `<div style="font-size:13px;line-height:1.45;color:#cdb9a5;margin-top:7px">${esc(f.synopsis.length > 230 ? f.synopsis.slice(0, 227).replace(/\s\S*$/, '') + '…' : f.synopsis)}</div>` : ''}
    </td></tr></table>`;
}

function posterStrip(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${list.slice(0, 4).map(f => `
    <td width="25%" style="padding:6px;vertical-align:top;font-family:${FONT}">
      ${f.poster ? `<img src="${esc(f.poster)}" width="120" style="display:block;width:100%;max-width:120px;border-radius:6px" alt="">` : ''}
      <div style="font-size:12.5px;font-weight:600;color:${CREAM};margin-top:6px;line-height:1.25">${esc(f.title)}</div>
      ${f.screens ? `<div style="font-size:11px;color:#8f7a6c">${fmt(f.screens)} salles</div>` : ''}
    </td>`).join('')}${'<td width="25%"></td>'.repeat(Math.max(0, 4 - list.length))}</tr></table>`;
}

function boTable(bo) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT}">${bo.rows.slice(0, 10).map(r => `
    <tr><td width="34" style="padding:8px 0;border-bottom:1px solid rgba(232,181,77,.15);font-family:${SERIF};font-size:22px;color:${r.rank <= 3 ? '#f3d58f' : GOLD};text-align:center">${r.rank}</td>
      <td style="padding:8px 8px;border-bottom:1px solid rgba(232,181,77,.15)">
        <div style="font-size:14.5px;font-weight:650;color:${CREAM}">${esc(r.title)}${r.isNew ? ` <span style="font-size:10px;font-weight:800;color:#fff;background:${VELVET};border-radius:3px;padding:1px 5px;vertical-align:middle">NOUVEAU</span>` : ''}</div>
        <div style="font-size:12px;color:#8f7a6c">${esc(r.distributor || '')}${r.weeks > 1 ? ` · ${r.weeks}e semaine` : ''}</div></td>
      <td style="padding:8px 0;border-bottom:1px solid rgba(232,181,77,.15);text-align:right;white-space:nowrap">
        <div style="font-size:14.5px;font-weight:700;color:${CREAM}">${fmt(r.entries)}</div>
        <div style="font-size:11.5px;color:${r.change && r.change.startsWith('-') ? '#ff9a92' : '#8f7a6c'}">${r.change || 'entrées'} · total ${fmt(r.total)}</div></td></tr>`).join('')}</table>`;
}

// « La séance de rattrapage » : 3 classiques à (re)voir
function recoSection(picks) {
  if (!picks?.length) return '';
  return title('La séance de rattrapage', '3 films à voir, piochés dans les grands classements') + `<tr><td style="padding:0 22px">${picks.map(f => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#2a0f13;border:1px solid rgba(232,181,77,.22);border-radius:12px;margin:10px 0"><tr>
      <td width="86" style="padding:12px;vertical-align:top">${f.poster ? `<a href="${esc(f.link)}"><img src="${esc(f.poster)}" width="80" style="display:block;width:80px;border-radius:6px" alt=""></a>` : ''}</td>
      <td style="padding:12px 14px 12px 4px;vertical-align:top;font-family:${FONT}">
        <a href="${esc(f.link)}" style="text-decoration:none"><span style="font-family:${SERIF};font-size:19px;line-height:1.15;color:${CREAM}">${esc(f.title)}</span></a>
        <div style="font-size:12.5px;color:#cdb9a5;margin-top:4px">${f.year} · ${esc(f.director)}${f.original && f.original !== f.title ? ` · <i>${esc(f.original)}</i>` : ''}</div>
        <div style="margin-top:6px">${f.sourceLabels.map(l => `<span style="display:inline-block;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#f3d58f;background:rgba(232,181,77,.14);border-radius:4px;padding:2px 6px;margin:0 4px 4px 0">${esc(l)}</span>`).join('')}</div>
        ${f.synopsis ? `<div style="font-size:13px;line-height:1.45;color:#cdb9a5;margin-top:4px">${esc(f.synopsis)}</div>` : ''}
      </td></tr></table>`).join('')}</td></tr>`;
}

function render(cat, wed, picks = []) {
  const on = d => cat.films.filter(f => f.date === d).sort((a, b) => (b.screens || 0) - (a.screens || 0));
  const big = l => { const b = l.filter(f => (f.screens || 0) >= BIG_SCREENS); return b.length ? b : l.slice(0, 3); };
  const thisWeek = on(wed);
  const main = big(thisWeek), rest = thisWeek.filter(f => !main.includes(f));
  let body = title(`Mercredi ${new Date(`${wed}T12:00:00Z`).getUTCDate()} ${MONTHS[new Date(`${wed}T12:00:00Z`).getUTCMonth()]} au cinéma`, `${thisWeek.length} sortie${thisWeek.length > 1 ? 's' : ''}`);
  body += `<tr><td style="padding:0 22px">${main.map(filmCard).join('') || `<p style="font-family:${FONT};color:#8f7a6c">Pas encore de sorties annoncées.</p>`}
    ${rest.length ? `<p style="font-family:${FONT};font-size:13px;color:#cdb9a5;margin:12px 0 0">Aussi : ${rest.map(f => esc(f.title)).join(', ')}.</p>` : ''}</td></tr>`;
  for (let i = 1; i <= 3; i++) {
    const d = addDays(wed, 7 * i), l = on(d);
    if (!l.length) continue;
    body += title(cap(day(d)), `${l.length} sortie${l.length > 1 ? 's' : ''}`) + `<tr><td style="padding:0 16px">${posterStrip(big(l))}</td></tr>`;
  }
  const bo = cat.boxoffice?.rows?.length ? cat.boxoffice : cat.boxoffice_prev;  // la plus récente, même partielle
  if (bo?.rows?.length) {
    const label = (bo.label || '').replace(/^Semaine \d+ - DU /i, 'du ').replace(/\s*\(\d Jours?\)/i, '').toLowerCase();
    body += title('Box-office France', `${esc(label)}${bo.days && bo.days < 7 ? ` · ${bo.days} premiers jours` : ''}`) + `<tr><td style="padding:0 22px">${boTable(bo)}</td></tr>`;
  }
  body += recoSection(picks);
  const subject = `🍿 Le Fauteuil Rouge — les sorties du ${day(wed)}`;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Le Fauteuil Rouge</title></head>
<body style="margin:0;background:#140608">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#140608"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#1f0a0d;border:1px solid rgba(232,181,77,.3);border-radius:16px">
<tr><td style="padding:26px 22px 18px;text-align:center;background:#2b0a0e;border-radius:16px 16px 0 0;border-bottom:2px solid ${GOLD}">
  <img src="${APP_URL}/icon-192.png" width="56" height="56" alt="" style="display:inline-block;border-radius:14px">
  <div style="font-family:${SERIF};font-size:30px;color:${CREAM};margin-top:8px"><i style="color:${GOLD};font-size:22px">le</i> Fauteuil <i style="color:#d1222c">Rouge</i></div>
  <div style="font-family:${FONT};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${GOLD};margin-top:6px">Votre semaine au cinéma</div></td></tr>
${body}
<tr><td style="padding:24px 22px;text-align:center;font-family:${FONT};font-size:12px;color:#8f7a6c;line-height:1.7">
  <a href="${APP_URL}" style="color:${CREAM};font-weight:700">Ouvrir l'app</a> pour tout le calendrier de l'année.<br>Chiffres : JP's Box-Office.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

async function main() {
  const cat = await loadCatalog();
  const picks = await weeklyPicks().catch(() => []);
  const { subject, html } = render(cat, nextWednesday(), picks);
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
