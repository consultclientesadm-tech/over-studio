// Grava cada etapa do motor em WAV para achar defeitos. Uso: node test/stages.mjs entrada.wav pasta_saida
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [inp, dir] = process.argv.slice(2);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8094' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto('http://localhost:8094/');
  await page.waitForFunction(() => window.cover);
  const r = await page.evaluate(async (b64) => {
    const C = window.cover;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const st = await C.analyze(new File([bytes], 'in.wav'), {});
    const enc = async (chs) => { const w = new Uint8Array(await C.toWav(chs, C.SR).arrayBuffer()); let s = ''; for (let i = 0; i < w.length; i += 0x8000) s += String.fromCharCode(...w.subarray(i, i + 0x8000)); return btoa(s); };
    const mix = await C.render(st, { trim: false, fadeIn: 0, fadeOut: 0 });
    const raw = await C.mixMaster(st.voice, st.bed, C.SR, 0.2);
    const flat = await C.mixMaster(st.voice, st.bed, C.SR, 0, { voiceLift: 1 });
    return { raw: await enc(raw), flat: await enc(flat), lite: (await import('./js/studio.js')).useLite(), voice: await enc(st.voice), bed: await enc(st.bed), tuned: await enc(st.tuned), mix: await enc(mix.channels),
      notes: st.plan.map((n) => [n.start, n.end]) };
  }, fs.readFileSync(inp).toString('base64'));
  for (const k of ['voice', 'bed', 'tuned', 'mix', 'raw', 'flat']) fs.writeFileSync(`${dir}/${k}.wav`, Buffer.from(r[k], 'base64'));
  fs.writeFileSync(`${dir}/notes.json`, JSON.stringify(r.notes));
  console.log('lite:', r.lite);
} finally { await browser.close(); srv.kill(); }
