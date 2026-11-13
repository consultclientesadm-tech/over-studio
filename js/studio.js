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
  let res = await fetch(url).catch(() => null);
  if ((!res || !res.ok) && localOf(url) !== url) res = await fetch(localOf(url));
  if (!res.ok) throw new Error(`modelo ${res.status}`);
  if (cache) {
    // Grava direto no armazenamento do aparelho enquanto baixa (sem juntar pedaços na memória: no iPhone,
    // juntar e copiar o modelo no primeiro uso estourava a memória e o app voltava para o início).
    const put = cache.put(url, res.clone());
    const reader = res.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; onBytes(value.length); }
    try { await put; const again = await cache.match(url); if (again) return again.arrayBuffer(); } catch { /* sem espaço */ }
    const r2 = await fetch(url).catch(() => fetch(localOf(url))); return r2.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; onBytes(value.length); }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

// Baixa o modelo em segundo plano assim que o app abre (vai direto para o armazenamento, sem ocupar memória):
// quando a pessoa subir o vídeo, a IA já está no aparelho.
export async function prefetchModel() {
  try {
    const cache = await caches.open(MODEL_CACHE);
    for (const u of useLite() ? SP_PARTS : MODEL_PARTS) if (!(await cache.match(u))) {
      let r = await fetch(u).catch(() => null);
      if ((!r || !r.ok) && localOf(u) !== u) r = await fetch(localOf(u));
      if (r.ok) await cache.put(u, r);
    }
    return true;
  } catch { return false; }
}

