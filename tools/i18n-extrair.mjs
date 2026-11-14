// Junta todos os textos em português do lado do cliente (app, páginas, e-mails, avisos) em tools/i18n/chaves.json.
// Usa o mesmo jeito de ler a página que o site/assets/i18n.js, rodando no Chromium, então as chaves batem.
// Uso: NODE_PATH=<pasta com acorn> node tools/i18n-extrair.mjs   (npm i acorn acorn-walk numa pasta qualquer)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const acorn = require('acorn'); const walk = require('acorn-walk');
const { chromium } = require('playwright');
const R = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rd = (f) => fs.readFileSync(path.join(R, f), 'utf8');

// páginas e códigos que o cliente vê (o painel admin fica em português)
const PAGES = ['index.html', 'site/index.html', 'site/entrar/index.html', 'site/obrigado/index.html', 'site/vsl/index.php', 'site/afiliado/index.html',
  'site/afiliados/index.html', 'site/depoimento/index.html', 'site/privacidade/index.html', 'site/termos/index.html'];
const JS = fs.readdirSync(path.join(R, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f)
  .concat(['site/app/conta.js', 'site/assets/compat.js', 'site/assets/marca.js', 'site/assets/voltar-app.js', 'site/assets/sem-emoji.js']);
const PHP = ['lib.php', 'conta.php', 'mail.php', 'funil.php', 'webhook.php', 'afiliado.php', 'afiliados.php', 'depoimento.php', 'depo_lib.php', 'push.php', 'origem.php', 'escudo.php', 'armadilha.php', 'e.php']
  .map((f) => 'site/api/' + f).filter((f) => fs.existsSync(path.join(R, f)));

const PTW = /[ãõçáéíóúâêôà]|\b(você|voce|não|para|com|seu|sua|seus|suas|vídeo|voz|que|uma|um|do|da|dos|das|no|na|nos|nas|em|de|ao|pelo|pela|mais|agora|toque|aqui|fazer|está|isso|então|ou|e|o|a|os|as|se|já|ainda|até|sem|por|quando|depois|antes)\b/i;
const SHORT = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?: [a-záéíóúâêôãõç]+){0,3}[.!?…:]?$/;
const NOT = /^(Content|Accept|Authorization|Error|TypeError|RangeError|Infinity|NaN|Promise|Array|Object|String|Number|Date|Math|JSON|Blob|File|Image|Audio|Video|Worker|Map|Set|Symbol|Uint8Array|Float32Array|Int16Array|GET|POST|Inter|Arial|Roboto|Helvetica|Mozilla|Safari|Chrome|Firefox|Edge|Android|Linux|Windows|Macintosh|Studio Cover|Spleeter|Demucs|Signalsmith|Bearer|Basic|None|Lax|Strict)$/;
const looksCode = (s) => /^[\w.-]+$/.test(s) && !SHORT.test(s) || /^[#.][\w-]/.test(s) || /^(https?:|\/|data:|blob:)/.test(s) || /[{};]\s*$/.test(s) && /:\s*[\w#-]+;/.test(s) || /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|PRAGMA)\b/i.test(s) || /^[a-z]+(-[a-z]+)+$/.test(s);
function isPT(s) {
  const t = s.replace(/⟦\d+⟧/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/[A-Za-zÀ-ÿ]{2}/.test(t) || looksCode(s.trim())) return false;
  if (NOT.test(t)) return false;
  if (/\s/.test(t) && PTW.test(t)) return true;
  return SHORT.test(t) && !/^[A-Z][a-z]+[A-Z]/.test(t);
}

const cands = new Map(); // texto -> Set(arquivo)
const add = (s, f) => { if (!s || s.length > 4000) return; if (!isPT(s)) return; if (!cands.has(s)) cands.set(s, new Set()); cands.get(s).add(f); };

function fromJS(code, f) {
  let ast; const opt = { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true };
  try { ast = acorn.parse(code, { ...opt, sourceType: 'module' }); } catch { try { ast = acorn.parse(code, { ...opt, sourceType: 'script' }); } catch (e) { console.log('não li', f, e.message); return; } }
  walk.full(ast, (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string') add(n.value, f);
    else if (n.type === 'TemplateLiteral') { let s = ''; n.quasis.forEach((q, i) => { s += q.value.cooked ?? q.value.raw; if (i < n.expressions.length) s += '⟦' + i + '⟧'; }); add(s, f); }
  });
}
function fromPHP(code, f) {
  code = code.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g; let m;
  while ((m = re.exec(code))) {
    if (m[1] != null) add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'), f);
    else { let i = 0; const s = m[2].replace(/\{\$[^}]+\}|\$[a-zA-Z_]\w*(?:\[[^\]]*\]|->\w+)*/g, () => '⟦' + i++ + '⟧').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\$/g, '$'); add(s, f); }
  }
  // HTML solto dentro do PHP (fora de <?php ?>)
}

