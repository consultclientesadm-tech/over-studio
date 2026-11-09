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
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch, userAgent: vp.isMobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : undefined });
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
    const busyDone = () => page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 600000 });
    const tagIs = async (t) => (await page.textContent('#tag')).trim() === t;
    check(!(await page.isHidden('#quick')), `${name}: aparece a escolha "Deixar tudo pronto" ou passo a passo`);
    await page.screenshot({ path: `${dir}/${name}-2b-escolha.png` });
    if (name === 'celular') {
      await page.click('#quickAll'); await page.waitForTimeout(500);
      await page.waitForFunction(() => document.getElementById('busy').hidden && document.querySelector('.step.on')?.dataset.step === '5', null, { timeout: 600000 });
      const st = await page.evaluate(() => ({ t: window.studio.tuned, m: !!window.studio.mastered, band: window.studio.state.after.band }));
      check(st.t && st.m && st.band >= 97, `celular: "Deixar tudo pronto" afinou (${st.band}%), mixou e foi para Exportar`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${dir}/${name}-2c-tudo-pronto.png` });
      await page.click('#watchBtn'); await page.waitForTimeout(1200);
      await page.screenshot({ path: `${dir}/${name}-8-telacheia.png` });
      await page.click('#fsBtn'); await page.click('#stepper button[data-step="2"]'); await page.waitForTimeout(600);
      await page.screenshot({ path: `${dir}/${name}-3-afinacao.png` });
      await page.click('#expandBtn'); await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/${name}-3e-expandido.png` });
      await page.click('#stepper button[data-step="3"]'); await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/${name}-5-mix.png` });
      await ctx.close(); continue;
    }
    await page.click('#quickStep'); await page.waitForTimeout(200);
    // etapa 2: ainda sem afinar
    check(!(await page.isHidden('#tuneAuto')), `${name}: botão Afinar automático aparece`);
    await page.screenshot({ path: `${dir}/${name}-3a-antes-de-afinar.png` });
    // ajuda: toca no "?" do Afinar automático
    await page.click('#helpBtn'); await page.click('#tuneAuto'); await page.waitForTimeout(200);
    check(!(await page.isHidden('#tip')) && (await page.evaluate(() => !window.studio.tuned)), `${name}: no modo ajuda, tocar no botão explica (e não executa)`);
    await page.screenshot({ path: `${dir}/${name}-3b-ajuda.png` });
    await page.click('#tipOk'); await page.click('#helpBtn'); await page.waitForTimeout(200);
    await page.click('#tuneAuto'); await page.waitForTimeout(300); await busyDone();
    const band = await page.evaluate(() => window.studio.state.after.band);
    check(band >= 97, `${name}: faixa verde depois = ${band}%`);
    check(!(await page.isHidden('#tuneUndo')) && !(await page.isHidden('#tuneAgain')), `${name}: aparecem Desfazer e Afinar de novo`);
    await page.click('#play'); await page.waitForTimeout(1500); await page.click('#play');
    await page.click('#abA'); check(await tagIs('ANTES'), `${name}: ANTES selecionado`);
    await page.screenshot({ path: `${dir}/${name}-3c-afinado-antes.png` });
    await page.click('#abB'); check(await tagIs('DEPOIS'), `${name}: DEPOIS selecionado`);
    await page.screenshot({ path: `${dir}/${name}-3d-afinado-depois.png` });
    if (name === 'computador') {
      await page.click('#tuneUndo'); await page.waitForTimeout(300); await busyDone();
      const und = await page.evaluate(() => window.studio.tuned == null);
      check(und && !(await page.isHidden('#tuneAuto')), 'Desfazer afinação volta para a voz original');
      await page.click('#tuneAuto'); await page.waitForTimeout(300); await busyDone();
      const i = await page.evaluate(() => { const p = window.studio.state.plan; let b = 0; p.forEach((n, k) => { if (n.end - n.start > p[b].end - p[b].start) b = k; }); return b; });
      const before = await page.evaluate((i) => window.studio.state.plan[i].target, i);
      await page.evaluate((i) => window.studio.select(i), i);
      await page.click('#nUp');
      await page.click('#apply'); await page.waitForTimeout(300); await busyDone();
      const after = await page.evaluate((i) => window.studio.state.plan[i].target, i);
      check(after === before + 1, `nota editada subiu meio tom (${before} → ${after})`);
      const band2 = await page.evaluate(() => window.studio.state.after.band);
      check(band2 >= 97, `faixa verde depois da edição = ${band2}%`);
      await page.screenshot({ path: `${dir}/${name}-4-editada.png` });
    }
    // etapa 3: mix e master com 3 opções
    await page.click('#next'); await page.waitForTimeout(300);
    check(!(await page.isHidden('#mixApply')) && !(await page.isHidden('#abC')), `${name}: etapa Mix com ORIGINAL | AFINADA | MIXADA`);
    await page.click('#mixApply'); await page.waitForTimeout(300); await busyDone();
    check(await tagIs('MIXADA'), `${name}: depois de mixar mostra MIXADA`);
    await page.screenshot({ path: `${dir}/${name}-5-mix.png` });
    await page.click('#abA'); check(await tagIs('ORIGINAL'), `${name}: alterna para ORIGINAL`);
    await page.click('#abB'); check(await tagIs('AFINADA'), `${name}: alterna para AFINADA`);
    // etapa 4: cor
    await page.click('#next'); await page.waitForTimeout(500); await busyDone();
    check(await page.isHidden('#abC'), `${name}: na cor volta a ANTES | DEPOIS`);
    const px = () => page.evaluate(() => { const c = document.getElementById('screen'), g = document.createElement('canvas'); g.width = 32; g.height = 56; const x = g.getContext('2d'); x.drawImage(c, 0, 0, 32, 56); return Array.from(x.getImageData(0, 0, 32, 56).data); });
    const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
    await page.click('#filters button:nth-child(1)'); await page.waitForTimeout(300); const p0 = await px();
    await page.click('#filters button:nth-child(6)'); await page.waitForTimeout(300); const p1 = await px();
    check(diff(p0, p1) > 3, `${name}: tocar no filtro muda a prévia (diferença ${diff(p0, p1).toFixed(1)})`);
    const clip = p1.filter((v, i) => i % 4 < 3 && v >= 254).length / (p1.length * 0.75);
    check(clip < 0.05, `${name}: filtro sem estourar (${(clip * 100).toFixed(1)}% de pixels no branco)`);
    await page.click('#filters button:nth-child(4)'); await page.waitForTimeout(300);
    const sync = await page.evaluate(async () => {
      document.getElementById('play').click(); const v = document.getElementById('video'); const out = [];
      for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 250)); const a = window.studio.audio(); out.push([v.currentTime, a.currentTime]); }
      document.getElementById('play').click(); return out;
    });
    const stalls = sync.slice(4).filter((x, i, arr) => i > 0 && x[0] - arr[i - 1][0] < 0.1).length, drift = Math.max(...sync.slice(4).map((x) => Math.abs(x[0] - x[1])));
    check(stalls === 0 && drift < 0.2, `${name}: prévia rodando sem congelar (${stalls} travadas, maior diferença vídeo×áudio ${(drift * 1000).toFixed(0)} ms)`);
    await page.screenshot({ path: `${dir}/${name}-6-cor.png` });
    // o que a pessoa VÊ tem que andar: duas fotos da prévia tocando, com 1 s de diferença, precisam ser diferentes
    await page.click('#play'); await page.waitForTimeout(800);
    const shot1 = await page.locator('#viewer').screenshot(); await page.waitForTimeout(1000);
    const shot2 = await page.locator('#viewer').screenshot();
    const vis = await page.evaluate(() => getComputedStyle(document.getElementById('screen')).display === 'none');
    await page.click('#play');
    check(vis && !shot1.equals(shot2), `${name}: a imagem da prévia anda na tela enquanto toca`);
    // etapa 5
    await page.click('#next'); await page.waitForTimeout(300);
    if (name === 'computador') {
      await page.click('#exportBtn');
      await page.waitForSelector('#ready:not([hidden])', { timeout: 180000 });
      const dl = await page.evaluate(() => document.getElementById('readyInfo').textContent);
      check(/MB/.test(dl), `exportou: ${dl}`);
      await page.waitForTimeout(600);
    }
    await page.screenshot({ path: `${dir}/${name}-7-exportar.png` });
    await page.click('#watchBtn'); await page.waitForTimeout(1500);
    const th = await page.evaluate(() => { const r = document.getElementById('video').getBoundingClientRect(); return [document.getElementById('app').classList.contains('theater'), Math.round(r.height), innerHeight]; });
    check(th[0] && th[1] > th[2] * 0.6, `${name}: prévia em tela cheia (${th[1]}px de ${th[2]}px)`);
    await page.screenshot({ path: `${dir}/${name}-8-telacheia.png` });
    await page.click('#fsBtn');
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} falha(s)` : 'Tudo certo.');
process.exit(fail ? 1 : 0);
