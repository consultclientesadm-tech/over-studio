// ===== Várias vozes: dupla, trio, backing vocal =====
// Depois que a IA tira a voz do instrumental, as vozes de quem canta junto ainda estão misturadas numa
// faixa só. Aqui, tudo no próprio aparelho e sem IA paga:
//   1) findVoices: em cada pedacinho de 23 ms acha TODAS as notas que estão soando ao mesmo tempo
//      (cada voz tem uma "escada" de harmônicos; acha a mais forte, tira os harmônicos dela e procura
//      a próxima). Liga as notas no tempo em "linhas de canto" e conta quantas vozes cantam juntas.
//   2) Quem é quem: onde todas cantam juntas, a mais aguda é a Voz 1 (primeira voz), a de baixo a Voz 2…
//      Nos trechos em que só uma canta, decide pelo timbre (o "desenho" dos harmônicos de cada cantor)
//      e pela região da voz.
//   3) splitVoices: cada voz fica com os harmônicos dela (máscara no espectro). As máscaras somam 1, então
//      as vozes separadas somadas dão exatamente a faixa de voz original (nada se perde nem duplica).
import { fft, ifft, getHannWindow } from './vendor/demucs/fft.js';

const N = 4096, H = 1024; // ~93 ms de janela, um quadro a cada ~23 ms (44,1 kHz)
const MAXV = 4; // até 4 vozes (quarteto)
const tick = () => new Promise((r) => setTimeout(r, 0));
const toMidi = (f) => 69 + 12 * Math.log2(f / 440);
const toHz = (m) => 440 * 2 ** ((m - 69) / 12);

const mono = (ch) => {
  if (ch.length < 2 || ch[1] === ch[0]) return ch[0];
  const L = ch[0], R = ch[1], m = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) m[i] = (L[i] + R[i]) * 0.5;
  return m;
};

// Quadro fi: centro na amostra fi*H
function frameFFT(x, fi, win, buf, re, im) {
  const st = fi * H - N / 2, len = x.length;
  for (let i = 0; i < N; i++) { const t = st + i; buf[i] = t >= 0 && t < len ? x[t] * win[i] : 0; }
  fft(re, im, buf, N);
}

