// Grava as telas do app para a VSL de cada língua (en, es, fr, pt-pt), com o app de verdade no Chromium em tela de celular.
// Precisa de um servidor local servindo o app em /app/ e site/assets/i18n* em /assets/ (ver tools/vsl-int/LEIA.md).
// Uso: node tools/vsl-int/gravar.mjs <lingua> <video.mp4> <pasta_saida> [porta]
// Sai: <pasta_saida>/<lingua>.webm (sessão inteira) e <lingua>.json (início e fim de cada trecho, em segundos).
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [lang, video, out, port = '8097'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const reg = lang === 'en' ? 'us' : 'eu';
const W = 390, H = 844;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  recordVideo: { dir: out, size: { width: W * 2, height: H * 2 } } });
const page = await ctx.newPage();
const T0 = Date.now();
const now = () => (Date.now() - T0) / 1000;
await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
page.on('pageerror', (e) => console.log('[erro]', e.message));
const marks = {};
const mark = (id) => { marks[id] = [now(), null]; };
const fim = (id) => { marks[id][1] = now(); };
const wait = (ms) => page.waitForTimeout(ms);
async function ring(x, y) {
  await page.evaluate(([x, y]) => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;border:4px solid #ffd60a;background:rgba(255,214,10,.35);z-index:99999;pointer-events:none;transition:transform .5s,opacity .5s;box-shadow:0 0 18px #ffd60a`;
    document.body.appendChild(d);
    setTimeout(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; }, 650);
    setTimeout(() => d.remove(), 1300);
  }, [x, y]);
}
async function box(sel) { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded().catch(() => {}); return el.boundingBox(); }
async function point(sel, ms = 900) { const b = await box(sel); await ring(b.x + b.width / 2, b.y + b.height / 2); await wait(ms); }
async function tap(sel, ms = 700) { await point(sel, 550); await page.locator(sel).first().click(); await wait(ms); }
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 900000 });
async function note() {
  return page.evaluate(() => {
    const ed = window.studio.editor, p = ed.state.plan, r = ed.c.getBoundingClientRect();
    let best = -1, bl = 0;
    p.forEach((n, i) => { const x = ed.X((n.start + n.end) / 2), y = ed.Y(n.target), len = n.end - n.start; if (x > 60 && x < ed.W - 40 && y > 40 && y < ed.H - 20 && len > bl) { best = i; bl = len; } });
    const n = p[best]; return { x: r.left + ed.X((n.start + n.end) / 2), y: r.top + ed.Y(n.target) };
  });
}
try {
  await page.goto(`http://localhost:${port}/app/?reg=${reg}&lang=${lang}`);
  await wait(2500);
  mark('home'); await wait(3500);
  await point('#refPick', 2500); fim('home');
  mark('ref'); await point('#refPick', 1800); await point('#refPick', 1800); fim('ref');
  await tap('#drop', 1500);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.av-b').click()]);
  await fc.setFiles(video);
  await wait(400);
  mark('ia');
  await page.waitForFunction(() => document.getElementById('app').dataset.screen === 'studio' && !document.getElementById('quick').hidden, null, { timeout: 900000 });
  fim('ia');
  await wait(800);
  await tap('#quickStep', 900);
  mark('afinar'); await wait(1200);
  await tap('#tuneAuto', 300);
  mark('afinando'); await idle(); fim('afinando');
  await wait(600);
  await tap('#play', 3000); await tap('#play', 400);
  fim('afinar');
  mark('painel'); await wait(600);
  await tap('#panelBtn', 2500);
  mark('painel_aberto'); await wait(2500);
  let n = await note();
  await ring(n.x, n.y); await wait(500); await page.mouse.click(n.x, n.y); await wait(1300);
  await tap('#nUp', 1500); await tap('#nUp', 1500); await tap('#nDown', 1500);
  mark('painel_play');
  await tap('#popPlay', 4000); await tap('#popPlay', 300);
  fim('painel_play'); fim('painel_aberto');
  await tap('#popClose', 1200);
  fim('painel');
  mark('mix');
  await tap('#next', 900);
  await tap('#mixApply', 300);
  mark('mixando'); await idle(); fim('mixando');
  await wait(800);
  mark('pots');
  {
    const b = await box('.row:has(#mVoice) .pot'); const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await ring(x, y); await wait(500);
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(x, y - i * 2.5); await wait(45); }
    await page.mouse.up();
  }
  await wait(500); await idle(); await wait(1200);
  await point('.row:has(#mBed) .pot', 1800);
  fim('pots'); fim('mix');
  mark('cor');
  await tap('#next', 800); await idle();
  await wait(800);
  await tap('#filters button:nth-child(1)', 1600);
  await tap('#filters button:nth-child(4)', 1600);
  await tap('#filters button:nth-child(7)', 1600);
  await tap('#filters button:nth-child(1)', 1600);
  fim('cor');
  mark('exportar');
  await tap('#next', 1200);
  await point('#exportBtn', 700);
  await page.locator('#exportBtn').click();
  mark('exportando');
  await page.waitForSelector('#ready:not([hidden])', { timeout: 900000 });
  fim('exportando');
  await wait(600);
  mark('pronto'); await point('#download', 2500); await wait(2500); fim('pronto');
  fim('exportar');
} catch (e) { console.log('FALHOU', e.message); await page.screenshot({ path: `${out}/${lang}-erro.png` }); }
const v = page.video();
await ctx.close();
fs.renameSync(await v.path(), `${out}/${lang}.webm`);
fs.writeFileSync(`${out}/${lang}.json`, JSON.stringify(marks, null, 1));
console.log(lang, JSON.stringify(marks));
await browser.close();
