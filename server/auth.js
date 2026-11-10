'use strict';
// Contas, senhas, sessões e vínculo com as organizações.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { q, now, rid, tx } = require('./db');
const { ROLE_LEVEL } = require('./rules');

const COOKIE = 'vx_sid';
const ROLES = ['gestor', 'equipe', 'aluno', 'familia'];
const ROLE_LABEL = { gestor: 'Gestão', equipe: 'Equipe', aluno: 'Aluno(a)', familia: 'Família' };
const PALETTE = ['#108C8C', '#0D1B3D', '#C9A227', '#7A4FB5', '#D0573A', '#2E7D32', '#1565C0', '#AD1457'];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (p.length > 200) return 'Senha longa demais.';
  return null;
}
const hashPassword = (p) => bcrypt.hash(p, 12);
// Sem conta, compara com um hash qualquer para o tempo de resposta não revelar se o e-mail existe.
let DUMMY = null;
const checkPassword = (p, h) => bcrypt.compare(String(p || ''), h || (DUMMY = DUMMY || bcrypt.hashSync(require('node:crypto').randomBytes(16).toString('hex'), 12)));
function tempPassword() {
  // 12 caracteres sem letras ambíguas, para a pessoa trocar no primeiro acesso.
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(12);
  return Array.from(b, x => A[x % A.length]).join('');
}

function colorOf(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
function avatarOf(name, color) {
  const ini = String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${color}"/><text x="32" y="41" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">${ini.replace(/[<&>"]/g, '')}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
function profile(u) {
  const color = colorOf(u.id);
  return { id: u.id, name: u.name, avatarUrl: avatarOf(u.name, color), color };
}

async function createUser({ email, name, password, mustChange = false }) {
  email = normEmail(email);
  if (!validEmail(email)) throw Object.assign(new Error('E-mail inválido.'), { code: 'invalid_argument' });
  const prob = passwordProblem(password); if (prob) throw Object.assign(new Error(prob), { code: 'invalid_argument' });
  if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw Object.assign(new Error('Já existe uma conta com este e-mail.'), { code: 'already_exists' });
  const id = rid(12, 'u_');
  q('INSERT INTO users (id, email, name, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, email, String(name || '').trim().slice(0, 120) || email, await hashPassword(password), mustChange ? 1 : 0, now());
  return userById(id);
}
const userById = (id) => { const r = q('SELECT id, email, name, must_change_password FROM users WHERE id = ?').get(id); return r ? { ...r } : null; };
const userByEmail = (e) => { const r = q('SELECT * FROM users WHERE email = ?').get(normEmail(e)); return r ? { ...r } : null; };
async function setPassword(userId, password, mustChange = false) {
  const prob = passwordProblem(password); if (prob) throw Object.assign(new Error(prob), { code: 'invalid_argument' });
  q('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?').run(await hashPassword(password), mustChange ? 1 : 0, userId);
}

function createTenant({ slug, name, settings = {} }) {
  slug = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) throw Object.assign(new Error('Endereço inválido: use de 3 a 40 letras minúsculas, números ou hífen.'), { code: 'invalid_argument' });
  if (['api', 'login', 'logout', 'signup', 'static', 'w', 'ws', 'oauth', 'healthz', 'admin'].includes(slug)) throw Object.assign(new Error('Este endereço é reservado.'), { code: 'invalid_argument' });
  if (q('SELECT 1 FROM tenants WHERE slug = ?').get(slug)) throw Object.assign(new Error('Este endereço já está em uso.'), { code: 'already_exists' });
  const id = rid(12, 't_');
  q('INSERT INTO tenants (id, slug, name, settings, created_at) VALUES (?, ?, ?, ?, ?)').run(id, slug, String(name).trim().slice(0, 120), JSON.stringify(settings), now());
  return tenantById(id);
}
function parseTenant(r) { return r ? { id: r.id, slug: r.slug, name: r.name, settings: JSON.parse(r.settings || '{}') } : null; }
const tenantById = (id) => parseTenant(q('SELECT * FROM tenants WHERE id = ?').get(id));
const tenantBySlug = (s) => parseTenant(q('SELECT * FROM tenants WHERE slug = ?').get(String(s || '').toLowerCase()));

function addMember(tenantId, userId, role) {
  if (!ROLES.includes(role)) throw Object.assign(new Error('Papel inválido.'), { code: 'invalid_argument' });
  q(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, user_id) DO UPDATE SET role = excluded.role`).run(tenantId, userId, role, now());
}
const roleIn = (tenantId, userId) => { const r = q('SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId); return r ? r.role : null; };
const tenantsOf = (userId) => q(`SELECT t.slug, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ? ORDER BY t.name`).all(userId).map(r => ({ ...r }));
const membersOf = (tenantId) => q(`SELECT u.id, u.name, u.email, m.role, u.must_change_password FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? ORDER BY u.name`).all(tenantId).map(r => ({ ...r }));

// ---- sessões ----
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + config.sessionDays * 864e5).toISOString();
  q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha(token), userId, now(), exp);
  return token;
}
function sessionUser(token) {
  if (!token) return null;
  const r = q('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha(token));
  if (!r) return null;
  if (r.expires_at < now()) { q('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); return null; }
  return userById(r.user_id);
}
const destroySession = (token) => token && q('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
const destroyUserSessions = (userId, exceptToken) => q('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, exceptToken ? sha(exceptToken) : '');
function purgeExpired() { q('DELETE FROM sessions WHERE expires_at < ?').run(now()); }

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function setSessionCookie(res, token) {
  const secure = config.baseUrl.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionDays * 86400}${secure}`);
}
function clearSessionCookie(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); }

// Middleware: req.user (ou null) e req.sessionToken
function attachUser(req, _res, next) {
  const tok = parseCookies(req.headers.cookie)[COOKIE];
  req.sessionToken = tok || null;
  req.user = sessionUser(tok);
  next();
}

// Contexto da organização a partir de /:slug (req.tenant, req.role, req.level)
function tenantCtx(req) {
  const t = tenantBySlug(req.params.slug);
  if (!t) return null;
  const role = req.user ? roleIn(t.id, req.user.id) : null;
  return { tenant: t, role, level: role ? ROLE_LEVEL[role] : 0 };
}

// Limite simples de tentativas (memória do processo).
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter(x => t - x < windowMs);
  arr.push(t); hits.set(key, arr);
  if (hits.size > 50000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > windowMs) hits.delete(k);
  return arr.length <= max;
}

module.exports = {
  COOKIE, ROLES, ROLE_LABEL, normEmail, validEmail, passwordProblem, hashPassword, checkPassword, tempPassword,
  profile, colorOf, createUser, userById, userByEmail, setPassword,
  createTenant, tenantById, tenantBySlug, addMember, roleIn, tenantsOf, membersOf,
  createSession, sessionUser, destroySession, destroyUserSessions, purgeExpired,
  parseCookies, setSessionCookie, clearSessionCookie, attachUser, tenantCtx, rateLimit, tx,
};
