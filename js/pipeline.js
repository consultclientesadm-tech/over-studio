// ===== Motor do Cover Studio =====
// Recebe o vídeo do artista (como veio do celular) e devolve o áudio pronto, no mesmo tempo do vídeo:
//   1) tira o áudio do vídeo
//   2) separa a voz do instrumental (IA HTDemucs no computador, Spleeter no celular, as duas grátis)
//   3) acha as notas cantadas e o tom da música
//   4) afina nota por nota no estilo VariAudio (centro da nota vai para a nota certa; vibrato,
//      deslizes e timbre ficam como a pessoa cantou, por isso não fica robótico)
//   5) mixa, masteriza, reverb opcional
//   6) corta o silêncio do começo e do fim (opcional) e faz fade-in e fade-out (opcionais)
// Nada muda a duração do áudio: o vídeo é cortado nos mesmos pontos, então a boca continua batendo.
import { separate, tuneVoice, STUDIO_SR } from './studio.js';
import { pitchTrack, detectKey, chromaOf } from './analysis.js';
import { referenceNotes, applyReference } from './reference.js';
import { decodeVideoAudio } from './demux.js';

export const SR = STUDIO_SR;

export const DEFAULTS = {
  separate: true, // false = gravação só de voz (a cappella): o áudio inteiro é tratado como voz
  strength: 1, // força da afinação, 0 a 1 (1 = cada nota no centro)
  scaleSnap: true, // nota que caiu fora do tom vai para a nota do tom mais próxima
  straighten: true, // dentro da nota, puxa de volta as escorregadas que saem da faixa (vibrato fica)
  band: 0.15, // largura da faixa "verde" para cada lado, em semitons (0,15 = 15 cents)
  reverb: 0.2, // 0 a 1
  trim: true, // corta o silêncio do começo e do fim
  fadeIn: 0.4, // segundos (0 = sem fade)
  fadeOut: 1.5,
};

const tick = () => new Promise((r) => setTimeout(r, 0));
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// ---------- 1) Áudio do vídeo ----------
// O navegador lê o áudio de MP4/MOV (AAC) direto, sem descompactar nada antes.
export async function audioFromVideo(file, sr = SR) {
  // Vídeo MP4/MOV: tira o AAC de dentro do arquivo (funciona no iPhone e não carrega o vídeo inteiro
  // na memória). Se não der (outro formato), deixa o navegador ler o arquivo todo.
  if (/\.(mov|mp4|m4v|m4a)$/i.test(file.name || '') || /video\/(mp4|quicktime)|audio\/mp4/.test(file.type || '')) {
    try { return await decodeVideoAudio(file, sr); } catch (e) { console.warn('leitura direta do AAC falhou:', e.message); }
  }
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(2, 1, sr);
  const ab = await ctx.decodeAudioData(buf);
  const L = ab.getChannelData(0).slice();
  const R = ab.numberOfChannels > 1 ? ab.getChannelData(1).slice() : L.slice();
  return [L, R];
}

// ---------- 3) Notas cantadas ----------
// Trechos estáveis da melodia viram notas (como os blocos do VariAudio). Cada nota guarda a altura real
// (m, em semitons com fração) medida no miolo da nota, sem o ataque e a soltura, que deslizam naturalmente.
export function notesFrom(track) {
  const dt = track.length > 1 ? track[1].t - track[0].t : 0.032;
  const notes = [];
  let cur = null;
  const close = () => {
    if (cur && cur.ms.length * dt >= 0.09) {
      const k = Math.floor(cur.ms.length * 0.2);
      const core = cur.ms.slice(k, cur.ms.length - k);
      const m = median(core.length ? core : cur.ms);
      notes.push({ start: cur.start, end: cur.end, m, midi: Math.round(m), fr: cur.fr });
    }
    cur = null;
  };
  for (const f of track) {
    if (f.midi == null) { close(); continue; }
    if (cur && Math.abs(f.midi - median(cur.ms.slice(-6))) < 0.6) { cur.ms.push(f.midi); cur.fr.push(f); cur.end = f.t + dt; continue; }
    close();
    cur = { ms: [f.midi], fr: [f], start: f.t, end: f.t + dt };
  }
  close();
  return notes;
}

const scaleOf = (key) => (key.minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]).map((x) => (x + key.tonic) % 12);
const pc = (m) => ((Math.round(m) % 12) + 12) % 12;

