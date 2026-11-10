// Página "Conta e equipe".
(function () {
  const main = document.querySelector('main.wrap');
  const slug = main.dataset.slug, me = main.dataset.me, owner = main.dataset.owner === '1';
  const API = '/api/t/' + encodeURIComponent(slug);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLE = { gestor: 'Gestão', equipe: 'Equipe', aluno: 'Aluno(a)', familia: 'Família' };
  async function call(method, url, body, raw) {
    const r = await fetch(url, { method, headers: { 'X-VX': '1', ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Não foi possível concluir. Tente de novo.');
    return j;
  }
  const say = (el, kind, html) => { el.innerHTML = html ? `<div class="alert ${kind}">${html}</div>` : ''; };

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const i = document.querySelector(b.dataset.copy); i.select();
    (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => { b.textContent = 'Copiado'; setTimeout(() => (b.textContent = 'Copiar'), 1500); }, () => document.execCommand('copy'));
  });

  // equipe
  const tb = document.getElementById('team'), tmsg = document.getElementById('teamMsg');
  async function loadTeam() {
    if (!tb) return;
    try {
      const list = await call('GET', API + '/team');
      tb.innerHTML = list.map(m => `<tr data-id="${esc(m.id)}"><td><b>${esc(m.nome)}</b>${m.id === me ? ' <span class="muted">(você)</span>' : ''}${m.senhaProvisoria ? '<br><small class="muted">ainda com senha provisória</small>' : ''}</td><td>${esc(m.email)}</td>
        <td>${owner && m.id !== me ? `<select data-role aria-label="Papel de ${esc(m.nome)}">${Object.keys(ROLE).map(r => `<option value="${r}" ${r === m.papel ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select>` : `<span class="pill">${ROLE[m.papel]}</span>`}</td>
        <td><div class="acts">${owner && m.id !== me ? '<button class="btn sm" data-reset>Senha provisória</button><button class="btn sm danger" data-remove>Remover</button>' : ''}</div></td></tr>`).join('');
    } catch (e) { tb.innerHTML = `<tr><td colspan="4">${esc(e.message)}</td></tr>`; }
  }
  if (tb) {
    tb.addEventListener('change', async e => {
      const s = e.target.closest('[data-role]'); if (!s) return;
      const id = s.closest('tr').dataset.id;
      try { await call('PATCH', `${API}/team/${id}`, { papel: s.value }); say(tmsg, 'ok', 'Papel alterado.'); } catch (er) { say(tmsg, 'bad', esc(er.message)); loadTeam(); }
    });
    tb.addEventListener('click', async e => {
      const tr = e.target.closest('tr'); if (!tr) return; const id = tr.dataset.id; const nome = tr.querySelector('b').textContent;
      if (e.target.closest('[data-remove]')) {
        const b = e.target.closest('[data-remove]');
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Confirmar remoção'; return; }
        try { await call('DELETE', `${API}/team/${id}`); say(tmsg, 'ok', `${esc(nome)} foi removido(a) da equipe.`); loadTeam(); } catch (er) { say(tmsg, 'bad', esc(er.message)); }
      }
      if (e.target.closest('[data-reset]')) {
        try { const r = await call('POST', `${API}/team/${id}/reset-password`); say(tmsg, 'info', `Senha provisória de <b>${esc(nome)}</b> (aparece só agora; envie por um canal seguro):<div class="secret">${esc(r.senhaProvisoria)}</div>`); loadTeam(); } catch (er) { say(tmsg, 'bad', esc(er.message)); }
      }
    });
  }
  const add = document.getElementById('addForm');
  if (add) add.addEventListener('submit', async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(add)); const btn = add.querySelector('button'); btn.disabled = true;
    try {
      const r = await call('POST', API + '/team', d);
      say(tmsg, r.senhaProvisoria ? 'info' : 'ok', r.senhaProvisoria
        ? `Conta criada para <b>${esc(d.email)}</b>. Senha provisória (aparece só agora; envie por um canal seguro, junto com o endereço ${esc(location.origin)}/login):<div class="secret">${esc(r.senhaProvisoria)}</div>`
        : `${esc(d.email)} já tinha conta e agora faz parte da equipe.`);
      add.reset(); loadTeam();
    } catch (er) { say(tmsg, 'bad', esc(er.message)); }
    btn.disabled = false;
  });
  loadTeam();

  // organização
  const orgF = document.getElementById('orgForm');
  if (orgF && owner) orgF.addEventListener('submit', async e => {
    e.preventDefault(); const btn = orgF.querySelector('button[type=submit]');
    try { await call('PUT', API + '/org', Object.fromEntries(new FormData(orgF))); btn.textContent = 'Salvo'; setTimeout(() => (btn.textContent = 'Salvar dados'), 1500); }
    catch (er) { alert(er.message); }
  });

  // modelo Word
  const tplS = document.getElementById('tplStatus');
  async function tpl() { if (!tplS) return; try { const r = await call('GET', API + '/template/status'); tplS.textContent = r.proprio ? 'Usando o modelo próprio da organização.' : 'Usando o modelo padrão do sistema.'; } catch (_) { tplS.textContent = ''; } }
  const tf = document.getElementById('tplFile');
  if (tf) tf.addEventListener('change', async () => {
    const f = tf.files[0]; if (!f) return;
    try { await call('PUT', API + '/template', null, await f.arrayBuffer()); tplS.textContent = 'Modelo enviado. Os próximos documentos já usam este arquivo.'; } catch (er) { tplS.textContent = er.message; }
    tf.value = '';
  });
  const tr = document.getElementById('tplReset');
  if (tr) tr.addEventListener('click', async () => { await call('DELETE', API + '/template').catch(() => {}); tpl(); });
  tpl();

  // Google
  const gS = document.getElementById('gStatus'), gC = document.getElementById('gConnect'), gD = document.getElementById('gDisconnect');
  async function g() {
    if (!gC) return;
    try {
      const r = await call('GET', API + '/google/status');
      gS.textContent = r.connected ? `Conectado${r.email ? ' como ' + r.email : ''}.` : 'Não conectado.';
      gC.textContent = r.connected ? 'Conectar outra conta' : 'Conectar Google Agenda'; gD.hidden = !r.connected;
    } catch (_) { gS.textContent = ''; }
  }
  if (gD) gD.addEventListener('click', async () => { await call('POST', API + '/google/disconnect').catch(() => {}); g(); });
  g();

  // senha
  const pw = document.getElementById('pwForm');
  pw.addEventListener('submit', async e => {
    e.preventDefault(); const btn = pw.querySelector('button');
    try { await call('POST', '/api/me/password', Object.fromEntries(new FormData(pw))); pw.reset(); btn.textContent = 'Senha trocada'; setTimeout(() => (btn.textContent = 'Trocar senha'), 2000); }
    catch (er) { alert(er.message); }
  });
})();
