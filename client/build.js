// Monta public/app.html: o sistema de gestão com os módulos Planner e Lousa Viva embutidos.
// Uso: npm run build   (lê client/src/*.src.html e grava public/app.html)
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const dir = path.join(__dirname, 'src');
const out = process.argv[2] || path.join(__dirname, '..', 'public', 'app.html');
const mem = {}; // arquivos intermediários (antes gravados em disco)

function splitSel(s) { // split selector list on top-level commas
  const parts = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function insideKeyframes(rule) { let p = rule.parent; while (p) { if (p.type === 'atrule' && /keyframes/.test(p.name)) return true; p = p.parent; } return false; }

function scopeModule(css, rootSel) {
  const root = postcss.parse(css);
  root.walkRules(rule => {
    if (insideKeyframes(rule)) return;
    const sels = splitSel(rule.selector).map(s => {
      if (s === ':root' || s === 'html' || s === 'body') return rootSel;
      if (s === 'body::before') return null;
      if (s.startsWith(':root')) return s + ' ' + rootSel;
      if (s.startsWith('html ')) return rootSel + ' ' + s.slice(5);
      if (s.startsWith('body ')) return rootSel + ' ' + s.slice(5);
      return rootSel + ' ' + s;
    }).filter(Boolean);
    if (!sels.length) rule.remove(); else rule.selector = sels.join(',\n');
  });
  return root.toString();
}
function scopeGestao(css) {
  const root = postcss.parse(css);
  const P = ':where(#gx)';
  root.walkRules(rule => {
    if (insideKeyframes(rule)) return;
    rule.selector = splitSel(rule.selector).map(s => {
      if (s.startsWith(':root') || s === 'html' || s === 'body' || s === 'body::before' || s === '[hidden]') return s;
      const m = /^(body(?:\.[\w-]+)+)\s+(.*)$/.exec(s);
      if (m) return m[1] + ' ' + P + ' ' + m[2];
      if (s.startsWith('body.')) return s;
      return P + ' ' + s;
    }).join(',');
  });
  return root.toString();
}
function rep(src, a, b, n) {
  const cnt = src.split(a).length - 1;
  if (n != null && cnt !== n) throw new Error(`Esperava ${n}x, achei ${cnt}x: ${a}`);
  if (!cnt) throw new Error('Não achei: ' + a);
  return src.split(a).join(b);
}
function pieces(html) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  const css = styles[styles.length - 1][1];
  const afterStyle = html.slice(styles[styles.length - 1].index + styles[styles.length - 1][0].length);
  const sIdx = afterStyle.indexOf('<script>');
  const markup = afterStyle.slice(0, sIdx).trim();
  const js = afterStyle.slice(sIdx + 8, afterStyle.lastIndexOf('</script>'));
  return { css, markup, js };
}
const guardFn = `
  const __mods = document.getElementById('mods');
  const __act = e => !ROOT.hidden && !__mods.hidden && !(e && e.target && e.target.closest && e.target.closest('#gx'));
  const __on = (type, fn, opts, tgt) => (tgt || document).addEventListener(type, e => { if (__act(e)) fn(e); }, opts);
`;

/* ---------- Planner ---------- */
{
  const src = fs.readFileSync(dir + '/planner.src.html', 'utf8');
  let { css, markup, js } = pieces(src);
  markup = rep(markup, 'id="app"', 'id="pl-app"', 1);
  markup = rep(markup, 'id="tip"', 'id="pl-tip"', 1);
  css = scopeModule(css, '#mod-planner') + '\n#mod-planner .pop{position:fixed}\n';
  js = rep(js, "const $ = (s, r) => (r || document).querySelector(s);", "const $ = (s, r) => (r || ROOT).querySelector(s);", 1);
  js = rep(js, "const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));", "const $$ = (s, r) => Array.from((r || ROOT).querySelectorAll(s));", 1);
  js = js.replace(/'#(app|tip|topbar|tabs|notice|filters|main|layer|drawer|pop|toast)'/g, "'#pl-$1'");
  js = js.replace(/id="(topbar|tabs|notice|filters|main|layer|drawer)"/g, 'id="pl-$1"');
  js = rep(js, "p.id = 'pop';", "p.id = 'pl-pop';", 1);
  js = rep(js, "t.id = 'toast';", "t.id = 'pl-toast';", 1);
  js = rep(js, "document.body.appendChild(p)", "ROOT.appendChild(p)", 1);
  js = rep(js, "document.body.appendChild(t)", "ROOT.appendChild(t)", 1);
  js = rep(js, "let left = r.left + window.scrollX; left = Math.max(12, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 12));\n  p.style.left = left + 'px'; p.style.top = (r.bottom + window.scrollY + 6) + 'px';",
    "let left = Math.max(12, Math.min(r.left, document.documentElement.clientWidth - w - 12));\n  p.style.left = left + 'px'; p.style.top = Math.min(r.bottom + 6, window.innerHeight - 60) + 'px';", 1);
  js = rep(js, "window.scrollTo(0, 0)", "ROOT.scrollTo(0, 0)", 1);
  js = rep(js, "await S.db.collection(col).doc(o.id).set(o)", "await S.db.collection('pl_' + col).doc(o.id).set(o)", 2);
  js = rep(js, "db.collection('boards')", "db.collection('pl_boards')", 1);
  js = rep(js, "db.collection('cards')", "db.collection('pl_cards')", 1);
  js = rep(js, "document.addEventListener(", "__on(", 13);
  js = rep(js, "if (typeof module !== 'undefined') module.exports = buildSample;", "", 1);
  if (/document\.body/.test(js)) throw new Error('planner ainda usa document.body');
  mem['planner.mod.js'] = ( `function __vxPlanner(ROOT){\n${guardFn}\nROOT.innerHTML = ${JSON.stringify(markup)};\n${js}\n}`);
  mem['planner.mod.css'] = css;
}