// Para onde cada nota vai. Com scaleSnap, uma nota que caiu num semitom fora do tom (cantou muito baixo
// ou muito alto) vai para a nota do tom mais próxima, desde que esteja a menos de 3/4 de semitom dela.
// edits[i] = ajuste feito à mão na nota i (editor estilo VariAudio):
//   { target: nota MIDI escolhida, quantize: 0–1 (força só desta nota), straighten: 0–1, bypass: true }
export function planTuning(notes, key, { strength = 1, scaleSnap = true, straighten = true, band = 0.15, useRef = true } = {}, edits = {}) {
  const scale = scaleOf(key);
  return notes.map((n, i) => {
    const ed = edits[i] || {};
    let target = Math.round(n.m);
    if (scaleSnap && !scale.includes(pc(target))) {
      const opts = [target - 1, target + 1].filter((t) => scale.includes(pc(t)) && Math.abs(t - n.m) < 0.75);
      if (opts.length) target = opts.sort((a, b) => Math.abs(a - n.m) - Math.abs(b - n.m))[0];
    }
    // Modo referência: a nota da música original (no tom do artista) manda, se estiver a até 2,5 semitons
    // do que ele cantou (mais longe que isso é casamento errado ou escolha dele, e fica a regra do tom)
    const viaRef = useRef && n.refTarget != null && Math.abs(n.refTarget - n.m) <= 2.5;
    if (viaRef) target = n.refTarget;
    const manual = ed.target != null;
    if (manual) target = ed.target;
    const q = ed.bypass ? 0 : ed.quantize ?? strength;
    const st = ed.bypass ? 0 : ed.straighten ?? (straighten === true ? 1 : +straighten || 0);
    const cents = Math.round((n.m - target) * 100);
    // 1) Centro da nota vai para a nota certa. Automático: no máximo 1 semitom (mais que isso é escolha do
    //    cantor). Na mão, o artista pode mover a nota até uma oitava.
    const lim = manual ? 12 : viaRef ? 2.5 : 1;
    const base = Math.max(-lim, Math.min(lim, target - n.m)) * q;
    const plan = { ...n, i, target, cents, manual, viaRef, q, st, shift: Math.abs(target - n.m) * q >= 0.03 ? base : 0 };
    if (!n.fr || n.fr.length < 3) return plan;
    // 2) Endireitar: a linha "lenta" da nota (média de ~0,22 s, que some com o vibrato) não pode sair da
    //    faixa em volta da nota certa. O que vazar é puxado de volta só o quanto vazou; o vibrato fica.
    const dt = n.fr.length > 1 ? n.fr[1].t - n.fr[0].t : 0.032;
    const p = n.fr.map((f) => f.midi);
    const v = new Float32Array(p.length);
    for (let k = 0; k < p.length; k++) {
      const r = slow(p, k) + base - target; // onde a linha lenta fica depois do passo 1
      const leak = Math.abs(r) > band * 0.5 ? -Math.sign(r) * (Math.abs(r) - band * 0.5) : 0;
      v[k] = Math.max(-lim - 0.5, Math.min(lim + 0.5, base + leak * st));
    }
    plan.curve = { t0: n.fr[0].t + 0.032, dt, v }; // +0,032 s: centro da janela de análise
    return plan;
  });
}

// Linha lenta da voz: média de 7 quadros (~0,22 s), ignorando quadros sem nota. É a altura que o ouvido
// entende como "a nota"; o vibrato oscila em volta dela.
function slow(p, k, H = 3, lo = 0, hi = p.length - 1) {
  let s = 0, c = 0;
  for (let j = Math.max(lo, k - H); j <= Math.min(hi, k + H); j++) if (p[j] != null) { s += p[j]; c++; }
  return c ? s / c : p[k];
}

// Mede uma melodia (quadros de pitchTrack) contra as notas certas do plano: para cada quadro dentro de
// uma nota, a linha lenta está dentro da faixa? Devolve a % de tempo dentro e, por quadro, o resultado.
export function bandCheck(track, plan, band = 0.15) {
  const dt = track.length > 1 ? track[1].t - track[0].t : 0.032;
  const marks = new Int8Array(track.length); // 0 = fora de nota, 1 = dentro da faixa, -1 = fora
  let tot = 0, ok = 0;
  const p = track.map((f) => f.midi);
  for (const n of plan) {
    const a = Math.max(0, Math.ceil(n.start / dt)), b = Math.min(track.length - 1, Math.floor((n.end - dt) / dt));
    for (let k = a; k <= b; k++) {
      if (p[k] == null) continue;
      const r = slow(p, k, 3, a, b) - n.target; // só quadros da própria nota (a vizinha não conta)
      if (Math.abs(r) > 1.5) continue; // erro do medidor (pulo de oitava, consoante), não é nota
      const inside = Math.abs(r) <= band + 0.02; // 2 cents de folga da medição
      marks[k] = inside ? 1 : -1; tot++; if (inside) ok++;
    }
  }
  return { pct: tot ? Math.round((ok * 1000) / tot) / 10 : 100, marks, dt };
}

