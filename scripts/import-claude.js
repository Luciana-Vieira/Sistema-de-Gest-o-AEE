'use strict';
// Importa para uma organização os dados exportados da versão do sistema que roda no Claude.
//
// Formato do arquivo (JSON):
//   {
//     "docs":   { "alunos/abc": {...}, "aulas/xyz": {...}, "lv_ink/<id>/boards/<b>/els/<e>": {...}, ... },
//     "assets": [ { "id": "<id do arquivo>", "contentType": "application/pdf", "filename": "laudo.pdf" }, ... ]
//   }
// Os arquivos (anexos, imagens da Lousa) ficam numa pasta, cada um com o nome igual ao id.
//
// Uso:
//   npm run import-claude -- --file export.json --tenant minha-escola [--assets-dir ./arquivos]
//        [--map <id-no-claude>=<email>] [--map ...] [--dry-run]
//
// --map troca o id de uma pessoa no Claude pelo id da conta nova (procurada pelo e-mail),
// tanto nos caminhos (ex.: tinta da Lousa) quanto nos campos (autor, responsáveis do Planner).
const fs = require('node:fs');
const path = require('node:path');
const config = require('../server/config');
const db = require('../server/db');
db.migrate();
const auth = require('../server/auth');
const store = require('../server/store');
const { parsePath } = require('../server/rules');

const argv = process.argv.slice(2);
const get = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const all = (k) => argv.flatMap((a, i) => (a === '--' + k ? [argv[i + 1]] : []));
const dry = argv.includes('--dry-run');

function fail(m) { console.error('Erro:', m); process.exit(1); }
const file = get('file'), slug = get('tenant');
if (!file || !slug) fail('use --file <export.json> --tenant <endereço da organização>');
const tenant = auth.tenantBySlug(slug); if (!tenant) fail(`organização "${slug}" não existe (crie com npm run create-owner).`);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!data.docs || typeof data.docs !== 'object') fail('o arquivo não tem a chave "docs".');

const map = new Map();
for (const m of all('map')) {
  const [from, email] = String(m).split('=');
  const u = auth.userByEmail(email || ''); if (!u) fail(`--map ${m}: não existe conta com o e-mail ${email}.`);
  if (!auth.roleIn(tenant.id, u.id)) fail(`--map ${m}: ${email} não faz parte da organização ${slug}.`);
  map.set(from, u.id);
}
const swap = (s) => (map.has(s) ? map.get(s) : s);
const walk = (v) => (typeof v === 'string' ? swap(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [swap(k), walk(x)])) : v);

let ok = 0, bad = [];
for (const [p0, d] of Object.entries(data.docs)) {
  const p = p0.split('/').map(swap).join('/');
  if (!parsePath(p, 'doc') || !d || typeof d !== 'object') { bad.push(p0); continue; }
  if (!dry) store.setDoc(tenant.id, p, walk(d), null);
  ok++;
}
let files = 0, missing = [];
const dir = get('assets-dir');
for (const a of Array.isArray(data.assets) ? data.assets : []) {
  if (!a || !/^[A-Za-z0-9_-]{6,80}$/.test(a.id || '')) { missing.push(String(a && a.id)); continue; }
  const src = dir && path.join(dir, a.id);
  if (!src || !fs.existsSync(src)) { missing.push(a.id); continue; }
  if (!dry) {
    const dest = path.join(config.assetsDir, tenant.id); fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(src, path.join(dest, a.id));
    const size = fs.statSync(src).size;
    db.q(`INSERT INTO assets (id, tenant_id, uploader_id, content_type, size_bytes, filename, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET content_type = excluded.content_type, size_bytes = excluded.size_bytes, filename = excluded.filename`)
      .run(a.id, tenant.id, a.contentType || 'application/octet-stream', size, a.filename || null, db.now());
  }
  files++;
}
console.log(`${dry ? '[simulação] ' : ''}Documentos importados: ${ok}. Arquivos: ${files}.`);
if (bad.length) console.log(`Ignorados (caminho inválido): ${bad.length}`, bad.slice(0, 10));
if (missing.length) console.log(`Arquivos não encontrados na pasta: ${missing.length}`, missing.slice(0, 10));
console.log('Depois de importar, abra o sistema com uma conta da gestão: o Portal da Família é republicado automaticamente.');
