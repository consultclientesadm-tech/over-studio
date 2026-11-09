// ===== Editor de afinação estilo VariAudio (Cubase) =====
// Cada nota cantada vira um bloco na grade de notas. O bloco fica na nota certa, com a faixa verde em volta.
// Dentro dele: a linha da voz afinada (verde onde está na faixa, vermelha onde saiu) e, se quiser,
// a voz original em cinza. Toque/clique seleciona; arrastar o bloco para cima ou para baixo muda a nota
// (de semitom em semitom); arrastar o fundo anda pela música; pinça ou Ctrl+roda dá zoom;
// tocar na régua de cima leva o vídeo para aquele ponto.
import { noteName } from './music.js?v=19';

const SCALE = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10] };
const C = { bg: '#0a0a0d', row: '#101015', rowKey: '#16161d', line: '#202029', txt: '#8b8b99', yel: '#ffd400', green: '#2ee59d', red: '#ff4d5e', orig: 'rgba(170,170,190,.45)', band: 'rgba(46,229,157,.13)' };

export class TuneEditor {
  constructor(canvas, { onSelect = () => {}, onEdit = () => {}, onSeek = () => {} } = {}) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.cb = { onSelect, onEdit, onSeek };
    this.state = null; this.sel = -1; this.showOrig = true; this.time = 0; this.band = 0.15;
    this.pps = 70; this.t0 = 0; this.row = 18; this.top = 72; this.GUT = 38; this.RULER = 20;
    this.pointers = new Map();
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }
  load(state) {
    this.state = state;
    this.fitPitch();
    this.draw();
  }
  resize() {
    const r = this.c.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.W = Math.max(100, r.width); this.H = Math.max(80, r.height);
    this.c.width = this.W * dpr; this.c.height = this.H * dpr;
    this.c.style.width = this.W + 'px'; this.c.style.height = this.H + 'px';
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fitPitch(); this.draw();
  }
  fitPitch() {
    if (!this.state || !this.H) return;
    // Faixa de notas onde a voz mais fica (ignora as pontas raras, que o arrastar mostra se precisar)
    const ts = this.state.plan.flatMap((n) => Array(Math.max(1, Math.round((n.end - n.start) * 20))).fill(n.target)).sort((a, b) => a - b);
    if (!ts.length) return;
    const lo = ts[Math.floor(ts.length * 0.05)] - 2, hi = ts[Math.floor(ts.length * 0.95)] + 2;
    this.row = Math.max(14, Math.min(26, (this.H - this.RULER) / (hi - lo + 1)));
    const rows = (this.H - this.RULER) / this.row;
    this.top = (hi + lo) / 2 + rows / 2;
  }
  X(t) { return this.GUT + (t - this.t0) * this.pps; }
  T(x) { return this.t0 + (x - this.GUT) / this.pps; }
  Y(m) { return this.RULER + (this.top - m) * this.row; }
  M(y) { return this.top - (y - this.RULER) / this.row; }
  setTime(t) {
    this.time = t;
    // acompanha a música: se o cursor sair da tela, a tela anda
    const x = this.X(t);
    if (!this.dragging && (x > this.W - 40 || x < this.GUT)) this.t0 = Math.max(0, t - (this.W - this.GUT) * 0.2 / this.pps);
    this.draw();
  }
  zoom(f, cx = this.W / 2) {
    const t = this.T(cx);
    this.pps = Math.max(12, Math.min(400, this.pps * f));
    this.t0 = Math.max(0, t - (cx - this.GUT) / this.pps);
    this.draw();
  }
  select(i) { this.sel = i; this.cb.onSelect(i); this.draw(); }
  noteAt(x, y) {
    const t = this.T(x), m = this.M(y);
    const p = this.state?.plan || [];
    for (let i = 0; i < p.length; i++) if (t >= p[i].start && t <= p[i].end && Math.abs(m - p[i].target) <= 0.75) return i;
    return -1;
  }
  local(e) { const r = this.c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  down(e) {
    this.c.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) { // pinça
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.abs(a.x - b.x) || 1, pps: this.pps, cx: (a.x + b.x) / 2 };
      this.drag = null; return;
    }
    if (p.y < this.RULER) { this.drag = { kind: 'seek' }; this.cb.onSeek(Math.max(0, this.T(p.x))); return; }
    const i = this.noteAt(p.x, p.y);
    if (i >= 0) {
      this.select(i);
      this.drag = { kind: 'note', i, y0: p.y, base: this.state.plan[i].target, moved: false };
    } else this.drag = { kind: 'pan', x0: p.x, y0: p.y, t0: this.t0, top: this.top, moved: false };
    this.dragging = true;
  }
  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.abs(a.x - b.x) || 1, t = this.T(this.pinch.cx);
      this.pps = Math.max(12, Math.min(400, (this.pinch.pps * d) / this.pinch.d));
      this.t0 = Math.max(0, t - (this.pinch.cx - this.GUT) / this.pps);
      return this.draw();
    }
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'seek') return this.cb.onSeek(Math.max(0, this.T(p.x)));
    if (d.kind === 'pan') {
      this.t0 = Math.max(0, d.t0 - (p.x - d.x0) / this.pps);
      this.top = d.top + (p.y - d.y0) / this.row;
      d.moved = true;
      return this.draw();
    }
    if (d.kind === 'note') {
      const steps = Math.round((d.y0 - p.y) / this.row);
      const n = this.state.plan[d.i];
      const nt = Math.max(d.base - 12, Math.min(d.base + 12, d.base + steps));
      if (nt !== n.target) { n.preview = nt; d.moved = true; this.draw(); }
    }
  }
  up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    this.drag = null; this.dragging = false;
    if (d?.kind === 'note') {
      const n = this.state.plan[d.i];
      if (n.preview != null && n.preview !== d.base) this.cb.onEdit(d.i, { target: n.preview });
      delete n.preview;
    } else if (d?.kind === 'pan' && !d.moved) { this.select(-1); this.cb.onSeek(Math.max(0, this.T(this.local(e).x))); }
    this.draw();
  }
  wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return this.zoom(Math.exp(-e.deltaY * 0.01), this.local(e).x);
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.t0 = Math.max(0, this.t0 + (e.deltaX || e.deltaY) / this.pps);
    else this.top += e.deltaY / this.row / 3;
    this.draw();
  }
  draw() {
    const g = this.g, st = this.state;
    if (!this.W) return;
    g.fillStyle = C.bg; g.fillRect(0, 0, this.W, this.H);
    if (!st) return;
    const scale = (st.key.minor ? SCALE.min : SCALE.maj).map((x) => (x + st.key.tonic) % 12);
    const mTop = Math.ceil(this.top), mBot = Math.floor(this.M(this.H));
    g.font = '10px "Space Grotesk", system-ui'; g.textBaseline = 'middle';
    for (let m = mBot; m <= mTop; m++) {
      const y = this.Y(m);
      g.fillStyle = scale.includes(((m % 12) + 12) % 12) ? C.rowKey : C.row;
      g.fillRect(this.GUT, y - this.row / 2, this.W, this.row);
      g.fillStyle = C.line; g.fillRect(this.GUT, y + this.row / 2 - 0.5, this.W, 0.5);
    }
    const t1 = this.T(this.W);
    // Notas
    st.plan.forEach((n, i) => {
      if (n.end < this.t0 || n.start > t1) return;
      const tg = n.preview ?? n.target;
      const x = this.X(n.start), w = Math.max(2, (n.end - n.start) * this.pps), y = this.Y(tg);
      g.fillStyle = C.band; g.fillRect(x, this.Y(tg + this.band), w, this.band * 2 * this.row);
      g.lineWidth = i === this.sel ? 2 : 1;
      g.strokeStyle = i === this.sel ? C.yel : n.manual ? 'rgba(255,212,0,.7)' : 'rgba(46,229,157,.45)';
      const r = Math.min(5, this.row / 3);
      g.beginPath(); g.roundRect(x + 0.5, y - this.row / 2 + 1.5, w - 1, this.row - 3, r); g.stroke();
      if (n.manual || i === this.sel) { g.fillStyle = 'rgba(255,212,0,.08)'; g.fill(); }
      if (n.q === 0 && n.st === 0) { g.fillStyle = C.txt; g.fillText('orig', x + 3, y); }
    });
    // Voz original (cinza)
    const curve = (track, colorOf, width, smooth) => {
      if (!track) return;
      const dt = track.length > 1 ? track[1].t - track[0].t : 0.032;
      const k0 = Math.max(1, Math.floor(this.t0 / dt) - 2), k1 = Math.min(track.length - 1, Math.ceil(t1 / dt) + 2);
      g.lineWidth = width; g.lineCap = 'round';
      for (let k = k0; k <= k1; k++) {
        const a = smooth ? smooth[k - 1] : track[k - 1].midi, b = smooth ? smooth[k] : track[k].midi;
        if (a == null || b == null || Math.abs(a - b) > 1.2) continue;
        g.strokeStyle = colorOf(k);
        g.beginPath(); g.moveTo(this.X((k - 1) * dt + 0.032), this.Y(a)); g.lineTo(this.X(k * dt + 0.032), this.Y(b)); g.stroke();
      }
    };
    if (this.showOrig) curve(st.track, () => C.orig, 1.5);
    // Voz afinada: linha fina (com o vibrato) e linha grossa (a nota que o ouvido entende), colorida
    const marks = st.check?.marks;
    if (st.afterTrack) {
      if (!this._sm || this._smFor !== st.afterTrack) { this._sm = smoothLine(st.afterTrack); this._smFor = st.afterTrack; }
      curve(st.afterTrack, () => 'rgba(255,255,255,.35)', 1);
      curve(st.afterTrack, (k) => (marks?.[k] === -1 ? C.red : marks?.[k] === 1 ? C.green : 'rgba(255,255,255,.25)'), 3, this._sm);
    }
    // Régua e cursor
    g.fillStyle = '#0d0d12'; g.fillRect(0, 0, this.W, this.RULER);
    g.fillStyle = C.txt;
    const stepS = this.pps > 120 ? 1 : this.pps > 40 ? 2 : 5;
    for (let s = Math.ceil(this.t0 / stepS) * stepS; s < t1; s += stepS) { const x = this.X(s); g.fillRect(x, this.RULER - 5, 1, 5); g.fillText(fmt(s), x + 3, 9); }
    const xh = this.X(this.time);
    if (xh >= this.GUT) { g.fillStyle = C.yel; g.fillRect(xh - 1, 0, 2, this.H); g.beginPath(); g.moveTo(xh - 5, 0); g.lineTo(xh + 5, 0); g.lineTo(xh, 7); g.fill(); }
    // Nomes das notas (coluna fixa)
    g.fillStyle = '#0d0d12'; g.fillRect(0, this.RULER, this.GUT, this.H);
    for (let m = mBot; m <= mTop; m++) { g.fillStyle = scale.includes(((m % 12) + 12) % 12) ? '#c9c9d6' : C.txt; g.fillText(noteName(m), 4, this.Y(m)); }
  }
}

function smoothLine(track, H = 3) {
  const p = track.map((f) => f.midi), out = new Array(p.length).fill(null);
  for (let k = 0; k < p.length; k++) {
    if (p[k] == null) continue;
    let s = 0, c = 0;
    for (let j = Math.max(0, k - H); j <= Math.min(p.length - 1, k + H); j++) if (p[j] != null && Math.abs(p[j] - p[k]) < 1) { s += p[j]; c++; }
    out[k] = s / c;
  }
  return out;
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
