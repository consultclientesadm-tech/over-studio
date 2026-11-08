// Tela da afinação: mostra cada nota cantada, a faixa verde em volta da nota certa,
// a voz original (vermelha onde saiu da faixa) e a voz afinada (verde).
import { noteName } from './music.js?v=5';

const PX_S = 90; // pixels por segundo
const ROW = 16; // pixels por semitom

export function drawTuning(canvas, state, { band = 0.15 } = {}) {
  const plan = state.plan || [];
  if (!plan.length) return;
  const lo = Math.min(...plan.map((n) => n.target)) - 2, hi = Math.max(...plan.map((n) => n.target)) + 2;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.ceil(state.duration * PX_S) + 60, H = (hi - lo + 1) * ROW + 24;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const X = (t) => 50 + t * PX_S, Y = (m) => 12 + (hi - m + 0.5) * ROW;
  g.fillStyle = '#10131a'; g.fillRect(0, 0, W, H);
  // Linhas das notas (as do tom mais claras) e nomes
  g.font = '10px system-ui'; g.textBaseline = 'middle';
  for (let m = lo; m <= hi; m++) {
    g.fillStyle = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12) ? '#151a23' : '#1a202b';
    g.fillRect(50, Y(m) - ROW / 2, W - 50, ROW);
    g.fillStyle = '#6b7385'; g.fillText(noteName(m), 6, Y(m));
  }
  // Segundos
  g.fillStyle = '#4a5161';
  for (let s = 0; s <= state.duration; s += 5) g.fillText(`${s}s`, X(s) + 2, H - 6);
  // Notas: bloco da nota certa com a faixa verde
  for (const n of plan) {
    g.fillStyle = 'rgba(52, 211, 153, 0.16)';
    g.fillRect(X(n.start), Y(n.target + band), (n.end - n.start) * PX_S, band * 2 * ROW);
    g.strokeStyle = 'rgba(52, 211, 153, 0.5)'; g.lineWidth = 1;
    g.strokeRect(X(n.start) + 0.5, Y(n.target) - ROW / 2 + 0.5, (n.end - n.start) * PX_S - 1, ROW - 1);
  }
  // Para cada quadro, a nota certa (se estiver dentro de uma nota)
  const targetAt = (t) => { for (const n of plan) if (t >= n.start && t <= n.end) return n.target; return null; };
  const line = (track, colorOf, width) => {
    g.lineWidth = width; g.lineCap = 'round';
    for (let k = 1; k < track.length; k++) {
      const a = track[k - 1], b = track[k];
      if (a.midi == null || b.midi == null || Math.abs(a.midi - b.midi) > 1.5) continue;
      g.strokeStyle = colorOf(b);
      g.beginPath(); g.moveTo(X(a.t + 0.032), Y(a.midi)); g.lineTo(X(b.t + 0.032), Y(b.midi)); g.stroke();
    }
  };
  // Voz original: vermelha onde saiu da faixa (já contando o vibrato normal), cinza onde estava certa
  line(state.track || [], (f) => {
    const T = targetAt(f.t);
    return T != null && Math.abs(f.midi - T) > band + 0.2 ? 'rgba(248, 113, 113, 0.9)' : 'rgba(148, 163, 184, 0.55)';
  }, 2);
  // Voz afinada
  line(state.afterTrack || [], () => 'rgba(52, 211, 153, 0.95)', 2);
  return { pxPerSec: PX_S, x: X };
}
