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
  const rms = () => page.evaluate(() => { const c = window.studio.mastered.channels[0]; let e = 0; for (let i = 0; i < c.length; i += 7) e += c[i] * c[i]; return e; });
  const before = await rms();
  await page.evaluate(() => { const r = document.getElementById('eVoice'); r.value = '9'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(300); await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 120000 });
  const after = await rms(), mv = await page.evaluate(() => document.getElementById('mVoice').value);
  check(after !== before && mv === '9', `volume da voz +9 dB mixou de novo e a régua da Mix acompanhou (${mv})`);
  await page.screenshot({ path: `${dir}/audio-2b-volumes.png` });
  // Equalizador, compressor e volume padrão Spotify
  const lu = () => page.evaluate(() => { const m = window.studio.mastered; let p = 0; for (const c of m.channels) for (const v of c) p = Math.max(p, Math.abs(v)); return { lufs: m.lufs, peak: 20 * Math.log10(p), comp: m.comp }; });
  let m = await lu();
  check(Math.abs(m.lufs + 14) < 0.8 && m.peak <= -0.95, `master no padrão Spotify: ${m.lufs.toFixed(1)} LUFS, pico ${m.peak.toFixed(2)} dB`);
  check(m.comp.mode === 'auto' && m.comp.ratio >= 2 && m.comp.ratio <= 5, `compressor automático escolheu ${m.comp.ratio.toFixed(1)}:1`);
  await page.evaluate(() => window.studio.go(3)); await page.waitForTimeout(300); await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 120000 });
  const e0 = await rms();
  for (const [id, v] of [['mLow', '4'], ['mHigh', '-3']]) await page.evaluate(([id, v]) => { const r = document.getElementById(id); r.value = v; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }, [id, v]);
  await page.waitForTimeout(300); await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 120000 });
  check((await rms()) !== e0 && (await page.textContent('#mLow + output')) === '+4 dB', 'grave +4 e agudo −3 mixaram de novo');
  await page.click('#compMode [data-m=manual]'); await page.waitForTimeout(300); await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 120000 });
  check(await page.isVisible('#compRow'), 'manual mostra a régua de compressão');
  await page.evaluate(() => { const r = document.getElementById('mComp'); r.value = '1'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(300); await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 120000 });
  m = await lu();
  check(m.comp.mode === 'manual' && m.comp.ratio === 8 && Math.abs(m.lufs + 14) < 0.8, `manual 100% = ${m.comp.ratio}:1, ainda ${m.lufs.toFixed(1)} LUFS`);
  check(/LUFS/.test(await page.textContent('#compInfo')), 'mostra o volume final: ' + (await page.textContent('#compInfo')));
  await page.evaluate(() => document.getElementById('mLow').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${dir}/audio-2c-eq.png` });
  await page.evaluate(() => window.studio.go(5)); await page.waitForTimeout(300); await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 120000 });
  for (const [id, nome] of [['#dlVoice', 'so-voz'], ['#dlBed', 'so-musica']]) {
    const [d] = await Promise.all([page.waitForEvent('download'), page.click(id)]);
    const sz = fs.statSync(await d.path()).size;
    check(sz > 100000 && d.suggestedFilename().endsWith(nome + '.wav'), `baixou ${d.suggestedFilename()} (${(sz / 1048576).toFixed(1)} MB)`);
  }
  await page.click('#play'); await page.waitForTimeout(1500);
  const t = await page.evaluate(() => +document.getElementById('seek').value);
  check(t > 0.5, `prévia do som anda (${t.toFixed(1)} s)`);
  await page.screenshot({ path: `${dir}/audio-3-tocando.png` });
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} falha(s)` : 'Tudo certo.'); process.exit(fail ? 1 : 0);