// ---------- 1) Notas ao mesmo tempo, quadro a quadro ----------
export async function findVoices(channels, sr, onProgress = () => {}) {
  const x = mono(channels), len = x.length;
  const nf = Math.ceil(len / H) + 1, bin = sr / N, dt = H / sr;
  const KMAX = Math.min(N / 2, Math.ceil(5000 / bin));
  const win = getHannWindow(N), buf = new Float32Array(N), re = new Float32Array(N), im = new Float32Array(N);
  const mag = new Float32Array(KMAX), Y = new Float32Array(KMAX), R = new Float32Array(KMAX), env = new Float32Array(KMAX);
  // candidatas: de Mi1 (~82 Hz) a Dó6 (~1 kHz), de 1/5 em 1/5 de semitom
  const cands = []; for (let m = 40; m <= 84.001; m += 0.2) cands.push({ m, f: toHz(m) });
  const sal = new Float32Array(cands.length);
  // volume de cada quadro (para ignorar respiro e silêncio)
  const rms = new Float32Array(nf);
  for (let fi = 0; fi < nf; fi++) {
    let s = 0, c = 0; const a = Math.max(0, fi * H - N / 4), b = Math.min(len, fi * H + N / 4);
    for (let i = a; i < b; i++) { s += x[i] * x[i]; c++; }
    rms[fi] = c ? Math.sqrt(s / c) : 0;
  }
  const loud = [...rms].filter((v) => v > 1e-5).sort((a, b) => a - b);
  const gate = loud.length ? loud[Math.floor(loud.length * 0.5)] * 0.3 : 1;
  const salience = (spec, f) => {
    let s = 0;
    const hmax = Math.min(20, Math.floor((KMAX - 2) * bin / f));
    for (let h = 1; h <= hmax; h++) {
      const c = (h * f) / bin, w = Math.max(1, c * 0.012);
      let mx = 0; for (let k = Math.max(1, Math.round(c - w)); k <= Math.min(KMAX - 1, Math.round(c + w)); k++) if (spec[k] > mx) mx = spec[k];
      s += ((f + 27) / (h * f + 320)) * mx;
    }
    return s;
  };
  const frames = new Array(nf);
  for (let fi = 0; fi < nf; fi++) {
    frames[fi] = [];
    if (fi % 60 === 0) { onProgress((fi / nf) * 0.85); await tick(); }
    if (rms[fi] < gate) continue;
    frameFFT(x, fi, win, buf, re, im);
    let tot = 0;
    for (let k = 0; k < KMAX; k++) { mag[k] = Math.hypot(re[k], im[k]); if (k * bin > 80) tot += mag[k] * mag[k]; }
    if (tot <= 0) continue;
    // branqueamento parcial: harmônicos fracos (voz de trás) também aparecem, sem virar ruído
    const Wn = 12; let acc = 0;
    for (let k = 0; k < Math.min(KMAX, Wn); k++) acc += mag[k];
    for (let k = 0; k < KMAX; k++) {
      const a = k + Wn < KMAX ? mag[k + Wn] : 0, b = k - Wn - 1 >= 0 ? mag[k - Wn - 1] : 0;
      acc += a - b; env[k] = acc / (2 * Wn + 1);
      Y[k] = mag[k] * Math.pow(env[k] + 1e-9, -0.67);
      R[k] = Y[k];
    }
    const found = [], claimed = new Uint8Array(KMAX);
    let s1 = 0;
    for (let it = 0; it < MAXV; it++) {
      let bi = -1, bs = 0;
      for (let j = 0; j < cands.length; j++) { sal[j] = salience(R, cands[j].f); if (sal[j] > bs) { bs = sal[j]; bi = j; } }
      if (bi < 0) break;
      if (it === 0) s1 = bs; else if (bs < 0.3 * s1) break;
      // altura exata: média dos harmônicos (com interpolação do pico), pesada pela força de cada um
      const f0 = cands[bi].f;
      let num = 0, den = 0, eh = 0;
      const hmax = Math.min(25, Math.floor((KMAX - 2) * bin / f0));
      const peaks = [];
      for (let h = 1; h <= hmax; h++) {
        const c = (h * f0) / bin, w = Math.max(1, c * 0.015);
        let k = -1, mx = 0;
        for (let q = Math.max(1, Math.round(c - w)); q <= Math.min(KMAX - 2, Math.round(c + w)); q++) if (R[q] > mx) { mx = R[q]; k = q; }
        if (k < 1) continue;
        peaks.push(k);
        const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(mag[k] + 1e-12), cc = Math.log(mag[k + 1] + 1e-12);
        const d = a - 2 * b + cc, p = d < 0 ? (0.5 * (a - cc)) / d : 0;
        if (h <= 10 && mag[k] > 0) { const wgt = mag[k]; num += wgt * (((k + p) * bin) / h); den += wgt; }
        const wq = Math.max(2, Math.round(c * 0.012));
        for (let q = k - wq; q <= k + wq; q++) if (q >= 0 && q < KMAX && !claimed[q]) { eh += mag[q] * mag[q]; claimed[q] = 1; }
      }
      const fr = den > 0 ? num / den : f0;
      if (Math.abs(toMidi(fr) - cands[bi].m) > 0.6) break;
      const share = eh / tot; // quanto da energia do quadro é desta voz
      if (it === 0 ? share < 0.3 : share < 0.1) break;
      // a mesma nota de novo, ou a oitava/12ª de uma voz já achada (sobra dos harmônicos dela), não é voz nova
      const mf = toMidi(fr);
      if (found.some((g) => [0, 12, 19, 24].some((iv) => Math.abs(mf - g.m - iv) < 0.6))) break;
      found.push({ m: toMidi(fr), e: share });
      // tira esta voz do espectro e procura a próxima
      for (const k of peaks) { const wq = Math.max(2, Math.round(k * 0.012)); for (let q = k - wq; q <= k + wq; q++) if (q >= 0 && q < KMAX) R[q] *= 0.03; }
    }
    frames[fi] = found;
  }
  onProgress(0.9); await tick();

  // ---------- Linhas de canto: liga as notas de um quadro com as do próximo ----------
  const lines = [], open = [];
  const GAP = 3, MINLEN = Math.round(0.12 / dt);
  for (let fi = 0; fi < nf; fi++) {
    const ps = frames[fi].map((p) => ({ ...p, used: false }));
    const pairs = [];
    for (const l of open) for (let j = 0; j < ps.length; j++) { const d = Math.abs(ps[j].m - l.last); if (d < 1.2) pairs.push({ l, j, d }); }
    pairs.sort((a, b) => a.d - b.d);
    const took = new Set();
    for (const { l, j } of pairs) { if (took.has(l) || ps[j].used) continue; took.add(l); ps[j].used = true; l.pts.push({ fi, m: ps[j].m, e: ps[j].e }); l.last = ps[j].m; l.end = fi; }
    for (const p of ps) if (!p.used) { const l = { pts: [{ fi, m: p.m, e: p.e }], last: p.m, start: fi, end: fi }; open.push(l); took.add(l); }
    for (let i = open.length - 1; i >= 0; i--) if (fi - open[i].end > GAP) { lines.push(open[i]); open.splice(i, 1); }
  }
  lines.push(...open);
  const good = lines.filter((l) => l.pts.length >= MINLEN);
  // quantas linhas ao mesmo tempo em cada quadro
  const cnt = new Uint8Array(nf);
  for (const l of good) for (const p of l.pts) cnt[p.fi]++;
  // trecho junto só conta se durar 0,3 s seguidos (a cauda do reverb na troca de nota não é outra voz)
  const run = Math.round(0.3 / dt);
  const together = (k) => {
    let tot = 0, r = 0;
    for (let fi = 0; fi <= nf; fi++) { if (fi < nf && cnt[fi] >= k) r++; else { if (r >= run) tot += r; r = 0; } }
    return tot;
  };
  let voiced = 0; for (let fi = 0; fi < nf; fi++) if (cnt[fi]) voiced++;
  let count = 1;
  for (let k = 2; k <= MAXV; k++) {
    const t = together(k), need = k === 2 ? Math.max(2.5 / dt, voiced * 0.08) : Math.max(1.5 / dt, voiced * 0.05);
    if (t >= need) count = k; else break;
  }
  const res = { count, nf, dt, sr, lines: good, frames, together: Math.round(together(2) * dt * 10) / 10, voicedSec: Math.round(voiced * dt * 10) / 10 };
  if (count >= 2) assign(res, x, sr, win, buf, re, im);
  onProgress(1);
  return res;
}

