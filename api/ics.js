// Agenda : une sortie (/api/ics?t=<titre>&d=<AAAA-MM-JJ>) ou l'abonnement aux grosses sorties (/api/ics?all=1)
const { catalog } = require('../lib/jpbox');

async function feed(res) {
  const cat = await catalog();
  const byDate = {};
  cat.films.forEach(f => (byDate[f.date] ||= []).push(f));
  const big = Object.values(byDate).flatMap(l => {
    l.sort((a, b) => (b.screens || 0) - (a.screens || 0));
    const b = l.filter(f => (f.screens || 0) >= 250);
    return b.length ? b : l.slice(0, 2);
  });
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Le Fauteuil Rouge//FR', 'METHOD:PUBLISH', 'X-WR-CALNAME:Le Fauteuil Rouge',
    'REFRESH-INTERVAL;VALUE=DURATION:P1D', 'X-PUBLISHED-TTL:P1D'];
  big.forEach(f => {
    const next = new Date(`${f.date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    lines.push('BEGIN:VEVENT', `UID:lfr-${f.id}@lefauteuilrouge`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${f.date.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`, `SUMMARY:${esc('🍿 ' + f.title.replace(/\s*\(\d{4}\)$/, ''))}`,
      `DESCRIPTION:${esc([f.genre, f.duration, f.screens ? f.screens + ' salles' : ''].filter(Boolean).join(' · '))}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  res.status(200).send(lines.join('\r\n') + '\r\n');
}

module.exports = async (req, res) => {
  if (req.query.all) { await feed(res).catch(() => res.status(502).send('Programme indisponible')); return; }
  const title = String(req.query.t || '').slice(0, 200);
  const day = String(req.query.d || '');
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(day)) { res.status(400).send('Paramètres manquants'); return; }
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const d = day.replace(/-/g, '');
  const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Le Fauteuil Rouge//FR', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:lfr-${d}-${title.replace(/[^\w]/g, '').slice(0, 40)}@lefauteuilrouge`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
    `SUMMARY:${esc('🎬 Sortie : ' + title)}`, 'DESCRIPTION:Le Fauteuil Rouge — https://lefauteuilrouge.vercel.app',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="sortie.ics"');
  res.status(200).send(ics + '\r\n');
};
