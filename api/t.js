// Ticket partagé : /t/<données> (réécrit vers /api/t?d=…). Les données de la séance voyagent dans le lien
// (JSON en base64url), rien n'est stocké. Page lisible sans l'app, avec aperçu (affiche) dans iMessage / WhatsApp.
// Liens de réservation et affiches limités aux sites connus : le lien ne peut pas servir à rediriger ailleurs.
const BOOK_HOSTS = ['pathe.fr', 'ugc.fr', 'mk2.com', 'mk2.fr', 'allocine.fr', 'cinemaspathegaumont.com', 'cgrcinemas.fr', 'paris-cine.info'];
const POSTER_HOSTS = ['jpbox-office.com', 'upload.wikimedia.org', 'thumb.wikimedia.org'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const okHost = (url, hosts) => { try { const u = new URL(url); return u.protocol === 'https:' && hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h)); } catch (e) { return false; } };
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function decode(d) {
  try {
    const t = JSON.parse(Buffer.from(String(d || ''), 'base64url').toString('utf8'));
    const k = { title: str(t.t, 120), film: str(t.f, 40), poster: str(t.p, 500), start: str(t.s, 16), end: str(t.e, 16), cinema: str(t.c, 80), version: str(t.v, 30), book: str(t.b, 500) };
    if (!k.title || !STAMP.test(k.start)) return null;
    if (!STAMP.test(k.end)) k.end = '';
    if (!okHost(k.book, BOOK_HOSTS)) k.book = '';
    if (!okHost(k.poster, POSTER_HOSTS)) k.poster = '';
    if (!/^[\w-]*$/.test(k.film)) k.film = '';
    return k;
  } catch (e) { return null; }
}

module.exports = (req, res) => {
  const k = decode(req.query.d);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!k) { res.status(404).send('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:24px">Ce ticket est illisible. <a href="/">Le Fauteuil Rouge</a></p>'); return; }
  res.setHeader('Cache-Control', 's-maxage=86400');
  const d = new Date(`${k.start}:00Z`);
  const dayTxt = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const hm = k.start.slice(11, 16);
  const title = k.title.replace(/\s*\(\d{4}\)\s*$/, '');
  const origin = `https://${req.headers.host}`;
  const q = o => new URLSearchParams(o).toString();
  const g = x => x.replace(/[-:]/g, '') + '00';
  const end = k.end || k.start;
  const ics = `/api/ics?${q({ t: title, s: k.start, e: end, l: k.cinema, u: k.book })}`;
  const gcal = `https://calendar.google.com/calendar/render?${q({ action: 'TEMPLATE', text: `🍿 ${title}`, dates: `${g(k.start)}/${g(end)}`, ctz: 'Europe/Paris', location: k.cinema, details: [k.version, k.book].filter(Boolean).join('\n') })}`;
  const desc = `${k.cinema}${k.version ? ` · ${k.version}` : ''} · Le Fauteuil Rouge`;
  res.status(200).send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · ${esc(dayTxt)} à ${hm}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)} · ${esc(dayTxt)} à ${hm}">
