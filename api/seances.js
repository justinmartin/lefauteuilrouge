// Séances : /api/seances?list=cinemas  |  ?c=104.169 (la semaine)  |  ?c=104.169&t=<titre>&o=<original> (un film)
//   |  ?all=1&t=<titre>&o=<original> (un film, dans tout Paris)
// Source : paris-cine.info (données Allociné). Réponses gardées 6 h par le CDN pour ménager le site.
const { theaters, week, film } = require('../lib/seances');

module.exports = async (req, res) => {
  try {
    if (req.query.list === 'cinemas') {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      res.status(200).json({ cinemas: await theaters() });
      return;
    }
    // Un film dans tout Paris (pour les reprises) : /api/seances?all=1&t=<titre>&o=<original>
    if (req.query.all === '1' && req.query.t) {
      const ids = (await theaters()).map(c => c.id);
      const f = await film(ids, String(req.query.t).slice(0, 200), String(req.query.o || '').slice(0, 200));
      res.setHeader('Cache-Control', f?.showtimes?.length ? 's-maxage=21600, stale-while-revalidate=86400' : 's-maxage=600');
      res.status(200).json({ film: f });
      return;
    }
    const ids = String(req.query.c || '').split(/[.,]/).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 15).sort((a, b) => a - b);
    if (!ids.length) { res.status(400).json({ error: 'cinémas manquants' }); return; }
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=259200');
    if (req.query.t) {
      res.status(200).json({ film: await film(ids, String(req.query.t).slice(0, 200), String(req.query.o || '').slice(0, 200)) });
      return;
    }
    res.status(200).json({ films: await week(ids) });
  } catch (e) {
    res.status(502).json({ error: 'Séances indisponibles' });
  }
};
