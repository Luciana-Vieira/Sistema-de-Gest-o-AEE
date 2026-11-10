/*
 * Camada de compatibilidade: substitui o ambiente de execução do Claude (window.claude.use)
 * pelo servidor próprio do Vértice Gestão. O código do sistema continua chamando
 *   window.claude.use("db" | "user" | "room" | "assets" | "downloads" | "mcp")
 * e recebe objetos com a mesma interface, que agora falam com a API REST e o WebSocket
 * deste servidor. Detalhes em docs/DEPENDENCIAS-CLAUDE.md.
 */
(function () {
  'use strict';
  const CFG = window.VX_CONFIG || {};
  if (!CFG.tenant) { console.error('VX_CONFIG ausente: a página precisa ser servida pelo servidor do Vértice Gestão.'); return; }
  const SLUG = CFG.tenant.slug;
  const API = '/api/t/' + encodeURIComponent(SLUG);
  const FAM = CFG.mode === 'familia';
  const BASE_H = Object.assign({ 'X-VX': '1' }, FAM ? { 'X-VX-Mode': 'familia' } : {});
  const enc = encodeURIComponent;
  const clone = (v) => (v == null ? v : (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))));

  function E(code, message) { const e = new Error(message || code); e.code = code; return e; }
  async function req(method, url, body, opts) {
    opts = opts || {};
    const headers = Object.assign({}, BASE_H, opts.headers || {});
    if (body !== undefined && !opts.raw) headers['Content-Type'] = 'application/json';
    let r;
    try {
      r = await fetch(API + url, { method, headers, credentials: 'same-origin', body: opts.raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
    } catch (_) { throw E('unavailable', 'Sem conexão com o servidor.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && !FAM) setTimeout(() => location.assign('/login?next=' + enc(location.pathname)), 1500);
      throw E(j.code || (r.status >= 500 ? 'unavailable' : 'invalid_argument'), j.message);
    }
    return j;
  }
  const ID_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function newId() { const b = new Uint8Array(20); crypto.getRandomValues(b); let s = ''; for (const x of b) s += ID_ABC[x % 62]; return s; }

  // ---------------- WebSocket (assinaturas e sala) ----------------
  const META = Object.freeze({ fromCache: false, hasPendingWrites: false });
  let ws = null, wsOpen = false, myPeer = null, myUid = null, retry = 0, sidSeq = 0, ridSeq = 0;
  const subs = new Map();           // sid -> { kind, path, next, error, map }
  const acks = new Map();           // rid -> {res, rej}
  const roomL = new Map();          // topic -> Set<{cb}>
  const peersL = new Set(); const connL = new Set();
  let lastPeers = null, myPresence = null;

  function connect() {
    if (ws) return;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?t=' + enc(SLUG) + (FAM ? '&familia=1' : '');
    ws = new WebSocket(url);
    ws.onopen = () => {
      wsOpen = true; retry = 0;
      for (const [sid, s] of subs) ws.send(JSON.stringify({ t: 'sub', sid, kind: s.kind, path: s.path }));
      if (myPresence) ws.send(JSON.stringify({ t: 'presence', patch: myPresence }));
      else if (peersL.size) ws.send(JSON.stringify({ t: 'peers' }));
      connL.forEach(f => { try { f(true); } catch (_) {} });
    };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } onMsg(m); };
    ws.onclose = (ev) => {
      ws = null; const was = wsOpen; wsOpen = false;
      for (const [, a] of acks) a.rej(E('unavailable')); acks.clear();
      if (was) connL.forEach(f => { try { f(false); } catch (_) {} });
      if (ev && ev.code === 4001) { // acesso alterado: recarrega com o papel novo
        subs.forEach(s => s.error && s.error(E('revoked')));
        setTimeout(() => location.reload(), 1200); return;
      }
      if (subs.size || connL.size || roomL.size || peersL.size) setTimeout(connect, Math.min(15000, 500 * 2 ** retry++));
    };
  }
  const wsSend = (m) => { connect(); if (wsOpen) ws.send(JSON.stringify(m)); };

  function docSnap(id, exists, data) { const d = exists ? data : undefined; return { id, exists: !!exists, data: () => clone(d), metadata: META }; }
  function querySnap(map, changes) {
    const docs = [...map.entries()].map(([id, d]) => docSnap(id, true, d));
    return { docs, size: docs.length, empty: !docs.length, metadata: META, docChanges: () => changes, forEach: (f) => docs.forEach(f) };
  }

  function onMsg(m) {
    if (m.t === 'hello') { myPeer = m.peer; myUid = m.uid; return; }
    if (m.t === 'snap' || m.t === 'chg' || m.t === 'doc' || m.t === 'err') {
      const s = subs.get(m.sid); if (!s) return;
      if (m.t === 'err') { subs.delete(m.sid); if (s.error) s.error(E(m.code)); return; }
      if (m.t === 'doc') { s.next(docSnap(s.path.split('/').pop(), m.exists, m.data)); return; }
      if (m.t === 'snap') {
        const old = s.map; s.map = new Map(m.docs.map(d => [d.id, d.data]));
        const ch = [];
        for (const [id, d] of s.map) ch.push({ type: old && old.has(id) ? 'modified' : 'added', doc: docSnap(id, true, d) });
        if (old) for (const [id, d] of old) if (!s.map.has(id)) ch.push({ type: 'removed', doc: docSnap(id, true, d) });
        s.next(querySnap(s.map, ch)); return;
      }
      if (!s.map) return;
      let type;
      if (m.data == null) { if (!s.map.has(m.id)) return; type = 'removed'; const d = s.map.get(m.id); s.map.delete(m.id); s.next(querySnap(s.map, [{ type, doc: docSnap(m.id, true, d) }])); return; }
      type = s.map.has(m.id) ? 'modified' : 'added'; s.map.set(m.id, m.data);
      s.next(querySnap(s.map, [{ type, doc: docSnap(m.id, true, m.data) }]));
      return;
    }
    if (m.t === 'ack') { const a = acks.get(m.rid); if (a) { acks.delete(m.rid); m.ok ? a.res() : a.rej(E(m.code)); } return; }
    if (m.t === 'room') {
      const msg = { topic: m.topic, data: m.data, peer: m.peer, by: m.by, kind: 'viewer', isMe: !!m.by && m.by === myUid, sameTab: m.peer === myPeer };
      (roomL.get(m.topic) || []).forEach(l => { try { l(msg); } catch (e) { console.error(e); } });
      return;
    }
    if (m.t === 'peers') {
      const peers = m.peers.map(p => Object.assign({}, p, { sameTab: p.peer === myPeer }));
      const byId = new Map(peers.map(p => [p.peer, p]));
      lastPeers = { peers, joined: (m.joined || []).map(id => byId.get(id)).filter(Boolean), left: (m.left || []).map(id => ({ peer: id })), updated: (m.updated || []).map(id => byId.get(id)).filter(Boolean) };
      peersL.forEach(f => { try { f(lastPeers); } catch (e) { console.error(e); } });
    }
  }

  function subscribe(kind, path, next, error) {
    const sid = 's' + (++sidSeq);
    subs.set(sid, { kind, path, next, error, map: null });
    wsSend({ t: 'sub', sid, kind, path });
    return () => { if (subs.delete(sid) && wsOpen) ws.send(JSON.stringify({ t: 'unsub', sid })); };
  }

  // ---------------- db ----------------
  const write = (op, path, data) => req('POST', '/db/write', { op, path, data }).then(() => undefined);
  function docRef(path) {
    const id = path.split('/').pop();
    return {
      id, path,
      get: async () => { const j = await req('GET', '/db/doc?path=' + enc(path)); return docSnap(id, j.exists, j.data); },
      set: (data) => write('set', path, JSON.parse(JSON.stringify(data))),
      update: (data) => write('update', path, JSON.parse(JSON.stringify(data))),
      delete: () => write('delete', path),
      onSnapshot: (next, error) => subscribe('doc', path, next, error),
      collection: (sub) => colRef(path + '/' + sub),
    };
  }
  function colRef(path) {
    return {
      id: path.split('/').pop(), path,
      doc: (id) => docRef(path + '/' + (id || newId())),
      get: async () => { const j = await req('GET', '/db/col?path=' + enc(path)); return querySnap(new Map(j.docs.map(d => [d.id, d.data])), []); },
      onSnapshot: (next, error) => subscribe('col', path, next, error),
    };
  }
  const db = { collection: colRef, doc: docRef };

  // ---------------- user ----------------
  const ANON = { id: null, name: '', avatarUrl: '', color: '#8a93a6', isOwner: false, canEdit: false };
  let meP = null;
  const me = () => (meP = meP || req('GET', '/me').catch(() => ANON));
  const user = {
    me: async () => Object.assign({}, await me()),
    id: async () => (await me()).id,
    isOwner: async () => !!(await me()).isOwner,
    can: async (perm) => (perm === 'data.write' ? !!(await me()).canEdit : false),
    profiles: async (ids) => ((await me()).id ? req('POST', '/users/profiles', { ids: [].concat(ids || []) }) : {}),
    search: async (q) => ((await me()).id ? req('GET', '/users/search?q=' + enc(q || '')) : []),
  };

  // ---------------- room (Lousa Viva) ----------------
  const room = {
    emit(topic, data) {
      connect();
      if (!wsOpen) return Promise.reject(E('unavailable'));
      const rid = 'r' + (++ridSeq);
      return new Promise((res, rej) => { acks.set(rid, { res, rej }); ws.send(JSON.stringify({ t: 'emit', rid, topic, data })); });
    },
    on(topic, cb) { if (!roomL.has(topic)) roomL.set(topic, new Set()); roomL.get(topic).add(cb); connect(); return () => roomL.get(topic).delete(cb); },
    presence(patch) { myPresence = Object.assign({}, myPresence || {}, patch || {}); wsSend({ t: 'presence', patch: patch || {} }); return Promise.resolve(); },
    onPeers(cb) { peersL.add(cb); connect(); if (lastPeers) cb(lastPeers); else wsSend({ t: 'peers' }); return () => peersL.delete(cb); },
    onConnection(cb) { connL.add(cb); connect(); cb(wsOpen); return () => connL.delete(cb); },
  };

  // ---------------- arquivos ----------------
  const assets = {
    upload: (blob, opts) => {
      const type = (opts && opts.type) || blob.type || 'application/octet-stream';
      return req('POST', '/assets', blob, { raw: true, headers: { 'Content-Type': type, 'X-Filename': enc(blob.name || '') } });
    },
    delete: (id) => req('DELETE', '/assets/' + enc(id)),
  };
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data], { type: typeof data === 'string' ? 'text/plain;charset=utf-8' : 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename || 'arquivo'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { status: 'saved' };
    },
  };

  // ---------------- integrações (antes: conectores do Claude) ----------------
  const mcp = {
    callTool: async (server, tool, input) => {
      if (server !== 'Google Calendar' || tool !== 'create_event') throw E('not_in_manifest', 'Integração não disponível.');
      const j = await req('POST', '/google/create-event', { input });
      return { payload: j.payload };
    },
  };

  const CAPS = { db, user, room, assets, downloads, mcp };
  window.claude = Object.freeze({ use: (name) => (CAPS[name] ? Promise.resolve(CAPS[name]) : Promise.reject(E('not_granted', 'Recurso indisponível: ' + name))) });

  // Botão "Sair" para quem não usa a barra lateral (alunos e familiares com conta).
  if (!FAM && CFG.user && !['gestor', 'equipe'].includes(CFG.user.role)) {
    document.addEventListener('DOMContentLoaded', () => {
      const f = document.createElement('form'); f.method = 'post'; f.action = '/logout';
      f.style.cssText = 'position:fixed;right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(64px + env(safe-area-inset-bottom,0px));z-index:40;margin:0';
      f.innerHTML = '<button type="submit" style="font:600 12.5px/1 Montserrat,system-ui,sans-serif;background:#0D1B3D;color:#fff;border:0;border-radius:999px;padding:9px 14px;cursor:pointer">Sair</button>';
      document.body.appendChild(f);
    });
  }
})();