<meta property="og:description" content="${esc(desc)}">
${k.poster ? `<meta property="og:image" content="${esc(k.poster)}">` : `<meta property="og:image" content="${origin}/icon-512.png">`}
<meta property="og:site_name" content="Le Fauteuil Rouge"><meta name="theme-color" content="#141414">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#141414;--paper:#f4f1ea;--red:#d7262e;--ink:#141414;--muted:#6b655d}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--paper);font-family:'Space Grotesk',-apple-system,sans-serif;min-height:100vh;padding:calc(env(safe-area-inset-top) + 28px) 16px 40px;display:flex;flex-direction:column;align-items:center}
main{width:100%;max-width:420px;display:flex;flex-direction:column;gap:14px}
.brand{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--paper);font-family:'Instrument Serif',serif;font-size:22px}
.brand i{color:#ff4a50}
.lead{font-size:15px;color:#b8b1a7}
.ticket{background:var(--paper);color:var(--ink);border-radius:18px;overflow:hidden}
.top{display:flex;gap:14px;padding:16px 18px 12px}
.top img{width:84px;border-radius:8px;display:block;flex:none;align-self:flex-start}
.small{display:flex;justify-content:space-between;font-size:10.5px;font-weight:700;letter-spacing:.2em;color:var(--muted)}
h1{font-family:'Instrument Serif',serif;font-weight:400;font-size:40px;line-height:.95;margin-top:8px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 18px 12px}
.grid small{display:block;font-size:10px;letter-spacing:.12em;color:var(--muted)}
.grid b{font-size:16px}
.place{padding:0 18px 14px;font-size:13.5px;color:#3a3530}
.perf{position:relative;height:18px;background-image:linear-gradient(90deg,#c9c2b8 50%,transparent 50%);background-size:10px 2px;background-repeat:repeat-x;background-position:16px 8px}
.perf:before,.perf:after{content:'';position:absolute;top:0;width:18px;height:18px;border-radius:50%;background:var(--bg)}
.perf:before{left:-9px}.perf:after{right:-9px}
.stub{background:var(--red);color:#fff;padding:14px 18px}
.stub small{display:block;font-size:10px;letter-spacing:.16em;opacity:.85}
.stub b{font-family:'Instrument Serif',serif;font-weight:400;font-size:30px}
.btn{display:flex;align-items:center;justify-content:center;min-height:50px;border-radius:12px;font-weight:600;font-size:15px;text-decoration:none;color:var(--paper);background:#24211f}
.btn.red{background:var(--red);color:#fff}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.foot{font-size:12px;color:#8a847b;text-align:center;margin-top:6px}
.foot a{color:#b8b1a7}
</style></head>
<body><main>
  <a class="brand" href="/"><img src="/logo.svg" alt="" width="26" height="26">le fauteuil <i>rouge</i></a>
  <p class="lead">On y va ?</p>
  <article class="ticket">
    <div class="top">${k.poster ? `<img src="${esc(k.poster)}" alt="">` : ''}<div style="flex:1;min-width:0"><div class="small"><span>LE FAUTEUIL ROUGE</span><span>ADMIT ONE</span></div><h1>${esc(title)}</h1></div></div>
    <div class="grid"><div><small>JOUR</small><b>${esc(dayTxt.split(' ').slice(0, 2).join(' '))}</b></div><div><small>HEURE</small><b>${hm}</b></div><div><small>VERSION</small><b>${esc(k.version || '—')}</b></div></div>
    <div class="place">${esc(k.cinema)}${k.end ? ` · sortie vers ${k.end.slice(11, 16)}` : ''}</div>
    <div class="perf"></div>
    <div class="stub"><small id="w1">LE</small><b id="w2">${esc(dayTxt)}</b></div>
  </article>
  ${k.book ? `<a class="btn red" href="${esc(k.book)}" target="_blank" rel="noopener">Réserver ma place</a>` : ''}
  <div class="row"><a class="btn" href="${esc(ics)}">Calendrier Apple</a><a class="btn" href="${esc(gcal)}" target="_blank" rel="noopener">Google Agenda</a></div>
  <div class="row"><a class="btn" href="https://maps.apple.com/?q=${encodeURIComponent(k.cinema)}" target="_blank" rel="noopener">Itinéraire</a><a class="btn" href="${k.film ? `/?film=${encodeURIComponent(k.film)}` : '/'}">Voir le film</a></div>
  <p class="foot">Séance partagée depuis <a href="/">Le Fauteuil Rouge</a></p>
</main>
<script>
// Compte à rebours, à l'heure de Paris du téléphone
(function () {
  var s = ${JSON.stringify(k.start)}, start = new Date(s + ':00'), mins = Math.round((start - new Date()) / 60000);
  var day = function (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  var days = Math.round((day(start) - day(new Date())) / 864e5);
  var a = 'DANS', b;
  if (mins < -150) { a = 'C’ÉTAIT'; b = ${JSON.stringify(dayTxt)}; }
  else if (mins <= 0) { a = 'C’EST'; b = 'maintenant'; }
  else if (mins < 60) b = mins + ' min';
  else if (days === 0) b = Math.floor(mins / 60) + ' h ' + String(mins % 60).padStart(2, '0');
  else if (days === 1) { a = 'C’EST'; b = 'demain'; }
  else b = days + ' jours';
  document.getElementById('w1').textContent = a; document.getElementById('w2').textContent = b;
})();
</script>
</body></html>`);
};
