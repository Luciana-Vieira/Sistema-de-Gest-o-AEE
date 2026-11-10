'use strict';
// Cria/atualiza as tabelas do banco (aplica migrations/*.sql que ainda não rodaram).
const config = require('../server/config');
const db = require('../server/db');
const applied = db.migrate();
console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.');
console.log('Banco:', config.dbFile);