// Quanto do tempo cantado ficou dentro da faixa verde (linha lenta a menos de `band` da nota certa)
export function inBand(notes, band = 0.15, ref = (n) => Math.round(n.m)) {
  let tot = 0, ok = 0;
  for (const n of notes) {
    if (!n.fr) continue;
    const p = n.fr.map((f) => f.midi), T = ref(n);
    for (let k = 0; k < p.length; k++) { tot++; if (Math.abs(slow(p, k) - T) <= band + 0.05) ok++; }
  }
  return tot ? Math.round((ok * 100) / tot) : 100;
}

// Resumo da afinação: média do desvio (em cents, ponderada pela duração) e % de notas dentro de ±20 cents
export function tuningStats(notes, ref = (n) => Math.round(n.m)) {
  let w = 0, s = 0, ok = 0;
  for (const n of notes) {
    const d = n.end - n.start, c = Math.abs((n.m - ref(n)) * 100);
    w += d; s += c * d; if (c <= 20) ok++;
  }
  return { avgCents: w ? Math.round(s / w) : 0, inTune: notes.length ? Math.round((ok * 100) / notes.length) : 100, count: notes.length };
}

// ---------- 6) Silêncio do começo e do fim ----------
// Mede o volume em blocos de 50 ms. O começo é o primeiro trecho de 0,3 s acima de −35 dB da parte forte;
// o fim é o último bloco acima disso. Deixa uma folga para não comer a respiração nem o final da nota.
export function findTrim(channels, sr, { padStart = 0.25, padEnd = 0.6 } = {}) {
  const L = channels[0], R = channels[1] || L, len = L.length;
  const B = Math.round(sr * 0.05), n = Math.floor(len / B);
  if (n < 4) return { start: 0, end: len / sr };
  const rms = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * B; i < (k + 1) * B; i++) { const m = (L[i] + R[i]) / 2; s += m * m; }
    rms[k] = Math.sqrt(s / B);
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const loud = sorted[Math.floor(n * 0.95)];
  const th = Math.max(loud * Math.pow(10, -35 / 20), 1e-4);
  const need = 6; // 0,3 s seguidos
  let a = 0;
  for (let k = 0, run = 0; k < n; k++) { run = rms[k] > th ? run + 1 : 0; if (run >= need) { a = k - need + 1; break; } }
  let b = n - 1;
  while (b > a && rms[b] <= th) b--;
  const start = Math.max(0, (a * B) / sr - padStart);
  const end = Math.min(len / sr, ((b + 1) * B) / sr + padEnd);
  return { start, end };
}

