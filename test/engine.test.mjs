// Teste do motor no Chromium (Playwright): afina a voz de teste e confere o antes e depois.
// Uso: node test/engine.test.mjs <voz.wav> [cover.mp4]
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'child_process';
import fs from 'fs';
const [voiceWav, coverMp4, refWav] = process.argv.slice(2);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8091' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
let fail = 0;
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  FALHOU', msg); if (!ok) fail++; };
try {
  await page.goto('http://localhost:8091/lab.html');
  await page.waitForFunction(() => window.cover);
  // 1) Só voz (sem separar): afinação
  const b64 = fs.readFileSync(voiceWav).toString('base64');
  const r = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'voz.wav', { type: 'audio/wav' });
    const st = await window.cover.analyze(file, { separate: false });
    await window.cover.verify(st);
    const out = await window.cover.render(st, {});
    return { key: st.key.name, before: st.before, after: st.after, plan: st.plan.map((n) => [n.midi, n.target, n.cents]), start: out.start, end: out.end, len: out.channels[0].length / out.sr, dur: st.duration };
  }, b64);
  console.log('Só voz:', JSON.stringify(r));
  check(r.key === 'Dó maior', 'achou o tom Dó maior');
  check(r.before.avgCents >= 25, `desvio antes ${r.before.avgCents} cents`);
  check(r.after.avgCents <= 10, `desvio depois ${r.after.avgCents} cents`);
  check(r.after.band >= 90 && r.after.band > r.before.band + 10, `tempo na faixa verde: ${r.before.band}% antes, ${r.after.band}% depois (escorregada corrigida)`);
  check(r.plan.some(([m, t]) => m === 66 && t === 65), 'nota fora do tom (Fá + 60 cents) foi para Fá, não Fá#');
  check(r.start > 1.5 && r.start < 2, `corte do começo em ${r.start.toFixed(2)} s (voz entra em 2 s)`);
  check(r.end > r.dur - 2 && r.end < r.dur - 1, `corte do fim em ${r.end.toFixed(2)} s`);
  check(Math.abs(r.len - (r.end - r.start)) < 0.01, 'áudio final tem exatamente a duração do corte (sincronia)');
  // 1b) Modo referência: a original está em Ré (2 semitons acima), tem notas antes e depois do trecho
  //     do cover, e a 4ª nota da melodia é Sol (o cover cantou Fá + 60 cents, que sem referência vira Fá)
  if (refWav) {
    const rb = fs.readFileSync(refWav).toString('base64');
    const rr = await page.evaluate(async ([b64, r64]) => {
      const f = (x, n) => new File([Uint8Array.from(atob(x), (c) => c.charCodeAt(0))], n, { type: 'audio/wav' });
      const st = await window.cover.analyze(f(b64, 'voz.wav'), { separate: false, reference: f(r64, 'original.wav') });
      return { ref: { shift: st.ref.shift, quality: st.ref.quality, changed: st.ref.changed }, plan: st.plan.map((n) => [n.midi, n.target, n.viaRef]) };
    }, [b64, rb]);
    console.log('Referência:', JSON.stringify(rr));
    check(rr.ref.shift === -2, `achou a diferença de tom (original 2 semitons acima): ${rr.ref.shift}`);
    check(rr.plan.some(([m, t]) => m === 66 && t === 67), 'nota de melodia errada foi para a nota da original (Sol)');
    check(rr.plan.filter(([m, t]) => m !== 66).every(([m, t]) => t === m), 'as outras notas continuam nas notas certas');
  }
  // 2) Vídeo com instrumental: o fluxo completo, com separação
  if (coverMp4) {
    const v64 = fs.readFileSync(coverMp4).toString('base64');
    const t0 = Date.now();
    const r2 = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'cover.mp4', { type: 'video/mp4' });
      const st = await window.cover.analyze(file, {});
      await window.cover.verify(st);
      const out = await window.cover.render(st, { reverb: 0.4 });
      let peak = 0; for (const c of out.channels) for (const x of c) peak = Math.max(peak, Math.abs(x));
      return { key: st.key.name, before: st.before, after: st.after, dur: st.duration, start: out.start, end: out.end, peak };
    }, v64);
    console.log('Vídeo:', JSON.stringify(r2), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
    check(Math.abs(r2.dur - 10.6) < 0.1, `leu o áudio do MP4 (${r2.dur.toFixed(2)} s)`);
    check(r2.after.avgCents < r2.before.avgCents, 'afinação melhorou depois da separação');
    check(r2.peak <= 0.9 && r2.peak > 0.5, `master com pico em ${r2.peak.toFixed(2)} (sem rachar)`);
  }
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} falha(s)` : 'Tudo certo.');
process.exit(fail ? 1 : 0);