const pages = [];
for (const f of PAGES) {
  let h = rd(f);
  if (f.endsWith('.php')) { // PHP da página: pega as strings e tira o código
    for (const m of h.matchAll(/<\?php([\s\S]*?)(\?>|$)/g)) fromPHP(m[1], f);
    h = h.replace(/<\?=[\s\S]*?\?>/g, '⟦0⟧').replace(/<\?php[\s\S]*?(\?>|$)/g, '');
  }
  for (const m of h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) fromJS(m[1], f);
  pages.push([f, h.replace(/<script[\s\S]*?<\/script>/gi, '')]);
}
for (const f of JS) fromJS(rd(f), f);
for (const f of PHP) fromPHP(rd(f), f);

const browser = await chromium.launch(); const page = await browser.newPage();
await page.route('**/*', (r) => r.request().url().startsWith('http://x/') ? r.fulfill({ body: '{}' }) : r.abort());
await page.goto('http://x/?lang=xx').catch(() => {});
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: rd('site/assets/i18n.js').replace("var lang = detect();", "var lang = 'en';") });
await page.waitForTimeout(200);
const COLLECT = `(input) => { const I = window.scI18n._, out = [];
  const keyOf = (s) => I.nz(s);
  function w(node) {
    if (node.nodeType === 3) { if (/[A-Za-zÀ-ÿ]{2}/.test(node.nodeValue)) out.push(keyOf(node.nodeValue)); return; }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) { if (I.skip(node)) return;
      for (const a of I.ATTRS) { const v = node.getAttribute(a); if (v) out.push(keyOf(v)); }
      if (node.tagName === 'META' && /description|og:title|og:description/.test((node.getAttribute('name') || '') + (node.getAttribute('property') || ''))) out.push(keyOf(node.content || ''));
      if (node.tagName === 'TITLE') { out.push(keyOf(node.textContent)); return; }
      if (I.richLeaf(node)) { const k = keyOf(I.canon(node)); if (/[A-Za-zÀ-ÿ]{2}/.test(k)) { out.push(k); return; } } }
    for (let c = node.firstChild; c; c = c.nextSibling) w(c);
  }
  if (input.doc) { const d = new DOMParser().parseFromString(input.html, 'text/html'); w(d.documentElement); }
  else for (const s of input.list) { if (/<[a-zA-Z][^>]*>|&\\w+;/.test(s)) { const t = document.createElement('template'); t.innerHTML = s; w(t.content); } else out.push(keyOf(s)); }
  return out; }`;
const keys = new Map();
const put = (k, f) => { if (!k || !isPT(k)) return; let i = 0; const map = {}; const kk = k.replace(/⟦(\d+)⟧/g, (_, n) => '{' + (map[n] ??= i++) + '}'); if (/^(\{\d+\}\s*)+$/.test(kk)) return; if (!keys.has(kk)) keys.set(kk, new Set()); keys.get(kk).add(f); };
for (const [f, html] of pages) for (const k of await page.evaluate(new Function('return ' + COLLECT)(), { doc: true, html })) put(k, f);
const list = [...cands.keys()];
for (let i = 0; i < list.length; i += 400) {
  const part = list.slice(i, i + 400);
  // cada texto separado, para saber de que arquivo veio
  const res = await page.evaluate((args) => { const fn = new Function('return ' + args.c)(); return args.p.map((s) => fn({ list: [s] })); }, { c: COLLECT, p: part });
  res.forEach((ks, j) => ks.forEach((k) => cands.get(part[j]).forEach((f) => put(k, f))));
}
await browser.close();
const out = {}; [...keys.keys()].sort().forEach((k) => (out[k] = [...keys.get(k)].sort()));
fs.writeFileSync(path.join(R, 'tools/i18n/chaves.json'), JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, 'textos;', Object.keys(out).join('').length, 'caracteres');
