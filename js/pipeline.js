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
import { separate, tuneVoice, mixMaster, STUDIO_SR } from './studio.js';
import { pitchTrack, detectKey, chromaOf } from './analysis.js';

export const SR = STUDIO_SR;

export const DEFAULTS = {
  separate: true, // false = gravação só de voz (a cappella): o áudio inteiro é tratado como voz
  strength: 1, // força da afinação, 0 a 1 (1 = cada nota no centro)
  scaleSnap: true, // nota que caiu fora do tom vai para a nota do tom mais próxima
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
    if (cur && cur.ms.length * dt >= 0.12) {
      const k = Math.floor(cur.ms.length * 0.2);
      const core = cur.ms.slice(k, cur.ms.length - k);
      const m = median(core.length ? core : cur.ms);
      notes.push({ start: cur.start, end: cur.end, m, midi: Math.round(m) });
    }
    cur = null;
  };
  for (const f of track) {
    if (f.midi == null) { close(); continue; }
    if (cur && Math.abs(f.midi - median(cur.ms.slice(-6))) < 0.6) { cur.ms.push(f.midi); cur.end = f.t + dt; continue; }
    close();
    cur = { ms: [f.midi], start: f.t, end: f.t + dt };
  }
  close();
  return notes;
}

const scaleOf = (key) => (key.minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]).map((x) => (x + key.tonic) % 12);
const pc = (m) => ((Math.round(m) % 12) + 12) % 12;

// Para onde cada nota vai. Com scaleSnap, uma nota que caiu num semitom fora do tom (cantou muito baixo
// ou muito alto) vai para a nota do tom mais próxima, desde que esteja a menos de 3/4 de semitom dela.
export function planTuning(notes, key, { strength = 1, scaleSnap = true } = {}) {
  const scale = scaleOf(key);
  return notes.map((n) => {
    let target = Math.round(n.m);
    if (scaleSnap && !scale.includes(pc(target))) {
      const opts = [target - 1, target + 1].filter((t) => scale.includes(pc(t)) && Math.abs(t - n.m) < 0.75);
      if (opts.length) target = opts.sort((a, b) => Math.abs(a - n.m) - Math.abs(b - n.m))[0];
    }
    const cents = Math.round((n.m - target) * 100);
    // A correção nunca passa de 1 semitom: mais que isso é escolha do cantor, não desafinação
    const shift = Math.max(-1, Math.min(1, (target - n.m) * strength));
    return { ...n, target, cents, shift: Math.abs(cents) >= 6 ? shift : 0 };
  });
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
  const state = { orig, voice, bed, key, rawNotes: raw, duration: orig[0].length / SR };
  await retune(state, o, onStep);
  return state;
}

// Refaz só a afinação (quando o artista muda a força ou o "prender no tom")
export async function retune(state, opts = {}, onStep = () => {}) {
  const o = { ...DEFAULTS, ...opts };
  const plan = planTuning(state.rawNotes, state.key, o);
  onStep('tune', 0);
  state.tuned = await tuneVoice(state.voice.map((c) => c.slice()), SR, plan, (p) => onStep('tune', p));
  onStep('tune', 1);
  state.plan = plan;
  state.before = tuningStats(plan, (n) => n.target);
  return state;
}

// Mede de novo a voz já afinada (para mostrar o antes e depois)
export async function verify(state) {
  const after = notesFrom(await pitchTrack(state.tuned, SR));
  state.after = tuningStats(after);
  return state.after;
}

// ---------- Etapa leve: mixar, masterizar, cortar e fazer os fades (roda a cada ajuste) ----------
// Devolve { channels, sr, start, end }: o áudio final já cortado, e os pontos de corte (em segundos
// do vídeo original) para cortar o vídeo igualzinho.
export async function render(state, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const len = state.orig[0].length;
  let mix = await mixMaster(state.tuned, state.bed, SR, o.reverb);
  mix = mix.map((c) => c.subarray(0, len)); // mesma duração do vídeo (a cauda do reverb fica no fade)
  const { start, end } = o.trim ? findTrim(state.orig, SR) : { start: 0, end: len / SR };
  const a = Math.round(start * SR), b = Math.round(end * SR);
  const out = mix.map((c) => c.slice(a, b));
  applyFades(out, SR, o.fadeIn, o.fadeOut);
  return { channels: out, sr: SR, start, end };
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
