// Roda o motor completo num áudio real e grava o resultado. Uso: node test/real.mjs entrada.wav saida.wav saida.json
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [inp, outWav, outJson] = process.argv.slice(2);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8092' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
try {
  await page.goto('http://localhost:8092/');
  await page.waitForFunction(() => window.cover);
  const t0 = Date.now();
  const r = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const st = await window.cover.analyze(new File([bytes], 'in.wav'), {});
    await window.cover.verify(st);
    const out = await window.cover.render(st, {});
    const wav = new Uint8Array(await window.cover.toWav(out.channels, out.sr).arrayBuffer());
    let s = ''; for (let i = 0; i < wav.length; i += 0x8000) s += String.fromCharCode(...wav.subarray(i, i + 0x8000));
    return { wav: btoa(s), key: st.key.name, before: st.before, after: st.after, start: out.start, end: out.end, dur: st.duration,
      lite: window.cover.SR && null, notes: st.plan.map((n) => ({ s: +n.start.toFixed(2), e: +n.end.toFixed(2), m: +n.m.toFixed(2), t: n.target })) };
  }, fs.readFileSync(inp).toString('base64'));
  fs.writeFileSync(outWav, Buffer.from(r.wav, 'base64'));
  delete r.wav;
  r.seconds = (Date.now() - t0) / 1000;
  fs.writeFileSync(outJson, JSON.stringify(r, null, 1));
  console.log(JSON.stringify({ ...r, notes: r.notes.length }));
} finally { await browser.close(); srv.kill(); }
