// Programme ciné (sorties France de l'année, box-office France / US / monde), sorties streaming
// et festivals / cérémonies. Recalculé au plus toutes les 6 h (cache du CDN de Vercel).
const { catalog } = require('../lib/jpbox');
const { streaming } = require('../lib/streaming');
const { events } = require('../data/evenements.json');

module.exports = async (req, res) => {
  try {
    const [data, stream] = await Promise.all([catalog(), streaming().catch(() => [])]);
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json({ ...data, streaming: stream, events: events.filter(e => e.end >= today) });
  } catch (e) {
    res.status(502).json({ error: 'Programme indisponible' });
  }
};
