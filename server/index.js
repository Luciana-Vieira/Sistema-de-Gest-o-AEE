'use strict';
// Servidor do Vértice Gestão SaaS: páginas, API REST, arquivos e tempo real.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const store = require('./store');
const rules = require('./rules');
const google = require('./google');
const realtime = require('./realtime');
const pages = require('./pages');
const { createOrganization } = require('./org');

db.migrate();

const PUBLIC = path.join(config.root, 'public');
const APP_FILE = path.join(PUBLIC, 'app.html');
const GENERIC_TEMPLATE = path.join(__dirname, 'templates', 'modelo-contrato-generico.docx');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// ---------- segurança básica ----------
const wsOrigin = config.baseUrl.replace(/^http/, 'ws');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${wsOrigin}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
  ].join('; '));
  if (config.baseUrl.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(auth.attachUser);
// Pedidos que alteram dados só valem vindos do próprio site.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const o = req.headers.origin;
  if (o && o !== 'null') {
    let host; try { host = new URL(o).host; } catch (_) { host = ''; }
    if (host !== req.headers.host) return res.status(403).json({ code: 'forbidden_origin', message: 'Origem não permitida.' });
  }
  if (req.path.startsWith('/api/') && req.headers['x-vx'] !== '1') return res.status(403).json({ code: 'forbidden', message: 'Cabeçalho X-VX ausente.' });
  next();
});

app.use('/static', express.static(path.join(PUBLIC, 'static'), { maxAge: config.production ? '1h' : 0 }));
app.get('/static/jszip.min.js', (_req, res) => res.sendFile(require.resolve('jszip/dist/jszip.min.js')));
app.get('/static/jspdf.umd.min.js', (_req, res) => res.sendFile(require.resolve('jspdf/dist/jspdf.umd.min.js')));
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(PUBLIC, 'static', 'favicon.svg'), { headers: { 'Content-Type': 'image/svg+xml' } }));

const form = express.urlencoded({ extended: false, limit: '50kb' });
const json = express.json({ limit: '2mb' });
const ip = (req) => req.ip || req.socket.remoteAddress || '';
const fail = (res, status, code, message) => res.status(status).json({ code, message: message || code });
const safeNext = (n) => (typeof n === 'string' && /^\/w\/[a-z0-9-]+\/[\w\-/]*$/.test(n) ? n : null);

