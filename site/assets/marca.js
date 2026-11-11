// Logo animada do Studio Cover (losango girando, barras de som pulsando, órbita com brilho) + fundo de estrelas.
// Uso: <div class="marca"></div> e <canvas class="estrelas"></canvas>; chame Marca.montar().
window.Marca = {
  svg() {
    return `<svg class="marca-svg" viewBox="-160 -160 320 320" aria-label="Studio Cover">
  <defs>
    <radialGradient id="mg" r="0.6"><stop offset="0" stop-color="#ffd400" stop-opacity=".35"/><stop offset="1" stop-color="#ffd400" stop-opacity="0"/></radialGradient>
    <linearGradient id="ml" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6b0"/><stop offset=".45" stop-color="#ffd400"/><stop offset="1" stop-color="#ff9d00"/></linearGradient>
    <filter id="mb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <circle r="150" fill="url(#mg)" class="m-halo"/>
  <g class="m-orbita"><ellipse rx="138" ry="46" fill="none" stroke="rgba(255,212,0,.35)" stroke-width="1.5" stroke-dasharray="4 7"/><circle cx="138" r="5" fill="#ffd400" filter="url(#mb)"/></g>
  <g class="m-orbita m-o2"><ellipse rx="128" ry="40" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1"/><circle cx="-128" r="3.5" fill="#fff"/></g>
  <g class="m-losango" filter="url(#mb)"><rect x="-62" y="-62" width="124" height="124" rx="16" transform="rotate(45)" fill="none" stroke="url(#ml)" stroke-width="12"/></g>
  <g class="m-barras" fill="url(#ml)">
    <rect x="-33" y="-15" width="11" height="30" rx="5.5"/><rect x="-15" y="-30" width="11" height="60" rx="5.5"/><rect x="3" y="-40" width="11" height="80" rx="5.5"/><rect x="21" y="-20" width="11" height="40" rx="5.5"/>
  </g>
</svg>`;
  },
  css: `.marca-svg{width:100%;height:100%;overflow:visible}
.m-losango{transform-origin:0 0;animation:mGira 9s cubic-bezier(.6,0,.4,1) infinite}
.m-orbita{transform-origin:0 0;animation:mOrb 6s linear infinite}.m-o2{animation-duration:9s;animation-direction:reverse}
.m-halo{animation:mPulsa 2.4s ease-in-out infinite}
.m-barras rect{transform-box:fill-box;transform-origin:center;animation:mBar 1.1s ease-in-out infinite}
.m-barras rect:nth-child(2){animation-delay:-.3s}.m-barras rect:nth-child(3){animation-delay:-.6s}.m-barras rect:nth-child(4){animation-delay:-.85s}
@keyframes mGira{0%,15%{transform:rotate(0)}45%,65%{transform:rotate(180deg)}95%,100%{transform:rotate(360deg)}}
@keyframes mOrb{to{transform:rotate(360deg)}}
@keyframes mPulsa{50%{opacity:.45;transform:scale(.92)}}
@keyframes mBar{50%{transform:scaleY(.35)}}
@media (prefers-reduced-motion:reduce){.m-losango,.m-orbita,.m-halo,.m-barras rect{animation:none}}`,
  montar() {
    if (!document.getElementById('marca-css')) { const s = document.createElement('style'); s.id = 'marca-css'; s.textContent = this.css; document.head.appendChild(s); }
    document.querySelectorAll('.marca').forEach((el) => (el.innerHTML = this.svg()));
    document.querySelectorAll('canvas.estrelas').forEach((c) => this.estrelas(c));
  },
  estrelas(c) {
    const g = c.getContext('2d'); let W, H, S = [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => { W = c.clientWidth; H = c.clientHeight; c.width = W * dpr; c.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      S = Array.from({ length: Math.round(W * H / 5000) }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random() * 0.8 + 0.2, t: Math.random() * 6 })); };
    size(); addEventListener('resize', size);
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = (ms) => {
      g.clearRect(0, 0, W, H);
      for (const s of S) {
        if (!calm) { s.y += s.z * 0.25; if (s.y > H) { s.y = 0; s.x = Math.random() * W; } }
        const a = 0.35 + 0.65 * Math.abs(Math.sin(ms / 900 * s.z + s.t));
        g.fillStyle = s.z > 0.85 ? `rgba(255,212,0,${a})` : `rgba(255,255,255,${a * s.z})`;
        g.fillRect(s.x, s.y, s.z * 2, s.z * 2);
      }
      if (!calm && !document.hidden) requestAnimationFrame(frame); else setTimeout(() => requestAnimationFrame(frame), 500);
    };
    requestAnimationFrame(frame);
  },
};
