"""Teste de ponta a ponta (servidor real + navegador Chromium). Veja test/e2e/README.md.
Uso: python3 test/e2e/e2e.py <BASE_URL> <arquivo com a saída do npm run seed> <pasta das capturas>"""
import sys, re, json, time, os, subprocess
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]            # http://127.0.0.1:3100
SEEDOUT = sys.argv[2]         # saída do npm run seed
SHOTS = sys.argv[3]
os.makedirs(SHOTS, exist_ok=True)
pw = dict(re.findall(r'(gestao|professor|aluno)@demo\.local\s+(\S+)', open(SEEDOUT).read()))
errs = []; res = {}
def ok(k, v): res[k] = v; print(f'{k}: {v}', flush=True)

def ctx_for(b, mobile=False):
    c = b.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1366, 'height': 900}, accept_downloads=True)
    c.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    c.route('https://fonts.gstatic.com/**', lambda r: r.fulfill(status=404, body=''))
    return c
def watch(pg, tag):
    pg.on('pageerror', lambda e: errs.append(f'{tag} PAGEERR {e}'))
    pg.on('console', lambda m: errs.append(f'{tag} CONSOLE {m.text}') if m.type == 'error' and 'fonts.g' not in m.text else None)
def login(pg, email, senha, nxt='/w/demo/'):
    pg.goto(f'{BASE}/login?next={nxt}'); pg.fill('input[name=email]', email); pg.fill('input[name=senha]', senha); pg.click('button[type=submit]')
    pg.wait_for_load_state('networkidle')
def api(pg, path):
    return pg.evaluate("async p=>{const r=await fetch(p,{headers:{'X-VX':'1'}});return {s:r.status,j:await r.json().catch(()=>null)}}", path)
