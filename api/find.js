// Recherche dans tous les films (Wikidata) : /api/find?q=<titre>
const { findFilms } = require('../lib/find');

module.exports = async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) { res.status(400).json({ error: 'recherche trop courte' }); return; }
  try {
    const films = await findFilms(q);
    res.setHeader('Cache-Control', films.length ? 's-maxage=604800, stale-while-revalidate=604800' : 's-maxage=600');
    res.status(200).json({ films });
  } catch (e) {
    res.status(502).json({ error: 'Recherche indisponible' });
  }
};
