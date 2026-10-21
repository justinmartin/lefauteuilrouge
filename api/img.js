// Relais d'affiches (JP's Box-Office, Wikipédia) servi depuis notre domaine : la fiche film peut ainsi
// lire les couleurs de l'affiche (le navigateur l'interdit sur une image d'un autre site).
const HOSTS = ['www.jpbox-office.com', 'jpbox-office.com', 'upload.wikimedia.org'];
const UA = 'lefauteuilrouge (newsletter perso ; github.com/justinmartin)';

module.exports = async (req, res) => {
  let u;
  try { u = new URL(req.query.u || ''); } catch (e) { return res.status(400).end(); }
  if (u.protocol !== 'https:' || !HOSTS.includes(u.hostname)) return res.status(400).end();
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return res.status(502).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3e6) return res.status(413).end();
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000, max-age=86400');
    return res.status(200).send(buf);
  } catch (e) { return res.status(502).end(); }
};
