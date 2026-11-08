// ===== Filtros de cinema (WebGL, roda na placa de vídeo do aparelho) =====
// Cada filtro é uma "receita" de correção de cor como a de um colorista: exposição, contraste,
// saturação, temperatura, cor nas sombras e nas luzes, preto levantado (cara de filme), vinheta,
// granulação e nitidez. A mesma conta vale para a prévia e para o vídeo final.

export const FILTERS = [
  { id: 'natural', name: 'Natural Pro', exposure: 0.03, contrast: 1.06, saturation: 1.06, temp: 0.01, tint: 0, shadows: [0, 0, 0], highlights: [0, 0, 0], fade: 0, vignette: 0.12, grain: 0, sharpen: 0.35 },
  { id: 'blockbuster', name: 'Blockbuster', exposure: 0, contrast: 1.15, saturation: 1.08, temp: 0.02, tint: 0, shadows: [-0.04, 0.03, 0.08], highlights: [0.08, 0.03, -0.05], fade: 0.02, vignette: 0.25, grain: 0.02, sharpen: 0.3 },
  { id: 'golden', name: 'Hora Dourada', exposure: 0.04, contrast: 1.05, saturation: 1.12, temp: 0.12, tint: 0.02, shadows: [0.03, 0.01, -0.03], highlights: [0.08, 0.04, -0.04], fade: 0.03, vignette: 0.2, grain: 0.015, sharpen: 0.25 },
  { id: 'film', name: 'Película 35mm', exposure: 0.01, contrast: 1.08, saturation: 0.92, temp: 0.05, tint: -0.01, shadows: [0.02, 0.03, 0.04], highlights: [0.05, 0.03, 0], fade: 0.07, vignette: 0.3, grain: 0.05, sharpen: 0.15 },
  { id: 'noir', name: 'Noir', exposure: 0, contrast: 1.3, saturation: 0, temp: 0, tint: 0, shadows: [0, 0, 0], highlights: [0, 0, 0], fade: 0.03, vignette: 0.4, grain: 0.05, sharpen: 0.3 },
  { id: 'bleach', name: 'Bleach Bypass', exposure: 0, contrast: 1.25, saturation: 0.55, temp: -0.02, tint: 0, shadows: [0, 0.01, 0.02], highlights: [0.02, 0.02, 0.01], fade: 0, vignette: 0.3, grain: 0.03, sharpen: 0.35 },
  { id: 'moon', name: 'Noite Azul', exposure: -0.03, contrast: 1.1, saturation: 0.9, temp: -0.12, tint: 0.02, shadows: [-0.02, 0.01, 0.07], highlights: [0, 0.02, 0.05], fade: 0.03, vignette: 0.3, grain: 0.02, sharpen: 0.25 },
  { id: 'neon', name: 'Neon', exposure: 0.01, contrast: 1.12, saturation: 1.3, temp: -0.03, tint: 0.06, shadows: [0.05, -0.02, 0.09], highlights: [0.05, 0.02, 0.06], fade: 0.02, vignette: 0.28, grain: 0.02, sharpen: 0.3 },
  { id: 'vintage', name: 'Anos 70', exposure: 0.02, contrast: 0.95, saturation: 0.85, temp: 0.1, tint: 0.03, shadows: [0.06, 0.03, -0.02], highlights: [0.06, 0.05, -0.03], fade: 0.1, vignette: 0.35, grain: 0.06, sharpen: 0.1 },
  { id: 'pastel', name: 'Pastel', exposure: 0.06, contrast: 0.9, saturation: 0.8, temp: 0.02, tint: 0.03, shadows: [0.04, 0.03, 0.05], highlights: [0.03, 0.02, 0.03], fade: 0.09, vignette: 0.1, grain: 0.01, sharpen: 0.15 },
];
export const ORIGINAL = { id: 'original', name: 'Original', exposure: 0, contrast: 1, saturation: 1, temp: 0, tint: 0, shadows: [0, 0, 0], highlights: [0, 0, 0], fade: 0, vignette: 0, grain: 0, sharpen: 0 };

