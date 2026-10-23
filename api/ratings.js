// Notes d'un film : /api/ratings?t=<titre>&o=<titre original>&y=<année>
const { ratings } = require('../lib/ratings');
const { notesFor } = require('../lib/seances');

module.exports = async (req, res) => {
  const title = String(req.query.t || '').slice(0, 200);
  if (!title) { res.status(400).json({ error: 'titre manquant' }); return; }
  const original = String(req.query.o || '').slice(0, 200), year = +req.query.y || null;
  const [data, pc] = await Promise.all([
    ratings({ title, original, year }).catch(() => ({ found: false })),
    notesFor(title, original, year).catch(() => null), // secours : notes relevées par paris-cine.info pour les films à l'affiche
  ]);
  if (pc) {
    data.found = true;
    if (!data.imdb?.rating && pc.imdb) data.imdb = pc.imdb;
    if (data.rt?.critics == null && pc.rt) data.rt = pc.rt;
    if (!data.letterboxd?.rating && pc.letterboxd) data.letterboxd = pc.letterboxd;
    if (pc.allocine) data.allocine = pc.allocine;
  }
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=172800');
  res.status(200).json(data);
};
