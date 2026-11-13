// Detecção de vozes num WAV de voz já separada (rápido, sem navegador). Uso: node test/voices-file.mjs voz.wav
import fs from 'fs';
import { findVoices, splitVoices } from '../js/voices.js';
const b = fs.readFileSync(process.argv[2]);
let p = 12, fmt = null, data = null;
while (p < b.length) { const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4); if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12) }; if (id === 'data') { data = b.subarray(p + 8, p + 8 + n); break; } p += 8 + n + (n & 1); }
const len = data.length / 2 / fmt.ch, ch = Array.from({ length: fmt.ch }, () => new Float32Array(len));
for (let i = 0; i < len; i++) for (let c = 0; c < fmt.ch; c++) ch[c][i] = data.readInt16LE((i * fmt.ch + c) * 2) / 32768;
const t = Date.now();
const est = await findVoices(ch, fmt.sr);
console.log(JSON.stringify({ count: est.count, together: est.together, t3: est.together3, voiced: est.voicedSec, lines: est.lines.length, range: est.range, ms: Date.now() - t }));
if (est.count >= 2 && process.argv[3]) {
  const parts = await splitVoices(ch, fmt.sr, est);
  parts.forEach((v, k) => {
    const out = Buffer.alloc(44 + v.length * 2);
    out.write('RIFF', 0); out.writeUInt32LE(36 + v.length * 2, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
    out.writeUInt32LE(fmt.sr, 24); out.writeUInt32LE(fmt.sr * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(v.length * 2, 40);
    for (let i = 0; i < v.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v[i] * 32767))), 44 + i * 2);
    fs.writeFileSync(`${process.argv[3]}-voz${k + 1}.wav`, out);
  });
  // uma linha por segundo: altura de cada voz
  for (let s = 0; s < est.nf * est.dt; s += 1) { const fi = Math.round(s / est.dt); console.log(s.toFixed(0).padStart(3), est.f0.map((f) => (isNaN(f[fi]) ? '  -  ' : f[fi].toFixed(1))).join('  ')); }
}
