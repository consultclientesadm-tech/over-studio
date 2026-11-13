// Gera uma dupla sintética cantando (com notas um pouco desafinadas) em WAV. Uso: node test/make-duo.mjs saida.wav
import fs from 'fs';
const SR = 44100, hz = (m) => 440 * 2 ** ((m - 69) / 12);
function sing(len, notes, formants, seed, gain = 0.3) {
  const out = new Float32Array(len); let ph = 0, rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [a, b, m] of notes) {
    const i0 = Math.round(a * SR), i1 = Math.round(b * SR), off = rand() * 0.45; // até 45 cents fora
    for (let i = i0; i < i1 && i < len; i++) {
      const t = (i - i0) / SR, env = Math.min(1, t / 0.05, (i1 - i) / SR / 0.05);
      const f = hz(m + off + 0.25 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.3)); ph += (2 * Math.PI * f) / SR;
      let s = 0; for (let h = 1; h * f < 8000; h++) { let g = 0; for (const [fc, bw, amp] of formants) g += amp / (1 + ((h * f - fc) / bw) ** 2); s += (g / h ** 0.3) * Math.sin(h * ph); }
      out[i] += gain * env * (s * 0.2 + 0.003 * rand());
    }
  }
  return out;
}
const A = [[700, 130, 1], [1200, 150, 0.6], [2700, 250, 0.4]], B = [[500, 100, 1], [900, 120, 0.8], [2300, 300, 0.15]];
const mel = (t0, n, base, step) => Array.from({ length: n }, (_, i) => [t0 + i * 0.75, t0 + i * 0.75 + 0.7, base + step[i % step.length]]);
const len = 20 * SR, up = [0, 2, 4, 5, 7, 5, 4, 2], low = [-3, -1, 0, 2, 4, 2, 0, -1];
const v1 = sing(len, [...mel(1, 6, 67, up), ...mel(10, 13, 67, up)], A, 3);
const v2 = sing(len, [...mel(5.5, 6, 64, up), ...mel(10, 13, 64, low)], B, 7);
const buf = Buffer.alloc(44 + len * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + len * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(len * 4, 40);
for (let i = 0; i < len; i++) { const s = Math.max(-1, Math.min(1, v1[i] + v2[i])) * 32767; buf.writeInt16LE(s | 0, 44 + i * 4); buf.writeInt16LE(s | 0, 46 + i * 4); }
fs.writeFileSync(process.argv[2], buf);
