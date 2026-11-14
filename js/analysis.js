// Análise da voz: melodia quadro a quadro (YIN), notas e tom da música.
// Vem do "Meu Palco" do Afina.ai (js/mystage.js), sem as partes de exercício.
import { detectPitch } from './pitch.js?v=37';
import { freqToMidi } from './music.js?v=38';
// em inglês e alemão as notas são letras (C D E...); espanhol/italiano Do Re Mi, francês Do Ré Mi, português Dó Ré Mi
const NAMES = (() => { const l = (globalThis.scI18n && globalThis.scI18n.lang) || '';
  if (/^(en|de)/.test(l)) return ['C', 'C#', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'A♭', 'A', 'B♭', 'B'];
  if (/^(es|it)/.test(l)) return ['Do', 'Do#', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa#', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
  if (/^fr/.test(l)) return ['Do', 'Do#', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa#', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
  return ['Dó', 'Dó#', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Fá#', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si']; })();
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

// Canal do meio, filtrado entre ~110 Hz e ~1300 Hz e reduzido para ~8 kHz
function voiceBand(channels, sr) {
  const L = channels[0], R = channels[1] || channels[0];
  const step = Math.max(1, Math.floor(sr / 8000));
  const out = new Float32Array(Math.floor(L.length / step));
  const hp = Math.exp((-2 * Math.PI * 110) / sr), lp = Math.exp((-2 * Math.PI * 1300) / sr);
  let hpPrevIn = 0, hpOut = 0, lpOut = 0, acc = 0, k = 0, j = 0;
  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) / 2;
    hpOut = hp * (hpOut + m - hpPrevIn);
    hpPrevIn = m;
    lpOut = lpOut * lp + hpOut * (1 - lp);
    acc += lpOut;
    if (++k === step) {
      if (j < out.length) out[j++] = acc / step;
      acc = 0; k = 0;
    }
  }
  return { data: out, sr: sr / step };
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

// Melodia quadro a quadro: { t, midi } a cada 32 ms (midi null = sem voz)
export async function pitchTrack(channels, sr, onProgress = () => {}) {
  const { data, sr: fs } = voiceBand(channels, sr);
  const N = 512, hop = Math.round(fs * 0.032);
  const frames = [];
  const rmsList = [];
  for (let i = 0, n = 0; i + N <= data.length; i += hop, n++) {
    const r = detectPitch(data.subarray(i, i + N), fs, { minFreq: 90, maxFreq: 1000, threshold: 0.12 });
    frames.push({ t: i / fs, f: r.freq, c: r.clarity, rms: r.rms });
    if (r.rms > 0) rmsList.push(r.rms);
    if (n % 400 === 0) { onProgress(i / data.length); await yieldUI(); }
  }
  // Só vale o quadro com nota clara e volume perto do da música (descarta respiros e silêncios)
  const floor = median(rmsList) * 0.35;
  return frames.map((f) => ({ t: f.t, midi: f.f > 0 && f.c > 0.82 && f.rms > floor ? freqToMidi(f.f) : null }));
}

// Tom da música: soma o tempo de cada nota da melodia por classe e compara com os perfis maior e menor
export function detectKey(notes, chroma = null) {
  const h = new Array(12).fill(0);
  for (const n of notes) h[((n.midi % 12) + 12) % 12] += n.end - n.start;
  const tot = h.reduce((a, b) => a + b, 0) || 1;
  if (chroma) {
    const ct = chroma.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < 12; i++) h[i] = h[i] / tot + chroma[i] / ct;
  }
  const corr = (prof, k) => {
    const x = h, y = prof.map((_, i) => prof[(i - k + 12) % 12]);
    const mx = x.reduce((a, b) => a + b, 0) / 12, my = y.reduce((a, b) => a + b, 0) / 12;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
    return num / Math.sqrt(dx * dy || 1);
  };
  let best = { tonic: 0, minor: false, r: -2 };
  for (let k = 0; k < 12; k++) {
    for (const minor of [false, true]) {
      const r = corr(minor ? MINOR : MAJOR, k);
      if (r > best.r) best = { tonic: k, minor, r };
    }
  }
  return { ...best, name: keyName(best.tonic, best.minor) };
}

export const keyName = (tonic, minor) => `${NAMES[((tonic % 12) + 12) % 12]} ${minor ? 'menor' : 'maior'}`;

// Croma da música inteira (Goertzel nas 12 notas, oitavas 2 a 5), para o tom não depender só da voz
export async function chromaOf(channels, sr) {
  const fr = await chromaFrames(channels, sr);
  const out = new Array(12).fill(0);
  for (const f of fr.frames) for (let i = 0; i < 12; i++) out[i] += f[i];
  return out;
}
// Cromas da base quadro a quadro (a cada 0,25 s): quanto de cada uma das 12 notas está soando
export async function chromaFrames(channels, sr) {
  const { data, sr: fs } = voiceBand(channels, sr);
  const N = 2048, hop = Math.round(fs * 0.25);
  const frames = [];
  const coefs = [];
  for (let m = 36; m < 84; m++) coefs.push({ pc: m % 12, c: 2 * Math.cos((2 * Math.PI * 440 * 2 ** ((m - 69) / 12)) / fs) });
  for (let i = 0, n = 0; i + N <= data.length; i += hop, n++) {
    const out = new Float32Array(12);
    for (const { pc, c } of coefs) {
      let s1 = 0, s2 = 0;
      for (let j = 0; j < N; j++) { const s0 = data[i + j] + c * s1 - s2; s2 = s1; s1 = s0; }
      out[pc] += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
    }
    frames.push(out);
    if (n % 40 === 0) await yieldUI();
  }
  return { frames, dt: hop / fs, t0: N / 2 / fs };
}

// Acordes da base, só os do campo harmônico do tom (I ii iii IV V vi vii° no maior; no menor
// i ii° III iv v V VI VII). Cada 0,25 s ganha o acorde que mais combina com o que soa, e uma troca de
// acorde custa caro (Viterbi), para não ficar pulando a cada batida.
const CIFRA = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export function harmonicField(key) {
  const deg = key.minor
    ? [[0, 'm'], [2, 'dim'], [3, ''], [5, 'm'], [7, 'm'], [7, ''], [8, ''], [10, '']]
    : [[0, ''], [2, 'm'], [4, 'm'], [5, ''], [7, ''], [9, 'm'], [11, 'dim']];
  return deg.map(([d, q]) => {
    const root = (key.tonic + d) % 12, third = (root + (q === '' ? 4 : 3)) % 12, fifth = (root + (q === 'dim' ? 6 : 7)) % 12;
    return { root, q, tones: [root, third, fifth], name: CIFRA[root] + (q === 'dim' ? '°' : q) };
  });
}
export function chordTrack(fr, key) {
  const field = harmonicField(key), F = fr.frames.length;
  if (!F) return [];
  const score = (f, ch) => {
    let tot = 0; for (let i = 0; i < 12; i++) tot += f[i];
    if (tot <= 0) return 0;
    const [r, t, q] = ch.tones;
    return (f[r] * 1.0 + f[t] * 0.9 + f[q] * 0.8) / tot - 0.2 * (1 - (f[r] + f[t] + f[q]) / tot);
  };
  // energia de cada quadro: quadro quase mudo não decide acorde
  const en = fr.frames.map((f) => f.reduce((a, b) => a + b, 0));
  const loud = [...en].sort((a, b) => a - b)[Math.floor(F * 0.5)] * 0.15;
  const K = field.length, SW = 0.35;
  let prev = field.map((ch) => (en[0] > loud ? score(fr.frames[0], ch) : 0));
  const back = [];
  for (let k = 1; k < F; k++) {
    const sc = field.map((ch) => (en[k] > loud ? score(fr.frames[k], ch) : 0));
    const cur = new Array(K), bk = new Int8Array(K);
    for (let j = 0; j < K; j++) {
      let best = -1e9, bi = 0;
      for (let i = 0; i < K; i++) { const v = prev[i] - (i === j ? 0 : SW); if (v > best) { best = v; bi = i; } }
      cur[j] = best + sc[j]; bk[j] = bi;
    }
    back.push(bk); prev = cur;
  }
  let j = prev.indexOf(Math.max(...prev));
  const path = new Array(F); path[F - 1] = j;
  for (let k = F - 1; k > 0; k--) { j = back[k - 1][j]; path[k - 1] = j; }
  const out = [];
  for (let k = 0; k < F; k++) {
    const t = fr.t0 + k * fr.dt - fr.dt / 2, ch = field[path[k]];
    if (out.length && out[out.length - 1].name === ch.name) out[out.length - 1].end = t + fr.dt;
    else out.push({ ...ch, start: Math.max(0, t), end: t + fr.dt });
  }
  return out;
}