const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0,1); }`;
const FS = `precision mediump float;
varying vec2 uv; uniform sampler2D img; uniform vec2 px; uniform vec4 crop; uniform float t;
uniform float exposure, contrast, saturation, temp, tint, fade, vignette, grain, sharpen, amount;
uniform vec3 shadows, highlights;
float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + t) * 43758.5453); }
void main(){
  vec2 st = crop.xy + uv * crop.zw;
  vec3 c0 = texture2D(img, st).rgb;
  // nitidez (unsharp mask com a cruz de vizinhos)
  vec3 blur = (texture2D(img, st + vec2(px.x,0.)).rgb + texture2D(img, st - vec2(px.x,0.)).rgb + texture2D(img, st + vec2(0.,px.y)).rgb + texture2D(img, st - vec2(0.,px.y)).rgb) * .25;
  vec3 c = c0 + (c0 - blur) * sharpen * 1.6;
  c *= exp2(exposure * 2.);
  c += vec3(temp, 0., -temp) * .25 + vec3(0., -tint, 0.) * .2 + vec3(tint, 0., tint) * .1;
  float l = dot(c, vec3(.2126,.7152,.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - .5) * contrast + .5;
  float sh = 1. - smoothstep(0., .55, l), hi = smoothstep(.45, 1., l);
  c += shadows * sh + highlights * hi;
  c = c * (1. - fade * .6) + fade * .6; // preto levantado (cara de filme)
  vec2 d = uv - .5; c *= 1. - vignette * smoothstep(.25, .85, length(d * vec2(1., 1.2)) * 1.2);
  c += (rnd(uv * 1000.) - .5) * grain;
  gl_FragColor = vec4(mix(c0, clamp(c, 0., 1.), amount), 1.);
}`;

// Grader: desenha o vídeo (ou imagem) no canvas com o filtro. Enquadra em "cover" no tamanho do canvas.
export class Grader {
  constructor(canvas) {
    this.c = canvas;
    const gl = (this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false }));
    if (!gl) throw new Error('Este aparelho não tem WebGL');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = (this.pr = gl.createProgram());
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.u = (n) => gl.getUniformLocation(pr, n);
    this.f = ORIGINAL; this.amount = 1;
  }
  set(filter, amount = 1) { this.f = filter || ORIGINAL; this.amount = amount; }
  draw(src) {
    const gl = this.gl, f = this.f;
    const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
    if (!sw || !sh) return;
    gl.viewport(0, 0, this.c.width, this.c.height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    // enquadramento "cover": corta as sobras para preencher o quadro sem distorcer
    const ra = this.c.width / this.c.height, rs = sw / sh;
    const crop = rs > ra ? [(1 - ra / rs) / 2, 0, ra / rs, 1] : [0, (1 - rs / ra) / 2, 1, rs / ra];
    gl.uniform4fv(this.u('crop'), crop);
    gl.uniform2f(this.u('px'), 1 / sw, 1 / sh);
    gl.uniform1f(this.u('t'), (performance.now() % 10000) / 1000);
    for (const k of ['exposure', 'contrast', 'saturation', 'temp', 'tint', 'fade', 'vignette', 'grain', 'sharpen']) gl.uniform1f(this.u(k), f[k]);
    gl.uniform3fv(this.u('shadows'), f.shadows); gl.uniform3fv(this.u('highlights'), f.highlights);
    gl.uniform1f(this.u('amount'), this.amount);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

// ===== Colorista automático =====
// Faz o que um colorista faz na "correção primária", medindo quadros do próprio vídeo:
//  1) exposição pelo meio do histograma, 2) contraste pelo preto e branco reais, 3) balanço de branco
//  pelos tons neutros (tira o amarelo de lâmpada ou o azul de sombra), e depois um look de cinema
//  suave (sombras um pouco frias, luzes um pouco quentes, que deixa a pele bonita), vinheta e nitidez.
// Os mesmos números valem para o vídeo todo, então a cor não "pisca".
export async function autoGrade(video, samples = 8) {
  const w = 96, h = Math.round((96 * video.videoHeight) / video.videoWidth) || 170;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  const lum = [], was = video.currentTime, paused = video.paused;
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let k = 0; k < samples; k++) {
    video.currentTime = (video.duration * (k + 0.5)) / samples;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    g.drawImage(video, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      lum.push(l);
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (l > 0.15 && l < 0.85 && mx - mn < 0.25) { sr += r; sg += gg; sb += b; n++; } // tons quase neutros
    }
  }
  video.currentTime = was; if (!paused) video.play();
  lum.sort((a, b) => a - b);
  const q = (p) => lum[Math.floor(p * (lum.length - 1))];
  const lo = q(0.01), mid = q(0.5), hi = q(0.99);
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const exposure = cl(Math.log2(0.45 / Math.max(0.05, mid)) / 2, -0.35, 0.35);
  const contrast = cl(0.92 / Math.max(0.2, hi - lo), 0.95, 1.3);
  let temp = 0, tint = 0;
  if (n > 200) {
    const r = sr / n, gg = sg / n, b = sb / n;
    temp = cl((-(r - b) / 0.5) * 0.7, -0.25, 0.25);
    tint = cl(((gg - (r + b) / 2) / 0.3) * 0.7, -0.15, 0.15);
  }
  return {
    id: 'auto', name: 'Auto · Colorista', exposure, contrast: contrast * 1.04, saturation: 1.08, temp, tint,
    shadows: [-0.015, 0.005, 0.025], highlights: [0.03, 0.015, -0.01], fade: 0.02, vignette: 0.18, grain: 0.012, sharpen: 0.35,
  };
}

// Um filtro aplicado por cima do Colorista: soma as correções e multiplica contraste e saturação
export function compose(base, look) {
  if (!base) return look;
  if (!look || look.id === 'original') return base;
  const add3 = (a, b) => a.map((x, i) => x + b[i]);
  return {
    id: look.id, name: look.name, exposure: base.exposure + look.exposure, contrast: base.contrast * look.contrast,
    saturation: base.saturation * look.saturation, temp: base.temp + look.temp, tint: base.tint + look.tint,
    shadows: add3(base.shadows, look.shadows), highlights: add3(base.highlights, look.highlights),
    fade: Math.max(base.fade, look.fade), vignette: Math.max(base.vignette, look.vignette), grain: Math.max(base.grain, look.grain), sharpen: Math.max(base.sharpen, look.sharpen),
  };
}
