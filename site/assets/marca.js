// Logo animada do Studio Cover (tecla amarela com losango e onda: a onda corre, o brilho passa, o halo respira) + fundo de estrelas.
// Uso: <div class="marca"></div> e <canvas class="estrelas"></canvas>; chame Marca.montar().
window.Marca = {
  // logo nova (2026-11): tecla amarela com o losango e a onda; a onda corre, o losango se desenha, um brilho passa e o halo respira
  svg() {
    const u = 'mk' + Math.random().toString(36).slice(2, 7);
    return `<svg class="marca-svg" viewBox="-160 -160 320 320" aria-label="Studio Cover">
  <defs>
    <radialGradient id="${u}h" r="0.6"><stop offset="0" stop-color="#ffd400" stop-opacity=".45"/><stop offset="1" stop-color="#ffd400" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe14d"/><stop offset="1" stop-color="#f2c400"/></linearGradient>
    <linearGradient id="${u}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="${u}c"><rect x="-96" y="-96" width="192" height="192" rx="44"/></clipPath>
  </defs>
  <circle r="155" fill="url(#${u}h)" class="m-halo"/>
  <g class="m-tecla">
    <rect x="-96" y="-88" width="192" height="192" rx="44" fill="#8a6f00"/>
    <rect x="-96" y="-96" width="192" height="192" rx="44" fill="url(#${u}k)"/>
    <rect x="-96" y="-96" width="192" height="192" rx="44" fill="none" stroke="#fff6b0" stroke-opacity=".7" stroke-width="2.5"/>
    <g clip-path="url(#${u}c)"><rect class="m-brilho" x="-60" y="-140" width="50" height="280" fill="url(#${u}s)" transform="skewX(-18)"/></g>
    <g transform="scale(5.6) translate(-12 -12)" fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">
      <path class="m-los" d="M12 1.5l10.5 10.5L12 22.5 1.5 12z" stroke-width="1.9" pathLength="100"/>
      <path d="M6.5 12c1.4-3 2.8-3 4.2 0s2.8 3 4.2 0c.6-1.4 1.6-2 2.6-1.6" stroke-width="2" opacity=".18"/>
      <path class="m-onda" d="M6.5 12c1.4-3 2.8-3 4.2 0s2.8 3 4.2 0c.6-1.4 1.6-2 2.6-1.6" stroke-width="2.2"/>
    </g>
  </g>
</svg>`;
  },
  css: `.marca-svg{width:100%;height:100%;overflow:visible}
.m-tecla{transform-origin:0 0;animation:mResp 2.6s ease-in-out infinite}
.m-halo{transform-origin:0 0;animation:mPulsa 2.6s ease-in-out infinite}
.m-onda{stroke-dasharray:16 16;animation:mOnda 1.4s linear infinite}
.m-los{stroke-dasharray:100;animation:mLos 1.6s ease-out both}
.m-brilho{animation:mBrilho 3.2s ease-in-out infinite}
@keyframes mResp{50%{transform:scale(1.045)}}
@keyframes mPulsa{50%{opacity:.5;transform:scale(.9)}}
@keyframes mOnda{from{stroke-dashoffset:32}to{stroke-dashoffset:0}}
@keyframes mLos{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}
@keyframes mBrilho{0%{transform:translateX(-120px) skewX(-18deg)}55%,100%{transform:translateX(260px) skewX(-18deg)}}
@media (prefers-reduced-motion:reduce){.m-tecla,.m-halo,.m-onda,.m-los,.m-brilho{animation:none}}`,
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
