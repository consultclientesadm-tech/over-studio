// Monta a VSL de uma língua: cantor (abertura), telas reais do app gravadas naquela língua (gravar.mjs), títulos,
// legendas palavra por palavra e a narração do locutor nativo.
// Uso: node tools/vsl-int/montar.mjs <lingua> <pasta_gravacao> <pasta_narracao> <saida.mp4>
//   pasta_gravacao: <lingua>.webm + <lingua>.json (de gravar.mjs)
//   pasta_narracao: n_<lingua>_sNN.mp3 + words.json (tempo de cada palavra)
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [lang, recDir, narDir, outFile] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '../..');
const TELA = JSON.parse(fs.readFileSync(`${here}/tela.json`, 'utf8'))[lang];
const WORDS = JSON.parse(fs.readFileSync(`${narDir}/words.json`, 'utf8'));
const M = JSON.parse(fs.readFileSync(`${recDir}/${lang}.json`, 'utf8'));
const FPS = 30, W = 720, H = 1280;
const work = fs.mkdtempSync(`/tmp/vsl-${lang}-`);
const run = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();

// 1) quadros: gravação do app (canto 1x do quadro) e cantor
fs.mkdirSync(`${work}/app`); fs.mkdirSync(`${work}/cantor`); fs.mkdirSync(`${work}/out`);
run(['-i', `${recDir}/${lang}.webm`, '-vf', `fps=${FPS},crop=390:844:0:0`, '-q:v', '3', `${work}/app/%05d.jpg`]);
// cantor de cada país (tools/vsl-fontes/paises/cantor-<pais>.mp4); sem ele, o cantor original
const PAIS = { en: 'us', es: 'es', fr: 'fr', 'pt-pt': 'pt' }[lang];
const CANTOR = fs.existsSync(`${root}/tools/vsl-fontes/paises/cantor-${PAIS}.mp4`) ? `${root}/tools/vsl-fontes/paises/cantor-${PAIS}.mp4` : `${root}/tools/vsl-fontes/cantor.mp4`;
// medidor do passo 2: números reais que o app mostrou na gravação (ANTES -> DEPOIS); padrão 48,4 -> 100
const [MED0, MED1] = (process.env.MEDIDOR || '48.4,100').split(',').map(Number);
run(['-i', CANTOR, '-vf', `fps=${FPS},scale=${W}:${H}`, '-q:v', '3', `${work}/cantor/%05d.jpg`]);
const nApp = fs.readdirSync(`${work}/app`).length, nCantor = fs.readdirSync(`${work}/cantor`).length;

