'use strict';
// Gera uma senha provisória para uma conta (use quando alguém da gestão esquecer a senha).
// Uso: npm run reset-password -- --email fulana@exemplo.com
const args = require('./_args')();
const db = require('../server/db');
db.migrate();
const auth = require('../server/auth');
(async () => {
  const u = args.email && auth.userByEmail(args.email);
  if (!u) { console.error('Conta não encontrada. Use --email.'); process.exit(1); }
  const senha = auth.tempPassword();
  await auth.setPassword(u.id, senha, true);
  auth.destroyUserSessions(u.id);
  console.log(`Senha provisória de ${u.email}: ${senha}\n(Será pedida a troca no próximo acesso.)`);
})();
