// « À la une » : l'actu ciné de quelques sites choisis, d'après leurs flux RSS publics.
// On ne garde que le titre, l'image, la date, un court extrait et le lien vers l'article.
const UA = 'Mozilla/5.0 (compatible; lefauteuilrouge/1.0; app perso ; github.com/justinmartin)';

// cat : rubrique par défaut de la source (corrigée article par article d'après le titre)
const SOURCES = [
  { id: 'allocine', name: 'AlloCiné', lang: 'fr', cat: 'sorties', color: '#f5c518', ink: '#141414', url: 'https://www.allocine.fr/rss/news.xml' },
  { id: 'allocine-series', name: 'AlloCiné Séries', lang: 'fr', cat: 'series', color: '#f5c518', ink: '#141414', url: 'https://www.allocine.fr/rss/news-series.xml' },
  { id: 'ecranlarge', name: 'Écran Large', lang: 'fr', cat: 'sorties', color: '#e5322d', ink: '#fff', url: 'https://www.ecranlarge.com/rss' },
  { id: 'telerama', name: 'Télérama', lang: 'fr', cat: 'critiques', color: '#d4002a', ink: '#fff', url: 'https://www.telerama.fr/rss/cinema.xml' },
  { id: 'inrocks', name: 'Les Inrocks', lang: 'fr', cat: 'critiques', color: '#f4f1ea', ink: '#141414', url: 'https://www.lesinrocks.com/cinema/feed/' },
  { id: 'bleudumiroir', name: 'Le Bleu du Miroir', lang: 'fr', cat: 'critiques', color: '#2f6fd6', ink: '#fff', url: 'https://www.lebleudumiroir.fr/feed/' },
  { id: 'cineuropa', name: 'Cineuropa', lang: 'fr', cat: 'industrie', color: '#0b4f8a', ink: '#fff', url: 'https://cineuropa.org/fr/rss/' },
  { id: 'deadline', name: 'Deadline', lang: 'en', cat: 'industrie', color: '#1f1f1f', ink: '#fff', url: 'https://deadline.com/feed/' },
  { id: 'variety', name: 'Variety', lang: 'en', cat: 'industrie', color: '#c8102e', ink: '#fff', url: 'https://variety.com/v/film/feed/' },
  { id: 'indiewire', name: 'IndieWire', lang: 'en', cat: 'critiques', color: '#ff5a1f', ink: '#fff', url: 'https://www.indiewire.com/feed/' },
  { id: 'slashfilm', name: '/Film', lang: 'en', cat: 'sorties', color: '#7a2ff7', ink: '#fff', url: 'https://www.slashfilm.com/feed/' },
  { id: 'playlist', name: 'The Playlist', lang: 'en', cat: 'critiques', color: '#0e7c66', ink: '#fff', url: 'https://theplaylist.net/feed/' },
];

// Rubriques d'après le titre : séries et streaming, box-office et industrie, critiques, sorties
const RULES = [
  ['series', /\b(série|séries|saison|season|episode|épisode|netflix|prime video|disney\+|apple tv|canal\+|max|hbo|showrunner|streaming|streamer)\b/i],
  ['industrie', /\b(box[- ]office|entrées|recettes|studio|rachat|acquisition|deal|distribut|financement|festival|cannes|venise|venice|berlinale|toronto|tiff|oscar|césar|award|nominat|ceo|revenue|ticket sales|weekend|opening)\b/i],
  ['critiques', /\b(critique|review|avis|chef-d'œuvre|masterpiece|on a vu|we saw|verdict|classement|ranking|best films|meilleurs films)\b/i],
  ['sorties', /\b(bande-annonce|trailer|teaser|casting|cast|tournage|filming|first look|premières images|date de sortie|release date|sequel|suite|remake|reboot)\b/i],
];
// Hors sujet : jeux vidéo (Écran Large et /Film en parlent aussi)
const GAMES = /\b(jeux? vidéo|video games?|playstation|ps5|xbox|nintendo|switch 2|steam|gaming|mass effect|gta)\b/i;
const catOf = (title, def) => (RULES.find(([, re]) => re.test(title)) || [def])[0];

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê', ocirc: 'ô' };
const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
const strip = s => decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i').exec(x); return m ? m[1] : ''; };
const attr = (x, t, a) => { const m = new RegExp(`<${t}\\b[^>]*\\b${a}="([^"]+)"`, 'i').exec(x); return m ? decode(m[1]) : ''; };

function image(item) {
  const raw = decode(item);
  const candidates = [
    attr(item, 'media:content', 'url'), attr(item, 'media:thumbnail', 'url'),
    /type="image/.test(item) ? attr(item, 'enclosure', 'url') : '',
    (/<img[^>]+src="([^"]+)"/i.exec(raw) || [])[1],
  ].filter(Boolean);
  const src = candidates.find(u => /^https:\/\//.test(u) && !/\.(gif|svg)(\?|$)/i.test(u) && !/(feedburner|pixel|tracking|gravatar|emoji)/i.test(u));
  return src || '';
}

async function fetchFeed(src) {
  try {
    const r = await fetch(src.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.split(/<item[\s>]/i).slice(1).map(x => x.split(/<\/item>/i)[0]);
    return items.slice(0, 25).map(it => {
      const title = strip(tag(it, 'title'));
      const url = strip(tag(it, 'link')) || attr(it, 'link', 'href');
      const date = new Date(strip(tag(it, 'pubDate')) || strip(tag(it, 'dc:date')) || Date.now());
      let excerpt = strip(tag(it, 'description'));
      if (excerpt.length > 190) excerpt = excerpt.slice(0, 187).replace(/\s\S*$/, '') + '…';
      return { title, url, date: isNaN(date) ? null : date.toISOString(), source: src.id, lang: src.lang, cat: catOf(title, src.cat), image: image(it), excerpt };
    }).filter(a => a.title && /^https?:\/\//.test(a.url) && a.date && !GAMES.test(a.title) && !/\/(jeux?-video|gaming|games?)\//i.test(a.url));
  } catch (e) { return []; }
}

const key = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);

async function news() {
  const lists = await Promise.all(SOURCES.map(fetchFeed));
  const since = Date.now() - 7 * 864e5;
  const seen = new Set();
  const all = lists.flat().filter(a => new Date(a.date).getTime() >= since && new Date(a.date).getTime() <= Date.now() + 3600e3)
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter(a => { const k = key(a.title); if (seen.has(a.url) || seen.has(k)) return false; seen.add(a.url); seen.add(k); return true; });
  return { sources: SOURCES.map(({ id, name, lang, color, ink }) => ({ id, name, lang, color, ink })), articles: all.slice(0, 160) };
}

// Pour la newsletter : n articles récents, sources toutes différentes, en français puis en anglais
function pick(articles, fr = 3, en = 2) {
  const out = [], used = new Set();
  for (const [lang, n] of [['fr', fr], ['en', en]]) {
    // Une rubrique par article autant que possible, en privilégiant ceux qui ont une image
    const pool = articles.filter(a => a.lang === lang).sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || b.date.localeCompare(a.date));
    const cats = new Set();
    for (const a of pool) {
      if (out.filter(x => x.lang === lang).length >= n) break;
      if (used.has(a.source) || cats.has(a.cat)) continue;
      out.push(a); used.add(a.source); cats.add(a.cat);
    }
  }
  return out;
}

module.exports = { news, pick, SOURCES };
