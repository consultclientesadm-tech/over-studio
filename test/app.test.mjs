// Teste do app completo no Chromium: sobe o vídeo, espera o estúdio, mexe numa nota, aplica, escolhe
// filtro, exporta e tira fotos no celular e no computador. Uso: node test/app.test.mjs video.mp4 pasta_fotos
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [vid, dir] = process.argv.slice(2);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8095' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let fail = 0;
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  FALHOU', msg); if (!ok) fail++; };
try {
  for (const [name, vp] of [['celular', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['computador', { width: 1440, height: 900, deviceScaleFactor: 1 }]]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort()); // sem internet no teste
    page.on('pageerror', (e) => console.log('[erro]', e.message));
    page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
    await page.goto('http://localhost:8095/');
    await page.screenshot({ path: `${dir}/${name}-1-inicio.png` });
    await page.setInputFiles('#file', vid);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${dir}/${name}-2-processando.png`, timeout: 60000 }).catch(() => console.log("  (sem foto do processando: a página estava ocupada)"));
    await page.waitForFunction(() => document.getElementById('app').dataset.screen === 'studio', null, { timeout: 900000 });
    await page.waitForTimeout(800);
    const noScroll = await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1);
    check(noScroll, `${name}: tela fixa, sem rolar`);
    const band = await page.evaluate(() => window.studio.state.after.band);
    check(band >= 97, `${name}: faixa verde depois = ${band}%`);
    // toca 2 s para a prévia desenhar
    await page.click('#play'); await page.waitForTimeout(2000); await page.click('#play');
    await page.screenshot({ path: `${dir}/${name}-3-afinacao.png` });
    if (name === 'computador') {
      // seleciona a nota mais longa (pelo editor) e sobe meio tom; aplica
      const i = await page.evaluate(() => { const p = window.studio.state.plan; let b = 0; p.forEach((n, k) => { if (n.end - n.start > p[b].end - p[b].start) b = k; }); return b; });
      const before = await page.evaluate((i) => window.studio.state.plan[i].target, i);
      await page.evaluate((i) => window.studio.select(i), i);
      await page.click('#nUp');
      await page.click('#apply');
      await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 600000 });
      const after = await page.evaluate((i) => window.studio.state.plan[i].target, i);
      check(after === before + 1, `nota editada subiu meio tom (${before} → ${after})`);
      const band2 = await page.evaluate(() => window.studio.state.after.band);
      check(band2 >= 97, `faixa verde depois da edição = ${band2}%`);
      await page.screenshot({ path: `${dir}/${name}-4-editada.png` });
    }
    await page.click('.tabs button[data-tab=look]'); await page.waitForTimeout(500);
    await page.click('#filters button:nth-child(3)'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/${name}-5-filtros.png` });
    await page.click('.tabs button[data-tab=mix]'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/${name}-6-mix.png` });
    if (name === 'computador') {
      await page.click('.tabs button[data-tab=out]');
      await page.click('#exportBtn');
      await page.waitForSelector('#download:not([hidden])', { timeout: 120000 });
      const dl = await page.evaluate(() => document.getElementById('download').textContent);
      check(/Baixar o vídeo/.test(dl), `exportou: ${dl}`);
      await page.screenshot({ path: `${dir}/${name}-7-exportar.png` });
    }
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} falha(s)` : 'Tudo certo.');
process.exit(fail ? 1 : 0);