// Fade com curva suave (cosseno): começa e termina sem "degrau"
export function applyFades(channels, sr, fadeIn, fadeOut) {
  const len = channels[0].length;
  const fi = Math.min(len, Math.round(fadeIn * sr)), fo = Math.min(len, Math.round(fadeOut * sr));
  for (const c of channels) {
    for (let i = 0; i < fi; i++) c[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
    for (let i = 0; i < fo; i++) c[len - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
  }
  return channels;
}

// ---------- Etapa pesada: separar, analisar e afinar (roda uma vez por vídeo) ----------
// onStep(nome, progresso 0–1). Devolve o "estado" que a mixagem usa; trocar reverb, fades ou corte
// não precisa refazer esta etapa.
export async function analyze(file, opts = {}, onStep = () => {}) {
  const o = { ...DEFAULTS, ...opts };
  onStep('audio', 0);
  const orig = file instanceof Blob ? await audioFromVideo(file) : file; // aceita canais prontos (testes)
  onStep('audio', 1);
  let voice = orig, bed = null;
  if (o.separate) {
    const r = await separate(orig, { onDownload: (p) => onStep('download', p), onProgress: (p) => onStep('separate', p) });
    voice = r.voice; bed = r.bed;
  }
  onStep('notes', 0);
  const track = await pitchTrack(voice, SR, (p) => onStep('notes', p));
  const raw = notesFrom(track);
  const chroma = bed ? await chromaOf(bed, SR) : null;
  const key = detectKey(raw, chroma);
  const state = { orig, voice, bed, key, track, rawNotes: raw, duration: orig[0].length / SR };
  if (o.reference) await setReference(state, o.reference, onStep);
  if (o.autoTune === false) untune(state, o); else await retune(state, o, onStep);
  return state;
}

// Volta a voz para como o artista cantou (desfaz a afinação). O plano continua calculado, para a tela
// mostrar onde a voz original sai da faixa.
export function untune(state, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  state.edits = state.edits || {};
  state.plan = planTuning(state.rawNotes, state.key, o, state.edits);
  state.tuned = null;
  state.afterTrack = state.track;
  state.check = bandCheck(state.track, state.plan, o.band);
  state.beforeCheck = state.check;
  state.before = { ...tuningStats(state.plan, (n) => n.target), band: state.check.pct };
  state.after = { ...state.before };
  state.opts = o;
  return state;
}

// Prévia da afinação, antes da mix: voz (afinada ou não) + instrumental, somados sem tratamento
export function rawMix(state) {
  const v = state.tuned || state.voice, b = state.bed;
  const len = v[0].length;
  const out = [0, 1].map((c) => { const o = new Float32Array(len), vc = v[c] || v[0]; for (let i = 0; i < len; i++) o[i] = vc[i] + (b ? (b[c] || b[0])[i] : 0); return o; });
  let peak = 0; for (const c of out) for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(c[i]));
  if (peak > 0.99) for (const c of out) for (let i = 0; i < len; i++) c[i] *= 0.99 / peak;
  return out;
}

// Modo referência: lê a música original (arquivo de áudio ou canais prontos) e liga nas notas do cover.
// Depois disso, chame retune() para afinar pela referência.
export async function setReference(state, file, onStep = () => {}) {
  onStep('ref', 0);
  const ch = file instanceof Blob ? await audioFromVideo(file) : file;
  const notes = await referenceNotes(ch, SR, notesFrom, onStep);
  return applyReference(state, notes);
}

// Afina e confere: depois de afinar, mede a voz afinada de verdade (não o desenho) e, onde a linha lenta
// ainda saiu da faixa verde, aumenta a correção daquele trecho e afina de novo, sempre a partir da voz
// original (o áudio passa uma vez só pelo afinador, então não perde qualidade). Até 4 rodadas.
export async function retune(state, opts = {}, onStep = () => {}) {
  const o = { ...DEFAULTS, ...opts };
  state.edits = state.edits || {};
  const plan = planTuning(state.rawNotes, state.key, o, state.edits);
  const target = 99;
  let check = null;
  for (let pass = 0; pass < 4; pass++) {
    onStep('tune', pass / 4);
    state.tuned = await tuneVoice(state.voice.map((c) => c.slice()), SR, plan, (p) => onStep('tune', (pass + p) / 4));
    state.afterTrack = await pitchTrack(state.tuned, SR);
    check = bandCheck(state.afterTrack, plan.filter((n) => n.st > 0), o.band);
    if (check.pct >= target) break;
    // Reforça a curva onde ainda vazou
    const tr = state.afterTrack.map((f) => f.midi);
    for (const n of plan) {
      if (!n.curve || !(n.st > 0)) continue;
      const { t0, dt, v } = n.curve;
      const ja = Math.max(0, Math.ceil(n.start / check.dt)), jb = Math.min(tr.length - 1, Math.floor((n.end - check.dt) / check.dt));
      const lim = n.manual ? 12.5 : n.viaRef ? 3 : 1.5;
      for (let k = 0; k < v.length; k++) {
        const j = Math.round((t0 + k * dt - 0.032) / check.dt);
        if (j < ja || j > jb || tr[j] == null) continue;
        const r = slow(tr, j, 3, ja, jb) - n.target;
        if (Math.abs(r) > 1.5 || Math.abs(r) <= o.band * 0.5) continue; // erro do medidor, ou já está dentro
        const step = Math.max(-0.5, Math.min(0.5, r - Math.sign(r) * o.band * 0.4));
        v[k] = Math.max(-lim, Math.min(lim, v[k] - step));
      }
    }
  }
  onStep('tune', 1);
  state.plan = plan;
  state.opts = o;
  state.check = check;
  state.beforeCheck = bandCheck(state.track, plan, o.band);
  state.before = { ...tuningStats(plan, (n) => n.target), band: state.beforeCheck.pct };
  return state;
}

// Resumo do antes e depois (a medição da voz afinada já foi feita no retune)
export async function verify(state) {
  if (!state.tuned) return state.after;
  const after = notesFrom(state.afterTrack);
  state.after = { ...tuningStats(after), band: state.check.pct };
  return state.after;
}

// ---------- Mix e master sem estalos ----------
// A IA nunca separa 100%: a voz separada e o instrumental carregam "chiados" iguais e de sinal contrário,
// que se anulam quando os dois voltam a ser somados por igual. Se a voz ganha EQ, compressor e volume
// diferentes do instrumental, eles param de se anular e aparecem como estalos de TV fora de sintonia.
// Por isso: soma a voz afinada com o instrumental quase por igual (voz só 10% mais alta), e todo o
// tratamento de estúdio (EQ, compressor, limitador) vai na música inteira. O reverb vem só da voz.
const makeIR = (ctx, sr, len, decay) => {
  const ir = ctx.createBuffer(2, Math.round(sr * len), sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3) * Math.exp(-i / (sr * decay));
  }
  return ir;
};
export async function mixMaster(voice, bed, sr, reverb = 0.2, { voiceLift = 1.1 } = {}) {
  const rv = Math.max(0, Math.min(1, reverb));
  const len = voice[0].length;
  // Cada compressor do navegador atrasa o som 6 ms (ele "olha à frente"); são dois, então o áudio sai
  // 12 ms atrasado. Renderiza um pouco a mais e corta esse atraso, senão a voz fica atrás da boca.
  const D = Math.round(0.012 * sr);
  const ctx = new OfflineAudioContext(2, len + D, sr);
  const buf = (chs) => { const b = ctx.createBuffer(2, len, sr); b.copyToChannel(chs[0], 0); b.copyToChannel(chs[1] || chs[0], 1); return b; };
  const f = (type, freq, gain = 0, Q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.gain.value = gain; b.Q.value = Q; return b; };
  const bus = ctx.createGain();
  const vs = ctx.createBufferSource(); vs.buffer = buf(voice);
  const vg = ctx.createGain(); vg.gain.value = bed ? voiceLift : 1;
  vs.connect(vg).connect(bus);
  if (bed) { const bs = ctx.createBufferSource(); bs.buffer = buf(bed); bs.connect(bus); bs.start(); }
  // Reverb só da voz (sala gerada; quanto mais reverb, maior a sala)
  if (rv > 0) {
    const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx, sr, 0.8 + 2 * rv, 0.16 + 0.55 * rv);
    const wet = ctx.createGain(); wet.gain.value = 0.45 * rv;
    vs.connect(f('highpass', 250)).connect(conv).connect(f('lowpass', 7000)).connect(wet).connect(bus);
  }
  // Master da música inteira: limpa o grave sujo, tira o embolado, presença e brilho, cola e limita
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 12; glue.ratio.value = 2; glue.attack.value = 0.025; glue.release.value = 0.3;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 3; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.12;
  let node = bus;
  for (const n of [f('highpass', 35), f('peaking', 300, -1.5, 0.9), f('peaking', 3000, 1.5, 0.8), f('highshelf', 11000, 1.5), glue, lim]) node = node.connect(n);
  node.connect(ctx.destination);
  vs.start();
  const out = await ctx.startRendering();
  const res = [0, 1].map((c) => out.getChannelData(c).slice(D, D + len));
  let peak = 0;
  for (const c of res) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const g = peak > 0 ? 0.89 / peak : 1; // pico em −1 dB
  for (const c of res) for (let i = 0; i < c.length; i++) c[i] *= g;
  return res;
}