// Celular usa a IA leve (Spleeter, ~40 MB, pouca memória). Computador usa a HTDemucs (mais fina, ~170 MB, ~2,5 GB de memória).
// A IA leve vem da CDN gratuita jsDelivr (cópia fixa deste repositório público): não pesa no servidor do site
// quando muita gente usa ao mesmo tempo. Se a CDN falhar, baixa do próprio site.
const CDN = 'https://cdn.jsdelivr.net/gh/consultclientesadm-tech/over-studio@2be6b966940bbd840065d29ce803ab1428c1302c/';
const SP_PARTS = ['vocals', 'accompaniment'].map((n) => CDN + `assets/ai/spleeter-${n}.bin`);
const localOf = (u) => (u.startsWith(CDN) ? new URL('../' + u.slice(CDN.length), import.meta.url).href : u);
const SP_TOTAL = 19681017 + 19681024;
export const useLite = () => {
  try {
    const ua = navigator.userAgent || '';
    const mobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
    // A IA grande só em computador com placa de vídeo acessível pelo navegador (WebGPU) e memória de sobra.
    // Qualquer outro computador (Firefox, Mac antigo, notebook de 4 GB) usa a leve, que roda em qualquer um.
    let weak = false; try { weak = localStorage.getItem('sc-lite') === '1'; } catch {}
    return mobile || weak || !navigator.gpu || (navigator.deviceMemory && navigator.deviceMemory < 8) || !matchMedia('(pointer: fine)').matches;
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

let ortP = null;
function loadOrt() { return (ortP ||= loadOrt1()); }
async function loadOrt1() {
  // Arquivos com extensão .js (e não .mjs): qualquer servidor manda o tipo certo, inclusive o nginx do Plesk
  // Celular: versão só-CPU do motor (12 MB em vez de 27 MB): compilar o motor grande sozinho já gastava
  // centenas de MB de memória no iPhone. Computador: versão com placa de vídeo (WebGPU).
  const lite = useLite();
  const ort = lite ? await import('./vendor/ort/ort.wasm.min.js') : await import('./vendor/ort/ort.webgpu.min.js');
  ort.env.wasm.wasmPaths = lite ? {
    mjs: new URL('./vendor/ort/ort-wasm-simd-threaded.js', import.meta.url).href,
    wasm: new URL('./vendor/ort/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  } : {
    mjs: new URL('./vendor/ort/ort-wasm-simd-threaded.asyncify.js', import.meta.url).href,
    wasm: new URL('./vendor/ort/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
  };
  // Com o service worker desta pasta (coi-sw.js) a página fica isolada e a IA usa vários núcleos
  ort.env.wasm.numThreads = self.crossOriginIsolated && !useLite() ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  return ort;
}

// Uma rede por vez: carrega a da voz, passa a música toda, libera; depois a do acompanhamento.
// Assim o pico de memória é o de uma rede só (no iPhone isso decide se o Safari fecha a página).
async function loadPart(ort, i, onBytes) {
  const buf = await fetchPart(SP_PARTS[i], onBytes);
  return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'basic', enableCpuMemArena: false, enableMemPattern: false });
}

// Separação leve (Spleeter 2 faixas, Deezer, MIT): trabalha em blocos de 512 quadros (~12 s).
async function separateLite(channels, { onDownload, onProgress }) {
  const ort = await loadOrt();
  const { fft, ifft, getHannWindow } = await import('./vendor/demucs/fft.js');
  const N = 4096, H = 1024, BINS = 1024, FULL = N / 2 + 1, F = 512;
  const L = channels[0].length, P = N;
  const src = [channels[0], channels[1] || channels[0]];
  const Lp = L + 2 * P;
  const nf = Math.floor((Lp - N) / H) + 1;
  const win = getHannWindow(N);
  const frIn = new Float32Array(N), re = new Float32Array(N), im = new Float32Array(N), oRe = new Float32Array(N), oIm = new Float32Array(N);
  const chunks = Math.ceil(nf / F);
  let got = 0;
  const dl = (b) => { got += b; onDownload(Math.min(1, got / SP_TOTAL)); };
  const frame = (c, fi) => {
    const st = fi * H - P;
    for (let i = 0; i < N; i++) { const t = st + i; frIn[i] = t >= 0 && t < L ? src[c][t] * win[i] : 0; }
    fft(re, im, frIn, N);
  };
  const feed = (k) => {
    const f0 = k * F, n = Math.min(F, nf - f0), x = new Float32Array(2 * F * BINS);
    for (let c = 0; c < 2; c++) for (let j = 0; j < n; j++) {
      frame(c, f0 + j);
      const xo = (c * F + j) * BINS;
      for (let b = 0; b < BINS; b++) x[xo + b] = Math.hypot(re[b], im[b]);
    }
    return new ort.Tensor('float32', x, [2, 1, F, BINS]);
  };
  // Passo 1: rede da voz. Guarda só a energia da voz, comprimida em 16 bits (log), 2 bytes por ponto.
  const Q = 1500, lo = -24;
  const V = new Uint16Array(2 * nf * BINS);
  let net = await loadPart(ort, 0, dl);
  for (let k = 0; k < chunks; k++) {
    const f0 = k * F, n = Math.min(F, nf - f0);
    const out = await net.run({ x: feed(k) });
    const v = out.y.data;
    for (let c = 0; c < 2; c++) for (let j = 0; j < n; j++) {
      const xo = (c * F + j) * BINS, vo = (c * nf + f0 + j) * BINS;
      for (let b = 0; b < BINS; b++) { const e = Math.log(v[xo + b] * v[xo + b] + 1e-11) - lo; V[vo + b] = e <= 0 ? 0 : Math.min(65535, Math.round(e * Q)); }
    }
    out.y.dispose?.();
    onProgress(0.5 * (k + 1) / chunks);
    await tick();
  }
  await net.release(); net = null;
  // Passo 2: rede do acompanhamento, máscara e volta para o som.
  net = await loadPart(ort, 1, dl);
  const outS = [new Float32Array(Lp), new Float32Array(Lp)];
  for (let k = 0; k < chunks; k++) {
    const f0 = k * F, n = Math.min(F, nf - f0);
    const out = await net.run({ x: feed(k) });
    const a = out.y.data;
    for (let c = 0; c < 2; c++) for (let j = 0; j < n; j++) {
      frame(c, f0 + j);
      const xo = (c * F + j) * BINS, vo = (c * nf + f0 + j) * BINS;
      let hi = 0;
      for (let b = 0; b < BINS; b++) {
        const q = V[vo + b], vv = q ? Math.exp(q / Q + lo) : 0, aa = a[xo + b] * a[xo + b];
        const m = (vv + 5e-11) / (vv + aa + 1e-10);
        if (b >= 960) hi += m;
        re[b] *= m; im[b] *= m;
      }
      hi /= BINS - 960; // acima de 11 kHz: usa a média do topo (mantém o brilho da voz)
      for (let b = BINS; b < FULL; b++) { re[b] *= hi; im[b] *= hi; }
      for (let b = 1; b < N / 2; b++) { re[N - b] = re[b]; im[N - b] = -im[b]; }
      ifft(oRe, oIm, re, im, N);
      const st = (f0 + j) * H, o = outS[c];
      for (let i = 0; i < N; i++) o[st + i] += oRe[i] * win[i];
    }
    out.y.dispose?.();
    onProgress(0.5 + 0.5 * (k + 1) / chunks);
    await tick();
  }
  await net.release(); net = null;
  // Janela de Hann com passo de 1/4: a soma das janelas ao quadrado é 1,5 em todo o trecho útil
  const voice = outS.map((o) => o.subarray(P, P + L));
  for (const v of voice) for (let i = 0; i < L; i++) v[i] /= 1.5;
  if (separateLite.noBed) return { voice }; // no ajudante: o playback é feito no app, fora do pico de memória da IA
  return { voice, bed: bedOf(src, voice) };
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

export { separateLite };
const bedOf = (src, voice) => voice.map((v, c) => { const s = src[c] || src[0], b = new Float32Array(v.length); for (let i = 0; i < v.length; i++) b[i] = s[i] - v[i]; return b; });
function separateInWorker(channels, { onDownload, onProgress }) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./sep-worker.js?v=39', import.meta.url), { type: 'module' }); } catch (e) { return reject(e); }
    let started = false, last = Date.now(), sent = false;
    const send = () => {
      if (sent) return; sent = true;
      // manda o próprio áudio (sem cópia); ele volta junto com a voz
      const L = channels[0], R = channels[1] && channels[1] !== channels[0] ? channels[1] : channels[0].slice();
      w.postMessage({ L, R }, [L.buffer, R.buffer]);
    };
    const guard = setInterval(() => { if (Date.now() - last > 120000) done(reject, new Error('ajudante parou de responder')); }, 5000);
    const done = (fn, v) => { clearInterval(guard); w.terminate(); if (v instanceof Error) v.lost = sent; fn(v); };
    w.onmessage = (e) => {
      const m = e.data; started = true; last = Date.now();
      if (m.t === 'ready') send();
      else if (m.t === 'd') onDownload(m.p);
      else if (m.t === 'p') onProgress(m.p);
      else if (m.t === 'done') {
        const voice = m.voice.map((v) => new Float32Array(v.b, v.o, v.n)), orig = [m.L, m.R];
        done(resolve, { voice, bed: bedOf(orig, voice), orig });
      }
      else if (m.t === 'err') done(reject, new Error(m.m));
    };
    w.onerror = (e) => { e.preventDefault?.(); done(reject, new Error(e.message || (started ? 'ajudante caiu' : 'ajudante não abriu'))); };
  });
}

