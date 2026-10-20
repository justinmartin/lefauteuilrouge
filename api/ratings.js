// Notes d'un film : /api/ratings?t=<titre>&o=<titre original>&y=<année>
const { ratings } = require('../lib/ratings');

module.exports = async (req, res) => {
  const title = String(req.query.t || '').slice(0, 200);
  if (!title) { res.status(400).json({ error: 'titre manquant' }); return; }
  const data = await ratings({ title, original: String(req.query.o || '').slice(0, 200), year: +req.query.y || null }).catch(() => ({ found: false }));
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=172800');
  res.status(200).json(data);
};
