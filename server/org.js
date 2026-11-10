'use strict';
// Criação de uma organização nova (cadastro pelo site ou pelos scripts).
const db = require('./db');
const auth = require('./auth');
const store = require('./store');

// Cria a organização, a pessoa gestora e os ajustes iniciais (usado no cadastro e nos scripts).
async function createOrganization({ slug, org, nome, email, senha, mustChange = false }) {
  if (auth.userByEmail(email)) throw Object.assign(new Error('Já existe uma conta com este e-mail. Entre com ela.'), { code: 'already_exists' });
  if (auth.tenantBySlug(slug)) throw Object.assign(new Error('Este endereço já está em uso.'), { code: 'already_exists' });
  const user = await auth.createUser({ email, name: nome, password: senha, mustChange });
  let tenant;
  try { tenant = auth.createTenant({ slug, name: org, settings: defaultOrgSettings(org) }); }
  catch (e) { db.q('DELETE FROM users WHERE id = ?').run(user.id); throw e; }
  auth.addMember(tenant.id, user.id, 'gestor');
  store.setDoc(tenant.id, 'ajustes/geral', { equipe: [user.name], assinatura: user.name, cobranca: { favorecido: tenant.name, cidade: '', modelo: '', copiaCola: true } }, user.id);
  return { tenant, user };
}
function defaultOrgSettings(org) {
  const words = String(org).trim().split(/\s+/);
  return { marca1: words.length > 1 ? words[0].toUpperCase() : '', marca2: (words.length > 1 ? words.slice(1).join(' ') : words[0]).toUpperCase(), subtitulo: 'Gestão de aulas e acompanhamento escolar' };
}

module.exports = { createOrganization, defaultOrgSettings };
