'use strict';
// Integração com o Google Agenda (substitui o conector "Google Calendar" do Claude).
// Cada pessoa da equipe conecta a própria conta Google; o sistema cria o evento
// com sala do Google Meet e devolve o link para a aula ou reunião.
const crypto = require('node:crypto');
const config = require('./config');
const { q, now } = require('./db');

const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email'];
const REDIRECT_PATH = '/oauth/google/callback';
const redirectUri = () => config.baseUrl + REDIRECT_PATH;
const gErr = (code, message) => Object.assign(new Error(message || code), { code });

// ---- criptografia dos tokens (AES-256-GCM) ----
function key() {
  const k = Buffer.from(config.tokenKey, 'base64');
  if (k.length !== 32) throw gErr('server_misconfigured', 'TOKEN_ENC_KEY precisa ter 32 bytes em base64.');
  return k;
}
function enc(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const out = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), out].map(b => b.toString('base64')).join('.');
}
function dec(s) {
  const [iv, tag, data] = String(s).split('.').map(x => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// ---- fluxo OAuth ----
function authUrl(tenantId, userId) {
  if (!config.googleEnabled) throw gErr('server_not_configured');
  const state = crypto.randomBytes(24).toString('base64url');
  q('DELETE FROM oauth_states WHERE created_at < ?').run(Date.now() - 15 * 60e3);
  q('INSERT INTO oauth_states (state, tenant_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(state, tenantId, userId, Date.now());
  const p = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: redirectUri(), response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `${config.google.authUrl}?${p}`;
}

async function tokenRequest(params) {
  const r = await fetch(config.google.tokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw gErr(j.error === 'invalid_grant' ? 'needs_reauth' : 'tool_error', j.error_description || j.error || `HTTP ${r.status}`);
  return j;
}

function emailFromIdToken(idt) {
  try { return JSON.parse(Buffer.from(String(idt).split('.')[1], 'base64url').toString('utf8')).email || null; } catch (_) { return null; }
}

// Retorna { tenantId, userId } para redirecionar de volta à página da organização.
async function handleCallback(state, code, sessionUserId) {
  const st = q('SELECT * FROM oauth_states WHERE state = ?').get(String(state || ''));
  if (!st) throw gErr('invalid_state', 'Pedido expirado. Tente conectar de novo.');
  q('DELETE FROM oauth_states WHERE state = ?').run(st.state);
  if (st.user_id !== sessionUserId) throw gErr('invalid_state', 'Entre com a mesma conta que pediu a conexão.');
  if (Date.now() - st.created_at > 15 * 60e3) throw gErr('invalid_state', 'Pedido expirado. Tente conectar de novo.');
  const tok = await tokenRequest({ code: String(code || ''), grant_type: 'authorization_code', redirect_uri: redirectUri() });
  const prev = q('SELECT refresh_enc FROM google_tokens WHERE tenant_id = ? AND user_id = ?').get(st.tenant_id, st.user_id);
  if (!tok.refresh_token && !prev) throw gErr('needs_reauth', 'O Google não enviou a autorização permanente. Remova o acesso do app na sua conta Google e conecte de novo.');
  q(`INSERT INTO google_tokens (tenant_id, user_id, google_email, refresh_enc, access_enc, expires_at, scope, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, user_id) DO UPDATE SET google_email = excluded.google_email,
       refresh_enc = excluded.refresh_enc, access_enc = excluded.access_enc, expires_at = excluded.expires_at,
       scope = excluded.scope, updated_at = excluded.updated_at`)
    .run(st.tenant_id, st.user_id, emailFromIdToken(tok.id_token),
      tok.refresh_token ? enc(tok.refresh_token) : prev.refresh_enc, enc(tok.access_token),
      Date.now() + (tok.expires_in || 3600) * 1000, tok.scope || '', now());
  return { tenantId: st.tenant_id, userId: st.user_id };
}

function status(tenantId, userId) {
  const r = q('SELECT google_email, updated_at FROM google_tokens WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId);
  return { configured: config.googleEnabled, connected: !!r, email: r ? r.google_email : null, since: r ? r.updated_at : null };
}

async function disconnect(tenantId, userId) {
  const r = q('SELECT refresh_enc FROM google_tokens WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId);
  q('DELETE FROM google_tokens WHERE tenant_id = ? AND user_id = ?').run(tenantId, userId);
  if (r) { try { await fetch(config.google.revokeUrl + '?token=' + encodeURIComponent(dec(r.refresh_enc)), { method: 'POST' }); } catch (_) {} }
}

async function accessToken(tenantId, userId) {
  if (!config.googleEnabled) throw gErr('server_not_configured', 'A integração com o Google não foi configurada neste servidor.');
  const r = q('SELECT * FROM google_tokens WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId);
  if (!r) throw gErr('server_not_connected');
  if (r.access_enc && r.expires_at > Date.now() + 60e3) return dec(r.access_enc);
  const tok = await tokenRequest({ refresh_token: dec(r.refresh_enc), grant_type: 'refresh_token' });
  q('UPDATE google_tokens SET access_enc = ?, expires_at = ?, updated_at = ? WHERE tenant_id = ? AND user_id = ?')
    .run(enc(tok.access_token), Date.now() + (tok.expires_in || 3600) * 1000, now(), tenantId, userId);
  return tok.access_token;
}

// Mesmo formato de entrada que o sistema usava com o conector do Claude:
// { summary, startTime "YYYY-MM-DDTHH:MM:SS", endTime, description, addGoogleMeetUrl, attendees:[{email}] }
async function createEvent(tenantId, userId, input) {
  const i = input || {};
  const dt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
  if (!i.summary || !dt.test(i.startTime || '') || !dt.test(i.endTime || '')) throw gErr('invalid_argument', 'Título, início e fim são obrigatórios.');
  const attendees = (Array.isArray(i.attendees) ? i.attendees : []).filter(a => a && /^[^\s@]+@[^\s@]+$/.test(a.email || '')).slice(0, 20).map(a => ({ email: a.email }));
  const body = {
    summary: String(i.summary).slice(0, 300),
    description: String(i.description || '').slice(0, 8000),
    start: { dateTime: i.startTime.length === 16 ? i.startTime + ':00' : i.startTime, timeZone: config.timezone },
    end: { dateTime: i.endTime.length === 16 ? i.endTime + ':00' : i.endTime, timeZone: config.timezone },
    attendees,
  };
  if (i.addGoogleMeetUrl !== false) body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  const token = await accessToken(tenantId, userId);
  const url = `${config.google.apiBase}/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${attendees.length ? 'all' : 'none'}`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw gErr('needs_reauth');
  if (!r.ok) throw gErr('tool_error', (j.error && j.error.message) || `HTTP ${r.status}`);
  const video = ((j.conferenceData && j.conferenceData.entryPoints) || []).find(e => e.entryPointType === 'video');
  const conferenceUrl = j.hangoutLink || (video && video.uri) || '';
  return { ...j, conferenceUrl, conferenceData: { ...(j.conferenceData || {}), videoEntryPoint: conferenceUrl ? { uri: conferenceUrl } : undefined } };
}

module.exports = { REDIRECT_PATH, authUrl, handleCallback, status, disconnect, createEvent };
