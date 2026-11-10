'use strict';
// Cria a organização de demonstração "demo" com dados fictícios (alunos, aulas, finanças,
// boletins, acervo, PDI e Planner) e três contas de exemplo. As senhas são geradas agora e
// mostradas uma única vez. Uso: npm run seed   (use --reset para apagar e recriar a demo)
const fs = require('node:fs');
const path = require('node:path');
const args = require('./_args')();
const config = require('../server/config');
const db = require('../server/db');
db.migrate();
const auth = require('../server/auth');
const store = require('../server/store');
const { createOrganization } = require('../server/org');

const SLUG = 'demo';
(async () => {
  const old = auth.tenantBySlug(SLUG);
  if (old && !args.reset) { console.log(`A organização "${SLUG}" já existe. Use "npm run seed -- --reset" para recriar.`); process.exit(0); }
  if (old) {
    const users = db.q('SELECT user_id FROM memberships WHERE tenant_id = ?').all(old.id).map(r => r.user_id);
    db.q('DELETE FROM tenants WHERE id = ?').run(old.id);
    for (const u of users) if (!db.q('SELECT 1 FROM memberships WHERE user_id = ?').get(u)) db.q('DELETE FROM users WHERE id = ?').run(u);
    fs.rmSync(path.join(config.assetsDir, old.id), { recursive: true, force: true });
  }
  const pw = { gestor: auth.tempPassword(), equipe: auth.tempPassword(), aluno: auth.tempPassword() };
  const { tenant, user } = await createOrganization({ slug: SLUG, org: 'Espaço Demonstração', nome: 'Helena Duarte', email: 'gestao@demo.local', senha: pw.gestor });
  db.q('UPDATE tenants SET settings = ? WHERE id = ?').run(JSON.stringify({
    marca1: 'ESPAÇO', marca2: 'DEMONSTRAÇÃO', subtitulo: 'Aulas particulares e apoio escolar',
    razaoSocial: 'Espaço Demonstração Ltda.', documento: '00.000.000/0001-00', endereco: 'Rua Exemplo, 100 • Centro • Cidade/UF',
    representante: 'Helena Duarte', email: 'contato@demo.local', whatsapp: '(00) 9 0000-0000', rodape: 'demo.local',
  }), tenant.id);
  const prof = await auth.createUser({ email: 'professor@demo.local', name: 'Rafael Moreira', password: pw.equipe });
  auth.addMember(tenant.id, prof.id, 'equipe');
  const alu = await auth.createUser({ email: 'aluno@demo.local', name: 'Sofia Ramos', password: pw.aluno });
  auth.addMember(tenant.id, alu.id, 'aluno');

  const seed = JSON.parse(fs.readFileSync(path.join(config.root, 'seed', 'demo.json'), 'utf8'));
  const shift = Math.round((Date.now() - Date.parse(seed._dataBase + 'T12:00:00Z')) / 864e5);
  const mv = (s) => {
    const m = /^(\d{4}-\d{2}-\d{2})(T.*)?$/.exec(s); if (!m) return s;
    const d = new Date(m[1] + 'T12:00:00Z'); if (isNaN(d)) return s;
    d.setUTCDate(d.getUTCDate() + shift);
    return d.toISOString().slice(0, 10) + (m[2] || '');
  };
  const walk = (v) => (typeof v === 'string' ? mv(v === 'u_1' ? user.id : v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  let n = 0;
  for (const [p, data] of Object.entries(seed.docs)) { store.setDoc(tenant.id, p, walk(data), user.id); n++; }
  store.setDoc(tenant.id, 'ajustes/geral', { equipe: ['Helena Duarte', 'Rafael Moreira'], assinatura: 'Helena Duarte — Pedagoga', contrato: { cidade: 'Cidade', pix: '00.000.000/0001-00' }, cobranca: { favorecido: 'Espaço Demonstração', cidade: 'Cidade', modelo: '', copiaCola: true } }, user.id);

  console.log(`\nDemonstração criada com ${n} registros fictícios: ${config.baseUrl}/w/${SLUG}/`);
  console.log('Contas (as senhas aparecem só agora):');
  console.log(`  Gestão   gestao@demo.local      ${pw.gestor}`);
  console.log(`  Equipe   professor@demo.local   ${pw.equipe}`);
  console.log(`  Aluno    aluno@demo.local       ${pw.aluno}  (só Lousa Viva)`);
  console.log(`Portal da Família: ${config.baseUrl}/w/${SLUG}/familia  (o código fica em Alunos › Família; o portal é publicado quando a gestão abre o sistema)\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
