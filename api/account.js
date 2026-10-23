// Compte et synchronisation : POST /api/account { action, pseudo, password | token, data }
//   signup / login → { pseudo, token, data } · pull → { data } · push → { ok } · logout → { ok } · delete (mot de passe) → { ok }
const acc = require('../lib/accounts');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return res.status(503).json({ error: 'Comptes pas encore activés.' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  try {
    const out = b.action === 'signup' ? await acc.signup(b.pseudo, b.password)
      : b.action === 'login' ? await acc.login(b.pseudo, b.password)
      : b.action === 'pull' ? await acc.pull(b.pseudo, b.token)
      : b.action === 'push' ? await acc.push(b.pseudo, b.token, b.data)
      : b.action === 'logout' ? await acc.logout(b.pseudo, b.token)
      : b.action === 'delete' ? await acc.remove(b.pseudo, b.password)
      : null;
    if (!out) return res.status(400).json({ error: 'Action inconnue' });
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof acc.AccountError) return res.status(e.status).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: 'Erreur du serveur, réessaie.' });
  }
};
