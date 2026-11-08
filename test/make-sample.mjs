// Gera uma "voz" de teste com notas desafinadas de propósito (tom de Dó maior), com vibrato, deslizes e
// silêncio no começo e no fim. Uso: node test/make-sample.mjs saida.wav [--bed]
import fs from 'fs';
const out = process.argv[2] || 'sample.wav', withBed = process.argv.includes('--bed');
const sr = 44100;
// [midi, cents de erro, duração]
// [midi, cents de erro, duração, escorregada em cents no fim da nota]
export const NOTES = [[60, 35, 0.9, 0], [64, -40, 0.9, 0], [67, 0, 1.4, 70], [65, 60, 0.9, 0], [62, -30, 0.9, 0], [60, 0, 1.2, 0]];
const lead = 2, tail = 2;
const dur = lead + tail + NOTES.reduce((a, n) => a + n[2] + 0.15, 0);
const len = Math.round(dur * sr);
const L = new Float32Array(len), R = new Float32Array(len);
let phase = 0, t0 = lead;
for (const [m, c, d, dr] of NOTES) {
  const a = Math.round(t0 * sr), b = Math.round((t0 + d) * sr);
  for (let i = a; i < b; i++) {
    const t = (i - a) / sr;
    const vib = t > 0.3 ? 0.2 * Math.sin(2 * Math.PI * 5.5 * t) : 0; // ±20 cents depois de 0,3 s
    const glide = t < 0.06 ? -0.5 * (1 - t / 0.06) : 0; // entra deslizando de baixo
    const slip = t > d / 2 ? (dr / 100) * ((t - d / 2) / (d / 2)) : 0; // sobe devagar na segunda metade
    const f = 440 * Math.pow(2, (m + c / 100 + vib + glide + slip - 69) / 12);
    phase += (2 * Math.PI * f) / sr;
    let s = 0;
    for (let h = 1; h <= 12; h++) s += Math.sin(h * phase) / (h * (h < 4 ? 1 : 1.6));
    const env = Math.min(1, t / 0.04, (d - t) / 0.08);
    const v = 0.22 * s * env + (Math.random() - 0.5) * 0.002;
    L[i] += v; R[i] += v;
  }
  t0 += d + 0.15;
}
if (withBed) { // acordes de Dó maior em teclado simples, de fundo
  const chords = [[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55]];
  const per = (dur - lead - tail) / chords.length;
  chords.forEach((ch, k) => {
    const a = Math.round((lead + k * per) * sr), b = Math.round((lead + (k + 1) * per) * sr);
    for (let i = a; i < b; i++) {
      const t = (i - a) / sr; let s = 0;
      for (const m of ch) { const f = 440 * Math.pow(2, (m - 69) / 12); s += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t); }
      const env = Math.exp(-t * 0.8) * Math.min(1, t / 0.01);
      L[i] += 0.05 * s * env; R[i] += 0.04 * s * env;
    }
  });
}
const buf = Buffer.alloc(44 + len * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + len * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(len * 4, 40);
for (let i = 0; i < len; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
fs.writeFileSync(out, buf);
console.log(out, dur.toFixed(2) + ' s');
