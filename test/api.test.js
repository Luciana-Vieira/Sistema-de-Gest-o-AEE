'use strict';
// Testes da API (rodam num banco temporário): npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-test-'));
process.env.DATA_DIR = TMP;
process.env.BASE_URL = 'http://127.0.0.1:0';
process.env.ALLOW_SIGNUP = 'true';

const WebSocket = require('ws');
const { server } = require('../server/index');
const { createOrganization } = require('../server/org');
const auth = require('../server/auth');

let base, wsBase;
const jar = {};
async function http(who, method, url, body, extra = {}) {
  const headers = { 'X-VX': '1', ...(jar[who] ? { Cookie: jar[who] } : {}), ...(extra.headers || {}) };
  if (body !== undefined && !extra.raw) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + url, { method, headers, body: extra.raw || (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc && who) jar[who] = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
}
async function login(who, email, senha) {
  const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, senha }) });
  jar[who] = r.headers.get('set-cookie').split(';')[0];
  return r;
}
function socket(who, extra = '') {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${wsBase}/ws?t=escola${extra}`, { headers: jar[who] ? { Cookie: jar[who] } : {} });
    const msgs = []; ws.msgs = msgs;
    ws.on('message', d => msgs.push(JSON.parse(d)));
    ws.wait = (pred, ms = 2000) => new Promise((ok, no) => {
      const t0 = Date.now(); const iv = setInterval(() => { const m = msgs.find(pred); if (m) { clearInterval(iv); ok(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); no(new Error('timeout')); } }, 10);
    });
    ws.on('open', () => res(ws)); ws.on('error', rej);
  });
}

before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port; base = `http://127.0.0.1:${port}`; wsBase = `ws://127.0.0.1:${port}`;
  const { tenant } = await createOrganization({ slug: 'escola', org: 'Escola Teste', nome: 'Gestora', email: 'g@t.local', senha: 'senha-gestora' });
  const p = await auth.createUser({ email: 'p@t.local', name: 'Prof', password: 'senha-prof1' }); auth.addMember(tenant.id, p.id, 'equipe');
  const a = await auth.createUser({ email: 'a@t.local', name: 'Aluna', password: 'senha-aluna' }); auth.addMember(tenant.id, a.id, 'aluno');
  await createOrganization({ slug: 'outra', org: 'Outra Escola', nome: 'Outra', email: 'o@t.local', senha: 'senha-outra' });
  await login('g', 'g@t.local', 'senha-gestora'); await login('p', 'p@t.local', 'senha-prof1'); await login('a', 'a@t.local', 'senha-aluna'); await login('o', 'o@t.local', 'senha-outra');
});
after(() => { server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('login errado é recusado', async () => {
  const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=g@t.local&senha=errada' });
  assert.equal(r.status, 401);
});

test('equipe grava e lê; aluno e outra escola não leem', async () => {
  assert.equal((await http('p', 'POST', '/api/t/escola/db/write', { op: 'set', path: 'alunos/a1', data: { nome: 'Ana' } })).status, 200);
  assert.deepEqual((await http('g', 'GET', '/api/t/escola/db/doc?path=alunos/a1')).body, { exists: true, data: { nome: 'Ana' } });
  assert.equal((await http('a', 'GET', '/api/t/escola/db/col?path=alunos')).status, 403);
  assert.equal((await http('o', 'GET', '/api/t/escola/db/col?path=alunos')).status, 403);
  assert.equal((await http(null, 'GET', '/api/t/escola/db/col?path=alunos')).status, 403);
  await http('p', 'POST', '/api/t/escola/db/write', { op: 'update', path: 'alunos/a1', data: { serie: '5º' } });
  assert.deepEqual((await http('g', 'GET', '/api/t/escola/db/doc?path=alunos/a1')).body.data, { nome: 'Ana', serie: '5º' });
});

test('aluno só escreve a própria tinta da Lousa', async () => {
  const me = (await http('a', 'GET', '/api/t/escola/me')).body;
  assert.equal(me.canEdit, false);
  assert.equal((await http('a', 'POST', '/api/t/escola/db/write', { op: 'set', path: `lv_ink/${me.id}/boards/b/els/e1`, data: { k: 1 } })).status, 200);
  assert.equal((await http('a', 'POST', '/api/t/escola/db/write', { op: 'set', path: 'lv_ink/outro/boards/b/els/e1', data: { k: 1 } })).status, 403);
  assert.equal((await http('a', 'POST', '/api/t/escola/db/write', { op: 'set', path: 'lv_boards/b', data: { t: 1 } })).status, 403);
  assert.equal((await http('a', 'GET', '/api/t/escola/db/doc?path=lv_acesso/turma')).status, 200);
});

test('portal: documento lido sem conta, mas coleção não', async () => {
  await http('g', 'POST', '/api/t/escola/db/write', { op: 'set', path: 'portal/ABCDEFGHJKMNPQRS/pub/dados', data: { alunos: [] } });
  const r = await http(null, 'GET', '/api/t/escola/db/doc?path=portal/ABCDEFGHJKMNPQRS/pub/dados', undefined, { headers: { 'X-VX-Mode': 'familia' } });
  assert.equal(r.status, 200); assert.equal(r.body.exists, true);
  assert.equal((await http(null, 'GET', '/api/t/escola/db/col?path=portal')).status, 403);
  assert.equal((await http(null, 'GET', '/api/t/escola/db/doc?path=ajustes/geral')).status, 403);
});

test('proteções: cabeçalho X-VX, origem e caminhos', async () => {
  const r = await fetch(base + '/api/t/escola/db/write', { method: 'POST', headers: { Cookie: jar.g, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  const r2 = await fetch(base + '/api/t/escola/db/write', { method: 'POST', headers: { Cookie: jar.g, 'X-VX': '1', Origin: 'https://malicioso.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r2.status, 403);
  assert.equal((await http('g', 'GET', '/api/t/escola/db/doc?path=../x')).status, 400);
  assert.equal((await http('g', 'GET', '/api/t/escola/db/doc?path=alunos')).status, 400);
});

test('arquivos: envio, leitura só por membros, exclusão', async () => {
  const up = await http('p', 'POST', '/api/t/escola/assets', undefined, { raw: Buffer.from('%PDF-1.4 teste'), headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'laudo.pdf' } });
  assert.equal(up.status, 200); assert.match(up.body.url, /^\/_blob\//);
  const get = await fetch(base + up.body.url, { headers: { Cookie: jar.g } });
  assert.equal(get.status, 200); assert.equal(get.headers.get('content-type'), 'application/pdf');
  assert.equal((await fetch(base + up.body.url, { headers: { Cookie: jar.o } })).status, 404);
  assert.equal((await fetch(base + up.body.url)).status, 404);
  assert.equal((await http('a', 'DELETE', '/api/t/escola/assets/' + up.body.id)).status, 403);
  assert.equal((await http('g', 'DELETE', '/api/t/escola/assets/' + up.body.id)).status, 200);
});

test('tempo real: assinatura de coleção recebe mudanças', async () => {
  const ws = await socket('g');
  ws.send(JSON.stringify({ t: 'sub', sid: 's1', kind: 'col', path: 'leads' }));
  await ws.wait(m => m.t === 'snap' && m.sid === 's1');
  await http('p', 'POST', '/api/t/escola/db/write', { op: 'set', path: 'leads/l1', data: { nome: 'Lead' } });
  const ch = await ws.wait(m => m.t === 'chg' && m.id === 'l1');
  assert.equal(ch.data.nome, 'Lead');
  await http('p', 'POST', '/api/t/escola/db/write', { op: 'delete', path: 'leads/l1' });
  await ws.wait(m => m.t === 'chg' && m.id === 'l1' && m.data === null);
  const wa = await socket('a');
  wa.send(JSON.stringify({ t: 'sub', sid: 'x', kind: 'col', path: 'leads' }));
  const e = await wa.wait(m => m.t === 'err' && m.sid === 'x');
  assert.equal(e.code, 'permission_denied');
  ws.close(); wa.close();
});

test('sala da Lousa: presença e traço ao vivo entre professora e aluna', async () => {
  const wp = await socket('p'), wa = await socket('a');
  wp.send(JSON.stringify({ t: 'presence', patch: { b: 'tela1', x: 1, y: 2 } }));
  wa.send(JSON.stringify({ t: 'presence', patch: { b: 'tela1' } }));
  const peers = await wp.wait(m => m.t === 'peers' && m.peers.length === 2);
  assert.ok(peers.peers.every(p => p.kind === 'viewer' && p.by));
  wa.send(JSON.stringify({ t: 'emit', rid: 'r1', topic: 'risco', data: { pts: [1, 2] } }));
  assert.equal((await wa.wait(m => m.t === 'ack' && m.rid === 'r1')).ok, true);
  const got = await wp.wait(m => m.t === 'room' && m.topic === 'risco');
  assert.deepEqual(got.data, { pts: [1, 2] });
  wa.send(JSON.stringify({ t: 'emit', rid: 'r2', topic: 'chamar', data: {} }));
  assert.equal((await wa.wait(m => m.t === 'ack' && m.rid === 'r2')).ok, false); // só a equipe chama a turma
  wp.close(); wa.close();
});

test('equipe: gestora inclui pessoa com senha provisória; professora não pode', async () => {
  assert.equal((await http('p', 'POST', '/api/t/escola/team', { nome: 'X', email: 'x@t.local', papel: 'equipe' })).status, 403);
  const r = await http('g', 'POST', '/api/t/escola/team', { nome: 'Nova', email: 'nova@t.local', papel: 'aluno' });
  assert.equal(r.status, 200); assert.equal(r.body.senhaProvisoria.length, 12);
  const lr = await login('n', 'nova@t.local', r.body.senhaProvisoria);
  assert.match(lr.headers.get('location'), /trocar-senha/);
  const me = (await http('g', 'GET', '/api/t/escola/me')).body;
  assert.equal((await http('g', 'DELETE', '/api/t/escola/team/' + me.id)).status, 400); // última gestora
});

test('Google: sem configuração, devolve erro claro', async () => {
  const r = await http('p', 'POST', '/api/t/escola/google/create-event', { input: { summary: 'x', startTime: '2026-11-10T10:00:00', endTime: '2026-11-10T11:00:00' } });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'server_not_configured');
});

test('página do sistema injeta a configuração da organização', async () => {
  const r = await fetch(base + '/w/escola/', { headers: { Cookie: jar.p } });
  const html = await r.text();
  assert.match(html, /window\.VX_CONFIG=/);
  assert.match(html, /claude-compat\.js/);
  assert.ok(!html.includes('{{ORG_'));
  const f = await fetch(base + '/w/escola/familia');
  assert.equal(f.status, 200);
  const m = await fetch(base + '/w/escola/modelo-contrato.txt', { headers: { Cookie: jar.p } });
  assert.ok((await m.text()).startsWith('UEsDB')); // .docx em base64
});

test('portal: família baixa só os documentos liberados para o seu código', async () => {
  const up = async (txt) => (await http('p', 'POST', '/api/t/escola/assets', undefined, { raw: Buffer.from(txt), headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'doc.pdf' } })).body.id;
  const lib = await up('%PDF liberado'), priv = await up('%PDF interno');
  await http('g', 'POST', '/api/t/escola/db/write', { op: 'set', path: 'portal/ZXCVBNMASDFGHJKL/pub/dados', data: { alunos: [{ nome: 'Ana', docs: [{ titulo: 'Atividades', asset: lib }] }] } });
  const ok = await fetch(`${base}/w/escola/familia/arquivo/ZXCVBNMASDFGHJKL/${lib}`);
  assert.equal(ok.status, 200); assert.equal(await ok.text(), '%PDF liberado');
  assert.equal((await fetch(`${base}/w/escola/familia/arquivo/ZXCVBNMASDFGHJKL/${priv}`)).status, 404);
  assert.equal((await fetch(`${base}/w/escola/familia/arquivo/AAAAAAAAAAAAAAAA/${lib}`)).status, 404);
  assert.equal((await fetch(`${base}/w/outra/familia/arquivo/ZXCVBNMASDFGHJKL/${lib}`)).status, 404);
});
