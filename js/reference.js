// ===== Modo referência: afinar pela melodia da música original =====
// O artista sobe (opcional) o áudio da música original. O motor:
//   1) separa a voz do cantor original e tira a melodia, nota por nota
//   2) descobre em que tom o artista cantou e transpõe a melodia original para esse tom
//   3) casa as notas do cover com as da original, na ordem (o cover pode ser só um trecho da música)
//   4) cada nota do cover ganha a "nota certa" da original, usada como alvo da afinação
// O ritmo não muda: mexer no tempo tiraria a voz da boca no vídeo.
import { separate } from './studio.js?v=32';
import { pitchTrack } from './analysis.js?v=32';

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pc = (m) => ((Math.round(m) % 12) + 12) % 12;

// Melodia da original. notesFrom vem do pipeline (mesma regra de notas do cover).
export async function referenceNotes(channels, sr, notesFrom, onStep = () => {}) {
  const { voice } = await separate(channels, { onDownload: (p) => onStep('download', p), onProgress: (p) => onStep('refsep', p) });
  const track = await pitchTrack(voice, sr, (p) => onStep('refnotes', p));
  return notesFrom(track).map(({ start, end, m }) => ({ start, end, m }));
}

// Quantos semitons separam o tom da original do tom do artista: compara o "histograma de notas"
// (tempo em cada nota, sem oitava) nas 12 transposições possíveis e acerta a oitava pela altura do meio.
export function keyShift(cover, ref) {
  const hist = (ns, k = 0) => { const h = new Array(12).fill(0); for (const n of ns) h[(pc(n.m) + k + 12) % 12] += n.end - n.start; return h; };
  const hc = hist(cover);
  let best = 0, bv = -Infinity;
  for (let k = 0; k < 12; k++) {
    const hr = hist(ref, k);
    const v = hc.reduce((s, x, i) => s + x * hr[i], 0) / (Math.hypot(...hc) * Math.hypot(...hr) || 1);
    if (v > bv) { bv = v; best = k; }
  }
  const oct = Math.round((median(cover.map((n) => n.m)) - median(ref.map((n) => n.m + best))) / 12);
  return { shift: best + 12 * oct, fit: bv };
}

// Casamento nota a nota (DTW de subsequência): o cover pode começar e terminar em qualquer ponto da
// original. Custo de casar = distância em semitons (até 3). Devolve, para cada nota do cover, a nota da
// original (já no tom do artista) e a qualidade do casamento.
export function matchNotes(cover, ref, shift) {
  const N = cover.length, M = ref.length;
  if (!N || !M) return { map: new Array(N).fill(null), quality: 0 };
  const r = ref.map((n) => n.m + shift);
  const cost = (i, j) => Math.min(3, Math.abs(cover[i].m - r[j]));
  const D = new Float32Array(N * M), P = new Int8Array(N * M); // 0 diagonal, 1 cima (mesma nota da original), 2 esquerda (pula nota da original)
  const SKIP = 0.35; // pular nota da original custa pouco (o cover pode simplificar a melodia)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const c = cost(i, j);
      if (i === 0) { D[j] = c; P[j] = 2; continue; } // começa em qualquer ponto da original
      let v = D[(i - 1) * M + j] + c, p = 1;
      if (j > 0) {
        const d = D[(i - 1) * M + j - 1] + c; if (d <= v) { v = d; p = 0; }
        const l = D[i * M + j - 1] + SKIP; if (l < v) { v = l; p = 2; }
      }
      D[i * M + j] = v; P[i * M + j] = p;
    }
  }
  let j = 0;
  for (let k = 1; k < M; k++) if (D[(N - 1) * M + k] < D[(N - 1) * M + j]) j = k; // termina em qualquer ponto
  const map = new Array(N).fill(null);
  for (let i = N - 1; i >= 0; ) {
    if (map[i] == null) map[i] = j;
    if (i === 0) break;
    const p = P[i * M + j];
    if (p === 0) { i--; j--; } else if (p === 1) i--; else j--;
  }
  const out = cover.map((n, k) => (map[k] == null ? null : Math.round(r[map[k]])));
  const close = out.filter((t, k) => t != null && Math.abs(t - cover[k].m) <= 0.6).length;
  return { map: out, quality: Math.round((close * 100) / N), cost: D[(N - 1) * M + map[N - 1]] / N };
}

// Liga a referência no estado do motor: cada nota do cover ganha refTarget
export function applyReference(state, refNotes) {
  // O tom (sem oitava) vem do histograma; a oitava certa é a que casa melhor as notas
  const k = keyShift(state.rawNotes, refNotes);
  let best = null;
  for (const o of [-24, -12, 0, 12, 24]) {
    const r = matchNotes(state.rawNotes, refNotes, k.shift + o);
    if (!best || r.cost < best.cost) best = { ...r, shift: k.shift + o };
  }
  const { map, quality, shift } = best, fit = k.fit;
  state.rawNotes.forEach((n, i) => { n.refTarget = map[i]; });
  state.ref = { notes: refNotes, shift, fit: Math.round(fit * 100), quality, changed: state.rawNotes.filter((n) => n.refTarget != null && n.refTarget !== Math.round(n.m)).length };
  return state.ref;
}
