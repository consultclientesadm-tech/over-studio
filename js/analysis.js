// Análise da voz: melodia quadro a quadro (YIN), notas e tom da música.
// Vem do "Meu Palco" do Afina.ai (js/mystage.js), sem as partes de exercício.
import { detectPitch } from './pitch.js?v=18';
import { freqToMidi } from './music.js?v=18';
const NAMES = ['Dó', 'Dó#', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Fá#', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si'];
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
  const { data, sr: fs } = voiceBand(channels, sr);
  const N = 2048, hop = Math.round(fs * 0.25);
  const out = new Array(12).fill(0);
  const coefs = [];
  for (let m = 36; m < 84; m++) coefs.push({ pc: m % 12, c: 2 * Math.cos((2 * Math.PI * 440 * 2 ** ((m - 69) / 12)) / fs) });
  for (let i = 0, n = 0; i + N <= data.length; i += hop, n++) {
    for (const { pc, c } of coefs) {
      let s1 = 0, s2 = 0;
      for (let j = 0; j < N; j++) { const s0 = data[i + j] + c * s1 - s2; s2 = s1; s1 = s0; }
      out[pc] += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
    }
    if (n % 40 === 0) await yieldUI();
  }
  return out;
}

