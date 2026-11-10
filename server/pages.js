'use strict';
// Páginas HTML simples (sem framework) para entrar, cadastrar e administrar a conta.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PRODUCT = 'Vértice Gestão';

function layout(title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${PRODUCT}</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/static/pages.css">
</head><body>${body}</body></html>`;
}
const brand = (o = {}) => `<div class="brand"><div class="b1">${esc(o.marca1 ?? 'SISTEMA')}</div><div class="b2">${esc(o.marca2 ?? 'VÉRTICE GESTÃO')}</div><div class="b3"></div><div class="b4">${esc(o.subtitulo ?? 'Aulas particulares e acompanhamento escolar')}</div></div>`;
const authShell = (title, inner) => layout(title, `<div class="auth"><aside class="auth-side">${brand()}<p>Agenda, alunos, avaliações, boletins, PDI, financeiro, Portal da Família, Planner e Lousa Viva em um só lugar.</p></aside><main class="auth-main">${inner}</main></div>`);
const alert = (m, kind = 'bad') => (m ? `<div class="alert ${kind}" role="alert">${esc(m)}</div>` : '');

function login({ email = '', next = null, error = '', allowSignup = false }) {
  return authShell('Entrar', `<div class="card"><h1>Entrar</h1><p class="sub">Use o e-mail e a senha da sua conta.</p>
  <form method="post" action="/login">${alert(error)}
    <label>E-mail<input name="email" type="email" autocomplete="username" required value="${esc(email)}" autofocus></label>
    <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
    ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
    <button class="btn primary" type="submit">Entrar</button>
  </form>
  <p class="foot">Esqueceu a senha? Peça à pessoa responsável pela sua escola para gerar uma senha provisória.${allowSignup ? '<br>Ainda não tem conta? <a href="/signup">Criar conta</a>' : ''}</p>
  <p class="foot">É da família de um aluno? Use o link do Portal da Família que a escola enviou. Não precisa de conta.</p></div>`);
}

function signup({ nome = '', email = '', org = '', slug = '', error = '' }) {
  return authShell('Criar conta', `<div class="card"><h1>Criar conta</h1><p class="sub">Crie o espaço da sua escola ou do seu trabalho com aulas particulares.</p>
  <form method="post" action="/signup">${alert(error)}
    <label>Seu nome<input name="nome" required maxlength="120" value="${esc(nome)}" autocomplete="name"></label>
    <label>E-mail<input name="email" type="email" required value="${esc(email)}" autocomplete="email"></label>
    <label>Nome da escola ou do seu trabalho<input name="org" required maxlength="120" value="${esc(org)}" placeholder="Ex.: Espaço Aprender"></label>
    <label>Endereço do sistema<input name="slug" required pattern="[a-z0-9][a-z0-9\\-]{1,38}[a-z0-9]" value="${esc(slug)}" placeholder="espaco-aprender"><small class="hint">Letras minúsculas, números e hífen. O sistema ficará em /w/<b>endereço</b>/</small></label>
    <label>Senha<input name="senha" type="password" minlength="8" required autocomplete="new-password"></label>
    <label>Confirme a senha<input name="confirma" type="password" minlength="8" required autocomplete="new-password"></label>
    <button class="btn primary" type="submit">Criar conta</button>
  </form><p class="foot">Já tem conta? <a href="/login">Entrar</a></p></div>`);
}

function changePassword({ user, next, error = '' }) {
  return authShell('Trocar senha', `<div class="card"><h1>Trocar a senha</h1>
  <p class="sub">${user.must_change_password ? 'Você entrou com uma senha provisória. Escolha uma senha sua para continuar.' : 'Escolha uma nova senha.'}</p>
  <form method="post" action="/trocar-senha">${alert(error)}
    <label>Senha atual<input name="atual" type="password" required autocomplete="current-password"></label>
    <label>Nova senha<input name="nova" type="password" minlength="8" required autocomplete="new-password"><small class="hint">Pelo menos 8 caracteres.</small></label>
    <label>Confirme a nova senha<input name="confirma" type="password" minlength="8" required autocomplete="new-password"></label>
    ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
    <button class="btn primary" type="submit">Salvar senha</button>
  </form></div>`);
}

function choose(user, tenants) {
  return authShell('Escolha a organização', `<div class="card"><h1>Olá, ${esc(user.name.split(' ')[0])}!</h1>
  ${tenants.length ? `<p class="sub">Escolha onde entrar:</p><div style="display:grid;gap:10px">${tenants.map(t => `<a class="btn" href="/w/${esc(t.slug)}/">${esc(t.name)}</a>`).join('')}</div>`
    : '<p class="sub">Sua conta ainda não foi incluída em nenhuma escola. Peça à pessoa responsável para incluir o seu e-mail.</p>'}
  <form method="post" action="/logout" style="margin-top:16px"><button class="btn" type="submit">Sair</button></form></div>`);
}

const message = (title, text, back) => authShell(title, `<div class="card"><h1>${esc(title)}</h1><p class="sub">${esc(text)}</p><a class="btn" href="${esc(back || '/')}">Voltar</a></div>`);
const notFound = () => message('Página não encontrada', 'Confira o endereço digitado.', '/');
const noAccess = (user, t) => authShell('Sem acesso', `<div class="card"><h1>Sem acesso</h1><p class="sub">A conta ${esc(user.email)} não faz parte de “${esc(t.name)}”. Peça à pessoa responsável para incluir você na equipe.</p><form method="post" action="/logout"><button class="btn" type="submit">Entrar com outra conta</button></form></div>`);

const ROLE_HELP = {
  gestor: 'Tudo, inclusive equipe, dados da organização e modelo de documentos.',
  equipe: 'Leads, alunos, agenda, financeiro, avaliações, boletins, PDI, acervo, Planner e Lousa Viva.',
  aluno: 'Somente a Lousa Viva: escreve nas telas liberadas para a turma.',
  familia: 'Acompanha a Lousa Viva. O Portal da Família funciona só com o código, sem conta.',
};
const MSG = {
  'google-ok': ['ok', 'Google Agenda conectado. Agora as aulas e reuniões on-line podem ganhar sala do Meet automaticamente.'],
  'google-off': ['warn', 'A integração com o Google ainda não foi configurada no servidor (veja docs/DEPLOY.md).'],
};

function account({ user, tenant, org, role, googleEnabled, portalUrl, msg }) {
  const owner = role === 'gestor';
  const staff = role === 'gestor' || role === 'equipe';
  const m = MSG[msg];
  const f = (k, label, hint = '', ph = '') => `<label>${label}<input name="${k}" value="${esc(org[k] || (k === 'nome' ? tenant.name : ''))}" ${owner ? '' : 'disabled'} placeholder="${esc(ph)}">${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
  const body = `<header class="top">${brand(org)}<nav>${staff || role === 'aluno' || role === 'familia' ? `<a href="/w/${esc(tenant.slug)}/">Abrir o sistema</a>` : ''}<form method="post" action="/logout"><button type="submit">Sair</button></form></nav></header>
<main class="wrap" data-slug="${esc(tenant.slug)}" data-me="${esc(user.id)}" data-owner="${owner ? 1 : 0}">
  <h1>Conta e equipe</h1>
  ${m ? alert(m[1], m[0]) : ''}
  ${staff ? `<section class="panel"><div class="panel-h"><h2>Link do Portal da Família</h2><p>Envie este link às famílias junto com o código de acesso de cada uma (gerado em Alunos › Família). Elas não precisam criar conta.</p></div>
  <div class="panel-b"><div class="copy"><input readonly value="${esc(portalUrl)}" id="portalUrl" aria-label="Link do Portal da Família"><button class="btn" type="button" data-copy="#portalUrl">Copiar</button></div></div></section>` : ''}

  ${staff ? `<section class="panel"><div class="panel-h"><h2>Equipe e acessos</h2><p>${owner ? 'Inclua professores, alunos (para a Lousa Viva) e familiares. Quem é novo recebe uma senha provisória para trocar no primeiro acesso.' : 'Somente a gestão pode incluir ou remover pessoas.'}</p></div>
  <div class="panel-b">
    <div id="teamMsg"></div>
    <table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th></th></tr></thead><tbody id="team"><tr><td colspan="4" class="muted">Carregando…</td></tr></tbody></table>
    ${owner ? `<form id="addForm" class="grid2" style="align-items:end">
      <label>Nome<input name="nome" maxlength="120" placeholder="Nome completo"></label>
      <label>E-mail<input name="email" type="email" required></label>
      <label>Papel<select name="papel">${['equipe', 'aluno', 'familia', 'gestor'].map(r => `<option value="${r}">${{ gestor: 'Gestão', equipe: 'Equipe (professor)', aluno: 'Aluno(a) – só Lousa', familia: 'Família – acompanha a Lousa' }[r]}</option>`).join('')}</select></label>
      <button class="btn primary" type="submit">Incluir</button>
    </form>
    <ul class="muted" style="margin:0;padding-left:18px;font-size:13px">${Object.entries(ROLE_HELP).map(([k, v]) => `<li><b>${{ gestor: 'Gestão', equipe: 'Equipe', aluno: 'Aluno(a)', familia: 'Família' }[k]}:</b> ${v}</li>`).join('')}</ul>` : ''}
  </div></section>` : ''}

  ${staff ? `<section class="panel"><div class="panel-h"><h2>Dados da organização</h2><p>Aparecem na barra lateral, no Portal da Família, nas mensagens e nos documentos Word.</p></div>
  <form class="panel-b" id="orgForm">
    <div class="grid2">${f('nome', 'Nome da organização')}${f('subtitulo', 'Subtítulo', '', 'Centro de Desenvolvimento Escolar')}
      ${f('marca1', 'Marca: linha pequena', 'Ex.: INSTITUTO. Pode ficar vazia.')}${f('marca2', 'Marca: linha grande', 'Ex.: VÉRTICE')}</div>
    <div class="grid2">${f('razaoSocial', 'Razão social ou nome completo')}${f('documento', 'CNPJ ou CPF')}${f('representante', 'Representante (nome e CPF)')}
      ${f('endereco', 'Endereço')}${f('email', 'E-mail de contato')}${f('whatsapp', 'WhatsApp', '', '(31) 9 0000-0000')}${f('rodape', 'Rodapé dos documentos', 'Ex.: site ou @ do Instagram')}</div>
    ${owner ? '<div><button class="btn primary" type="submit">Salvar dados</button></div>' : ''}
  </form></section>

  <section class="panel"><div class="panel-h"><h2>Modelo dos documentos Word</h2><p>O contrato, o PDI e o relatório para a família usam este modelo. Campos entre chaves duplas, como <code>{{RESP_NOME}}</code>, são preenchidos pelo sistema (lista em docs/FUNCIONALIDADES.md).</p></div>
  <div class="panel-b"><p id="tplStatus" class="muted" style="margin:0">Verificando…</p>
    ${owner ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><label class="btn" style="display:inline-flex">Enviar modelo (.docx)<input type="file" id="tplFile" accept=".docx" hidden></label><button class="btn danger" type="button" id="tplReset">Voltar ao modelo padrão</button></div>` : ''}
  </div></section>

  <section class="panel"><div class="panel-h"><h2>Google Agenda e Meet</h2><p>Conecte a sua conta Google para o sistema criar o evento e a sala do Meet das aulas e reuniões on-line. Cada pessoa da equipe conecta a própria conta.</p></div>
  <div class="panel-b"><p id="gStatus" class="muted" style="margin:0">${googleEnabled ? 'Verificando…' : 'A integração ainda não foi configurada neste servidor.'}</p>
    ${googleEnabled ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" id="gConnect" href="/w/${esc(tenant.slug)}/google/conectar">Conectar Google Agenda</a><button class="btn danger" type="button" id="gDisconnect" hidden>Desconectar</button></div>` : ''}
  </div></section>` : ''}

  <section class="panel"><div class="panel-h"><h2>Minha senha</h2><p>${esc(user.name)} · ${esc(user.email)}</p></div>
  <form class="panel-b" id="pwForm"><div class="grid2">
    <label>Senha atual<input name="atual" type="password" required autocomplete="current-password"></label>
    <label>Nova senha<input name="nova" type="password" minlength="8" required autocomplete="new-password"></label></div>
    <div><button class="btn primary" type="submit">Trocar senha</button></div></form></section>
</main>
<script src="/static/conta.js"></script>`;
  return layout('Conta e equipe', body);
}

module.exports = { login, signup, changePassword, choose, message, notFound, noAccess, account, esc };
