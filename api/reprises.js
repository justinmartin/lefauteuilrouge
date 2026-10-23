// Films anciens à l'affiche à Paris cette semaine (reprises, ressorties) : /api/reprises
const { reprises } = require('../lib/seances');

module.exports = async (req, res) => {
  try {
    const films = await reprises();
    res.setHeader('Cache-Control', films.length ? 's-maxage=43200, stale-while-revalidate=86400' : 's-maxage=600');
    res.status(200).json({ films });
  } catch (e) {
    res.status(502).json({ error: 'Reprises indisponibles' });
  }
};