// ---------- 2) Quem é a Voz 1, a Voz 2… ----------
// Timbre de uma linha: o contorno dos harmônicos (em dB) em 12 pontos de 200 Hz a 4 kHz, sem o volume.
function timbreAt(mag, bin, f0, KMAX) {
  const pts = [];
  for (let h = 1; h * f0 < 4200 && h <= 30; h++) {
    const k = Math.round((h * f0) / bin); if (k >= KMAX) break;
    pts.push([h * f0, 20 * Math.log10(Math.max(mag[k - 1] || 0, mag[k], mag[k + 1] || 0) + 1e-9)]);
  }
  if (pts.length < 3) return null;
  const v = new Float32Array(12);
  for (let i = 0; i < 12; i++) {
    const f = 200 * 20 ** (i / 11);
    let j = 0; while (j < pts.length - 2 && pts[j + 1][0] < f) j++;
    const [fa, a] = pts[j], [fb, b] = pts[j + 1], u = Math.max(0, Math.min(1, (f - fa) / (fb - fa)));
    v[i] = a + (b - a) * u;
  }
  let mu = 0; for (const q of v) mu += q; mu /= 12;
  for (let i = 0; i < 12; i++) v[i] -= mu;
  return v;
}
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };

function assign(res, x, sr, win, buf, re, im) {
  const { lines, count: K, nf } = res, bin = sr / N, KMAX = Math.min(N / 2, Math.ceil(5000 / bin));
  const mag = new Float32Array(KMAX);
  // timbre médio de cada linha (amostrando até 12 quadros dela)
  for (const l of lines) {
    const acc = new Float32Array(12); let c = 0;
    const step = Math.max(1, Math.floor(l.pts.length / 12));
    for (let i = 0; i < l.pts.length; i += step) {
      const p = l.pts[i]; frameFFT(x, p.fi, win, buf, re, im);
      for (let k = 0; k < KMAX; k++) mag[k] = Math.hypot(re[k], im[k]);
      const t = timbreAt(mag, bin, toHz(p.m), KMAX); if (!t) continue;
      for (let q = 0; q < 12; q++) acc[q] += t[q]; c++;
    }
    l.timbre = c ? acc.map((v) => v / c) : null;
    l.med = [...l.pts.map((p) => p.m)].sort((a, b) => a - b)[Math.floor(l.pts.length / 2)];
    l.voice = -1; l.votes = new Float32Array(K);
  }
  // quadros com todas as vozes: a mais aguda é a Voz 1
  const at = Array.from({ length: nf }, () => []);
  for (const l of lines) for (const p of l.pts) at[p.fi].push({ l, m: p.m });
  for (let fi = 0; fi < nf; fi++) {
    if (at[fi].length !== K) continue;
    at[fi].sort((a, b) => b.m - a.m).forEach((q, r) => q.l.votes[r]++);
  }
  const anch = lines.filter((l) => { const s = l.votes.reduce((a, b) => a + b, 0); return s >= 5 && Math.max(...l.votes) >= 0.6 * s; });
  for (const l of anch) l.voice = l.votes.indexOf(Math.max(...l.votes));
  // retrato de cada voz: região (nota média) e timbre médio
  const prof = Array.from({ length: K }, () => ({ w: 0, m: 0, t: new Float32Array(12), tw: 0 }));
  for (const l of anch) {
    const p = prof[l.voice], w = l.pts.length; p.w += w; p.m += l.med * w;
    if (l.timbre) { for (let q = 0; q < 12; q++) p.t[q] += l.timbre[q] * w; p.tw += w; }
  }
  for (const p of prof) { p.m = p.w ? p.m / p.w : 60; if (p.tw) for (let q = 0; q < 12; q++) p.t[q] /= p.tw; }
  for (let v = 0; v < K; v++) if (!prof[v].w) prof[v].m = (prof[v - 1]?.m ?? 70) - 4;
  let spread = 0, sc = 0;
  for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) if (prof[a].tw && prof[b].tw) { spread += dist(prof[a].t, prof[b].t); sc++; }
  spread = sc ? Math.max(1, spread / sc) : 0;
  // as outras linhas (trechos de uma voz só): a voz mais parecida que esteja livre naquele trecho
  const busy = Array.from({ length: K }, () => new Uint8Array(nf));
  for (const l of anch) for (const p of l.pts) busy[l.voice][p.fi] = 1;
  const rest = lines.filter((l) => l.voice < 0).sort((a, b) => b.pts.length - a.pts.length);
  for (const l of rest) {
    const cost = prof.map((p, v) => {
      let c = Math.abs(l.med - p.m) / 5;
      if (spread && l.timbre && p.tw) c += dist(l.timbre, p.t) / spread;
      let clash = 0; for (const q of l.pts) clash += busy[v][q.fi];
      return c + (clash / l.pts.length) * 4;
    });
    l.voice = cost.indexOf(Math.min(...cost));
    for (const p of l.pts) busy[l.voice][p.fi] = 1;
  }
  // altura de cada voz, quadro a quadro (NaN = calada). Se duas linhas caírem na mesma voz no mesmo
  // quadro, fica a mais forte.
  const f0 = Array.from({ length: K }, () => new Float32Array(nf).fill(NaN));
  const en = Array.from({ length: K }, () => new Float32Array(nf));
  for (const l of lines) for (const p of l.pts) if (p.e > en[l.voice][p.fi]) { en[l.voice][p.fi] = p.e; f0[l.voice][p.fi] = p.m; }
  res.f0 = f0;
  res.range = prof.map((p) => Math.round(p.m));
}

