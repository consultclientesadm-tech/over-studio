// Monta os vídeos do "Manual do usuário" a partir da gravação de test/manual-gravar.mjs: corta cada vídeo, acelera as
// esperas, põe a legenda numa faixa em cima e grava MP4 leve (sem som) + capa JPG em assets/manual/.
// Uso: node tools/manual-montar.mjs pasta_da_gravacao
import fs from 'fs';
import { execFileSync } from 'child_process';
const dir = process.argv[2], dest = 'assets/manual';
fs.mkdirSync(dest, { recursive: true });
const VW = 600, VH = 1298, BAND = 210, FAST = 2.2; // espera vira no máximo ~2 s
const sessions = JSON.parse(fs.readFileSync(`${dir}/marcas.json`, 'utf8'));
const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = (s % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${x}`; };
const esc = (t) => t.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')');
const info = {};
for (const s of sessions) for (const c of s.clips) {
  // trechos: normal e acelerado
  const segs = []; let t = c.start;
  for (const [a, b] of c.fast.filter((f) => f[1] > f[0]).sort((x, y) => x[0] - y[0])) {
    if (a > t) segs.push({ a: t, b: a, k: 1 });
    segs.push({ a: Math.max(a, t), b, k: Math.max(1, (b - Math.max(a, t)) / FAST) });
    t = b;
  }
  if (c.end > t) segs.push({ a: t, b: c.end, k: 1 });
  const map = (x) => { let o = 0; for (const g of segs) { if (x <= g.a) break; o += (Math.min(x, g.b) - g.a) / g.k; } return o; };
  const dur = map(c.end);
  const ass = [`[Script Info]\nScriptType: v4.00+\nPlayResX: ${VW}\nPlayResY: ${VH + BAND}\nWrapStyle: 0\n`,
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Cap,Inter,33,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,28,28,0,1',
    'Style: Fast,Inter,22,&H000AD6FF,&H000AD6FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,9,20,20,0,1',
    '\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
  c.caps.forEach((p, i) => {
    const a = map(Math.max(p.t, c.start)), b = i + 1 < c.caps.length ? map(c.caps[i + 1].t) : dur;
    if (b - a > 0.05) ass.push(`Dialogue: 0,${ts(a)},${ts(b)},Cap,,0,0,0,,{\\pos(${VW / 2},${BAND / 2})}${esc(p.text)}`);
  });
  for (const g of segs) if (g.k > 1.5) ass.push(`Dialogue: 0,${ts(map(g.a))},${ts(map(g.b))},Fast,,0,0,0,,{\\pos(${VW - 16},${BAND + 14})\\an9}▶▶ acelerado`);
  const assFile = `${dir}/${c.id}.ass`;
  fs.writeFileSync(assFile, ass.join('\n') + '\n');
  const f = segs.map((g, i) => `[0:v]trim=start=${g.a.toFixed(3)}:end=${g.b.toFixed(3)},setpts=(PTS-STARTPTS)/${g.k.toFixed(3)}[s${i}]`).join(';')
    + `;${segs.map((_, i) => `[s${i}]`).join('')}concat=n=${segs.length}:v=1:a=0,crop=iw/2:ih/2:0:0,fps=24,scale=${VW}:${VH},pad=${VW}:${VH + BAND}:0:${BAND}:0x0b0b0b,drawbox=x=0:y=${BAND - 5}:w=${VW}:h=5:color=0xffd60a:t=fill,ass=${assFile}[v]`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${dir}/${s.file}`, '-filter_complex', f, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${dest}/${c.id}.mp4`]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', (dur * 0.62).toFixed(2), '-i', `${dest}/${c.id}.mp4`, '-frames:v', '1', '-vf', 'crop=600:900:0:210,scale=240:-2', '-q:v', '7', `${dest}/${c.id}.jpg`]);
  const kb = Math.round(fs.statSync(`${dest}/${c.id}.mp4`).size / 1024);
  info[c.id] = { s: Math.round(dur), kb };
  console.log(c.id, dur.toFixed(1) + ' s', kb + ' KB');
}
console.log(JSON.stringify(info));
