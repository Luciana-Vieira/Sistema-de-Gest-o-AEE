'use strict';
// Armazenamento de documentos JSON por organização + aviso de mudanças (tempo real).
const { EventEmitter } = require('node:events');
const { q, now, tx } = require('./db');

const bus = new EventEmitter();
bus.setMaxListeners(0);
const MAX_DOC_BYTES = 1024 * 1024; // 1 MB por documento

function err(code, message) { return Object.assign(new Error(message || code), { code }); }
const split = (p) => { const i = p.lastIndexOf('/'); return { parent: p.slice(0, i), id: p.slice(i + 1) }; };

function getDoc(tenantId, path) {
  const r = q('SELECT id, data FROM docs WHERE tenant_id = ? AND path = ?').get(tenantId, path);
  return r ? { id: r.id, data: JSON.parse(r.data) } : null;
}
function listCol(tenantId, parent) {
  return q('SELECT id, data FROM docs WHERE tenant_id = ? AND parent = ? ORDER BY id').all(tenantId, parent)
    .map(r => ({ id: r.id, data: JSON.parse(r.data) }));
}
function checkData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw err('invalid_argument', 'O documento precisa ser um objeto JSON.');
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > MAX_DOC_BYTES) throw err('invalid_argument', 'Documento grande demais (máximo 1 MB).');
  return json;
}
function emit(tenantId, path, data) {
  const { parent, id } = split(path);
  bus.emit('change', { tenantId, path, parent, id, data });
}
function setDoc(tenantId, path, data, uid) {
  const json = checkData(data);
  const { parent, id } = split(path);
  q(`INSERT INTO docs (tenant_id, path, parent, id, data, version, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(tenant_id, path) DO UPDATE SET data = excluded.data, version = docs.version + 1,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(tenantId, path, parent, id, json, now(), uid || null);
  emit(tenantId, path, JSON.parse(json));
}
function updateDoc(tenantId, path, patch, uid) {
  checkData(patch);
  const merged = tx(() => {
    const cur = getDoc(tenantId, path);
    if (!cur) throw err('not_found', 'Documento não encontrado.');
    const m = { ...cur.data, ...patch };
    for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
    const json = checkData(m);
    q('UPDATE docs SET data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND path = ?')
      .run(json, now(), uid || null, tenantId, path);
    return m;
  });
  emit(tenantId, path, merged);
}
function deleteDoc(tenantId, path) {
  const r = q('DELETE FROM docs WHERE tenant_id = ? AND path = ?').run(tenantId, path);
  if (r.changes) emit(tenantId, path, null);
}

module.exports = { bus, err, getDoc, listCol, setDoc, updateDoc, deleteDoc };
