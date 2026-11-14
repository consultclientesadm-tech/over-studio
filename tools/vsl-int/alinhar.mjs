// Tempo aproximado de cada palavra da narração (para a legenda), sem precisar de reconhecimento de voz:
// acha as pausas do áudio, casa cada trecho de fala com uma frase do roteiro e reparte as palavras pelo tamanho.
// Uso: node tools/vsl-int/alinhar.mjs <pasta_narracao>   → <pasta>/words.json (n_<lingua>_sNN.mp3 + roteiro.json)
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const dir = process.argv[2];
const here = path.dirname(new URL(import.meta.url).pathname);
const R = JSON.parse(fs.readFileSync(`${here}/roteiro.json`, 'utf8'));
const out = {};
for (const lang of Object.keys(R)) for (const [id, text] of Object.entries(R[lang])) {
  const f = `${dir}/n_${lang}_${id}.mp3`;
  if (!fs.existsSync(f)) continue;
  const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
  const res = execFileSync('sh', ['-c', `ffmpeg -nostdin -i "${f}" -af silencedetect=n=-38dB:d=0.12 -f null - 2>&1`]).toString();
  const sil = []; let s0 = null;
  for (const l of res.split('\n')) {
    const a = l.match(/silence_start: ([\d.]+)/), b = l.match(/silence_end: ([\d.]+)/);
    if (a) s0 = +a[1]; if (b && s0 != null) { sil.push([s0, +b[1]]); s0 = null; }
  }
  // trechos de fala
  const speech = []; let t = 0;
  for (const [a, b] of sil) { if (a - t > 0.08) speech.push([t, a]); t = b; }
  if (dur - t > 0.08) speech.push([t, dur]);
  // frases do roteiro (quebra na pontuação forte e nas vírgulas)
  for (let i = speech.length - 1; i >= 0; i--) if (speech[i][1] - speech[i][0] < 0.3 && speech.length > 1) { // trecho curto demais (respiração): junta ao vizinho
    const j = i > 0 ? i - 1 : i + 1; speech[j] = [Math.min(speech[i][0], speech[j][0]), Math.max(speech[i][1], speech[j][1])]; speech.splice(i, 1);
  }
  const words = text.replace(/\s+([:;!?»])/g, '\u00a0$1').split(/[ \t\n]+/).filter(Boolean);
  const phrases = []; let cur = [];
  for (const w of words) { cur.push(w); if (/[.,!?;:…]$/.test(w)) { phrases.push(cur); cur = []; } }
  if (cur.length) phrases.push(cur);
  // reparte o tempo pelo tamanho das palavras, com uma pausa curta depois de vírgula e maior depois de ponto
  const pausa = (w) => (/[.!?…]$/.test(w) ? 0.34 : /[,;:]$/.test(w) ? 0.16 : 0);
  const p0 = speech.length ? speech[0][0] : 0, p1 = speech.length ? speech[speech.length - 1][1] : dur;
  const totP = words.slice(0, -1).reduce((s, w) => s + pausa(w), 0);
  const fala = Math.max(0.5, p1 - p0 - totP), tot = words.reduce((s, w) => s + w.length + 2, 0);
  const W = []; let x = p0;
  for (const w of words) { const d = fala * (w.length + 2) / tot; W.push([+x.toFixed(2), +(x + d).toFixed(2), w]); x += d + pausa(w); }
  const sp = speech;
  out[`${lang}_${id}`] = { dur, words: W, trechos: sp.length };
}
fs.writeFileSync(`${dir}/words.json`, JSON.stringify(out));
console.log(Object.keys(out).length, 'falas');
