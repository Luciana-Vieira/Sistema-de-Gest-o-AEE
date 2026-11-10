'use strict';
// Tempo real via WebSocket: assinaturas de documentos/coleções e a "sala" da Lousa Viva
// (traço ao vivo, laser, presença de quem está na tela).
const { WebSocketServer } = require('ws');
const { bus, getDoc, listCol } = require('./store');
const { parsePath, allowed, roomAllowed, ROLE_LEVEL } = require('./rules');
const auth = require('./auth');
const { rid } = require('./db');

const byTenant = new Map(); // tenantId -> Set<conn>

function send(c, msg) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); }
const peerOf = (c) => ({ peer: c.peer, by: c.uid, kind: 'viewer', presence: c.presence });
function peersMsg(tenantId, extra) {
  const set = byTenant.get(tenantId) || new Set();
  const peers = [...set].filter(c => c.level > 0 && c.presence).map(peerOf);
  for (const c of set) if (c.level > 0) send(c, { t: 'peers', peers, ...extra });
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const t = auth.tenantBySlug(url.searchParams.get('t'));
    if (!t) { socket.destroy(); return; }
    const familia = url.searchParams.get('familia') === '1';
    const user = familia ? null : auth.sessionUser(auth.parseCookies(req.headers.cookie)[auth.COOKIE]);
    const role = user ? auth.roleIn(t.id, user.id) : null;
    wss.handleUpgrade(req, socket, head, ws => {
      const c = { ws, tenantId: t.id, uid: role ? user.id : null, level: role ? ROLE_LEVEL[role] : 0, peer: rid(10, 'p'), subs: new Map(), presence: null, alive: true };
      if (!byTenant.has(t.id)) byTenant.set(t.id, new Set());
      byTenant.get(t.id).add(c);
      send(c, { t: 'hello', peer: c.peer, uid: c.uid });
      ws.on('pong', () => { c.alive = true; });
      ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch (_) { return; } try { onMessage(c, m); } catch (e) { send(c, { t: 'err', sid: m && m.sid, code: e.code || 'internal' }); } });
      ws.on('close', () => {
        const set = byTenant.get(t.id); if (set) { set.delete(c); if (!set.size) byTenant.delete(t.id); }
        if (c.presence) peersMsg(t.id, { joined: [], left: [c.peer], updated: [] });
      });
    });
  });

  function onMessage(c, m) {
    if (m.t === 'sub') {
      const kind = m.kind === 'doc' ? 'doc' : 'col';
      const segs = parsePath(m.path, kind);
      if (!segs) return send(c, { t: 'err', sid: m.sid, code: 'invalid_argument' });
      if (!allowed(c.level, segs, c.uid, kind === 'doc' ? 'get' : 'list') || (kind === 'doc' && c.level === 0))
        return send(c, { t: 'err', sid: m.sid, code: 'permission_denied' });
      c.subs.set(m.sid, { kind, path: m.path });
      if (kind === 'doc') { const d = getDoc(c.tenantId, m.path); send(c, { t: 'doc', sid: m.sid, exists: !!d, data: d ? d.data : null }); }
      else send(c, { t: 'snap', sid: m.sid, docs: listCol(c.tenantId, m.path) });
      return;
    }
    if (m.t === 'unsub') { c.subs.delete(m.sid); return; }
    if (m.t === 'emit') {
      if (c.level < 1 || typeof m.topic !== 'string' || m.topic.length > 40) return send(c, { t: 'ack', rid: m.rid, ok: false, code: 'permission_denied' });
      if (!roomAllowed(c.level, m.topic)) return send(c, { t: 'ack', rid: m.rid, ok: false, code: 'permission_denied' });
      const out = { t: 'room', topic: m.topic, data: m.data, peer: c.peer, by: c.uid };
      for (const o of byTenant.get(c.tenantId) || []) if (o.level > 0) send(o, out);
      return send(c, { t: 'ack', rid: m.rid, ok: true });
    }
    if (m.t === 'presence') {
      if (c.level < 1) return;
      const first = !c.presence;
      c.presence = { ...(c.presence || {}), ...(m.patch && typeof m.patch === 'object' ? m.patch : {}) };
      peersMsg(c.tenantId, first ? { joined: [c.peer], left: [], updated: [] } : { joined: [], left: [], updated: [c.peer] });
      return;
    }
    if (m.t === 'peers') { if (c.level > 0) peersMsg(c.tenantId, { joined: [], left: [], updated: [] }); return; }
  }

  bus.on('change', ch => {
    const set = byTenant.get(ch.tenantId); if (!set) return;
    for (const c of set) for (const [sid, s] of c.subs) {
      if (s.kind === 'doc' && s.path === ch.path) send(c, { t: 'doc', sid, exists: ch.data != null, data: ch.data });
      else if (s.kind === 'col' && s.path === ch.parent) send(c, { t: 'chg', sid, id: ch.id, data: ch.data });
    }
  });

  const hb = setInterval(() => {
    for (const set of byTenant.values()) for (const c of set) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false; try { c.ws.ping(); } catch (_) {}
    }
  }, 30000);
  hb.unref();
  return wss;
}

// Encerra as conexões de alguém que perdeu o acesso (o navegador reconecta com o novo papel).
function dropUser(tenantId, userId) {
  for (const c of byTenant.get(tenantId) || []) if (c.uid === userId) c.ws.close(4001, 'revoked');
}

module.exports = { attach, dropUser };
