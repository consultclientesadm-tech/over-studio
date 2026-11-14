// Monta os dicionários do site: tools/i18n/<lingua>.json (fonte, legível) -> site/assets/i18n/<lingua>.json (compacto)
// e sobe a versão no site/assets/i18n.js para os celulares baixarem o novo. Também lista o que falta traduzir.
// Uso: node tools/i18n-montar.mjs
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const R = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const chaves = Object.keys(JSON.parse(fs.readFileSync(path.join(R, 'tools/i18n/chaves.json'), 'utf8')));
const langs = fs.readdirSync(path.join(R, 'tools/i18n')).filter((f) => /^[a-z]{2}(-[a-z]{2})?\.json$/.test(f) && f !== 'chaves.json');
const h = crypto.createHash('sha1');
fs.mkdirSync(path.join(R, 'site/assets/i18n'), { recursive: true });
for (const f of langs) {
  const d = JSON.parse(fs.readFileSync(path.join(R, 'tools/i18n', f), 'utf8'));
  const s = JSON.stringify(d); h.update(f + s);
  fs.writeFileSync(path.join(R, 'site/assets/i18n', f), s);
  const falta = chaves.filter((k) => !(k in d));
  console.log(f, Object.keys(d).length, 'textos;', falta.length, 'sem tradução (ou de propósito)');
}
const V = parseInt(h.digest('hex').slice(0, 7), 16);
const js = path.join(R, 'site/assets/i18n.js');
fs.writeFileSync(js, fs.readFileSync(js, 'utf8').replace(/var V = \d+;/, 'var V = ' + V + ';'));
console.log('versão', V);
