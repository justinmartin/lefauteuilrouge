// « À la une » : /api/news → { sources, articles } (12 sites ciné, flux RSS publics, 7 derniers jours)
const { news } = require('../lib/news');

module.exports = async (req, res) => {
  try {
    const data = await news();
    res.setHeader('Cache-Control', data.articles.length ? 's-maxage=1800, stale-while-revalidate=7200' : 's-maxage=120');
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Actu indisponible' });
  }
};
