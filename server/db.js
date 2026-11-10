'use strict';
// Banco de dados SQLite (módulo nativo node:sqlite, sem compilação).
// Para trocar por PostgreSQL, veja docs/ARQUITETURA.md (seção "Banco de dados").
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let db;
function open(file = config.dbFile) {
  if (db) return db;
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

function migrate() {
  const d = open();
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(d.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  const dir = path.join(config.root, 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    tx(() => {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(f, now());
    });
    applied.push(f);
  }
  return applied;
}

function tx(fn) {
  const d = open();
  d.exec('BEGIN IMMEDIATE');
  try { const r = fn(); d.exec('COMMIT'); return r; }
  catch (e) { try { d.exec('ROLLBACK'); } catch (_) {} throw e; }
}

const now = () => new Date().toISOString();
const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
function rid(n = 16, prefix = '') {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length];
  return prefix + s;
}
const q = (sql) => open().prepare(sql);
const plain = (r) => (r ? { ...r } : r);

module.exports = { open, migrate, tx, now, rid, q, plain };