// Separa: devolve a voz e o playback (playback = música − voz, então somar os dois dá a música original)
export async function separate(channels, { onDownload = () => {}, onProgress = () => {} } = {}) {
  if (useLite()) {
    // No celular a IA roda num "ajudante" separado que é desligado no fim: assim toda a memória dela volta
    // para o aparelho antes de abrir a imagem do vídeo (sem isso o iPhone fechava o app nessa hora).
    if (typeof window !== 'undefined' && window.Worker && !separate.noWorker) {
      try { return await separateInWorker(channels, { onDownload, onProgress }); } catch (e) {
        // o ajudante caiu (pouca memória no celular) e levou o áudio junto: quem chamou relê o áudio e tenta direto
        separate.noWorker = true;
        if (e.lost || channels[0].length === 0) { const x = new Error('A separação da voz parou no meio. Toque em Novo vídeo e tente de novo.'); x.lost = true; x.causa = String(e.message || '').slice(0, 80); throw x; }
        console.warn('ajudante da IA falhou, rodando direto:', e.message);
      }
    }
    return separateLite(channels, { onDownload, onProgress });
  }
  const L = channels[0], R = channels[1] || channels[0];
  let res;
  try {
    const proc = await loadDemucs(onDownload);
    proc.onProgress = (p) => onProgress(p.progress);
    res = await proc.separate(L, R);
  } catch (e) {
    // Computador sem força para a IA grande: termina com a leve e lembra disso nas próximas vezes
    console.warn('IA grande falhou, usando a leve:', e.message);
    try { localStorage.setItem('sc-lite', '1'); } catch {}
    demucs = null;
    return separateLite(channels, { onDownload, onProgress });
  }
  const voice = [res.vocals.left, res.vocals.right];
  const bed = [new Float32Array(L.length), new Float32Array(L.length)];
  for (let i = 0; i < L.length; i++) { bed[0][i] = L[i] - voice[0][i]; bed[1][i] = R[i] - voice[1][i]; }
  return { voice, bed };
}

