// Séances : /api/seances?list=cinemas  |  ?c=104.169 (la semaine)  |  ?c=104.169&t=<titre>&o=<original> (un film)
// Source : paris-cine.info (données Allociné). Réponses gardées 6 h par le CDN pour ménager le site.
const { theaters, week, film } = require('../lib/seances');

module.exports = async (req, res) => {
  try {
    if (req.query.list === 'cinemas') {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      res.status(200).json({ cinemas: await theaters() });
      return;
    }
    const ids = String(req.query.c || '').split(/[.,]/).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 15).sort((a, b) => a - b);
    if (!ids.length) { res.status(400).json({ error: 'cinémas manquants' }); return; }
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    if (req.query.t) {
      res.status(200).json({ film: await film(ids, String(req.query.t).slice(0, 200), String(req.query.o || '').slice(0, 200)) });
      return;
    }
    res.status(200).json({ films: await week(ids) });
  } catch (e) {
    res.status(502).json({ error: 'Séances indisponibles' });
  }
};
