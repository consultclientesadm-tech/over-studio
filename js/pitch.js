// Detecção de frequência fundamental pelo algoritmo YIN (de Cheveigné e Kawahara, 2002).
// Recebe um bloco de áudio e devolve { freq, clarity, rms }. freq = 0 quando não há nota.

export function detectPitch(buf, sampleRate, opts = {}) {
  const minFreq = opts.minFreq ?? 65;
  const maxFreq = opts.maxFreq ?? 1100;
  const threshold = opts.threshold ?? 0.15;

  const n = buf.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / n);

  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const w = n - maxTau;

  // Função de diferença
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let j = 0; j < w; j++) {
      const diff = buf[j] - buf[j + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }

  // Diferença normalizada cumulativa
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // Primeiro mínimo abaixo do limiar; senão, o mínimo global
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = minTau;
    for (let t = minTau + 1; t <= maxTau; t++) if (d[t] < d[best]) best = t;
    tau = best;
  }

  const clarity = Math.max(0, 1 - d[tau]);

  // Interpolação parabólica para precisão abaixo de uma amostra
  let refined = tau;
  if (tau > 1 && tau < maxTau) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = tau + (a - c) / (2 * denom);
  }

  const freq = refined > 0 ? sampleRate / refined : 0;
  if (freq < minFreq || freq > maxFreq) return { freq: 0, clarity: 0, rms };
  return { freq, clarity, rms };
}
