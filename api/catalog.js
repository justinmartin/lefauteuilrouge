// Programme ciné (sorties France de l'année + box-office de la semaine), lu sur JP's Box-Office.
// Recalculé au plus toutes les 6 h : le CDN de Vercel garde la réponse et la rafraîchit en arrière-plan.
const { catalog } = require('../lib/jpbox');

module.exports = async (req, res) => {
  try {
    const data = await catalog();
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Programme indisponible' });
  }
};
