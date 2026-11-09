// Teste do modo "só o áudio": sobe um arquivo de áudio, deixa tudo pronto e baixa o WAV.
// Uso: node test/audio.test.mjs audio.m4a pasta_fotos
import { createRequire } from 'module';
import { spawn } from 'child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const [aud, dir] = process.argv.slice(2);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8096' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let fail = 0;
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  FALHOU', msg); if (!ok) fail++; };
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  page.on('pageerror', (e) => { console.log('[erro]', e.message); fail++; });
  await page.goto('http://localhost:8096/');
  check(await page.isVisible('#audioPick'), 'tela inicial mostra "Ou suba só o áudio"');
  await page.screenshot({ path: `${dir}/audio-1-inicio.png` });
  await page.setInputFiles('#audioFile', aud);
  await page.waitForFunction(() => document.getElementById('app').dataset.screen === 'studio', null, { timeout: 900000 });
  await page.click('#quickAll'); await page.waitForTimeout(500);
  await page.waitForFunction(() => document.getElementById('busy').hidden && document.querySelector('.step.on')?.dataset.step === '5', null, { timeout: 600000 });
  const st = await page.evaluate(() => ({ t: window.studio.tuned, m: !!window.studio.mastered }));
  check(st.t && st.m, 'só áudio: afinou e mixou');
  check(await page.isHidden('#stepCor') && await page.isHidden('#exportBtn'), 'só áudio: sem etapa de cor e sem gerar vídeo');
  await page.screenshot({ path: `${dir}/audio-2-exportar.png` });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlWav')]);
  const p = await dl.path(); const fs = await import('fs'); const n = fs.statSync(p).size;
  check(n > 100000 && /studio-cover\.wav$/.test(dl.suggestedFilename()), `baixou ${dl.suggestedFilename()} (${(n / 1048576).toFixed(1)} MB)`);
  await page.click('#play'); await page.waitForTimeout(1500);
  const t = await page.evaluate(() => +document.getElementById('seek').value);
  check(t > 0.5, `prévia do som anda (${t.toFixed(1)} s)`);
  await page.screenshot({ path: `${dir}/audio-3-tocando.png` });
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} falha(s)` : 'Tudo certo.'); process.exit(fail ? 1 : 0);
