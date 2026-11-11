// Master no padrão das plataformas de streaming (Spotify): volume integrado em −14 LUFS (ITU-R BS.1770)
// e pico máximo em −1 dB, com um limitador que olha à frente. Também mede a dinâmica da voz para o
// compressor automático. Tudo em JS puro, roda no navegador.

export const TARGET_LUFS = -14;
export const CEILING_DB = -1;

// Biquad (RBJ) aplicado num Float32Array, devolve um novo
function biquad(x, [b0, b1, b2, a0, a1, a2]) {
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
  }
  return y;
}
// Filtro de ponderação K (mesmos parâmetros do pyloudnorm / BS.1770-4), para qualquer taxa de amostragem
function kWeight(x, sr) {
  let G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.9744509555319;
  let A = 10 ** (G / 40), w = 2 * Math.PI * fc / sr, al = Math.sin(w) / (2 * Q), c = Math.cos(w), s = 2 * Math.sqrt(A) * al;
  const shelf = [A * ((A + 1) + (A - 1) * c + s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - s),
    (A + 1) - (A - 1) * c + s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - s];
  Q = 0.5003270373253953; fc = 38.13547087613982; w = 2 * Math.PI * fc / sr; al = Math.sin(w) / (2 * Q); c = Math.cos(w);
  const hp = [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
  return biquad(biquad(x, shelf), hp);
}

// Volume integrado (LUFS) com os portões absoluto (−70) e relativo (−10)
export function lufs(channels, sr) {
  const k = channels.map((c) => kWeight(c, sr));
  const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), n = k[0].length;
  const z = [];
  for (let s = 0; s + blk <= n; s += hop) {
    let sum = 0;
    for (const c of k) { let e = 0; for (let i = s; i < s + blk; i++) e += c[i] * c[i]; sum += e / blk; }
    z.push(sum);
  }
  if (!z.length) return -70;
  const L = (p) => -0.691 + 10 * Math.log10(p);
  const abs = z.filter((p) => p > 0 && L(p) > -70);
  if (!abs.length) return -70;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rel = L(mean(abs)) - 10;
  const g = abs.filter((p) => L(p) > rel);
  return L(mean(g.length ? g : abs));
}

// Limitador com antecipação (os dois canais juntos): nada passa de `ceilingDb`
export function limit(channels, sr, ceilingDb = CEILING_DB, { attack = 0.0015, release = 0.08 } = {}) {
  const ceil = 10 ** (ceilingDb / 20), n = channels[0].length;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0; for (const c of channels) { const a = Math.abs(c[i]); if (a > p) p = a; }
    g[i] = p > ceil ? ceil / p : 1;
  }
  // de trás para frente: começa a baixar um pouco antes do pico (ataque suave, sem estalo)
  const ka = 1 - Math.exp(-1 / (attack * sr));
  for (let i = n - 2; i >= 0; i--) { const t = g[i + 1] + (1 - g[i + 1]) * ka; if (t < g[i]) g[i] = t; }
  // de frente para trás: volta devagar (release)
  const kr = 1 - Math.exp(-1 / (release * sr));
  for (let i = 1; i < n; i++) { const t = g[i - 1] + (1 - g[i - 1]) * kr; if (t < g[i]) g[i] = t; }
  for (const c of channels) for (let i = 0; i < n; i++) { const v = c[i] * g[i]; c[i] = v > ceil ? ceil : v < -ceil ? -ceil : v; }
  return channels;
}

// Leva a música para −14 LUFS com pico em −1 dB. Devolve o volume final medido.
export function loudnessMaster(channels, sr, target = TARGET_LUFS) {
  let now = lufs(channels, sr), total = 0;
  if (now <= -69) return now;
  // duas voltas: o limitador tira um pouco do volume nos picos, a segunda volta compensa
  for (let k = 0; k < 2 && Math.abs(target - now) > 0.2 && total < 24; k++) {
    const db = Math.min(24 - total, target - now); total += db;
    const gain = 10 ** (db / 20);
    for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= gain;
    limit(channels, sr);
    now = lufs(channels, sr);
  }
  return now;
}

// Dinâmica da voz para o compressor automático: nível típico (mediana) e o quanto ela varia entre
// as partes fracas e fortes (p90 − p30), medidos em janelas de 300 ms onde há voz.
export function voiceDynamics(ch, sr) {
  const w = Math.round(0.3 * sr), lv = [];
  for (let s = 0; s + w <= ch.length; s += w) { let e = 0; for (let i = s; i < s + w; i++) e += ch[i] * ch[i]; lv.push(10 * Math.log10(e / w + 1e-12)); }
  const top = Math.max(...lv), voiced = lv.filter((d) => d > top - 40).sort((a, b) => a - b);
  if (voiced.length < 3) return { level: -30, range: 8 };
  const q = (p) => voiced[Math.min(voiced.length - 1, Math.floor(p * voiced.length))];
  return { level: q(0.5), range: q(0.9) - q(0.3) };
}

// Regras do compressor da voz. auto: quanto mais a voz varia, mais comprime (2:1 a 5:1, ataque médio
// para manter a palavra viva, release que acompanha a frase).
// manual: amount 0..1 (0 = sem compressão, 1 = bem comprimida).
export function compSettings(dyn, mode = 'auto', amount = 0.5) {
  const a = mode === 'auto' ? Math.max(0.15, Math.min(0.55, (dyn.range - 4) / 18)) : Math.max(0, Math.min(1, +amount || 0));
  const threshold = Math.max(-60, Math.min(0, dyn.level + 4 - a * 14)), ratio = 1 + a * 7;
  // ganho de compensação: devolve o volume que a voz perdeu nas partes normais (a base não some por cima dela)
  const makeup = Math.min(9, Math.max(0, dyn.level + 3 - threshold) * (1 - 1 / ratio) * 0.8);
  return { mode: mode === 'auto' ? 'auto' : 'manual', amount: a, threshold, ratio, makeup, attack: 0.012 - a * 0.008, release: 0.18, knee: 8 };
}
