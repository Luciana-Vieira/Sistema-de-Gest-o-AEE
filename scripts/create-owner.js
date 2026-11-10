'use strict';
// Cria uma organização e a pessoa gestora (dona da conta).
// Uso: npm run create-owner -- --slug minha-escola --org "Minha Escola" --nome "Fulana" --email fulana@exemplo.com
// A senha provisória é gerada e mostrada uma única vez; a pessoa troca no primeiro acesso.
const args = require('./_args')();
const config = require('../server/config');
const db = require('../server/db');
db.migrate();
const auth = require('../server/auth');
const { createOrganization } = require('../server/org');

(async () => {
  for (const k of ['slug', 'org', 'nome', 'email']) if (!args[k] || args[k] === true) { console.error(`Informe --${k}. Exemplo:\n  npm run create-owner -- --slug minha-escola --org "Minha Escola" --nome "Fulana de Tal" --email fulana@exemplo.com`); process.exit(1); }
  const senha = auth.tempPassword();
  try {
    const { tenant, user } = await createOrganization({ slug: args.slug, org: args.org, nome: args.nome, email: args.email, senha, mustChange: true });
    console.log(`\nOrganização criada: ${tenant.name}\nEndereço: ${config.baseUrl}/w/${tenant.slug}/\nGestão: ${user.name} <${user.email}>\nSenha provisória (troque no primeiro acesso): ${senha}\n`);
    process.exit(0);
  } catch (e) { console.error('Erro:', e.message); process.exit(1); }
})();
