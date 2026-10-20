// Ajout d'une sortie à l'agenda (événement « journée entière ») : /api/ics?t=<titre>&d=<AAAA-MM-JJ>
module.exports = (req, res) => {
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
