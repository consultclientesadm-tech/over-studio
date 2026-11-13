// ===== Filtros de cinema (WebGL, roda na placa de vídeo do aparelho) =====
// Cada filtro é uma "receita" de correção de cor como a de um colorista: exposição, contraste,
// saturação, temperatura, cor nas sombras e nas luzes, preto levantado (cara de filme), vinheta,
// granulação e nitidez. A mesma conta vale para a prévia e para o vídeo final.

// Valores pequenos de propósito: um colorista de cinema mexe pouco e com curva suave, sem estourar a pele
// nem o céu. "contrast" é a força da curva em S (1 = nada), "saturation" funciona como vibrance
// (puxa mais as cores apagadas e protege a pele), "shadows"/"highlights" tingem sombras e luzes.
// Looks de câmera de cinema: curva de filme (luzes que "rolam" suave, sem estourar), cor separada nas sombras e
// nas luzes, halation (o brilho avermelhado em volta das luzes que a película e as lentes de cinema fazem),
// difusão leve de lente, grão fino e nitidez de câmera. Sem nomes de marca: são inspirados no visual delas.
// 2026-11-13: linha de looks equilibrada, um para cada ambiente (pedido do Leo: nada de puxar tudo para o amarelo).
// "Câmera de Cinema" foi aprovado e fica como está. Os outros variam em brilho, saturação, nitidez e contraste,
// com balanço de branco neutro (o Colorista já corrige a luz amarela do quarto antes do filtro).
//  - Cinema: teal & orange de cinema (luz de dia ou quarto)
//  - Natural Limpo: luz de dia, parede clara, pele real, só mais limpo e definido
//  - Cor Viva: externo, plantas, céu; cor um pouco mais saturada sem estourar pele
//  - Filme Lavado: luz chapada ou nublada; cor suave, preto levantado, cara de película
//  - Brilho Suave: pouca luz, ring light, clima romântico; glow e difusão de lente
//  - Nítido HD: vídeo meio "mole" do celular; realce de detalhe (clarity) e nitidez forte
//  - Palco Noturno: show, bar, luz colorida; sombras frias e brilho nas luzes
//  - Preto e Branco de Cinema
export const FILTERS = [
  { id: 'cine', name: 'Câmera de Cinema', exposure: -0.04, contrast: 1.32, saturation: 1.08, temp: 0.03, tint: 0, shadows: [-0.05, 0.015, 0.075], highlights: [0.07, 0.03, -0.045], fade: 0.03, vignette: 0.42, grain: 0.022, sharpen: 0.5, halation: 0.7, diffusion: 0.25, glow: 0.45 },
  { id: 'pro', name: 'Natural Limpo', exposure: 0.06, contrast: 1.12, saturation: 1.06, temp: -0.01, tint: 0, shadows: [-0.006, 0, 0.012], highlights: [0.004, 0.004, 0.004], fade: 0, vignette: 0.18, grain: 0.008, sharpen: 0.7, halation: 0.1, diffusion: 0.06, glow: 0.15, clarity: 0.25 },
  { id: 'vivo', name: 'Cor Viva', exposure: 0.02, contrast: 1.16, saturation: 1.24, temp: 0, tint: 0, shadows: [-0.015, 0.004, 0.025], highlights: [0.012, 0.008, -0.004], fade: 0, vignette: 0.26, grain: 0.01, sharpen: 0.6, halation: 0.2, diffusion: 0.08, glow: 0.2, clarity: 0.3 },
  { id: 'film', name: 'Filme Lavado', exposure: 0.03, contrast: 1.04, saturation: 0.76, temp: -0.02, tint: -0.006, shadows: [0, 0.014, 0.03], highlights: [0.01, 0.01, 0.012], fade: 0.24, vignette: 0.26, grain: 0.035, sharpen: 0.25, halation: 0.35, diffusion: 0.25, glow: 0.22 },
  { id: 'glow', name: 'Brilho Suave', exposure: 0.05, contrast: 1.04, saturation: 1.0, temp: 0, tint: 0, shadows: [0, 0.006, 0.02], highlights: [0.016, 0.012, 0.01], fade: 0.06, vignette: 0.26, grain: 0.012, sharpen: 0.2, halation: 0.5, diffusion: 0.7, glow: 0.95 },
  { id: 'hd', name: 'Nítido HD', exposure: 0.02, contrast: 1.14, saturation: 1.08, temp: -0.01, tint: 0, shadows: [-0.008, 0, 0.012], highlights: [0.006, 0.004, 0], fade: 0, vignette: 0.16, grain: 0, sharpen: 1, halation: 0, diffusion: 0, glow: 0.05, clarity: 0.75 },
  { id: 'night', name: 'Palco Noturno', exposure: -0.1, contrast: 1.24, saturation: 0.9, temp: -0.18, tint: 0.008, shadows: [-0.035, 0.012, 0.09], highlights: [0.03, 0.02, 0.02], fade: 0.02, vignette: 0.42, grain: 0.02, sharpen: 0.45, halation: 0.5, diffusion: 0.2, glow: 0.5 },
  { id: 'noir', name: 'Preto e Branco de Cinema', exposure: -0.02, contrast: 1.5, saturation: 0, temp: 0, tint: 0, shadows: [0, 0, 0], highlights: [0, 0, 0], fade: 0.04, vignette: 0.5, grain: 0.045, sharpen: 0.45, halation: 0.4, diffusion: 0.2, glow: 0.5 },
];
export const ORIGINAL = { id: 'original', name: 'Original', exposure: 0, contrast: 1, saturation: 1, temp: 0, tint: 0, shadows: [0, 0, 0], highlights: [0, 0, 0], fade: 0, vignette: 0, grain: 0, sharpen: 0, halation: 0, diffusion: 0, glow: 0, clarity: 0 };

