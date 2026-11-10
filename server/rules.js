'use strict';
// Regras de acesso aos documentos. Reproduzem as regras que o sistema usava no Claude:
//   admin    = gestor e equipe (veem e alteram tudo)
//   interact = alunos (só escrevem na própria tinta da Lousa Viva)
//   view     = famílias com conta (acompanham a Lousa)
//   público  = qualquer pessoa, só para ler um documento do portal pelo código
const LEVEL = { none: 0, view: 1, interact: 2, admin: 3, owner: 4 };
const ROLE_LEVEL = { familia: LEVEL.view, aluno: LEVEL.interact, equipe: LEVEL.admin, gestor: LEVEL.owner };

// A regra mais específica (prefixo mais longo) vale. {self} = id de quem está logado.
const RULES = [
  { path: '', read: 'admin', write: 'admin' },
  { path: 'portal', read: 'view', write: 'admin', publicGet: true },
  { path: 'lv_boards', read: 'view', write: 'admin' },
  { path: 'lv_ink', read: 'view', write: 'admin' },
  { path: 'lv_ink/{self}', read: 'view', write: 'interact' },
  { path: 'lv_acesso', read: 'interact', write: 'admin' },
];
// Tópicos de tempo real da Lousa (traço ao vivo e laser) liberados para alunos.
const ROOM_TOPICS = { laser: 'interact', risco: 'interact' };

const SEG = /^[A-Za-z0-9_.\-@]{1,160}$/;
function parsePath(p, kind) {
  if (typeof p !== 'string' || !p || p.length > 600) return null;
  const segs = p.split('/');
  if (!segs.every(s => SEG.test(s) && s !== '.' && s !== '..')) return null;
  if (kind === 'doc' && segs.length % 2 !== 0) return null;
  if (kind === 'col' && segs.length % 2 !== 1) return null;
  return segs;
}

function ruleFor(segs, uid) {
  let best = RULES[0], bestLen = 0;
  for (const r of RULES) {
    if (!r.path) continue;
    const rs = r.path.split('/');
    if (rs.length > segs.length || rs.length <= bestLen) continue;
    const ok = rs.every((s, i) => (s === '{self}' ? !!uid && segs[i] === uid : s === segs[i]));
    if (ok) { best = r; bestLen = rs.length; }
  }
  return best;
}

// op: 'get' (ler um documento), 'list' (ler uma coleção), 'write'
function allowed(level, segs, uid, op) {
  const r = ruleFor(segs, uid);
  if (op === 'write') return level >= LEVEL[r.write];
  if (op === 'get' && r.publicGet) return true;
  return level >= LEVEL[r.read] && level > 0;
}

function roomAllowed(level, topic) {
  return level >= LEVEL[ROOM_TOPICS[topic] || 'admin'];
}

module.exports = { LEVEL, ROLE_LEVEL, RULES, parsePath, allowed, roomAllowed };