// ---------- Afinação de estúdio (Signalsmith Stretch) ----------
let stretchMod = null;
async function loadStretch() {
  if (stretchMod) return stretchMod;
  const { default: Factory } = await import('./vendor/stretch.js');
  stretchMod = Factory;
  return Factory;
}

// notes: [{start, end, cents}] — cada nota vai para o centro certo (−cents), com entrada e saída suaves;
// deslizes e vibrato ficam como a pessoa cantou. Fora das notas o áudio original fica intacto.
// n.shift (semitons) = ajuste feito na mão no editor; n.strength (0–1) = força da correção automática.
// n.curve = { t0, dt, v } (semitons por quadro): correção que varia dentro da nota (puxa de volta as escorregadas)
const curveAt = (c, t) => { const x = (t - c.t0) / c.dt, i = Math.floor(x), f = x - i, v = c.v; if (!v.length) return 0; const a = v[Math.max(0, Math.min(v.length - 1, i))], b = v[Math.max(0, Math.min(v.length - 1, i + 1))]; return a * (1 - f) + b * f; };
const curveMax = (c) => c.v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const shiftOf = (n) => (n.shift != null ? Math.max(-12.5, Math.min(12.5, n.shift)) : Math.max(-1, Math.min(1, -n.cents / 100)) * (n.strength ?? 1));
export async function tuneVoice(channels, sr, notes, onProgress = () => {}) {
  const todo = notes.filter((n) => (n.curve ? curveMax(n.curve) >= 0.02 : n.shift != null ? Math.abs(n.shift) >= 0.02 : Math.abs(n.cents) >= 6));
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
  // Notas vizinhas se sobrepõem nas rampas: a correção é a média pesada das notas que valem naquele
  // instante (antes pegava só a primeira e a correção pulava de uma vez na troca de nota)
  const corrAt = (t) => {
    let sw = 0, sv = 0;
    for (const n of todo) {
      if (t < n.start - RAMP || t > n.end + RAMP) continue;
      const w = Math.max(0, Math.min(1, (t - (n.start - RAMP)) / RAMP, ((n.end + RAMP) - t) / RAMP));
      sw += w; sv += w * (n.curve ? curveAt(n.curve, Math.max(n.start, Math.min(n.end, t))) : shiftOf(n));
    }
    return sw > 1 ? sv / sw : sv;
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
  // Usa o áudio processado só nas notas corrigidas (com emenda suave); o resto fica idêntico ao original.
  // Primeiro monta UMA curva de mistura para a música toda (a maior entre as notas) e só depois mistura:
  // antes cada nota regravava o trecho dela e, onde duas notas se sobrepunham, o começo da segunda
  // cortava de uma vez o áudio afinado da primeira — era o "tic" entre as palavras.
  const F = Math.round(0.03 * sr);
  const W = new Float32Array(len);
  for (const n of todo) {
    const a = Math.max(0, Math.round((n.start - RAMP - 0.04) * sr)), b = Math.min(len, Math.round((n.end + RAMP + 0.04) * sr));
    for (let i = a; i < b; i++) { const w = Math.min(1, (i - a) / F, (b - 1 - i) / F); if (w > W[i]) W[i] = w; }
  }
  const res = channels.map((c) => c.slice());
  for (let i = 0; i < len; i++) {
    const w = W[i];
    if (w <= 0) continue;
    for (let c = 0; c < nc; c++) res[c][i] = channels[c][i] * (1 - w) + out[c][i + lat] * w;
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