// ---------- páginas de conta ----------
app.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const ts = auth.tenantsOf(req.user.id);
  if (ts.length === 1) return res.redirect(`/w/${ts[0].slug}/`);
  res.send(pages.choose(req.user, ts));
});
app.get('/login', (req, res) => res.send(pages.login({ next: safeNext(req.query.next), allowSignup: config.allowSignup })));
app.post('/login', form, async (req, res) => {
  const email = auth.normEmail(req.body.email);
  const next = safeNext(req.body.next);
  if (!auth.rateLimit('login:' + ip(req), 30, 15 * 60e3) || !auth.rateLimit('login:' + email, 10, 15 * 60e3))
    return res.status(429).send(pages.login({ email, next, error: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.', allowSignup: config.allowSignup }));
  const u = auth.userByEmail(email);
  const ok = await auth.checkPassword(req.body.senha, u ? u.password_hash : null);
  if (!u || !ok) return res.status(401).send(pages.login({ email, next, error: 'E-mail ou senha incorretos.', allowSignup: config.allowSignup }));
  auth.setSessionCookie(res, auth.createSession(u.id));
  if (u.must_change_password) return res.redirect('/trocar-senha' + (next ? '?next=' + encodeURIComponent(next) : ''));
  res.redirect(next || '/');
});
app.post('/logout', (req, res) => { auth.destroySession(req.sessionToken); auth.clearSessionCookie(res); res.redirect('/login'); });
app.get('/trocar-senha', (req, res) => { if (!req.user) return res.redirect('/login'); res.send(pages.changePassword({ user: req.user, next: safeNext(req.query.next) })); });
app.post('/trocar-senha', form, async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const next = safeNext(req.body.next);
  const u = auth.userByEmail(req.user.email);
  const err = (m) => res.status(400).send(pages.changePassword({ user: req.user, next, error: m }));
  if (!(await auth.checkPassword(req.body.atual, u.password_hash))) return err('A senha atual não confere.');
  if (req.body.nova !== req.body.confirma) return err('A confirmação não é igual à nova senha.');
  if (req.body.nova === req.body.atual) return err('Escolha uma senha diferente da atual.');
  const p = auth.passwordProblem(req.body.nova); if (p) return err(p);
  await auth.setPassword(u.id, req.body.nova, false);
  auth.destroyUserSessions(u.id, req.sessionToken);
  res.redirect(next || '/');
});
app.get('/signup', (req, res) => { if (!config.allowSignup) return res.status(404).send(pages.notFound()); res.send(pages.signup({})); });
app.post('/signup', form, async (req, res) => {
  if (!config.allowSignup) return res.status(404).send(pages.notFound());
  const b = req.body; const keep = { nome: b.nome, email: b.email, org: b.org, slug: b.slug };
  if (!auth.rateLimit('signup:' + ip(req), 5, 60 * 60e3)) return res.status(429).send(pages.signup({ ...keep, error: 'Muitas contas criadas a partir desta rede. Tente mais tarde.' }));
  if (!String(b.nome || '').trim() || !String(b.org || '').trim()) return res.status(400).send(pages.signup({ ...keep, error: 'Preencha o seu nome e o nome da escola ou do seu trabalho.' }));
  if (b.senha !== b.confirma) return res.status(400).send(pages.signup({ ...keep, error: 'A confirmação não é igual à senha.' }));
  try {
    const { tenant, user } = await createOrganization({ slug: b.slug, org: b.org, nome: b.nome, email: b.email, senha: b.senha });
    auth.setSessionCookie(res, auth.createSession(user.id));
    res.redirect(`/w/${tenant.slug}/`);
  } catch (e) { res.status(400).send(pages.signup({ ...keep, error: e.message })); }
});

// ---------- aplicação ----------
let appHtmlCache = null;
function appHtml() {
  if (!appHtmlCache || !config.production) {
    if (!fs.existsSync(APP_FILE)) throw new Error('public/app.html não existe. Rode "npm run build".');
    appHtmlCache = fs.readFileSync(APP_FILE, 'utf8');
  }
  return appHtmlCache;
}
// Os campos {{ORG_*}} aparecem no HTML e também dentro de textos de JavaScript (módulos
// Planner e Lousa), por isso o escape cobre aspas, crase, cifrão, barra invertida e quebras de linha.
const escHtml = (s) => String(s ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ')
  .replace(/[&<>"'`$\\]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '$': '&#36;', '\\': '&#92;' }[c]));
function orgOf(t) {
  const s = t.settings || {};
  return {
    nome: t.name, marca1: s.marca1 ?? '', marca2: s.marca2 ?? t.name.toUpperCase(), subtitulo: s.subtitulo ?? '',
    razaoSocial: s.razaoSocial || '', documento: s.documento || '', endereco: s.endereco || '', representante: s.representante || '',
    email: s.email || '', whatsapp: s.whatsapp || '', rodape: s.rodape || '',
  };
}
function renderApp(req, res, ctx, mode) {
  const t = ctx.tenant; const org = orgOf(t);
  const cfg = {
    mode, tenant: { slug: t.slug, name: t.name }, org,
    user: mode === 'app' && req.user ? { id: req.user.id, name: req.user.name, role: ctx.role } : null,
    portalUrl: `${config.baseUrl}/w/${t.slug}/familia`, contaUrl: `/w/${t.slug}/conta`, googleEnabled: config.googleEnabled,
  };
  const inject = `<script>window.VX_CONFIG=${JSON.stringify(cfg).replace(/</g, '\\u003c')};</script>`;
  const html = appHtml()
    .replace('<!--VX_CONFIG-->', inject)
    .replace(/\{\{ORG_(NOME|MARCA1|MARCA2|SUBTITULO)\}\}/g, (_, k) => escHtml(org[{ NOME: 'nome', MARCA1: 'marca1', MARCA2: 'marca2', SUBTITULO: 'subtitulo' }[k]]));
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html);
}
app.get('/w/:slug/', (req, res) => {
  // a barra final importa: o sistema busca arquivos com caminho relativo (modelo-contrato.txt)
  if (!req.path.endsWith('/')) return res.redirect(301, `/w/${encodeURIComponent(req.params.slug)}/`);
  const ctx = auth.tenantCtx(req); if (!ctx) return res.status(404).send(pages.notFound());
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(`/w/${ctx.tenant.slug}/`));
  if (req.user.must_change_password) return res.redirect('/trocar-senha?next=' + encodeURIComponent(`/w/${ctx.tenant.slug}/`));
  if (!ctx.role) return res.status(403).send(pages.noAccess(req.user, ctx.tenant));
  renderApp(req, res, ctx, 'app');
});
app.get('/w/:slug/familia', (req, res) => {
  const ctx = auth.tenantCtx(req); if (!ctx) return res.status(404).send(pages.notFound());
  renderApp(req, res, ctx, 'familia');
});
// Documentos liberados no Portal da Família: sem conta, só com o código de acesso.
// O arquivo precisa estar na lista "docs" do portal daquele código.
app.get('/w/:slug/familia/arquivo/:token/:asset', (req, res) => {
  const t = auth.tenantBySlug(req.params.slug); if (!t) return res.status(404).end();
  if (!auth.rateLimit('pubfile:' + ip(req), 60, 60e3)) return res.status(429).end();
  const tok = String(req.params.token || '');
  if (!/^[A-Z0-9]{16}$/.test(tok)) return res.status(404).end();
  const portal = store.getDoc(t.id, `portal/${tok}/pub/dados`);
  const ok = portal && (portal.data.alunos || []).some(al => (al.docs || []).some(d => d && d.asset === req.params.asset));
  const a = ok && db.q('SELECT * FROM assets WHERE id = ? AND tenant_id = ?').get(req.params.asset, t.id);
  const file = a && path.join(config.assetsDir, t.id, a.id);
  if (!a || !fs.existsSync(file)) return res.status(404).end();
  sendAsset(res, a, file);
});
app.get('/w/:slug/conta', (req, res) => {
  const ctx = auth.tenantCtx(req); if (!ctx) return res.status(404).send(pages.notFound());
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(`/w/${ctx.tenant.slug}/conta`));
  if (!ctx.role) return res.status(403).send(pages.noAccess(req.user, ctx.tenant));
  res.setHeader('Cache-Control', 'no-store');
  res.send(pages.account({ user: req.user, tenant: ctx.tenant, org: orgOf(ctx.tenant), role: ctx.role, googleEnabled: config.googleEnabled, portalUrl: `${config.baseUrl}/w/${ctx.tenant.slug}/familia`, msg: req.query.msg }));
});
// Modelo Word usado no contrato, no PDI e no relatório (base64, como no Claude).
app.get('/w/:slug/modelo-contrato.txt', (req, res) => {
  const ctx = auth.tenantCtx(req); if (!ctx) return res.status(404).end();
  if (ctx.level < rules.LEVEL.admin) return res.status(403).end();
  const own = path.join(config.templatesDir, ctx.tenant.id + '.docx');
  res.setHeader('Cache-Control', 'no-store');
  res.type('text/plain').send(fs.readFileSync(fs.existsSync(own) ? own : GENERIC_TEMPLATE).toString('base64'));
});

// ---------- Google Agenda ----------
app.get('/w/:slug/google/conectar', (req, res) => {
  const ctx = auth.tenantCtx(req); if (!ctx) return res.status(404).send(pages.notFound());
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(`/w/${ctx.tenant.slug}/conta`));
  if (ctx.level < rules.LEVEL.admin) return res.status(403).send(pages.noAccess(req.user, ctx.tenant));
  if (!config.googleEnabled) return res.redirect(`/w/${ctx.tenant.slug}/conta?msg=google-off`);
  res.redirect(google.authUrl(ctx.tenant.id, req.user.id));
});
app.get(google.REDIRECT_PATH, async (req, res) => {
  if (!req.user) return res.redirect('/login');
  try {
    if (req.query.error) throw Object.assign(new Error('A conexão foi cancelada no Google.'), { code: 'declined' });
    const r = await google.handleCallback(req.query.state, req.query.code, req.user.id);
    res.redirect(`/w/${auth.tenantById(r.tenantId).slug}/conta?msg=google-ok`);
  } catch (e) { res.status(400).send(pages.message('Não foi possível conectar o Google Agenda', e.message, '/')); }
});

// ---------- API ----------
const api = express.Router({ mergeParams: true });
api.use((req, res, next) => {
  const ctx = auth.tenantCtx(req); if (!ctx) return fail(res, 404, 'not_found', 'Organização não encontrada.');
  Object.assign(req, ctx); req.uid = ctx.role ? req.user.id : null;
  if (req.headers['x-vx-mode'] === 'familia') { req.level = 0; req.uid = null; req.role = null; }
  next();
});
const need = (lvl) => (req, res, next) => (req.level >= lvl ? next() : fail(res, req.user ? 403 : 401, 'permission_denied', 'Seu acesso não permite esta ação.'));

api.get('/db/doc', (req, res) => {
  const segs = rules.parsePath(req.query.path, 'doc'); if (!segs) return fail(res, 400, 'invalid_argument', 'Caminho inválido.');
  if (!rules.allowed(req.level, segs, req.uid, 'get')) return fail(res, 403, 'permission_denied');
  if (req.level === 0 && !auth.rateLimit('pub:' + ip(req), 30, 60e3)) return fail(res, 429, 'resource_exhausted', 'Muitas tentativas. Aguarde um minuto.');
  const d = store.getDoc(req.tenant.id, req.query.path);
  res.json({ exists: !!d, data: d ? d.data : null });
});
api.get('/db/col', (req, res) => {
  const segs = rules.parsePath(req.query.path, 'col'); if (!segs) return fail(res, 400, 'invalid_argument', 'Caminho inválido.');
  if (!rules.allowed(req.level, segs, req.uid, 'list')) return fail(res, 403, 'permission_denied');
  res.json({ docs: store.listCol(req.tenant.id, req.query.path) });
});
api.post('/db/write', json, (req, res) => {
  const { op, path: p, data } = req.body || {};
  const segs = rules.parsePath(p, 'doc'); if (!segs) return fail(res, 400, 'invalid_argument', 'Caminho inválido.');
  if (!rules.allowed(req.level, segs, req.uid, 'write')) return fail(res, 403, 'permission_denied', 'Seu acesso não permite alterar este registro.');
  if (!auth.rateLimit('w:' + req.uid, 600, 60e3)) return fail(res, 429, 'resource_exhausted');
  try {
    if (op === 'set') store.setDoc(req.tenant.id, p, data, req.uid);
    else if (op === 'update') store.updateDoc(req.tenant.id, p, data, req.uid);
    else if (op === 'delete') store.deleteDoc(req.tenant.id, p);
    else return fail(res, 400, 'invalid_argument', 'Operação inválida.');
    res.json({ ok: true });
  } catch (e) { fail(res, e.code === 'not_found' ? 404 : 400, e.code || 'invalid_argument', e.message); }
});

api.get('/me', (req, res) => {
  if (!req.uid) return res.json({ id: null, name: '', avatarUrl: '', color: '#8a93a6', isOwner: false, canEdit: false, role: null });
  res.json({ ...auth.profile(req.user), email: req.user.email, isOwner: req.role === 'gestor', canEdit: req.level >= rules.LEVEL.admin, role: req.role });
});
api.post('/users/profiles', json, need(1), (req, res) => {
  const ids = [].concat((req.body && req.body.ids) || []).filter(x => typeof x === 'string').slice(0, 500);
  const out = {};
  if (ids.length) {
    const rows = db.q(`SELECT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id AND m.tenant_id = ? WHERE u.id IN (${ids.map(() => '?').join(',')})`).all(req.tenant.id, ...ids);
    for (const r of rows) out[r.id] = auth.profile(r);
  }
  res.json(out);
});
api.get('/users/search', need(1), (req, res) => {
  const t = String(req.query.q || '').trim().toLowerCase();
  const list = auth.membersOf(req.tenant.id).filter(m => !t || m.name.toLowerCase().includes(t) || (req.level >= rules.LEVEL.admin && m.email.includes(t))).slice(0, 20);
  res.json(list.map(m => ({ ...auth.profile(m), ...(req.level >= rules.LEVEL.admin ? { email: m.email } : {}) })));
});

// arquivos
api.post('/assets', need(rules.LEVEL.interact), express.raw({ type: () => true, limit: config.maxUploadMb + 'mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return fail(res, 400, 'invalid_argument', 'Arquivo vazio.');
  const id = db.rid(24);
  const ct = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().slice(0, 120) || 'application/octet-stream';
  const name = decodeURIComponent(String(req.headers['x-filename'] || '')).slice(0, 200) || null;
  const dir = path.join(config.assetsDir, req.tenant.id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), req.body);
  db.q('INSERT INTO assets (id, tenant_id, uploader_id, content_type, size_bytes, filename, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, req.tenant.id, req.uid, ct, req.body.length, name, db.now());
  res.json({ id, url: '/_blob/' + id, sizeBytes: req.body.length, contentType: ct });
});
api.delete('/assets/:id', need(rules.LEVEL.interact), (req, res) => {
  const a = db.q('SELECT * FROM assets WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenant.id);
  if (!a) return fail(res, 404, 'invalid_request', 'Arquivo não encontrado.');
  if (a.uploader_id !== req.uid && req.level < rules.LEVEL.admin) return fail(res, 403, 'not_uploader');
  db.q('DELETE FROM assets WHERE id = ?').run(a.id);
  fs.rmSync(path.join(config.assetsDir, req.tenant.id, a.id), { force: true });
  res.json({ deleted: true });
});

// Google
api.get('/google/status', need(rules.LEVEL.admin), (req, res) => res.json(google.status(req.tenant.id, req.uid)));
api.post('/google/disconnect', need(rules.LEVEL.admin), async (req, res) => { await google.disconnect(req.tenant.id, req.uid); res.json({ ok: true }); });
api.post('/google/create-event', json, need(rules.LEVEL.admin), async (req, res) => {
  try { res.json({ payload: await google.createEvent(req.tenant.id, req.uid, req.body && req.body.input) }); }
  catch (e) { fail(res, e.code === 'tool_error' ? 502 : 400, e.code || 'tool_error', e.message); }
});

// organização, equipe e modelo de documento
const ORG_FIELDS = ['marca1', 'marca2', 'subtitulo', 'razaoSocial', 'documento', 'endereco', 'representante', 'email', 'whatsapp', 'rodape'];
api.put('/org', json, need(rules.LEVEL.owner), (req, res) => {
  const b = req.body || {};
  const nome = String(b.nome || '').trim().slice(0, 120);
  if (!nome) return fail(res, 400, 'invalid_argument', 'Informe o nome da organização.');
  const s = { ...req.tenant.settings };
  for (const k of ORG_FIELDS) if (b[k] !== undefined) s[k] = String(b[k]).trim().slice(0, 300);
  db.q('UPDATE tenants SET name = ?, settings = ? WHERE id = ?').run(nome, JSON.stringify(s), req.tenant.id);
  res.json({ ok: true });
});
api.get('/team', need(rules.LEVEL.admin), (req, res) => res.json(auth.membersOf(req.tenant.id).map(m => ({ id: m.id, nome: m.name, email: m.email, papel: m.role, senhaProvisoria: !!m.must_change_password }))));
api.post('/team', json, need(rules.LEVEL.owner), async (req, res) => {
  const b = req.body || {};
  if (!auth.ROLES.includes(b.papel)) return fail(res, 400, 'invalid_argument', 'Escolha o papel.');
  const email = auth.normEmail(b.email);
  if (!auth.validEmail(email)) return fail(res, 400, 'invalid_argument', 'E-mail inválido.');
  let u = auth.userByEmail(email); let temp = null;
  if (u) { if (auth.roleIn(req.tenant.id, u.id)) return fail(res, 400, 'already_exists', 'Esta pessoa já faz parte da equipe.'); }
  else {
    if (!String(b.nome || '').trim()) return fail(res, 400, 'invalid_argument', 'Informe o nome.');
    temp = auth.tempPassword();
    u = await auth.createUser({ email, name: b.nome, password: temp, mustChange: true });
  }
  auth.addMember(req.tenant.id, u.id, b.papel);
  res.json({ id: u.id, senhaProvisoria: temp, contaExistente: !temp });
});
function lastOwner(tenantId, userId) {
  const owners = auth.membersOf(tenantId).filter(m => m.role === 'gestor');
  return owners.length === 1 && owners[0].id === userId;
}
api.patch('/team/:uid', json, need(rules.LEVEL.owner), (req, res) => {
  const papel = req.body && req.body.papel;
  if (!auth.ROLES.includes(papel)) return fail(res, 400, 'invalid_argument', 'Papel inválido.');
  if (!auth.roleIn(req.tenant.id, req.params.uid)) return fail(res, 404, 'not_found');
  if (papel !== 'gestor' && lastOwner(req.tenant.id, req.params.uid)) return fail(res, 400, 'invalid_argument', 'A organização precisa de pelo menos uma pessoa na gestão.');
  auth.addMember(req.tenant.id, req.params.uid, papel);
  realtime.dropUser(req.tenant.id, req.params.uid);
  res.json({ ok: true });
});
api.delete('/team/:uid', need(rules.LEVEL.owner), (req, res) => {
  if (!auth.roleIn(req.tenant.id, req.params.uid)) return fail(res, 404, 'not_found');
  if (lastOwner(req.tenant.id, req.params.uid)) return fail(res, 400, 'invalid_argument', 'A organização precisa de pelo menos uma pessoa na gestão.');
  db.q('DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?').run(req.tenant.id, req.params.uid);
  db.q('DELETE FROM google_tokens WHERE tenant_id = ? AND user_id = ?').run(req.tenant.id, req.params.uid);
  realtime.dropUser(req.tenant.id, req.params.uid);
  res.json({ ok: true });
});
api.post('/team/:uid/reset-password', need(rules.LEVEL.owner), async (req, res) => {
  const ts = db.q('SELECT tenant_id FROM memberships WHERE user_id = ?').all(req.params.uid);
  if (!ts.some(t => t.tenant_id === req.tenant.id)) return fail(res, 404, 'not_found');
  if (ts.length > 1) return fail(res, 400, 'invalid_argument', 'Esta pessoa usa a mesma conta em outra organização. Ela mesma precisa trocar a senha.');
  if (req.params.uid === req.uid) return fail(res, 400, 'invalid_argument', 'Para trocar a sua própria senha, use "Minha senha".');
  const temp = auth.tempPassword();
  await auth.setPassword(req.params.uid, temp, true);
  auth.destroyUserSessions(req.params.uid);
  realtime.dropUser(req.tenant.id, req.params.uid);
  res.json({ senhaProvisoria: temp });
});
api.put('/template', need(rules.LEVEL.owner), express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf.readUInt32LE(0) !== 0x04034b50) return fail(res, 400, 'invalid_argument', 'Envie um arquivo Word (.docx).');
  try {
    const zip = await require('jszip').loadAsync(buf);
    if (!zip.file('word/document.xml')) throw new Error('x');
  } catch (_) { return fail(res, 400, 'invalid_argument', 'O arquivo não parece ser um .docx válido.'); }
  fs.writeFileSync(path.join(config.templatesDir, req.tenant.id + '.docx'), buf);
  res.json({ ok: true });
});
api.delete('/template', need(rules.LEVEL.owner), (req, res) => { fs.rmSync(path.join(config.templatesDir, req.tenant.id + '.docx'), { force: true }); res.json({ ok: true }); });
api.get('/template/status', need(rules.LEVEL.admin), (req, res) => res.json({ proprio: fs.existsSync(path.join(config.templatesDir, req.tenant.id + '.docx')) }));
app.use('/api/t/:slug', api);

app.post('/api/me/password', json, async (req, res) => {
  if (!req.user) return fail(res, 401, 'unauthenticated');
  const b = req.body || {};
  const u = auth.userByEmail(req.user.email);
  if (!(await auth.checkPassword(b.atual, u.password_hash))) return fail(res, 400, 'invalid_argument', 'A senha atual não confere.');
  const p = auth.passwordProblem(b.nova); if (p) return fail(res, 400, 'invalid_argument', p);
  await auth.setPassword(u.id, b.nova, false);
  auth.destroyUserSessions(u.id, req.sessionToken);
  res.json({ ok: true });
});

// Arquivos enviados (anexos, imagens da Lousa, anexos do Planner). Mesmo caminho do Claude: /_blob/<id>
app.get('/_blob/:id', (req, res) => {
  const a = db.q('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!a || !req.user || !auth.roleIn(a.tenant_id, req.user.id)) return res.status(404).end();
  const file = path.join(config.assetsDir, a.tenant_id, a.id);
  if (!fs.existsSync(file)) return res.status(404).end();
  sendAsset(res, a, file);
});
function sendAsset(res, a, file) {
  const inline = /^(image\/(png|jpe?g|gif|webp|svg\+xml)|application\/pdf|video\/|audio\/)/.test(a.content_type);
  res.setHeader('Content-Type', a.content_type);
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const fname = encodeURIComponent(a.filename || a.id);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${fname}`);
  fs.createReadStream(file).pipe(res);
}

app.use((req, res) => res.status(404).send(pages.notFound()));
app.use((err, req, res, _next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return fail(res, 413, 'quota_exceeded', 'Arquivo ou registro grande demais.');
  if (req.path.startsWith('/api/')) return fail(res, 500, 'internal', 'Erro interno.');
  res.status(500).send(pages.message('Algo deu errado', 'Tente de novo em instantes.', '/'));
});

const server = http.createServer(app);
realtime.attach(server);
setInterval(() => auth.purgeExpired(), 6 * 3600e3).unref();

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`Vértice Gestão rodando em ${config.baseUrl} (porta ${config.port})`);
    if (!config.googleEnabled) console.log('Integração com o Google Agenda desativada (configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e TOKEN_ENC_KEY).');
    if (!fs.existsSync(APP_FILE)) console.warn('Atenção: public/app.html não existe. Rode "npm run build".');
  });
}

module.exports = { app, server };
