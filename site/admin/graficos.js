// Gráficos neon em canvas, sem biblioteca: área, barras, anel e rosca.
window.G = (() => {
  const prep = (c) => {
    const dpr = Math.min(2, devicePixelRatio || 1), W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    return { g, W, H };
  };
  const anim = (draw, ms = 900) => { const t0 = performance.now(); const f = (t) => { const k = Math.min(1, (t - t0) / ms); draw(1 - Math.pow(1 - k, 3)); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); };
  const grid = (g, W, H, pad, max, fmt) => {
    g.strokeStyle = 'rgba(140,150,200,.09)'; g.fillStyle = '#6b7088'; g.font = '600 11px Sora'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = pad.t + (H - pad.t - pad.b) * i / 4; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.fillText(fmt(max * (1 - i / 4)), 2, y + 4); }
  };
  const label = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const niceMax = (m) => { if (m < 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / p * 1.15) * p; };

  function area(c, series, { color = '#ffd400', fmt = (v) => Math.round(v), second = null, color2 = '#2ee59d' } = {}) {
    const all = [...series.map((s) => s.v), ...(second || []).map((s) => s.v)];
    const max = niceMax(Math.max(...all, 0));
    anim((k) => {
      const { g, W, H } = prep(c); const pad = { l: 44, r: 8, t: 10, b: 22 };
      grid(g, W, H, pad, max, fmt);
      const X = (i) => pad.l + (W - pad.l - pad.r) * (series.length < 2 ? 0.5 : i / (series.length - 1));
      const Y = (v) => H - pad.b - (H - pad.t - pad.b) * (v / max) * k;
      const draw = (s, col) => {
        const gr = g.createLinearGradient(0, pad.t, 0, H - pad.b); gr.addColorStop(0, col + '55'); gr.addColorStop(1, col + '00');
        g.beginPath(); s.forEach((p, i) => { const x = X(i), y = Y(p.v); if (!i) g.moveTo(x, y); else { const px = X(i - 1), py = Y(s[i - 1].v); g.bezierCurveTo((px + x) / 2, py, (px + x) / 2, y, x, y); } });
        g.save(); g.lineTo(X(s.length - 1), H - pad.b); g.lineTo(X(0), H - pad.b); g.closePath(); g.fillStyle = gr; g.fill(); g.restore();
        g.beginPath(); s.forEach((p, i) => { const x = X(i), y = Y(p.v); if (!i) g.moveTo(x, y); else { const px = X(i - 1), py = Y(s[i - 1].v); g.bezierCurveTo((px + x) / 2, py, (px + x) / 2, y, x, y); } });
        g.strokeStyle = col; g.lineWidth = 2.4; g.shadowColor = col; g.shadowBlur = 14; g.stroke(); g.shadowBlur = 0;
        const li = s.length - 1; g.fillStyle = col; g.beginPath(); g.arc(X(li), Y(s[li].v), 4, 0, 7); g.fill();
      };
      draw(series, color); if (second) draw(second, color2);
      g.fillStyle = '#6b7088'; g.font = '600 11px Sora';
      const step = Math.max(1, Math.ceil(series.length / 7));
      series.forEach((p, i) => { if (i % step === 0 || i === series.length - 1) { g.textAlign = 'center'; g.fillText(label(p.d), X(i), H - 6); } });
      g.textAlign = 'left';
    });
  }

  function bars(c, series, { color = '#3fd0ff', fmt = (v) => Math.round(v) } = {}) {
    const max = niceMax(Math.max(...series.map((s) => s.v), 0));
    anim((k) => {
      const { g, W, H } = prep(c); const pad = { l: 34, r: 6, t: 10, b: 22 };
      grid(g, W, H, pad, max, fmt);
      const bw = (W - pad.l - pad.r) / series.length;
      series.forEach((p, i) => {
        const h = (H - pad.t - pad.b) * (p.v / max) * k, x = pad.l + i * bw + bw * 0.18, w = Math.max(2, bw * 0.64), y = H - pad.b - h;
        const gr = g.createLinearGradient(0, y, 0, H - pad.b); gr.addColorStop(0, color); gr.addColorStop(1, color + '22');
        g.fillStyle = gr; g.shadowColor = color; g.shadowBlur = p.v ? 10 : 0; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, [4, 4, 0, 0]) : g.rect(x, y, w, h); g.fill(); g.shadowBlur = 0;
      });
      g.fillStyle = '#6b7088'; g.font = '600 11px Sora'; g.textAlign = 'center';
      const step = Math.max(1, Math.ceil(series.length / 6));
      series.forEach((p, i) => { if (i % step === 0) g.fillText(label(p.d), pad.l + (i + 0.5) * bw, H - 6); });
      g.textAlign = 'left';
    });
  }

  function ring(c, frac, { color = '#2ee59d', text = '' } = {}) {
    anim((k) => {
      const { g, W, H } = prep(c); const r = Math.max(4, Math.min(W, H) / 2 - 18), cx = W / 2, cy = H / 2;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(140,150,200,.12)'; g.lineWidth = 14; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      // marcas em volta (cara de painel de nave)
      for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; g.strokeStyle = i / 60 < frac * k ? color + 'aa' : 'rgba(140,150,200,.15)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * (r + 12), cy + Math.sin(a) * (r + 12)); g.lineTo(cx + Math.cos(a) * (r + 17), cy + Math.sin(a) * (r + 17)); g.stroke(); }
      g.strokeStyle = color; g.lineWidth = 14; g.shadowColor = color; g.shadowBlur = 20;
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, frac) * k); g.stroke(); g.shadowBlur = 0;
      g.fillStyle = '#fff'; g.font = '800 30px Orbitron'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text || Math.round(frac * 100 * k) + '%', cx, cy); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    });
  }

  function donut(c, parts) {
    const tot = parts.reduce((a, p) => a + p.v, 0) || 1;
    anim((k) => {
      const { g, W, H } = prep(c); const r = Math.max(4, Math.min(W, H) / 2 - 14), cx = W / 2, cy = H / 2;
      let a0 = -Math.PI / 2;
      g.lineWidth = 22;
      if (!parts.some((p) => p.v)) { g.strokeStyle = 'rgba(140,150,200,.12)'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); }
      for (const p of parts) {
        const a1 = a0 + (p.v / tot) * Math.PI * 2 * k;
        if (p.v) { g.strokeStyle = p.c; g.shadowColor = p.c; g.shadowBlur = 14; g.beginPath(); g.arc(cx, cy, r, a0 + 0.02, a1 - 0.02); g.stroke(); g.shadowBlur = 0; }
        a0 = a1;
      }
      g.fillStyle = '#fff'; g.font = '800 28px Orbitron'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(Math.round(tot * k), cx, cy - 6);
      g.font = '600 11px Sora'; g.fillStyle = '#8b8fa3'; g.fillText('CONTAS', cx, cy + 18); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    });
  }
  return { area, bars, ring, donut };
})();