// ---------- 3) Separa: cada voz com os próprios harmônicos ----------
export async function splitVoices(channels, sr, est, onProgress = () => {}) {
  const x = mono(channels), len = x.length, K = est.count, nf = est.nf, bin = sr / N;
  const win = getHannWindow(N), buf = new Float32Array(N), re = new Float32Array(N), im = new Float32Array(N);
  const oRe = new Float32Array(N), oIm = new Float32Array(N), mr = new Float32Array(N), mi = new Float32Array(N);
  const B = N / 2 + 1, HK = Math.min(B, Math.ceil(8000 / bin));
  // atividade de cada voz, espalhada por ±0,3 s: consoantes, respiros e "s" perto das notas de uma voz são dela
  const spread = Math.round(0.3 / est.dt);
  const act = est.f0.map((f) => {
    const a = new Float32Array(nf);
    for (let fi = 0; fi < nf; fi++) if (!isNaN(f[fi])) for (let j = Math.max(0, fi - spread); j <= Math.min(nf - 1, fi + spread); j++) a[j] = Math.max(a[j], 1 - Math.abs(j - fi) / (spread + 1));
    return a;
  });
  const out = Array.from({ length: K }, () => new Float32Array(len));
  const W = Array.from({ length: K }, () => new Float32Array(B));
  const ok = (fi) => fi >= 0 && fi < nf;
  // começa 2 quadros antes e termina 2 depois: as pontas também somam as 4 janelas
  for (let fi = -2; fi < nf + 2; fi++) {
    if (fi % 40 === 0) { onProgress(Math.max(0, fi / nf)); await tick(); }
    frameFFT(x, fi, win, buf, re, im);
    let any = false;
    for (let v = 0; v < K; v++) {
      const w = W[v]; w.fill(0);
      const m = ok(fi) ? est.f0[v][fi] : NaN;
      if (isNaN(m)) continue;
      any = true;
      const f = toHz(m);
      for (let h = 1; h * f < 8000; h++) {
        const c = (h * f) / bin, s = 1.1 + c * 0.004;
        for (let k = Math.max(0, Math.floor(c - 3 * s)); k <= Math.min(HK - 1, Math.ceil(c + 3 * s)); k++) { const g = Math.exp(-0.5 * ((k - c) / s) ** 2); if (g > w[k]) w[k] = g; }
      }
    }
    const A = (v) => (ok(fi) ? act[v][fi] : 0);
    let actSum = 0; for (let v = 0; v < K; v++) actSum += A(v);
    for (let v = 0; v < K; v++) {
      // o que não é harmônico de ninguém (ruído, consoante, agudos): divide pela atividade de cada voz
      const eps = actSum > 0.01 ? (A(v) / actSum) * 0.005 : 0.005 / K;
      for (let k = 0; k < B; k++) {
        let tot = 0;
        if (any) for (let u = 0; u < K; u++) tot += W[u][k] * W[u][k];
        const mask = (any ? (W[v][k] * W[v][k] + eps) / (tot + 0.005) : 1 / K);
        mr[k] = re[k] * mask; mi[k] = im[k] * mask;
      }
      for (let k = 1; k < N / 2; k++) { mr[N - k] = mr[k]; mi[N - k] = -mi[k]; }
      ifft(oRe, oIm, mr, mi, N);
      const o = out[v], st = fi * H - N / 2;
      for (let i = 0; i < N; i++) { const t = st + i; if (t >= 0 && t < len) o[t] += oRe[i] * win[i]; }
    }
  }
  // Hann com passo de 1/4: a soma das janelas ao quadrado é 1,5
  onProgress(1);
  for (const o of out) for (let i = 0; i < len; i++) o[i] /= 1.5;
  return out;
}
