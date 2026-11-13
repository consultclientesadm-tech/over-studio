// Embaralha o JavaScript do site antes de publicar (roda no GitHub, na publicação). Uso: node tools/proteger.mjs site
// - todo .js do site: minificado (sem comentários, nomes internos trocados, sem mapa do código-fonte);
// - telas de conta, painel e página (scripts comuns): além disso, ofuscados (textos escondidos, nomes sem sentido).
// O motor de áudio e vídeo só é minificado: ofuscação pesada deixaria o processamento mais lento no celular.
// Código que roda no navegador nunca fica 100% escondido; isso deixa muito mais difícil de ler e copiar.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const req = createRequire(path.join(process.env.PROTEGER_MODULOS || process.cwd(), 'x.js'));
const { minify } = req('terser');
const JO = req('javascript-obfuscator');

const raiz = process.argv[2] || 'site';
const OFUSCAR = new Set(['app/conta.js', 'admin/admin.js', 'admin/graficos.js', 'assets/compat.js', 'assets/marca.js']);
const PULAR = /(^|\/)vendor\/|\.min\.js$/;
const arquivos = [];
(function anda(d) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, n.name);
    if (n.isDirectory()) anda(p); else if (n.name.endsWith('.js')) arquivos.push(p);
  }
})(raiz);

let antes = 0, depois = 0, n = 0;
for (const f of arquivos) {
  const rel = path.relative(raiz, f).split(path.sep).join('/');
  if (PULAR.test(rel)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const modulo = /^\s*(import|export)\s/m.test(src) || /import\.meta/.test(src);
  const r = await minify(src, { module: modulo, ecma: 2020, compress: { passes: 2, drop_debugger: true }, mangle: { toplevel: modulo }, format: { comments: false }, sourceMap: false });
  let out = r.code;
  if (OFUSCAR.has(rel)) {
    out = JO.obfuscate(out, {
      compact: true, sourceMap: false, target: 'browser', identifierNamesGenerator: 'hexadecimal', renameGlobals: false,
      stringArray: true, stringArrayThreshold: 0.75, stringArrayEncoding: ['base64'], stringArrayRotate: true, stringArrayShuffle: true,
      splitStrings: false, controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false, debugProtection: false,
      transformObjectKeys: false, unicodeEscapeSequence: false, numbersToExpressions: false, simplify: true,
    }).getObfuscatedCode();
  }
  fs.writeFileSync(f, out);
  antes += src.length; depois += out.length; n++;
}
// nada de mapa do código-fonte no ar
for (const f of arquivos) if (fs.existsSync(f + '.map')) fs.unlinkSync(f + '.map');
console.log(`protegidos ${n} arquivos JS: ${(antes / 1024).toFixed(0)} KB → ${(depois / 1024).toFixed(0)} KB`);