/* ---------- Lousa ---------- */
{
  const src = fs.readFileSync(dir + '/lousa.src.html', 'utf8');
  let { css, markup, js } = pieces(src);
  markup = rep(markup, 'id="app"', 'id="lv-app"', 1);
  markup = rep(markup, 'id="tip"', 'id="lv-tip"', 1);
  markup = rep(markup, 'id="toast"', 'id="lv-toast"', 1);
  css = rep(css, '#app{', '#lv-app{', 1);
  css = scopeModule(css, '#mod-lousa');
  js = rep(js, "const $ = s => document.querySelector(s);", "const $ = s => ROOT.querySelector(s);", 1);
  js = js.replace(/'#(tip|toast)'/g, "'#lv-$1'");
  js = rep(js, "getComputedStyle(document.documentElement)", "getComputedStyle(ROOT)", 1);
  js = rep(js, "db.collection('boards')", "db.collection('lv_boards')", 1);
  js = rep(js, "db.collection('ink')", "db.collection('lv_ink')", 1);
  js = rep(js, "queueWrite('boards/'+id", "queueWrite('lv_boards/'+id", 2);
  js = rep(js, "return `ink/${uid}/boards/${bid}/els/${eid}`;", "return `lv_ink/${uid}/boards/${bid}/els/${eid}`;", 1);
  js = rep(js, "return `ink/${uid}/boards/${bid}/els`;", "return `lv_ink/${uid}/boards/${bid}/els`;", 1);
  js = rep(js, "'ink/'+S.me.id", "'lv_ink/'+S.me.id", 2);
  js = rep(js, "const w = await user.can('data.write');", "let w = await user.can('data.write');\n  if (w === false) { try { w = (await db.doc('lv_acesso/turma').get()).exists; } catch(e){ w = false; } }", 1);
  js = rep(js, "document.addEventListener(", "__on(", 4);
  js = rep(js, "window.addEventListener('hashchange', route);", "__on('hashchange', route, undefined, window);", 1);
  if (/document\.body/.test(js)) throw new Error('lousa ainda usa document.body');
  mem['lousa.mod.js'] = ( `function __vxLousa(ROOT){\n${guardFn}\nROOT.innerHTML = ${JSON.stringify(markup)};\n${js}\n}`);
  mem['lousa.mod.css'] = css;
}

/* ---------- Gestão ---------- */
{
  let g = fs.readFileSync(dir + '/gestao.src.html', 'utf8');
  // fontes: tudo que os três usam
  g = rep(g, '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&family=Patrick+Hand&display=swap">', 1);
  // escopo do CSS do sistema
  const st = g.indexOf('<style>'), en = g.indexOf('</style>', st);
  const gcss = scopeGestao(g.slice(st + 7, en));
  const modsCss = `
/* Módulos embutidos (Planner e Lousa) */
#mods{position:fixed;left:232px;top:0;right:0;bottom:0;z-index:24;background:var(--bg)}
.vxmod{position:absolute;inset:0}
#mod-planner{overflow:auto;-webkit-overflow-scrolling:touch}
#mod-lousa{overflow:hidden}
body.mod-open{overflow:hidden}
body.aluno #gx{display:none}
body.aluno #mods{left:0!important;top:0!important}
.vx-back{position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:30;font:600 12.5px/1 "Montserrat",system-ui,sans-serif;background:#0D1B3D;color:#fff;border:0;border-radius:999px;padding:9px 14px;cursor:pointer}
`;
  g = g.slice(0, st + 7) + gcss + modsCss + g.slice(en);
  // envolver o sistema em #gx e criar o espaço dos módulos
  g = rep(g, '<div class="app">', '<div id="gx">\n<div class="app">', 1);
  g = rep(g, '<div class="toast" id="toast" hidden role="status" aria-live="polite"></div>',
    '<div class="toast" id="toast" hidden role="status" aria-live="polite"></div>\n</div>\n<div id="mods" hidden><div id="mod-planner" class="vxmod" hidden></div><div id="mod-lousa" class="vxmod" hidden></div></div>\n<button class="vx-back" id="vxBack" hidden>← Portal da Família</button>', 1);
  // CSS dos módulos + código
  const pcss = mem['planner.mod.css'], lcss = mem['lousa.mod.css'];
  const pjs = mem['planner.mod.js'], ljs = mem['lousa.mod.js'];
  const modScript = `<script>\nwindow.__VX_MODS = { planner: { css: ${JSON.stringify(pcss)}, init: ${pjs} }, lousa: { css: ${JSON.stringify(lcss)}, init: ${ljs} } };\n</script>\n`;
  if (/<\/script/i.test(pjs + ljs + pcss + lcss)) throw new Error('fechamento de script dentro do módulo');
  g = rep(g, '<script>\n(function(){', modScript + '<script>\n(function(){', 1);
  // documento completo + configuração injetada pelo servidor + camada de compatibilidade
  g = '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">\n<!--VX_CONFIG-->\n<script src="/static/claude-compat.js"></script>\n' + g + '\n</html>\n';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, g);
  console.log('public/app.html gerado (' + Math.round(g.length / 1024) + ' KB)');
}
