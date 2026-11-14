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
import { separate, tuneVoice, STUDIO_SR } from './studio.js?v=47';
import { pitchTrack, detectKey, chromaFrames, chordTrack } from './analysis.js?v=37';
import { referenceNotes, applyReference } from './reference.js?v=39';
import { decodeVideoAudio } from './demux.js?v=40';
import { voiceDynamics, compSettings, loudnessMaster } from './master.js?v=37';
import { findVoices, splitVoices, forceVoices } from './voices.js?v=4';

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
export async function audioFromVideo(file, sr = SR, maxSec = 0) {
  let direta = '';
  // Vídeo MP4/MOV: tira o AAC de dentro do arquivo (funciona no iPhone e não carrega o vídeo inteiro
  // na memória). Se não der (outro formato), deixa o navegador ler o arquivo todo.
  if (/\.(mov|mp4|m4v|m4a)$/i.test(file.name || '') || /video\/(mp4|quicktime)|audio\/mp4/.test(file.type || '')) {
    try { return await decodeVideoAudio(file, sr, maxSec); } catch (e) {
      console.warn('leitura direta do AAC falhou:', e.message);
      // vídeo sem som: não adianta tentar de novo lendo o arquivo inteiro (só dava "Unable to decode audio data")
      if (/não tem áudio/.test(e.message)) throw new Error('Este vídeo não tem áudio (parece que foi gravado sem som). Grave de novo com o som ligado ou use "Ou suba só o áudio".');
      direta = String(e.message || e).slice(0, 80);
    }
  }
  // ler o arquivo inteiro na memória derruba o celular com vídeo grande
  if (file.size > 250 * 1048576) throw new Error(`Não consegui tirar o áudio desse vídeo (${Math.round(file.size / 1048576)} MB). Tente exportar em MP4 1080p e subir de novo.`);
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(2, 1, sr);
  let ab;
  try { ab = await ctx.decodeAudioData(buf); } catch (e) {
    // guarda o motivo da primeira tentativa (vai para o diário do app) para sabermos o que o aparelho recusou
    const err = e instanceof Error ? e : new Error(String(e?.message || e || 'Unable to decode audio data'));
    if (direta) err.causa = direta;
    throw err;
  }
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
// Acorde que mais soa durante a nota (o que cobre mais tempo dela)
export function chordAt(chords, a, b) {
  if (!chords) return null;
  let best = null, bo = 0;
  for (const c of chords) { if (c.end <= a) continue; if (c.start >= b) break; const o = Math.min(b, c.end) - Math.max(a, c.start); if (o > bo) { bo = o; best = c; } }
  return best;
}
export function planTuning(notes, key, { strength = 1, scaleSnap = true, straighten = true, band = 0.15, useRef = true, chords = null } = {}, edits = {}) {
  const scale = scaleOf(key);
  return notes.map((n, i) => {
    const ed = edits[i] || {};
    let target = Math.round(n.m);
    if (scaleSnap && !scale.includes(pc(target))) {
      const opts = [target - 1, target + 1].filter((t) => scale.includes(pc(t)) && Math.abs(t - n.m) < 0.75);
      if (opts.length) target = opts.sort((a, b) => Math.abs(a - n.m) - Math.abs(b - n.m))[0];
    }
    // Campo harmônico: se a nota cantada ficou no meio do caminho e a vizinha é nota do acorde que a base
    // está tocando naquela hora, vai para a do acorde. Nota cantada certinha (perto do centro) fica.
    const chord = scaleSnap ? chordAt(chords, n.start, n.end) : null;
    if (chord && !chord.tones.includes(pc(target)) && Math.abs(target - n.m) > 0.25) {
      const alt = [target - 2, target - 1, target + 1, target + 2].filter((t) => chord.tones.includes(pc(t)) && Math.abs(t - n.m) < 0.8)
        .sort((a, b) => Math.abs(a - n.m) - Math.abs(b - n.m))[0];
      if (alt != null) target = alt;
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
    const plan = { ...n, i, target, appliedTarget: target, chord: chord?.name, cents, manual, viaRef, q, st, shift: Math.abs(target - n.m) * q >= 0.03 ? base : 0 };
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
  let orig = file instanceof Blob ? await audioFromVideo(file, SR, o.maxSec || 0) : file; // aceita canais prontos (testes)
  onStep('audio', 1);
  // vídeo maior que o limite: em vez de recusar, usa os primeiros minutos (a pessoa não perde o teste)
  let cortado = o.maxSec && orig.fullDur > o.maxSec + 0.5 ? orig.fullDur : 0;
  if (o.maxSec && orig[0].length / SR > o.maxSec) { cortado = Math.max(cortado, orig[0].length / SR); const n = Math.round(o.maxSec * SR); orig = orig.map((c) => c.slice(0, n)); }
  let voice = orig, bed = null;
  if (o.separate) {
    const sepOpts = { onDownload: (p) => onStep('download', p), onProgress: (p) => onStep('separate', p) };
    let r;
    try { r = await separate(orig, sepOpts); } catch (e) {
      // o ajudante da IA caiu no meio e o áudio foi junto: lê o áudio de novo do arquivo e separa direto (sem ajudante)
      if (!e.lost || !(file instanceof Blob)) throw e;
      console.warn('separação de novo, sem ajudante:', e.causa);
      orig = null; onStep('audio', 0);
      orig = await audioFromVideo(file, SR, o.maxSec || 0);
      if (o.maxSec && orig[0].length / SR > o.maxSec) { const n = Math.round(o.maxSec * SR); orig = orig.map((c) => c.slice(0, n)); }
      onStep('separate', 0);
      try { r = await separate(orig, sepOpts); } catch (e2) { if (!e2.causa) e2.causa = e.causa; throw e2; }
    }
    voice = r.voice; bed = r.bed; if (r.orig) orig = r.orig;
  }
  // Modo leve (celular mais simples): a voz vira uma faixa só (mono). Voz de cover é praticamente mono, então
  // não muda o som, mas a afinação e a análise fazem metade das contas e usam metade da memória.
  if (o.leve && voice.length > 1 && voice[1] !== voice[0]) {
    const L = voice[0], R = voice[1], m = new Float32Array(L.length);
    for (let i = 0; i < m.length; i++) m[i] = (L[i] + R[i]) * 0.5;
    voice = [m];
  }
  // Dupla, trio, backing vocal: quantas vozes cantam? Com mais de uma, cada voz vira uma faixa própria
  let multi = null, parts = null;
  if (o.multi !== false) {
    onStep('voices', 0);
    multi = await findVoices(voice, SR, (p) => onStep('voices', p * 0.5));
    if (multi.count >= 2 && o.voices !== 1) parts = await splitVoices(voice, SR, multi, (p) => onStep('voices', 0.5 + 0.5 * p));
    onStep('voices', 1);
  }
  onStep('notes', 0);
  let track, raw;
  if (parts) {
    parts = await partsFrom(parts, multi, (p) => onStep('notes', p));
    track = parts[0].track; raw = parts.flatMap((p) => p.rawNotes);
  } else {
    track = await pitchTrack(voice, SR, (p) => onStep('notes', p));
    raw = notesFrom(track);
  }
  const cf = bed ? await chromaFrames(bed, SR) : null;
  const chroma = cf ? cf.frames.reduce((a, f) => { for (let i = 0; i < 12; i++) a[i] += f[i]; return a; }, new Array(12).fill(0)) : null;
  const key = detectKey(raw, chroma);
  const chords = cf ? chordTrack(cf, key) : null; // acordes da base, dentro do campo harmônico
  const duration = orig[0].length / SR;
  const state = { orig, voice, bed, key, chords, track, rawNotes: parts ? parts[0].rawNotes : raw, duration, cortado, voices: multi ? { count: multi.count, together: multi.together, range: multi.range } : null };
  if (parts) { for (const p of parts) Object.assign(p, { key, chords, duration }); state.parts = parts; }
  state.multi = multi; // para separar na mão depois (botão Separar as vozes)
  if (o.reference) await setReference(state, o.reference, onStep);
  if (o.autoTune === false) untune(state, o); else await retune(state, o, onStep);
  return state;
}

// Volta a voz para como o artista cantou (desfaz a afinação). O plano continua calculado, para a tela
// mostrar onde a voz original sai da faixa.
export function untune(state, opts = {}) {
  if (state.parts) { for (const p of state.parts) untune(p, opts); return sumUp(state, opts); }
  const o = { ...DEFAULTS, ...opts };
  state.edits = state.edits || {};
  state.plan = planTuning(state.rawNotes, state.key, { ...o, chords: state.chords }, state.edits);
  state.tuned = null;
  state.afterTrack = state.track;
  state.check = bandCheck(state.track, state.plan, o.band);
  state.beforeCheck = state.check;
  state.before = { ...tuningStats(state.plan, (n) => n.target), band: state.check.pct };
  state.after = { ...state.before };
  state.opts = o;
  return state;
}

// ---------- Várias vozes ----------
// Melodia de cada voz separada: a do YIN, conferida com a da detecção de várias vozes (onde a detecção
// diz que a voz está calada, não tem nota; onde o YIN se perdeu no meio das duas, vale a da detecção).
async function partsFrom(voices, multi, onProgress) {
  const K = voices.length, out = [];
  for (let i = 0; i < K; i++) {
    const v = [voices[i]];
    const tr = await pitchTrack(v, SR, (p) => onProgress((i + p) / K));
    const f = multi.f0[i];
    for (const fr of tr) {
      const k = Math.round(((fr.t + 0.032) * SR) / (multi.dt * SR)), e = k >= 0 && k < f.length ? f[k] : NaN;
      if (isNaN(e)) fr.midi = null;
      else if (fr.midi == null || Math.abs(fr.midi - e) > 0.7) fr.midi = e;
    }
    out.push({ name: `Voz ${i + 1}`, voice: v, track: tr, rawNotes: notesFrom(tr) });
  }
  return out;
}
// Resumo da dupla: números das vozes juntos (pesados pela quantidade de notas de cada uma)
function sumUp(state, opts) {
  const ps = state.parts, w = ps.map((p) => Math.max(1, (p.plan || p.rawNotes).length)), W = w.reduce((a, b) => a + b, 0);
  const avg = (get) => { const xs = ps.map(get); if (xs.some((x) => x == null)) return undefined; return Math.round((xs.reduce((a, x, i) => a + x * w[i], 0) / W) * 10) / 10; };
  const mix = (k) => (ps.every((p) => p[k]) ? { band: avg((p) => p[k].band), avgCents: Math.round(avg((p) => p[k].avgCents)), inTune: Math.round(avg((p) => p[k].inTune)), count: ps.reduce((a, p) => a + (p[k].count || 0), 0) } : undefined);
  state.before = mix('before'); state.after = mix('after');
  state.plan = ps[0].plan; state.edits = ps[0].edits;
  if (opts) state.opts = { ...DEFAULTS, ...opts };
  return state;
}
const dbGain = (db) => (db == null ? 1 : db <= -15 ? 0 : 10 ** (db / 20)); // −15 dB na régua = voz desligada
// A voz que vai para a mix: com várias vozes, a soma delas, cada uma no volume escolhido
// (gains = um número por voz: ganho direto; ou dB com inDb). before = sem a afinação.
export function voiceMix(state, gains = null, before = false, inDb = false) {
  if (!state.parts) return before ? state.voice : state.tuned || state.voice;
  const len = state.parts[0].voice[0].length, out = new Float32Array(len);
  state.parts.forEach((p, i) => {
    const g = gains ? (inDb ? dbGain(gains[i]) : gains[i] ?? 1) : 1;
    if (!g) return;
    const v = (before ? p.voice : p.tuned || p.voice)[0];
    for (let j = 0; j < len; j++) out[j] += v[j] * g;
  });
  return [out];
}
// Separar na mão: a pessoa diz quantas vozes cantam (2, 3 ou 4) e o app separa assim
export async function splitInto(state, K, opts = {}, onStep = () => {}) {
  if (!state.multi) throw new Error('Este vídeo foi aberto sem a análise de vozes. Suba de novo.');
  forceVoices(state.multi, state.voice, SR, K);
  const pv = await splitVoices(state.voice, SR, state.multi, (p) => onStep('voices', p));
  const parts = await partsFrom(pv, state.multi, (p) => onStep('notes', p));
  for (const p of parts) Object.assign(p, { key: state.key, chords: state.chords, duration: state.duration });
  state.parts = parts; state.edits = {}; state.ref = null;
  state.voices = { ...(state.voices || {}), count: K, manual: true, range: state.multi.range };
  return untune(state, opts);
}

// "É uma voz só": junta as vozes de volta e trata como uma voz (afinação volta para o começo)
export async function joinVoices(state, opts = {}) {
  if (!state.parts) return state;
  state.parts = null; state.voices = { ...(state.voices || {}), joined: true };
  state.track = await pitchTrack(state.voice, SR);
  state.rawNotes = notesFrom(state.track);
  state.edits = {}; state.ref = null;
  return untune(state, opts);
}

// Prévia da afinação, antes da mix: voz (afinada ou não) + instrumental, somados sem tratamento
// gains: volume de cada voz (dupla/trio; 0 = mudo). before = vozes sem afinar.
export function rawMix(state, gains = null, before = false) {
  const v = voiceMix(state, gains, before), b = state.bed;
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
  // dupla: a melodia da original é a da primeira voz
  if (state.parts) { state.ref = applyReference(state.parts[0], notes); return state.ref; }
  return applyReference(state, notes);
}

// Afina e confere: depois de afinar, mede a voz afinada de verdade (não o desenho) e, onde a linha lenta
// ainda saiu da faixa verde, aumenta a correção daquele trecho e afina de novo, sempre a partir da voz
// original (o áudio passa uma vez só pelo afinador, então não perde qualidade). Até 4 rodadas.
export async function retune(state, opts = {}, onStep = () => {}) {
  if (state.parts) {
    const K = state.parts.length;
    for (let i = 0; i < K; i++) await retune(state.parts[i], opts, (s, p) => onStep(s, (i + p) / K));
    return sumUp(state, opts);
  }
  const o = { ...DEFAULTS, ...opts };
  state.edits = state.edits || {};
  const plan = planTuning(state.rawNotes, state.key, { ...o, chords: state.chords }, state.edits);
  const target = 99;
  let check = null;
  const PASSES = o.leve ? 2 : 4; // modo leve: no máximo 2 rodadas (o celular simples termina bem mais rápido)
  for (let pass = 0; pass < PASSES; pass++) {
    onStep('tune', pass / PASSES);
    state.tuned = await tuneVoice(state.voice.map((c) => c.slice()), SR, plan, (p) => onStep('tune', (pass + p) / PASSES));
    state.afterTrack = await pitchTrack(state.tuned, SR);
    check = bandCheck(state.afterTrack, plan.filter((n) => n.st > 0), o.band);
    if (check.pct >= target || pass === PASSES - 1) break;
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

// Afinação só das notas mexidas (o resto da voz fica como está): rápida, roda sozinha a cada mudança.
// Afina um trecho curto em volta das notas, emenda com 25 ms de transição e mede a voz nova só ali.
export async function retuneLocal(state, opts = {}, idxs = []) {
  const o = { ...DEFAULTS, ...opts };
  state.edits = state.edits || {};
  const fresh = planTuning(state.rawNotes, state.key, { ...o, chords: state.chords }, state.edits);
  const keep = state.plan && state.plan.length === fresh.length;
  const set = new Set(idxs);
  const plan = keep ? state.plan.map((n, i) => (set.has(i) ? fresh[i] : n)) : fresh;
  const len = state.voice[0].length, dur = len / SR;
  let a = Infinity, b = -Infinity;
  for (const i of set) { const n = plan[i]; if (n) { a = Math.min(a, n.start); b = Math.max(b, n.end); } }
  state.plan = plan; state.opts = o;
  if (!isFinite(a)) return state;
  a = Math.max(0, a - 0.15); b = Math.min(dur, b + 0.15);
  const PAD = 0.6, s0 = Math.max(0, Math.floor((a - PAD) * SR)), s1 = Math.min(len, Math.ceil((b + PAD) * SR)), off = s0 / SR;
  const notes = plan.filter((n) => n.end > off - 0.1 && n.start < s1 / SR + 0.1)
    .map((n) => ({ ...n, start: n.start - off, end: n.end - off, curve: n.curve && { ...n.curve, t0: n.curve.t0 - off } }));
  const seg = await tuneVoice(state.voice.map((c) => c.slice(s0, s1)), SR, notes);
  if (!state.tuned) state.tuned = state.voice.map((c) => c.slice());
  const ia = Math.round(a * SR), ib = Math.round(b * SR), F = Math.round(0.025 * SR);
  for (let c = 0; c < state.tuned.length; c++) {
    const t = state.tuned[c], v = seg[c] || seg[0];
    for (let i = ia; i < ib; i++) { const w = Math.min(1, (i - ia) / F, (ib - 1 - i) / F); t[i] = t[i] * (1 - w) + v[i - s0] * w; }
  }
  // linha da voz afinada no painel: troca só o trecho mexido
  const tr = await pitchTrack(seg, SR);
  const after = (state.afterTrack || state.track).slice();
  const dt = after.length > 1 ? after[1].t - after[0].t : 0.032;
  for (const f of tr) {
    const t = f.t + off; if (t < a || t > b) continue;
    const k = Math.round(t / dt); if (k >= 0 && k < after.length) after[k] = { t: after[k].t, midi: f.midi };
  }
  state.afterTrack = after;
  state.check = bandCheck(after, plan.filter((n) => n.st > 0), o.band);
  state.after = { ...(state.after || {}), band: state.check.pct };
  return state;
}

// Resumo do antes e depois (a medição da voz afinada já foi feita no retune)
export async function verify(state) {
  if (state.parts) { for (const p of state.parts) await verify(p); sumUp(state); return state.after; }
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
// Atraso de um compressor do navegador (ele "olha à frente"; ~6 ms no Chrome/Safari). Medido uma vez.
let compDelay = null;
async function measureCompDelay(sr) {
  if (compDelay != null) return compDelay;
  try {
    const n = Math.round(0.05 * sr), ctx = new OfflineAudioContext(1, n, sr);
    const b = ctx.createBuffer(1, n, sr); b.getChannelData(0)[0] = 0.5;
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.createDynamicsCompressor()).connect(ctx.destination); s.start();
    const o = (await ctx.startRendering()).getChannelData(0);
    let k = 0; for (let i = 1; i < n; i++) if (Math.abs(o[i]) > Math.abs(o[k])) k = i;
    compDelay = k / sr;
  } catch { compDelay = 0.006; }
  return compDelay;
}

// eq: { low, mid, high } em dB (grave 100 Hz, médio 1 kHz, agudo 8 kHz). comp: { mode: 'auto' | 'manual', amount 0..1 }
export async function mixMaster(voice, bed, sr, reverb = 0.2, { voiceLift = 1.1, voiceDb = 0, bedDb = 0, eq = {}, comp = { mode: 'auto' }, loud = true } = {}) {
  const rv = Math.max(0, Math.min(1, reverb));
  const len = voice[0].length;
  // Cada compressor atrasa o som (ele "olha à frente"). A voz passa por três (voz, cola, limitador) e a
  // base por dois; a base ganha o mesmo atraso da voz e no fim o atraso total é cortado.
  const L = await measureCompDelay(sr);
  const D = Math.round(3 * L * sr);
  const ctx = new OfflineAudioContext(2, len + D, sr);
  const buf = (chs) => { const b = ctx.createBuffer(2, len, sr); b.copyToChannel(chs[0], 0); b.copyToChannel(chs[1] || chs[0], 1); return b; };
  const f = (type, freq, gain = 0, Q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.gain.value = gain; b.Q.value = Q; return b; };
  const bus = ctx.createGain();
  const vs = ctx.createBufferSource(); vs.buffer = buf(voice);
  // Compressor da voz (automático pelas regras de mix, ou manual)
  const cs = compSettings(voiceDynamics(voice[0], sr), comp.mode, comp.amount);
  const vc = ctx.createDynamicsCompressor();
  vc.threshold.value = cs.threshold; vc.ratio.value = cs.ratio; vc.knee.value = cs.knee; vc.attack.value = cs.attack; vc.release.value = cs.release;
  const makeup = ctx.createGain(); makeup.gain.value = 10 ** (cs.makeup / 20);
  const vg = ctx.createGain(); vg.gain.value = (bed ? voiceLift : 1) * 10 ** (voiceDb / 20); // volume da voz escolhido pela pessoa
  vs.connect(f('highpass', 80)).connect(vc).connect(makeup).connect(vg).connect(bus);
  if (bed) {
    const bs = ctx.createBufferSource(), bg = ctx.createGain(), dl = ctx.createDelay(0.1); dl.delayTime.value = L;
    bg.gain.value = 10 ** (bedDb / 20); bs.buffer = buf(bed); bs.connect(dl).connect(bg).connect(bus); bs.start();
  }
  // Reverb só da voz (sala gerada; quanto mais reverb, maior a sala)
  if (rv > 0) {
    const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx, sr, 0.8 + 2 * rv, 0.16 + 0.55 * rv);
    const wet = ctx.createGain(); wet.gain.value = 0.45 * rv;
    vg.connect(f('highpass', 250)).connect(conv).connect(f('lowpass', 7000)).connect(wet).connect(bus);
  }
  // Master da música inteira: limpa o grave sujo, tira o embolado, presença e brilho, o equalizador
  // de 3 bandas da pessoa, cola e limita
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 12; glue.ratio.value = 2; glue.attack.value = 0.025; glue.release.value = 0.3;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 3; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.12;
  const cl = (v) => Math.max(-12, Math.min(12, +v || 0));
  let node = bus;
  for (const n of [f('highpass', 35), f('peaking', 300, -1.5, 0.9), f('peaking', 3000, 1.5, 0.8), f('highshelf', 11000, 1.5),
    f('lowshelf', 100, cl(eq.low)), f('peaking', 1000, cl(eq.mid), 0.7), f('highshelf', 8000, cl(eq.high)), glue, lim]) node = node.connect(n);
  node.connect(ctx.destination);
  vs.start();
  const out = await ctx.startRendering();
  const res = [0, 1].map((c) => out.getChannelData(c).slice(D, D + len));
  if (loud) { res.lufs = loudnessMaster(res, sr); res.comp = cs; return res; }
  let peak = 0;
  for (const c of res) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const g = peak > 0 ? 0.89 / peak : 1; // pico em −1 dB
  for (const c of res) for (let i = 0; i < c.length; i++) c[i] *= g;
  res.comp = cs;
  return res;
}

// ---------- Etapa leve: mixar, masterizar, cortar e fazer os fades (roda a cada ajuste) ----------
// Devolve { channels, sr, start, end }: o áudio final já cortado, e os pontos de corte (em segundos
// do vídeo original) para cortar o vídeo igualzinho.
export async function render(state, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const len = state.orig[0].length;
  let mix = await mixMaster(voiceMix(state, o.voiceGains, false, true), state.bed, SR, o.reverb, { voiceDb: o.voiceDb || 0, bedDb: o.bedDb || 0, eq: o.eq, comp: o.comp });
  const info = { lufs: mix.lufs, comp: mix.comp };
  mix = mix.map((c) => c.subarray(0, len)); // mesma duração do vídeo (a cauda do reverb fica no fade)
  const { start, end } = o.trim ? findTrim(state.orig, SR) : { start: 0, end: len / SR };
  const a = Math.round(start * SR), b = Math.round(end * SR);
  const out = mix.map((c) => c.slice(a, b));
  applyFades(out, SR, o.fadeIn, o.fadeOut);
  // full: mesma linha do tempo do vídeo inteiro (silêncio fora do corte), para comparar lado a lado
  const full = out.map((c) => { const f = new Float32Array(len); f.set(c, a); return f; });
  return { channels: out, full, sr: SR, start, end, ...info };
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