const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0,1); }`;
const FS = `precision mediump float;
varying vec2 uv; uniform sampler2D img; uniform vec2 px; uniform vec4 crop; uniform float t;
uniform float exposure, contrast, saturation, temp, tint, fade, vignette, grain, sharpen, halation, diffusion, glow, clarity, amount; uniform vec2 gr;
uniform vec3 shadows, highlights;
float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + t) * 43758.5453); }
// curva em S que nunca estoura: preto continua preto e branco continua branco
float scurve(float x, float k){ const float p = .42; x = clamp(x, 0., 1.);
  return x < p ? p * pow(x / p, k) : 1. - (1. - p) * pow((1. - x) / (1. - p), k); }
// ombro suave nas luzes: o que passaria do branco é comprimido em vez de cortado
vec3 shoulder(vec3 c){ const float k = .86; vec3 t = max(c - k, 0.) / (1. - k); return min(c, k) + (1. - k) * t / (1. + t); }
void main(){
  vec2 st = crop.xy + uv * crop.zw;
  vec3 c0 = texture2D(img, st).rgb;
  // nitidez adaptativa (AMD FidelityFX CAS, MIT): realça só onde há pouco contraste, sem halo nem "cara de filtro".
  // É o mesmo realce usado no upscale de jogos: deixa a imagem mais definida de forma natural.
  vec3 nb = texture2D(img, st - vec2(0.,px.y)).rgb, nd = texture2D(img, st - vec2(px.x,0.)).rgb;
  vec3 nf = texture2D(img, st + vec2(px.x,0.)).rgb, nh = texture2D(img, st + vec2(0.,px.y)).rgb;
  vec3 mnC = min(min(min(nd, c0), min(nf, nb)), nh), mxC = max(max(max(nd, c0), max(nf, nb)), nh);
  vec3 amp = sqrt(clamp(min(mnC, 2. - mxC) / max(mxC, vec3(1e-4)), 0., 1.));
  vec3 w = amp * (-1. / mix(8., 5., clamp(sharpen, 0., 1.)));
  vec3 c = clamp((nb * w + nd * w + nf * w + nh * w + c0) / (1. + 4. * w), 0., 1.);
  // brilho de lente/película (bloom): dois anéis largos, com raio proporcional ao quadro (gr), não ao pixel
  vec3 wide = vec3(0.), wide2 = vec3(0.);
  for (int i = 0; i < 8; i++) { float a = float(i) * .7853982 + .3927;
    vec2 o = vec2(cos(a), sin(a));
    wide += texture2D(img, st + o * gr * .45).rgb;
    wide2 += texture2D(img, st + o * gr).rgb; }
  wide = wide * .125; wide2 = wide2 * .125;
  vec3 bl = (wide * .55 + wide2 * .45);
  float wl = dot(bl, vec3(.2126,.7152,.0722));
  // clarity: realça o detalhe médio (textura, cabelo, cordas) comparando com a versão borrada
  c = clamp(c + clarity * (c - bl) * 1.4 * (1. - abs(wl - .5)), 0., 1.);
  // difusão (filtro "mist" de lente): véu suave nas luzes, pele mais bonita
  c = mix(c, max(c, bl), diffusion * smoothstep(.35, .9, wl));
  // glow: só o que é luz forte vaza para os lados, somado em "screen" (não estoura)
  vec3 bp = max(bl - .55, 0.) / .45; bp *= bp;
  c = 1. - (1. - c) * (1. - clamp(glow * 1.1 * bp * vec3(1., .93, .85), 0., 1.));
  // halation: borda quente avermelhada em volta das luzes fortes, como na película
  c += halation * .3 * smoothstep(.5, 1., wl) * vec3(1., .38, .18) * (1. - smoothstep(.7, 1., dot(c, vec3(.33))));
  // luz linear: balanço de branco e exposição como na câmera
  vec3 lin = c * c;
  vec3 wb = vec3(1. + temp * .9, 1. - tint * .8, 1. - temp * 1.1);
  wb /= dot(wb, vec3(.2126, .7152, .0722));
  lin *= wb * exp2(exposure);
  c = sqrt(shoulder(lin));
  // contraste por curva em S
  float kc = 1. + (contrast - 1.) * 2.4;
  c = vec3(scurve(c.r, kc), scurve(c.g, kc), scurve(c.b, kc));
  // vibrance com proteção de pele
  float l = dot(c, vec3(.2126,.7152,.0722));
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), sat = mx - mn;
  float skin = smoothstep(.12, .0, abs((c.r - c.g) - (c.g - c.b) * 1.2 - .08)) * step(c.b, c.g) * step(c.g, c.r);
  float s = saturation >= 1. ? 1. + (saturation - 1.) * (1. - sat) * (1. - skin * .6) : saturation;
  c = mix(vec3(l), c, s);
  // cor nas sombras e nas luzes (teal & orange e afins)
  float sh = 1. - smoothstep(0., .55, l), hi = smoothstep(.4, 1., l);
  c += (shadows * sh + highlights * hi) * 2.2;
  c = c * (1. - fade * .5) + fade * .5 * vec3(.92, .9, .95);
  vec2 d = uv - .5; c *= 1. - vignette * smoothstep(.25, .95, length(d * vec2(1., 1.15)) * 1.3);
  c += (rnd(uv * 1000.) - .5) * grain * (1. - l * .6);
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
    const m = Math.min(sw, sh); gl.uniform2f(this.u('gr'), (m * 0.022) / sw, (m * 0.022) / sh);
    for (const k of ['exposure', 'contrast', 'saturation', 'temp', 'tint', 'fade', 'vignette', 'grain', 'sharpen', 'halation', 'diffusion', 'glow', 'clarity']) gl.uniform1f(this.u(k), f[k] ?? 0);
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
export async function autoGrade(video, samples = 5) {
  const w = 96, h = Math.round((96 * video.videoHeight) / video.videoWidth) || 170;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  const lum = [], was = video.currentTime, paused = video.paused;
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let k = 0; k < samples; k++) {
    video.currentTime = (video.duration * (k + 0.5)) / samples;
    // nunca espera para sempre: no iPhone o vídeo às vezes não avisa que chegou no ponto
    await new Promise((r) => { video.addEventListener('seeked', r, { once: true }); setTimeout(r, 800); });
    if (video.readyState < 2) continue;
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
  if (lum.length < 500) return { ...ORIGINAL, id: 'auto', name: 'Auto · Colorista', contrast: 1.05, saturation: 1.05, vignette: 0.12, sharpen: 0.2 };
  lum.sort((a, b) => a - b);
  const q = (p) => lum[Math.floor(p * (lum.length - 1))];
  const lo = q(0.01), mid = q(0.5), hi = q(0.99);
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const exposure = cl(Math.log2(0.42 / Math.max(0.05, mid)) * 0.6, -0.3, 0.3);
  const contrast = cl(0.9 / Math.max(0.3, hi - lo), 0.98, 1.12);
  let temp = 0, tint = 0;
  if (n > 200) {
    const r = sr / n, gg = sg / n, b = sb / n;
    temp = cl((-(r - b) / 0.5) * 0.5, -0.15, 0.15);
    tint = cl(((gg - (r + b) / 2) / 0.3) * 0.5, -0.08, 0.08);
  }
  return {
    id: 'auto', name: 'Auto · Colorista', exposure, contrast: contrast * 1.03, saturation: 1.05, temp, tint,
    shadows: [-0.006, 0.003, 0.012], highlights: [0.012, 0.006, -0.004], fade: 0.01, vignette: 0.12, grain: 0.006, sharpen: 0.2,
  };
}

// Um filtro aplicado por cima do Colorista: soma as correções e multiplica contraste e saturação
export function compose(base, look) {
  if (!base) return look;
  if (!look || look.id === 'original') return base;
  const add3 = (a, b) => a.map((x, i) => x + b[i]);
  return {
    id: look.id, name: look.name, exposure: base.exposure + look.exposure, contrast: Math.min(1.6, base.contrast * look.contrast),
    saturation: look.saturation < 1 ? look.saturation : Math.min(1.35, base.saturation * look.saturation), temp: base.temp + look.temp, tint: base.tint + look.tint,
    shadows: add3(base.shadows, look.shadows), highlights: add3(base.highlights, look.highlights),
    fade: Math.max(base.fade, look.fade), vignette: Math.max(base.vignette, look.vignette), grain: Math.max(base.grain, look.grain), sharpen: Math.max(base.sharpen, look.sharpen), halation: Math.max(base.halation || 0, look.halation || 0), diffusion: Math.max(base.diffusion || 0, look.diffusion || 0), glow: Math.max(base.glow || 0, look.glow || 0), clarity: Math.max(base.clarity || 0, look.clarity || 0),
  };
}
