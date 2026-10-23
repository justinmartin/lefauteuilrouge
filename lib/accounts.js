// Comptes « pseudo + mot de passe » pour synchroniser la liste, les tickets et les cinémas entre appareils.
// Un fichier JSON par compte dans un store Vercel Blob privé. Le mot de passe n'est jamais stocké :
// seulement son empreinte scrypt (avec un sel aléatoire). Les sessions sont des jetons aléatoires dont on ne
// garde que l'empreinte SHA-256. Après 8 essais ratés, le compte est bloqué 15 minutes.
const crypto = require('crypto');
const { put, get, del } = require('@vercel/blob');

const PSEUDO_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;
const MAX_SESSIONS = 10;
const MAX_FAILS = 8, LOCK_MS = 15 * 60e3;

const pathOf = pseudo => `accounts/${pseudo}.json`;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const scrypt = (password, salt) => new Promise((res, rej) => crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => e ? rej(e) : res(k.toString('hex'))));

class AccountError extends Error { constructor(status, message) { super(message); this.status = status; } }

const normPseudo = p => String(p || '').trim().toLowerCase();
function checkPseudo(p) {
  if (!PSEUDO_RE.test(p)) throw new AccountError(400, 'Pseudo : 3 à 24 caractères, lettres, chiffres, point, tiret ou tiret bas.');
}
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) throw new AccountError(400, 'Mot de passe : 8 caractères au moins.');
}

async function load(pseudo) {
  const res = await get(pathOf(pseudo), { access: 'private', useCache: false }).catch(() => null);
  if (!res || !res.stream) return null;
  return JSON.parse(await new Response(res.stream).text());
}
const save = acc => put(pathOf(acc.pseudo), JSON.stringify(acc), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });

function newSession(acc) {
  const token = crypto.randomBytes(32).toString('base64url');
  acc.sessions = [{ h: sha(token), at: Date.now() }, ...(acc.sessions || [])].slice(0, MAX_SESSIONS);
  return token;
}

async function signup(pseudoIn, password) {
  const pseudo = normPseudo(pseudoIn);
  checkPseudo(pseudo); checkPassword(password);
  if (await load(pseudo)) throw new AccountError(409, 'Ce pseudo est déjà pris.');
  const salt = crypto.randomBytes(16).toString('hex');
  const acc = { pseudo, salt, hash: await scrypt(password, salt), created: Date.now(), fails: 0, lockedUntil: 0, sessions: [], data: null };
  const token = newSession(acc);
  await save(acc);
  return { pseudo, token, data: null };
}

async function login(pseudoIn, password) {
  const pseudo = normPseudo(pseudoIn);
  const acc = PSEUDO_RE.test(pseudo) ? await load(pseudo) : null;
  if (!acc) throw new AccountError(401, 'Pseudo ou mot de passe incorrect.');
  if (acc.lockedUntil > Date.now()) throw new AccountError(429, 'Trop d’essais : réessaie dans quelques minutes.');
  if (!same(await scrypt(String(password || ''), acc.salt), acc.hash)) {
    acc.fails = (acc.fails || 0) + 1;
    if (acc.fails >= MAX_FAILS) { acc.lockedUntil = Date.now() + LOCK_MS; acc.fails = 0; }
    await save(acc);
    throw new AccountError(401, 'Pseudo ou mot de passe incorrect.');
  }
  acc.fails = 0;
  const token = newSession(acc);
  await save(acc);
  return { pseudo, token, data: acc.data };
}

async function authed(pseudoIn, token) {
  const pseudo = normPseudo(pseudoIn);
  const acc = PSEUDO_RE.test(pseudo) && typeof token === 'string' ? await load(pseudo) : null;
  const h = acc && sha(token);
  if (!acc || !(acc.sessions || []).some(s => same(s.h, h))) throw new AccountError(401, 'Session expirée : reconnecte-toi.');
  return { acc, h };
}

// Données synchronisées : liste, tickets, cinémas (rien d'autre n'est accepté)
function cleanData(d) {
  const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const out = {
    list: obj(d?.list),
    tickets: Array.isArray(d?.tickets) ? d.tickets.slice(0, 500) : [],
    cines: Array.isArray(d?.cines) ? d.cines.filter(Number.isInteger).slice(0, 15) : null,
    updated: Number.isFinite(d?.updated) ? d.updated : Date.now(),
  };
  if (JSON.stringify(out).length > 300e3) throw new AccountError(413, 'Trop de données.');
  return out;
}

async function pull(pseudo, token) { const { acc } = await authed(pseudo, token); return { data: acc.data }; }
async function push(pseudo, token, data) {
  const { acc } = await authed(pseudo, token);
  acc.data = cleanData(data);
  await save(acc);
  return { ok: true, updated: acc.data.updated };
}
async function logout(pseudo, token) {
  const { acc, h } = await authed(pseudo, token);
  acc.sessions = acc.sessions.filter(s => !same(s.h, h));
  await save(acc);
  return { ok: true };
}

// Suppression définitive : il faut le mot de passe, pas seulement la session
async function remove(pseudoIn, password) {
  await login(pseudoIn, password);
  await del(pathOf(normPseudo(pseudoIn)));
  return { ok: true };
}

module.exports = { signup, login, pull, push, logout, remove, AccountError };