// ---------- Etapa leve: mixar, masterizar, cortar e fazer os fades (roda a cada ajuste) ----------
// Devolve { channels, sr, start, end }: o áudio final já cortado, e os pontos de corte (em segundos
// do vídeo original) para cortar o vídeo igualzinho.
export async function render(state, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const len = state.orig[0].length;
  let mix = await mixMaster(state.tuned || state.voice, state.bed, SR, o.reverb);
  mix = mix.map((c) => c.subarray(0, len)); // mesma duração do vídeo (a cauda do reverb fica no fade)
  const { start, end } = o.trim ? findTrim(state.orig, SR) : { start: 0, end: len / SR };
  const a = Math.round(start * SR), b = Math.round(end * SR);
  const out = mix.map((c) => c.slice(a, b));
  applyFades(out, SR, o.fadeIn, o.fadeOut);
  // full: mesma linha do tempo do vídeo inteiro (silêncio fora do corte), para comparar lado a lado
  const full = out.map((c) => { const f = new Float32Array(len); f.set(c, a); return f; });
  return { channels: out, full, sr: SR, start, end };
}

// WAV 16 bits (para ouvir no player e para mandar ao servidor montar o vídeo)
export function toWav(channels, sr) {
  const nc = channels.length, len = channels[0].length;
  const buf = new ArrayBuffer(44 + len * nc * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len * nc * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * nc * 2, true);
  let p = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nc; c++) { const s = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true); p += 2; }
  return new Blob([buf], { type: 'audio/wav' });
}

export { tick };
