// ===== Estúdio no celular (Meu Palco) =====
// 1) Separa a voz do playback com a IA HTDemucs (Meta, código aberto), rodando no próprio aparelho.
// 2) Afina só a voz com o motor Signalsmith Stretch (código aberto): muda a altura sem mudar o timbre.
// 3) Junta a voz afinada com o playback, mixa e masteriza a música inteira.
// Nada sai do celular. O modelo da IA (~172 MB) é baixado uma vez e fica guardado no aparelho.

export const STUDIO_SR = 44100;
const MODEL_PARTS = [0, 1, 2, 3].map((i) => new URL(`../assets/ai/htdemucs.${i}.bin`, import.meta.url).href);
const MODEL_CACHE = 'afina-ia-v1';

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------- Modelo da IA: baixa em 4 pedaços (com progresso) e guarda no aparelho ----------
async function fetchPart(url, onBytes) {
  let cache = null;
  try { cache = await caches.open(MODEL_CACHE); } catch { /* sem Cache Storage */ }
  const hit = cache && (await cache.match(url));
  if (hit) { const b = await hit.arrayBuffer(); onBytes(b.byteLength); return b; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`modelo ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  // O service worker já guarda; sem ele (navegador comum), guarda aqui
  if (!navigator.serviceWorker?.controller) try { await cache?.put(url, new Response(out.slice().buffer)); } catch { /* sem espaço: baixa de novo da próxima vez */ }
  return out.buffer;
}

// Celular usa a IA leve (Spleeter, ~40 MB, pouca memória). Computador usa a HTDemucs (mais fina, ~170 MB, ~2,5 GB de memória).
const SP_PARTS = ['vocals', 'accompaniment'].map((n) => new URL(`../assets/ai/spleeter-${n}.bin`, import.meta.url).href);
const SP_TOTAL = 19681017 + 19681024;
export const useLite = () => {
  try {
    const ua = navigator.userAgent || '';
    const mobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
    return mobile || (navigator.deviceMemory && navigator.deviceMemory < 8) || !matchMedia('(pointer: fine)').matches;
  } catch { return true; }
};
export const modelSizeMB = () => (useLite() ? 40 : 170);

export async function modelCached() {
  try {
    const cache = await caches.open(MODEL_CACHE);
    for (const u of (useLite() ? SP_PARTS : MODEL_PARTS)) if (!(await cache.match(u))) return false;
    return true;
  } catch { return false; }
}

async function loadOrt() {
  const ort = await import('./vendor/ort/ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
  ort.env.wasm.numThreads = 1; // o site não usa isolamento entre origens (pixel e checkout continuam funcionando)
  return ort;
}

let spleeter = null;
async function loadSpleeter(onProgress) {
  if (spleeter) return spleeter;
  const ort = await loadOrt();
  let got = 0;
  const sessions = [];
  for (const u of SP_PARTS) {
    const buf = await fetchPart(u, (b) => { got += b; onProgress(Math.min(1, got / SP_TOTAL)); });
    sessions.push(await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }));
  }
  spleeter = { ort, vocals: sessions[0], accomp: sessions[1] };
  return spleeter;
}

// Separação leve (Spleeter 2 faixas, Deezer, MIT): trabalha em blocos de 512 quadros (~12 s),
// então a memória fica pequena mesmo em música de 5 minutos.
async function separateLite(channels, { onDownload, onProgress }) {
  const { ort, vocals, accomp } = await loadSpleeter(onDownload);
  const { fft, ifft, getHannWindow } = await import('./vendor/demucs/fft.js');
  const N = 4096, H = 1024, BINS = 1024, FULL = N / 2 + 1, F = 512;
  const L = channels[0].length, P = N;
  const src = [channels[0], channels[1] || channels[0]];
  const Lp = L + 2 * P;
  const nf = Math.floor((Lp - N) / H) + 1;
  const win = getHannWindow(N);
  const out = [new Float32Array(Lp), new Float32Array(Lp)];
  const frIn = new Float32Array(N), re = new Float32Array(N), im = new Float32Array(N), oRe = new Float32Array(N), oIm = new Float32Array(N);
  const chunks = Math.ceil(nf / F);
  for (let k = 0; k < chunks; k++) {
    const f0 = k * F, n = Math.min(F, nf - f0);
    const specRe = [new Float32Array(n * FULL), new Float32Array(n * FULL)];
    const specIm = [new Float32Array(n * FULL), new Float32Array(n * FULL)];
    const x = new Float32Array(2 * F * BINS);
    for (let c = 0; c < 2; c++) {
      for (let j = 0; j < n; j++) {
        const st = (f0 + j) * H - P;
        for (let i = 0; i < N; i++) { const t = st + i; frIn[i] = t >= 0 && t < L ? src[c][t] * win[i] : 0; }
        fft(re, im, frIn, N);
        specRe[c].set(re.subarray(0, FULL), j * FULL);
        specIm[c].set(im.subarray(0, FULL), j * FULL);
        const xo = (c * F + j) * BINS;
        for (let b = 0; b < BINS; b++) x[xo + b] = Math.hypot(re[b], im[b]);
      }
    }
    const feeds = { x: new ort.Tensor('float32', x, [2, 1, F, BINS]) };
    const v = (await vocals.run(feeds)).y.data;
    const a = (await accomp.run(feeds)).y.data;
    for (let c = 0; c < 2; c++) {
      for (let j = 0; j < n; j++) {
        const xo = (c * F + j) * BINS, so = j * FULL;
        let hi = 0;
        for (let b = 0; b < BINS; b++) {
          const vv = v[xo + b] * v[xo + b], aa = a[xo + b] * a[xo + b];
          const m = (vv + 5e-11) / (vv + aa + 1e-10);
          if (b >= 960) hi += m;
          re[b] = specRe[c][so + b] * m; im[b] = specIm[c][so + b] * m;
        }
        hi /= BINS - 960; // acima de 11 kHz: usa a média do topo (mantém o brilho da voz)
        for (let b = BINS; b < FULL; b++) { re[b] = specRe[c][so + b] * hi; im[b] = specIm[c][so + b] * hi; }
        for (let b = 1; b < N / 2; b++) { re[N - b] = re[b]; im[N - b] = -im[b]; }
        ifft(oRe, oIm, re, im, N);
        const st = (f0 + j) * H, o = out[c];
        for (let i = 0; i < N; i++) o[st + i] += oRe[i] * win[i];
      }
    }
    onProgress((k + 1) / chunks);
    await tick();
  }
  // Janela de Hann com passo de 1/4: a soma das janelas ao quadrado é 1,5 em todo o trecho útil
  const voice = out.map((o) => o.subarray(P, P + L));
  const bed = [new Float32Array(L), new Float32Array(L)];
  for (let c = 0; c < 2; c++) {
    const v = voice[c], s = src[c], b = bed[c];
    for (let i = 0; i < L; i++) { v[i] /= 1.5; b[i] = s[i] - v[i]; }
  }
  return { voice, bed };
}

let demucs = null;
async function loadDemucs(onProgress) {
  if (demucs) return demucs;
  const ort = await loadOrt();
  const { DemucsProcessor } = await import('./vendor/demucs/processor.js');
  const TOTAL = 180534758;
  let got = 0;
  const parts = [];
  for (const u of MODEL_PARTS) parts.push(await fetchPart(u, (b) => { got += b; onProgress(Math.min(1, got / TOTAL)); }));
  const model = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) { model.set(new Uint8Array(p), o); o += p.byteLength; }
  parts.length = 0;
  const proc = new DemucsProcessor({ ort });
  proc.only = 3; // só a voz
  const eps = typeof navigator !== 'undefined' && navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
  proc.sessionOptions = { executionProviders: eps };
  await proc.loadModel(model.buffer);
  demucs = proc;
  return proc;
}

// Separa: devolve a voz e o playback (playback = música − voz, então somar os dois dá a música original)
export async function separate(channels, { onDownload = () => {}, onProgress = () => {} } = {}) {
  if (useLite()) return separateLite(channels, { onDownload, onProgress });
  const proc = await loadDemucs(onDownload);
  const L = channels[0], R = channels[1] || channels[0];
  proc.onProgress = (p) => onProgress(p.progress);
  const res = await proc.separate(L, R);
  const voice = [res.vocals.left, res.vocals.right];
  const bed = [new Float32Array(L.length), new Float32Array(L.length)];
  for (let i = 0; i < L.length; i++) { bed[0][i] = L[i] - voice[0][i]; bed[1][i] = R[i] - voice[1][i]; }
  return { voice, bed };
}

// ---------- Afinação de estúdio (Signalsmith Stretch) ----------
let stretchMod = null;
async function loadStretch() {
  if (stretchMod) return stretchMod;
  const { default: Factory } = await import('./vendor/stretch.mjs');
  stretchMod = Factory;
  return Factory;
}

// notes: [{start, end, cents}] — cada nota vai para o centro certo (−cents), com entrada e saída suaves;
// deslizes e vibrato ficam como a pessoa cantou. Fora das notas o áudio original fica intacto.
// n.shift (semitons) = ajuste feito na mão no editor; n.strength (0–1) = força da correção automática.
const shiftOf = (n) => (n.shift != null ? Math.max(-12.5, Math.min(12.5, n.shift)) : Math.max(-1, Math.min(1, -n.cents / 100)) * (n.strength ?? 1));
export async function tuneVoice(channels, sr, notes, onProgress = () => {}) {
  const todo = notes.filter((n) => (n.shift != null ? Math.abs(n.shift) >= 0.02 : Math.abs(n.cents) >= 6));
  if (!todo.length) return channels;
  const Factory = await loadStretch();
  const m = await Factory();
  m._main();
  const nc = channels.length, len = channels[0].length;
  m._presetDefault(nc, sr);
  const lat = m._inputLatency() + m._outputLatency();
  const B = 256;
  const ptr = m._setBuffers(nc, B);
  // Curva de correção (semitons) amostra a amostra, por blocos
  const RAMP = 0.06;
  const corrAt = (t) => {
    for (const n of todo) {
      if (t < n.start - RAMP || t > n.end + RAMP) continue;
      const w = Math.max(0, Math.min(1, (t - (n.start - RAMP)) / RAMP, ((n.end + RAMP) - t) / RAMP));
      return shiftOf(n) * w;
    }
    return 0;
  };
  const inLat = m._inputLatency() / sr;
  const out = channels.map(() => new Float32Array(len + lat + B));
  m._setFormantSemitones(0, true); // mantém o timbre (sem voz de "esquilo" ou de robô)
  m._setFormantBase(0);
  for (let i = 0, k = 0; i < len + lat; i += B, k++) {
    // A mudança vale para o trecho que está sendo analisado agora (atrasado pela latência de entrada)
    m._setTransposeSemitones(corrAt(i / sr - inLat), 8000 / sr);
    const mem = m.HEAP8.buffer;
    for (let c = 0; c < nc; c++) {
      const inb = new Float32Array(mem, ptr + B * 4 * c, B);
      inb.fill(0);
      if (i < len) inb.set(channels[c].subarray(i, Math.min(len, i + B)));
    }
    m._process(B, B);
    const mem2 = m.HEAP8.buffer;
    for (let c = 0; c < nc; c++) out[c].set(new Float32Array(mem2, ptr + B * 4 * (c + nc), B), i);
    if (k % 400 === 0) { onProgress(i / (len + lat)); await tick(); }
  }
  // Usa o áudio processado só nas notas corrigidas (com emenda suave); o resto fica idêntico ao original
  const res = channels.map((c) => c.slice());
  const F = Math.round(0.03 * sr);
  for (const n of todo) {
    const a = Math.max(0, Math.round((n.start - RAMP - 0.04) * sr)), b = Math.min(len, Math.round((n.end + RAMP + 0.04) * sr));
    for (let i = a; i < b; i++) {
      const w = Math.min(1, (i - a) / F, (b - 1 - i) / F);
      for (let c = 0; c < nc; c++) res[c][i] = channels[c][i] * (1 - w) + out[c][i + lat] * w;
    }
  }
  return res;
}

// ---------- Mixar e masterizar a música inteira ----------
// Voz: limpa grave, tira o embolado, presença, brilho, segura o "s", compressor e um pouco de ambiente.
// Playback: leve corte onde a voz mora (abre espaço para ela). Tudo junto: compressor de mix e limitador
// (volume alto, pico em −1 dB: não racha).
// Sala gerada (resposta de impulso): ruído que vai sumindo; quanto mais reverb, maior e mais longa
function makeIR(ctx, sr, irLen, decay) {
  const ir = ctx.createBuffer(2, Math.round(sr * irLen), sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3) * Math.exp(-i / (sr * decay));
  }
  return ir;
}

// Só o "eco" do reverb (para ouvir na hora, antes de masterizar): mesma sala do mixMaster
export async function reverbWet(voice, sr, reverb, withBed = false) {
  const rv = Math.max(0, Math.min(1, reverb));
  const irLen = 0.8 + 2 * rv, decay = 0.16 + 0.55 * rv, len = voice[0].length;
  const ctx = new OfflineAudioContext(2, len, sr);
  const b = ctx.createBuffer(2, len, sr);
  b.copyToChannel(voice[0], 0); b.copyToChannel(voice[1] || voice[0], 1);
  const src = ctx.createBufferSource(); src.buffer = b;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
  const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx, sr, irLen, decay);
  const g = ctx.createGain(); g.gain.value = (withBed ? 0.4 : 0.48) * rv * 1.5;
  src.connect(hp).connect(conv).connect(lp).connect(g).connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
}

// reverb: 0–1 (quantidade escolhida pelo aluno; 0,25 = o ambiente de antes). Mais reverb = sala maior e cauda mais longa.
export async function mixMaster(voice, bed, sr, reverb = 0.25) {
  const rv = Math.max(0, Math.min(1, reverb));
  const irLen = 0.8 + 2 * rv, decay = 0.16 + 0.55 * rv;
  const len = voice[0].length, tail = Math.round(sr * (0.4 + irLen));
  const ctx = new OfflineAudioContext(2, len + tail, sr);
  const toBuf = (chs) => { const b = ctx.createBuffer(2, len, sr); b.copyToChannel(chs[0], 0); b.copyToChannel(chs[1] || chs[0], 1); return b; };
  const f = (type, freq, gain = 0, Q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.gain.value = gain; b.Q.value = Q; return b; };
  const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
  const bus = ctx.createGain();
  // Voz
  const vs = ctx.createBufferSource(); vs.buffer = toBuf(voice);
  const vcomp = ctx.createDynamicsCompressor();
  vcomp.threshold.value = -22; vcomp.knee.value = 8; vcomp.ratio.value = 3.5; vcomp.attack.value = 0.006; vcomp.release.value = 0.15;
  const vgain = ctx.createGain(); vgain.gain.value = bed ? 1.5 : 1.7;
  const vout = chain(vs, f('highpass', 90), f('peaking', 300, -2.5, 1.1), f('peaking', 800, -1, 1.4), f('peaking', 3200, 2.5, 0.9), f('peaking', 7000, -1.5, 2.5), f('highshelf', 11000, 2.5), vcomp, vgain);
  vout.connect(bus);
  // Ambiente da voz (sala curta, gerada)
  const conv = ctx.createConvolver();
  conv.buffer = makeIR(ctx, sr, irLen, decay);
  const wet = ctx.createGain(); wet.gain.value = (bed ? 0.4 : 0.48) * rv;
  chain(vout, f('highpass', 250), conv, f('lowpass', 7000), wet).connect(bus);
  // Playback
  if (bed) {
    const bs = ctx.createBufferSource(); bs.buffer = toBuf(bed);
    const bg = ctx.createGain(); bg.gain.value = 0.95;
    chain(bs, f('peaking', 2500, -1.5, 0.8), bg).connect(bus);
    bs.start();
  }
  // Mix: compressor de barramento + limitador
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -14; glue.knee.value = 10; glue.ratio.value = 2; glue.attack.value = 0.02; glue.release.value = 0.25;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
  chain(bus, glue, lim).connect(ctx.destination);
  vs.start();
  const out = await ctx.startRendering();
  const res = [0, 1].map((c) => out.getChannelData(c).slice());
  let peak = 0;
  for (const c of res) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  for (const c of res) for (let i = 0; i < c.length; i++) c[i] *= g;
  return res;
}

// Soma simples voz + playback (para ouvir enquanto edita)
export function mixDown(voice, bed) {
  if (!bed) return voice.map((c) => c.slice());
  const len = voice[0].length;
  return [0, 1].map((c) => {
    const v = voice[c] || voice[0], b = bed[c] || bed[0], o = new Float32Array(len);
    for (let i = 0; i < len; i++) o[i] = v[i] + b[i];
    return o;
  });
}
