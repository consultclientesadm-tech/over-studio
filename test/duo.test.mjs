// Teste do modo dupla no app (Chromium): sobe uma dupla cantando à capela, confere que o app achou 2 vozes,
// afina cada uma, abas e mudo no painel, volume de cada voz na mix. Uso: node test/duo.test.mjs video.mp4 pasta_fotos
import { createRequire } from 'module';
import { spawn } from 'child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const [vid, dir, sep] = process.argv.slice(2);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8096' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let fail = 0;
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  FALHOU', msg); if (!ok) fail++; };
try {
  for (const [name, vp] of [['celular', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['computador', { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.isMobile, hasTouch: vp.hasTouch, userAgent: vp.isMobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : undefined });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    page.on('pageerror', (e) => console.log('[erro]', e.message));
    page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
    await page.goto('http://localhost:8096/');
    if (sep !== 'sep') await page.evaluate(() => { document.getElementById('optSeparate').checked = false; });
    await page.setInputFiles('#file', vid);
    await page.waitForFunction(() => document.getElementById('app').dataset.screen === 'studio', null, { timeout: 600000 });
    await page.waitForTimeout(800);
    const v = await page.evaluate(() => ({ n: window.studio.state.parts?.length, voices: window.studio.state.voices, bar: !!document.querySelector('#voiceBar .vtab'), tabs: document.querySelectorAll('#voiceBar .vtab').length, vols: document.querySelectorAll('#mVoices input, #eVoices input').length }));
    console.log(name, JSON.stringify(v));
    check(v.n === 2 && v.bar && v.tabs === 2, `${name}: achou a dupla e mostra as abas Voz 1 e Voz 2`);
    check(v.vols === 4, `${name}: volume da Voz 1 e da Voz 2 na Mix e no Exportar`);
    await page.click('#quickStep'); await page.waitForTimeout(300);
    await page.click('#tuneAuto');
    await page.waitForFunction(() => document.getElementById('busy').hidden && window.studio.tuned, null, { timeout: 600000 });
    const t = await page.evaluate(() => window.studio.state.parts.map((p) => ({ antes: p.before.band, depois: p.after.band, notas: p.plan.length })));
    console.log('  afinação por voz:', JSON.stringify(t));
    check(t.every((p) => p.depois >= 90 && p.depois > p.antes), `${name}: cada voz afinada separada (${t.map((p) => p.antes + '% → ' + p.depois + '%').join(', ')})`);
    await page.screenshot({ path: `${dir}/${name}-dupla-afinacao.png` });
    // mudo da Voz 2: a prévia fica só com a Voz 1
    const e0 = await page.evaluate(() => { const s = window.studio.state; return s.parts[1].voice[0].reduce((a, x) => a + x * x, 0); });
    await page.click('#voiceBar .vmute[data-m="1"]'); await page.waitForTimeout(300);
    const m = await page.evaluate(() => ({ cls: document.querySelector('#voiceBar .vmute[data-m="1"]').classList.contains('on') }));
    check(m.cls && e0 > 0, `${name}: mudo da Voz 2 ligado`);
    await page.click('#voiceBar .vsel[data-i="1"]'); await page.waitForTimeout(400);
    const sel = await page.evaluate(() => ({ on: document.querySelector('#voiceBar .vtab.on .vsel').dataset.i, plan: window.studio.editor.state === window.studio.state.parts[1] }));
    check(sel.on === '1' && sel.plan, `${name}: tocar na Voz 2 abre as notas dela no painel`);
    const solo = await page.evaluate(() => ({ m0: document.querySelector('#voiceBar .vmute[data-m="0"]').classList.contains('on'), m1: document.querySelector('#voiceBar .vmute[data-m="1"]').classList.contains('on'), all: !!document.querySelector('#voiceBar .vall') }));
    check(solo.m0 && !solo.m1 && solo.all, `${name}: tocar na Voz 2 toca só a Voz 2 (Voz 1 muda) e aparece Ouvir todas`);
    await page.click('#voiceBar .vsel[data-i="0"]'); await page.waitForTimeout(300);
    const solo1 = await page.evaluate(() => [0, 1].map((i) => document.querySelector(`#voiceBar .vmute[data-m="${i}"]`).classList.contains('on')));
    check(!solo1[0] && solo1[1], `${name}: tocar na Voz 1 toca só a Voz 1`);
    await page.click('#voiceBar .vall'); await page.waitForTimeout(300);
    check(await page.evaluate(() => !document.querySelector('#voiceBar .vmute.on')), `${name}: Ouvir todas liga as duas vozes de novo`);
    await page.click('#voiceBar .vsel[data-i="1"]'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/${name}-dupla-voz2-mudo.png` });
    if (name === 'celular') {
      await page.click('#panelBtn'); await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/${name}-dupla-painel-grande.png` });
      const pop = await page.evaluate(() => ({ h: Math.round(document.getElementById('editor').getBoundingClientRect().height), bar: document.getElementById('voiceBar').getBoundingClientRect().height }));
      check(pop.h > 350 && pop.bar > 30, `celular: painel grande com as abas das vozes (${pop.h}px de notas)`);
      await page.click('#popClose'); await page.waitForTimeout(300);
    }
    // Mix: Voz 2 no mínimo = muda no vídeo final
    await page.click('#stepper button[data-step="3"]'); await page.waitForTimeout(300);
    await page.click('#mixApply');
    await page.waitForFunction(() => document.getElementById('busy').hidden && window.studio.mastered, null, { timeout: 600000 });
    await page.evaluate(() => { const r = document.getElementById('mV1'); r.value = '-15'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(500);
    await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 600000 });
    const g = await page.evaluate(() => ({ e: document.getElementById('eV1').value, out: document.getElementById('mV1').nextElementSibling.textContent }));
    check(g.e === '-15' && g.out === 'mudo', `${name}: volume da Voz 2 vai para o Exportar junto (${g.out})`);
    await page.screenshot({ path: `${dir}/${name}-dupla-mix.png` });
    await page.click('#stepper button[data-step="5"]'); await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/${name}-dupla-exportar.png` });
    // "É uma voz só"
    await page.click('#stepper button[data-step="2"]'); await page.waitForTimeout(300);
    await page.click('#voiceBar .vpick button[data-k="1"]');
    await page.waitForFunction(() => document.getElementById('busy').hidden && !window.studio.state.parts, null, { timeout: 600000 });
    const j = await page.evaluate(() => ({ bar: !document.querySelector('#voiceBar .vtab'), vols: document.querySelectorAll('#mVoices input').length }));
    check(j.bar && j.vols === 0, `${name}: "É uma voz só" junta as vozes e some com as abas`);
    // escolher dupla na mão (Ajustes)
    await page.click('#voiceBar .vpick button[data-k="2"]');
    await page.waitForFunction(() => document.getElementById('busy').hidden && window.studio.state.parts?.length === 2, null, { timeout: 600000 });
    check(await page.evaluate(() => document.querySelectorAll('#voiceBar .vtab').length === 2), `${name}: "Dupla" em Quem canta separa as vozes de novo`);
    await page.screenshot({ path: `${dir}/${name}-dupla-afinacao-v2.png` });
    await page.click('#panelBtn'); await page.waitForTimeout(600);
    await page.click('#voiceBar .vsel[data-i="1"]'); await page.waitForTimeout(400);
    const pv = await page.evaluate(() => ({ pop: document.getElementById('studio').classList.contains('pop'), tabs: [...document.querySelectorAll('#voiceBar .vtab')].every((t) => { const r = t.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), ed: Math.round(document.getElementById('editor').getBoundingClientRect().height) }));
    check(pv.pop && pv.tabs && pv.ed > 250, `${name}: dentro do painel, trocar de voz deixa as vozes à vista em cima (${pv.ed}px de notas)`);
    await page.screenshot({ path: `${dir}/${name}-dupla-painel-v2.png` });
    await page.click('#popClose'); await page.waitForTimeout(300);
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} FALHA(S)` : 'TUDO OK');
process.exit(fail ? 1 : 0);
