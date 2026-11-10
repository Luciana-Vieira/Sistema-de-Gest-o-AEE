'use strict';
// Cópia de segurança consistente (pode rodar com o servidor ligado).
// Uso: npm run backup [-- --dir ./backups]
// Gera <dir>/<data-hora>/vertice.sqlite + assets/ + templates/
const fs = require('node:fs');
const path = require('node:path');
const args = require('./_args')();
const config = require('../server/config');
const db = require('../server/db');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const dest = path.resolve(args.dir && args.dir !== true ? args.dir : path.join(config.dataDir, '..', 'backups'), stamp);
fs.mkdirSync(dest, { recursive: true });
db.open().exec(`VACUUM INTO '${path.join(dest, 'vertice.sqlite').replace(/'/g, "''")}'`);
for (const d of ['assets', 'templates']) {
  const src = path.join(config.dataDir, d);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, d), { recursive: true });
}
console.log('Backup salvo em', dest);