def shot(pg, name): pg.evaluate("document.querySelectorAll('.toast').forEach(t=>t.hidden=true)"); pg.screenshot(path=f'{SHOTS}/{name}.png')

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- gestão ----------
    c1 = ctx_for(b); g = c1.new_page(); watch(g, 'gestor')
    g.goto(BASE + '/w/demo/'); ok('redirect sem login', g.url.split('?')[0].endswith('/login'))
    g.fill('input[name=email]', 'gestao@demo.local'); g.fill('input[name=senha]', 'errada123'); g.click('button[type=submit]')
    ok('senha errada', g.locator('.alert.bad').inner_text())
    login(g, 'gestao@demo.local', pw['gestao']); g.wait_for_timeout(1500)
    ok('url app', g.url)
    ok('marca', g.locator('#gx .brand').inner_text().replace('\n', ' | '))
    ok('me', g.locator('#me').inner_text().replace('\n', ' | '))
    ok('painel h1', g.locator('main h1').first.inner_text())
    shot(g, '01-painel')
    for v in ['leads', 'alunos', 'agenda', 'financeiro', 'acervo']:
        g.click(f'#nav button[data-view={v}]'); g.wait_for_timeout(400)
        ok(f'view {v}', g.locator('main h1').first.inner_text())
    shot(g, '02-acervo')
    g.click('#nav button[data-view=agenda]'); g.wait_for_timeout(400); shot(g, '03-agenda')

    # ---------- tempo real com a professora ----------
    c2 = ctx_for(b); pr = c2.new_page(); watch(pr, 'prof')
    login(pr, 'professor@demo.local', pw['professor']); pr.wait_for_timeout(1200)
    ok('prof me', pr.locator('#me').inner_text().replace('\n', ' | '))
    pr.click('#nav button[data-view=leads]'); pr.wait_for_timeout(400)
    g.click('#nav button[data-view=leads]'); g.wait_for_timeout(300)
    g.click('[data-act=newLead] >> nth=0'); g.wait_for_timeout(300)
    g.fill('#f_nome', 'Lead Tempo Real'); g.fill('#f_telefone', '31999990000'); g.click('[data-act=saveLead]'); g.wait_for_timeout(1200)
    ok('lead aparece para a professora', 'Lead Tempo Real' in pr.inner_text('main'))
    leads = api(g, '/api/t/demo/db/col?path=leads')['j']['docs']
    ok('lead salvo no banco', any(d['data'].get('nome') == 'Lead Tempo Real' for d in leads))

    # ---------- contrato Word e anexo ----------
    g.keyboard.press('Escape'); g.click('#nav button[data-view=alunos]'); g.wait_for_timeout(400)
    g.locator('[data-act=openAluno]').first.click(); g.wait_for_timeout(500)
    with g.expect_download() as dl:
        g.click('#drawer [data-act=contrato]')
    d = dl.value; d.save_as(f'{SHOTS}/contrato.docx'); ok('contrato baixado', d.suggested_filename)
    g.wait_for_timeout(500)
    g.click('#drawer [data-act=tab][data-tab=anexos]'); g.wait_for_timeout(300)
    open(f'{SHOTS}/laudo.pdf', 'wb').write(b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    g.select_option('#f_axcat', index=1) if g.locator('#f_axcat').count() else None
    g.fill('#f_axtitulo', 'Laudo de teste') if g.locator('#f_axtitulo').count() else None
    g.set_input_files('#axfile', f'{SHOTS}/laudo.pdf'); g.click('[data-act=upAnexo]'); g.wait_for_timeout(1200)
    anx = api(g, '/api/t/demo/db/col?path=anexos')['j']['docs']
    ok('anexo salvo', [a['data'].get('titulo') for a in anx])
    aid = anx[-1]['data'].get('assetId') if anx else None
    r = g.evaluate("async id=>{const r=await fetch('/_blob/'+id);return [r.status,r.headers.get('content-type')]}", aid)
    ok('anexo baixa (/_blob)', r)
    anon = b.new_context(); ap = anon.new_page(); r2 = ap.goto(f'{BASE}/_blob/{aid}'); ok('anexo sem login', r2.status); anon.close()
    g.keyboard.press('Escape')

    # ---------- planner e lousa (equipe) ----------
    g.click('#nav button[data-view=planner]'); g.wait_for_timeout(1500); shot(g, '04-planner')
    ok('planner quadros', g.locator('#mod-planner').inner_text()[:120].replace('\n', ' | '))
    g.click('#nav button[data-view=lousa]'); g.wait_for_timeout(1500); shot(g, '05-lousa')
    ok('lousa', g.locator('#mod-lousa').inner_text()[:160].replace('\n', ' | '))

    # ---------- Portal da Família (sem conta) ----------
    g.click('#nav button[data-view=painel]'); g.wait_for_timeout(6500)   # sincronização diária do portal
    fams = api(g, '/api/t/demo/db/col?path=familias')['j']['docs']
    tok = fams[0]['data']['token']; ok('família sincronizada', fams[0]['data'].get('sincronizadoEm', '')[:10])
    c3 = ctx_for(b, mobile=True); f = c3.new_page(); watch(f, 'familia')
    f.goto(BASE + '/w/demo/familia'); f.wait_for_timeout(800)
    ok('portal h1', f.locator('main h1').first.inner_text())
    f.fill('#p_cod', tok); f.click('#pform button[type=submit]'); f.wait_for_timeout(1200)
    ok('portal logado', f.locator('main h1').first.inner_text())
    ok('portal conteúdo', f.inner_text('main')[:200].replace('\n', ' | '))
    shot(f, '06-portal-celular')
    r = api(f, '/api/t/demo/db/col?path=alunos'); ok('família lê alunos?', r['s'])
    r = api(f, '/api/t/demo/db/doc?path=portal/ZZZZZZZZZZZZZZZZ/pub/dados'); ok('código inexistente', r['j'])

    # ---------- aluno (só Lousa) ----------
    c4 = ctx_for(b); a = c4.new_page(); watch(a, 'aluno')
    login(a, 'aluno@demo.local', pw['aluno']); a.wait_for_timeout(2000)
    ok('aluno modo', a.evaluate("document.body.className"))
    ok('aluno vê gestão?', a.locator('#gx').is_visible())
    r = api(a, '/api/t/demo/db/col?path=alunos'); ok('aluno lê alunos?', r['s'])
    r = a.evaluate("async()=>{const r=await fetch('/api/t/demo/db/write',{method:'POST',headers:{'X-VX':'1','Content-Type':'application/json'},body:JSON.stringify({op:'set',path:'alunos/x',data:{nome:'hack'}})});return r.status}")
    ok('aluno escreve alunos?', r)
    me = api(a, '/api/t/demo/me')['j']['id']
    r = a.evaluate("async me=>{const r=await fetch('/api/t/demo/db/write',{method:'POST',headers:{'X-VX':'1','Content-Type':'application/json'},body:JSON.stringify({op:'set',path:'lv_ink/'+me+'/boards/b1/els/e1',data:{t:'p'}})});return r.status}", me)
    ok('aluno escreve a própria tinta', r)
    shot(a, '07-aluno-lousa')

    # ---------- segurança básica ----------
    r = g.evaluate("async()=>{const r=await fetch('/api/t/demo/db/write',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status}")
    ok('sem X-VX', r)
    r = g.evaluate("async()=>{const r=await fetch('/api/t/demo/db/doc?path=../../etc',{headers:{'X-VX':'1'}});return r.status}")
    ok('caminho inválido', r)

    # ---------- conta e equipe ----------
    g.goto(BASE + '/w/demo/conta'); g.wait_for_timeout(800)
    ok('equipe', g.locator('#team').inner_text().replace('\n', ' | ')[:200])
    g.fill('#addForm input[name=nome]', 'Bruna Lima'); g.fill('#addForm input[name=email]', 'bruna@demo.local'); g.select_option('#addForm select[name=papel]', 'equipe')
    g.click('#addForm button[type=submit]'); g.wait_for_timeout(1500)
    temp = g.locator('#teamMsg .secret').inner_text(); ok('senha provisória gerada', len(temp))
    shot(g, '08-conta')
    c5 = ctx_for(b); n = c5.new_page(); watch(n, 'nova')
    login(n, 'bruna@demo.local', temp); ok('pede troca de senha', n.url.split('?')[0].endswith('/trocar-senha'))
    n.fill('input[name=atual]', temp); n.fill('input[name=nova]', 'NovaSenha#2026'); n.fill('input[name=confirma]', 'NovaSenha#2026'); n.click('button[type=submit]'); n.wait_for_timeout(1500)
    ok('nova pessoa entra', n.url)

    # ---------- Google Agenda (servidor falso) ----------
    g.click('#gConnect'); g.wait_for_load_state('networkidle'); g.wait_for_timeout(500)
    ok('google conectado', g.locator('#gStatus').inner_text())
    g.goto(BASE + '/w/demo/'); g.wait_for_timeout(1500)
    g.click('#nav button[data-view=agenda]'); g.wait_for_timeout(300)
    g.click('[data-act=newReu]'); g.wait_for_timeout(300)
    g.select_option('#f_leadId', index=1); g.wait_for_timeout(300)
    g.fill('#f_inicio', '15:00'); g.fill('#f_fim', '15:30')
    if not g.locator('#lk_serv').is_visible():
        g.check('input[name=linkModo][value=servico]')
    g.click('[data-act=meetCriar]'); g.wait_for_timeout(1500)
    ok('link do meet', g.input_value('#f_linkReuniao'))
    shot(g, '09-reuniao-meet')
    b.close()

print('\n'.join(errs) or 'NO ERRORS')
json.dump(res, open(SHOTS + '/result.json', 'w'), ensure_ascii=False, indent=1)