// 2) linha do tempo
const IDS = ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12', 's13', 's16', 's17'];
const seg = (a, b, share = 1) => ({ a, b, share });
const PHONE = {
  s04: [seg(M.home[0], M.home[0] + 4)],
  s05: [seg(M.ia[0] - 1.2, M.ia[1] + 0.8)],
  s06: [seg(M.ref[0], M.ref[1])],
  s07: [seg(M.afinar[0], M.afinar[1])],
  s08: [seg(M.painel[0], M.painel_aberto[0] + 2.5)],
  s09: [seg(M.painel_aberto[0] + 2.5, M.painel_play[0])],
  s10: [seg(M.painel_play[0], M.painel_play[1])],
  s11: [seg(M.mix[0], M.mix[1])],
  s12: [seg(M.cor[0], M.cor[1])],
  s13: [seg(M.exportar[0], M.exportando[0] + 1.5, 0.35), seg(M.exportando[0] + 1.5, M.exportando[1], 0.2), seg(M.pronto[0], M.pronto[1], 0.45)],
  s16: [seg(M.pronto[0] + 1.5, M.pronto[1])],
};
let t = 0.35;
const scenes = IDS.map((id) => {
  const f = `${narDir}/n_${lang}_${id}.mp3`, d = dur(f);
  const tail = id === 's17' ? 2.4 : id === 's16' ? 0.5 : 0.4;
  const s = { id, start: t, narr: f, nd: d, dur: d + tail, words: (WORDS[`${lang}_${id}`] || {}).words || [] };
  if (id === 's01') s.start = 0, s.dur = d + tail + 0.35, s.off = 0.35; else s.off = 0;
  t = s.start + s.dur;
  return s;
});
const total = t;
// tempo na gravação para o instante x (0..dur) da cena
function srcTime(s, x) {
  const segs = PHONE[s.id]; if (!segs) return null;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i], T = g.share * s.dur, L = g.b - g.a;
    if (x <= acc + T || i === segs.length - 1) {
      const y = Math.min(x - acc, T), k = L > T ? L / T : 1;
      return Math.min(g.b, g.a + y * k);
    }
    acc += T;
  }
}
// legendas: grupos de palavras curtos
function chunks(words) {
  const out = []; let cur = [];
  for (const w of words) {
    cur.push(w);
    const txt = cur.map((x) => x[2]).join(' ');
    if (txt.length > 22 || /[.,!?;:]$/.test(w[2])) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}
for (const s of scenes) s.caps = chunks(s.words);

// 3) página que desenha um quadro
const fontCss = fs.readFileSync(`${here}/fonts/f.css`, 'utf8').replace(/url\(([^)]+)\)/g, (m, u) => `url(file://${here}/fonts/${u})`);
const logo = fs.readFileSync(`${root}/site/assets/logo.svg`, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:#0a0a0b;font-family:'Space Grotesk',sans-serif;color:#fff}
#bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 45% at 50% 42%,rgba(255,212,0,.13),transparent 70%),linear-gradient(#0d0d0f,#070708)}
#grid{position:absolute;inset:0;opacity:.07;background-image:linear-gradient(#ffd400 1px,transparent 1px),linear-gradient(90deg,#ffd400 1px,transparent 1px);background-size:48px 48px}
#cantor{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#shade{position:absolute;inset:0;background:linear-gradient(rgba(0,0,0,.72) 0%,rgba(0,0,0,.1) 30%,rgba(0,0,0,.05) 62%,rgba(0,0,0,.78) 100%)}
#top{position:absolute;left:30px;right:30px;top:58px;text-align:center}
#badge{display:inline-block;background:#ffd400;color:#111;font:900 20px Orbitron;letter-spacing:2px;padding:7px 16px;border-radius:999px;margin-bottom:14px;box-shadow:0 0 22px rgba(255,212,0,.5)}
#title{font:900 40px/1.12 Orbitron;letter-spacing:.5px;text-transform:uppercase;text-shadow:0 3px 14px rgba(0,0,0,.85)}
#title b{color:#ffd400;font-weight:900;text-shadow:0 0 18px rgba(255,212,0,.45),0 3px 14px rgba(0,0,0,.85)}
.pop{animation:none}
#phone{position:absolute;left:50%;top:268px;width:404px;height:868px;margin-left:-202px;border-radius:46px;padding:7px;background:#1b1b1f;border:2px solid #34343a;box-shadow:0 0 0 1px #000,0 0 46px rgba(255,212,0,.32),0 30px 60px rgba(0,0,0,.7)}
#phone img{width:390px;height:844px;border-radius:38px;display:block}
#chips{position:absolute;left:0;right:0;top:470px;display:flex;flex-direction:column;align-items:center;gap:16px}
.chip{display:flex;align-items:center;gap:10px;background:rgba(10,10,12,.86);border:2px solid #ff3b3b;color:#fff;font:700 27px 'Space Grotesk';padding:10px 22px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.chip.y{border-color:#ffd400}
.x{width:26px;height:26px;border-radius:50%;background:#ff3b3b;position:relative;flex:none}
.x:before,.x:after{content:'';position:absolute;left:12px;top:5px;width:3px;height:16px;background:#fff;border-radius:2px;transform:rotate(45deg)}
.x:after{transform:rotate(-45deg)}
#cards{position:absolute;left:70px;right:70px;top:330px;display:flex;flex-direction:column;gap:26px}
.card{display:flex;align-items:center;gap:20px;background:#141417;border:2px solid #2c2c33;border-radius:20px;padding:26px 26px;font:700 31px 'Space Grotesk';box-shadow:0 10px 30px rgba(0,0,0,.5)}
.card i{flex:none;width:52px;height:52px;border-radius:14px;background:#ff3b3b22;border:2px solid #ff3b3b;position:relative}
.card i:before,.card i:after{content:'';position:absolute;left:23px;top:11px;width:4px;height:28px;background:#ff3b3b;border-radius:2px;transform:rotate(45deg)}
.card i:after{transform:rotate(-45deg)}
#logo{position:absolute;left:0;right:0;top:390px;text-align:center}
#logo svg{width:230px;height:230px;filter:drop-shadow(0 0 40px rgba(255,212,0,.55))}
#logo div{font:900 64px Orbitron;letter-spacing:3px;margin-top:30px}
#logo div b{color:#ffd400}
#meter{position:absolute;left:50%;top:268px;width:404px;height:868px;margin-left:-202px;border-radius:46px;background:rgba(0,0,0,.66);display:flex;flex-direction:column;align-items:center;justify-content:center}
#meter b{font:900 104px Orbitron;color:#26f08c;text-shadow:0 0 34px rgba(38,240,140,.6)}
#meter span{margin-top:10px;font:700 28px 'Space Grotesk';background:#000;border:2px solid #26f08c;border-radius:12px;padding:8px 18px}
#lines{position:absolute;left:0;right:0;top:300px;text-align:center;font:900 54px/1.9 Orbitron}
#cta{position:absolute;left:50px;right:50px;top:300px;text-align:center}
#cta svg{width:150px;height:150px;filter:drop-shadow(0 0 30px rgba(255,212,0,.5))}
#cta .nm{font:900 48px Orbitron;letter-spacing:2px;margin:18px 0 40px}
#cta .nm b{color:#ffd400}
#cta p{font:700 38px/1.3 'Space Grotesk'}
#cta p b{color:#ffd400}
#cta .btn{margin:52px auto 0;background:linear-gradient(#ffe14d,#f2c400);color:#111;font:900 34px/1.15 Orbitron;padding:30px 20px;border-radius:999px;box-shadow:0 0 50px rgba(255,212,0,.55),0 10px 0 #a88600}
#cta .below{margin-top:46px;color:#ffd400;font:700 30px 'Space Grotesk';display:flex;flex-direction:column;align-items:center;gap:10px}
#cap{position:absolute;left:30px;right:30px;bottom:52px;text-align:center;font:700 34px/1.25 'Space Grotesk';text-shadow:0 2px 8px #000,0 0 3px #000}
#cap span{background:rgba(0,0,0,.62);padding:6px 14px;border-radius:10px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
#cap b{color:#ffd400}
.hide{display:none!important}
</style></head><body>
<div id="bg"></div><div id="grid"></div><img id="cantor"><div id="shade"></div>
<div id="cards"></div><div id="chips"></div>
<div id="phone"><img id="screen"></div><div id="meter"><b></b><span></span></div>
<div id="logo">${logo}<div>STUDIO <b>COVER</b></div></div>
<div id="lines"></div>
<div id="cta">${logo}<div class="nm">STUDIO <b>COVER</b></div><p></p><div class="btn"></div><div class="below"><span></span><svg width="44" height="54" viewBox="0 0 44 54"><path d="M22 4v40M6 30l16 18 16-18" fill="none" stroke="#ffd400" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>
<div id="top"><div id="badge"></div><div id="title"></div></div>
<div id="cap"><span></span></div>
<script>
const $=(i)=>document.getElementById(i);
const md=(s)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\\*([^*]+)\\*/g,'<b>$1</b>');
const ease=(x)=>1-Math.pow(1-Math.min(1,Math.max(0,x)),3);
let last={};
function setImg(el,src){ if(el.getAttribute('src')!==src){ el.src=src; return el.decode().catch(()=>{});} }
window.render=async function(f){
  const p=[];
  // cantor
  $('cantor').classList.toggle('hide',!f.cantor); $('shade').classList.toggle('hide',!f.cantor);
  if(f.cantor){ p.push(setImg($('cantor'),f.cantor)); $('cantor').style.transform='scale('+(1.04+0.04*f.kb)+')'; }
  // phone
  const ph=$('phone'); ph.classList.toggle('hide',!f.screen);
  if(f.screen){ p.push(setImg($('screen'),f.screen)); const a=ease(f.phoneIn); ph.style.opacity=a; ph.style.transform='translateY('+((1-a)*80)+'px) scale('+(0.96+0.04*a)+')'; }
  // título
  const top=$('top'); top.classList.toggle('hide',!f.title);
  if(f.title){ if(last.title!==f.title){ $('title').innerHTML=md(f.title); last.title=f.title; }
    const a=ease(f.titleIn); $('title').style.opacity=a; $('title').style.transform='scale('+(0.86+0.14*a)+')'; }
  $('badge').classList.toggle('hide',!f.badge); if(f.badge) $('badge').textContent=f.badge;
  // chips e cards
  $('chips').innerHTML=(f.chips||[]).map(c=>'<div class="chip'+(c.y?' y':'')+'" style="opacity:'+ease(c.a)+';transform:translateX('+((1-ease(c.a))*-60)+'px)">'+(c.y?'':'<i class="x"></i>')+md(c.t)+'</div>').join('');
  $('cards').innerHTML=(f.cards||[]).map(c=>'<div class="card" style="opacity:'+ease(c.a)+';transform:translateY('+((1-ease(c.a))*40)+'px)"><i></i>'+md(c.t)+'</div>').join('');
  // logo
  $('logo').classList.toggle('hide',!f.logo); if(f.logo){ const a=ease(f.logo); $('logo').style.opacity=a; $('logo').style.transform='scale('+(0.8+0.2*a)+')'; }
  // medidor
  $('meter').classList.toggle('hide',f.meter==null); if(f.meter!=null){ $('meter').querySelector('b').textContent=f.meter; $('meter').querySelector('span').textContent=f.meterLabel; $('meter').style.opacity=ease(f.meterIn); }
  // linhas
  $('lines').innerHTML=(f.lines||[]).map(l=>'<div style="opacity:'+ease(l.a)+'">'+md(l.t)+'</div>').join('');
  // cta
  $('cta').classList.toggle('hide',!f.cta);
  if(f.cta){ $('cta').querySelector('p').innerHTML=md(f.cta.p); $('cta').querySelector('.btn').textContent=f.cta.btn; $('cta').querySelector('.below span').textContent=f.cta.below;
    $('cta').style.opacity=ease(f.cta.a); $('cta').querySelector('.btn').style.transform='scale('+(1+0.035*Math.sin(f.cta.pulse))+')'; $('cta').querySelector('.below svg').style.transform='translateY('+(6*Math.sin(f.cta.pulse*1.3))+'px)'; }
  // legenda
  $('cap').classList.toggle('hide',!f.cap); if(f.cap) $('cap').firstChild.innerHTML=f.cap;
  await Promise.all(p);
};
</script></body></html>`;
fs.writeFileSync(`${work}/page.html`, html);

// 4) estado de cada quadro
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function frameState(T) {
  const s = scenes.find((x) => T >= x.start && T < x.start + x.dur) || scenes[scenes.length - 1];
  const x = T - s.start, p = x / s.dur, tx = TELA[s.id] || {}, f = {};
  const nx = x - s.off; // tempo dentro da narração
  // título que vale agora (os títulos trocam em partes iguais, ou nos marcos abaixo)
  const marks = { s02: [0, 0.62], s07: [0, 0.4], s08: [0, 0.5], s09: [0, 0.38, 0.72], s11: [0, 0.48], s13: [0, 0.3, 0.62] }[s.id] || (tx.t || []).map((_, i, a) => i / a.length);
  if (tx.t) { let i = 0; marks.forEach((m, j) => { if (p >= m) i = j; }); f.title = tx.t[i]; f.titleIn = (x - marks[i] * s.dur) / 0.35; }
  if (tx.b) f.badge = tx.b;
  if (s.id === 's01' || s.id === 's02') { const fr = Math.floor(T * FPS) % nCantor + 1; f.cantor = `file://${work}/cantor/${String(fr).padStart(5, '0')}.jpg`; f.kb = (T / 20) % 1; }
  if (s.id === 's01') f.chips = tx.chips.map((c, i) => ({ t: c, a: (p - 0.5 - i * 0.12) / 0.06 }));
  if (s.id === 's02') f.chips = tx.chips.map((c, i) => ({ t: c, a: (p - 0.04 - i * 0.18) / 0.05 }));
  if (s.id === 's03') f.cards = tx.cards.map((c, i) => ({ t: c, a: (p - 0.05 - i * 0.3) / 0.05 }));
  if (s.id === 's04') { if (p < 0.27) { f.logo = x / 0.4; f.title = null; } }
  if (s.id === 's16') { const n = tx.lines.length; if (p < 0.55) { f.title = null; f.lines = tx.lines.map((l, i) => ({ t: l, a: (p - i * 0.15) / 0.04 })); } else f.titleIn = (p - 0.55) * s.dur / 0.35; }
  if (s.id === 's17') { f.title = null; f.cta = { p: tx.cta, btn: tx.btn, below: tx.below, a: x / 0.4, pulse: x * 5 }; }
  const st = srcTime(s, x);
  if (st != null && !(s.id === 's04' && p < 0.27) && !(s.id === 's16' && p < 0.55)) {
    const fr = Math.min(nApp, Math.max(1, Math.round(st * FPS) + 1));
    f.screen = `file://${work}/app/${String(fr).padStart(5, '0')}.jpg`;
    const pin = s.id === 's04' ? (p - 0.27) * s.dur : s.id === 's16' ? (p - 0.55) * s.dur : x;
    const prevHasPhone = ['s05', 's06', 's07', 's08', 's09', 's10', 's11', 's12', 's13'].includes(s.id);
    f.phoneIn = prevHasPhone ? 1 : pin / 0.45;
  }
  if (s.id === 's07' && p > 0.66) { const q = Math.min(1, (p - 0.68) / 0.16); const v = MED0 + (MED1 - MED0) * ease(q); f.meter = (v >= 99.95 ? '100' : v.toFixed(1).replace('.', lang === 'en' ? '.' : ',')) + '%'; f.meterLabel = tx.meter; f.meterIn = (p - 0.66) / 0.04; }
  // legenda
  if (s.caps.length && nx >= 0 && nx <= s.nd + 0.2) {
    let c = s.caps.findIndex((g) => nx < g[g.length - 1][1] + 0.12);
    if (c < 0) c = s.caps.length - 1;
    const g = s.caps[c];
    if (nx >= g[0][0] - 0.25) f.cap = g.map((w) => (nx >= w[0] && nx < w[1] + 0.05 ? `<b>${esc(w[2])}</b>` : esc(w[2]))).join(' ');
  }
  return f;
}
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// 5) desenha todos os quadros
const N = Math.ceil(total * FPS);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`file://${work}/page.html`);
await page.evaluate(() => document.fonts.ready);
const t0 = Date.now();
if (process.env.PREVIEW) { // só alguns quadros em PNG, para conferir o visual
  const ts = process.env.PREVIEW === 'all' ? scenes.flatMap((s) => [s.start + s.dur * 0.2, s.start + s.dur * 0.75]) : process.env.PREVIEW.split(',').map(Number);
  for (const [i, T] of ts.entries()) { await page.evaluate((f) => window.render(f), frameState(T)); await page.screenshot({ path: `${outFile}-${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 80 }); }
  await browser.close(); fs.rmSync(work, { recursive: true, force: true }); process.exit(0);
}
for (let i = 0; i < N; i++) {
  await page.evaluate((f) => window.render(f), frameState(i / FPS));
  await page.screenshot({ path: `${work}/out/${String(i + 1).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
  if (i % 600 === 0) console.log(lang, `${i}/${N}`, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
await browser.close();

// 6) áudio: narração + o som "ruim" do cantor por baixo da abertura
const nar = scenes.map((s) => s.narr);
const fc = scenes.map((s, i) => `[${i + 1}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${Math.round((s.start + s.off) * 1000)}:all=1[a${i}]`).join(';')
  + `;[${scenes.length + 1}:a]aresample=44100,aformat=channel_layouts=stereo,aloop=loop=3:size=2e6,atrim=0:${(scenes[2].start).toFixed(2)},volume=0.16,afade=t=out:st=${(scenes[2].start - 1.2).toFixed(2)}:d=1.2[bed]`
  + `;${scenes.map((_, i) => `[a${i}]`).join('')}[bed]amix=inputs=${scenes.length + 1}:normalize=0,loudnorm=I=-15:TP=-1.5,apad,atrim=0:${total.toFixed(2)}[a]`;
run(['-framerate', String(FPS), '-i', `${work}/out/%05d.jpg`, ...nar.flatMap((f) => ['-i', f]), '-i', CANTOR,
  '-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', outFile]);
// capa: quadro do medidor de afinação
const s7 = scenes.find((s) => s.id === 's07');
fs.writeFileSync(`${outFile}.json`, JSON.stringify({ total, capa: s7.start + s7.dur * 0.9, scenes: scenes.map(({ id, start, dur }) => ({ id, start, dur })) }));
fs.rmSync(work, { recursive: true, force: true });
console.log('ok', outFile, total.toFixed(1) + 's');
