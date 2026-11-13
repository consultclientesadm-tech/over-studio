// Teste do modo várias vozes (dupla/trio) com vozes sintéticas. Uso: node test/voices.test.mjs
import { findVoices, splitVoices } from '../js/voices.js';
const SR = 44100;
let fail = 0;
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  FALHOU', msg); if (!ok) fail++; };
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
// voz cantada: harmônicos com formantes (timbre), vibrato e um pouco de ar
function sing(len, notes, formants, seed = 1, gain = 0.3) {
  const out = new Float32Array(len);
  let ph = 0, rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [a, b, m] of notes) {
    const i0 = Math.round(a * SR), i1 = Math.round(b * SR);
    for (let i = i0; i < i1 && i < len; i++) {
      const t = (i - i0) / SR, env = Math.min(1, t / 0.05, (i1 - i) / SR / 0.05);
      const f = hz(m + 0.3 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.3));
      ph += (2 * Math.PI * f) / SR;
      let s = 0;
      for (let h = 1; h * f < 8000; h++) {
        let g = 0; for (const [fc, bw, amp] of formants) g += amp / (1 + ((h * f - fc) / bw) ** 2);
        s += (g / h ** 0.3) * Math.sin(h * ph);
      }
      out[i] += gain * env * (s * 0.2 + 0.003 * rand());
    }
  }
  return out;
}
const A = [[700, 130, 1], [1200, 150, 0.6], [2700, 250, 0.4]]; // timbre claro (voz 1)
const B = [[500, 100, 1], [900, 120, 0.8], [2300, 300, 0.15]]; // timbre escuro (voz 2)
const mel = (t0, n, base, step = [0, 2, 4, 5, 7, 5, 4, 2]) => Array.from({ length: n }, (_, i) => [t0 + i * 0.75, t0 + i * 0.75 + 0.7, base + step[i % step.length]]);
const add = (...xs) => { const o = new Float32Array(xs[0].length); for (const x of xs) for (let i = 0; i < o.length; i++) o[i] += x[i]; return o; };

// 1) Dupla: 6 s só a Voz 1, 6 s só a Voz 2, 12 s as duas juntas (Voz 2 uma terça abaixo)
{
  const len = 24 * SR;
  const v1 = sing(len, [...mel(0, 8, 67), ...mel(12, 16, 67)], A, 3);
  const v2 = sing(len, [...mel(6, 8, 62), ...mel(12, 16, 63, [-3, -1, 0, 2, 4, 2, 0, -1])], B, 7);
  const mix = add(v1, v2);
  const t = Date.now();
  const est = await findVoices([mix, mix], SR);
  console.log('Dupla:', est.count, 'vozes,', est.together, 's juntas de', est.voicedSec, 's, regiões', est.range, (Date.now() - t) + ' ms');
  check(est.count === 2, 'achou 2 vozes');
  // quem é quem: no trecho solo de cada um e no trecho junto
  const who = (a, b, v) => { let ok = 0, n = 0; for (let fi = Math.round(a * SR / 1024); fi < Math.round(b * SR / 1024); fi++) { const on = !isNaN(est.f0[v][fi]); n++; if (on) ok++; } return ok / n; };
  check(who(0.5, 5.5, 0) > 0.7 && who(0.5, 5.5, 1) < 0.15, `trecho só da Voz 1 ficou na Voz 1 (${(who(0.5, 5.5, 0) * 100).toFixed(0)}%)`);
  check(who(6.5, 11.5, 1) > 0.7 && who(6.5, 11.5, 0) < 0.15, `trecho só da Voz 2 ficou na Voz 2 (${(who(6.5, 11.5, 1) * 100).toFixed(0)}%, na Voz 1: ${(who(6.5, 11.5, 0) * 100).toFixed(0)}%)`);
  check(who(12.5, 23.5, 0) > 0.7 && who(12.5, 23.5, 1) > 0.7, `trecho junto: as duas vozes presentes (${(who(12.5, 23.5, 0) * 100).toFixed(0)}% e ${(who(12.5, 23.5, 1) * 100).toFixed(0)}%)`);
  const t2 = Date.now();
  const parts = await splitVoices([mix, mix], SR, est);
  console.log('  separação:', (Date.now() - t2) + ' ms');
  // soma das partes = original
  let e = 0, s = 0; for (let i = 0; i < len; i++) { const d = parts[0][i] + parts[1][i] - mix[i]; e += d * d; s += mix[i] * mix[i]; }
  check(10 * Math.log10(s / e) > 40, `Voz 1 + Voz 2 = faixa original (${(10 * Math.log10(s / e)).toFixed(0)} dB de diferença)`);
  // qualidade da separação no trecho junto (SDR)
  const sdr = (p, ref) => { let e = 0, s = 0; for (let i = 13 * SR; i < 23 * SR; i++) { const d = p[i] - ref[i]; e += d * d; s += ref[i] * ref[i]; } return 10 * Math.log10(s / e); };
  const s1 = sdr(parts[0], v1), s2 = sdr(parts[1], v2);
  console.log(`  separação no trecho junto: Voz 1 ${s1.toFixed(1)} dB, Voz 2 ${s2.toFixed(1)} dB`);
  check(s1 > 6 && s2 > 6, 'cada voz separada fica bem mais forte que a outra (> 6 dB; o que sobra são harmônicos que as duas vozes dividem)');
}
// 2) Uma voz só, com reverb grande: não pode virar dupla
{
  const len = 20 * SR;
  const dry = sing(len, mel(0.5, 25, 64), A, 5);
  const ir = new Float32Array(Math.round(1.8 * SR)); let r = 9; for (let i = 0; i < ir.length; i++) { r = (r * 16807) % 2147483647; ir[i] = ((r / 2147483647) * 2 - 1) * Math.exp(-i / (0.5 * SR)) * 0.02; } ir[0] = 1;
  // convolução esparsa (rápida o bastante para o teste)
  const wet = new Float32Array(len); for (let k = 0; k < ir.length; k += 151) { const g = ir[k] * (k ? 151 : 1); if (!g) continue; for (let i = k; i < len; i++) wet[i] += dry[i - k] * g; }
  const est = await findVoices([wet, wet], SR);
  console.log('Voz só com reverb:', est.count, 'voz,', est.together, 's juntas de', est.voicedSec);
  check(est.count === 1, 'uma voz só (reverb não vira segunda voz)');
}
// 3) Trio: três vozes juntas (tríade)
{
  const len = 16 * SR;
  const v1 = sing(len, mel(0.5, 20, 71, [0, 2, 0, -1, 0, 2, 4, 2]), A, 3);
  const v2 = sing(len, mel(0.5, 20, 67, [0, 2, 0, 0, 0, 2, 0, 2]), B, 7);
  const v3 = sing(len, mel(0.5, 20, 60, [0, -1, 0, 2, 0, -1, 0, -1]), [[600, 120, 1], [1000, 150, 0.7], [2500, 200, 0.3]], 11);
  const est = await findVoices([add(v1, v2, v3), add(v1, v2, v3)], SR);
  console.log('Trio:', est.count, 'vozes, regiões', est.range);
  check(est.count === 3, 'achou 3 vozes');
}
console.log(fail ? `${fail} FALHA(S)` : 'TUDO OK');
process.exit(fail ? 1 : 0);
