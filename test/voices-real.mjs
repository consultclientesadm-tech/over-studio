// Vídeos reais: separa a voz (IA) e conta quantas vozes cantam. Uso: node test/voices-real.mjs test/out/a.wav [...]
// (os arquivos têm que estar dentro da pasta do app, o servidor de teste entrega pelo caminho)
import { createRequire } from 'module';
import { spawn } from 'child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const files = process.argv.slice(2);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8093' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
try {
  await page.goto('http://localhost:8093/lab.html');
  await page.waitForFunction(() => window.cover);
  for (const f of files) {
    const t0 = Date.now();
    const r = await page.evaluate(async (u) => {
      const b = await (await fetch(u)).blob();
      const st = await window.cover.analyze(new File([b], 'in.wav', { type: 'audio/wav' }), { autoTune: false });
      return { voices: st.voices, parts: st.parts ? st.parts.map((p) => p.rawNotes.length) : null, dur: st.duration };
    }, '/' + f);
    console.log(f, JSON.stringify(r), Math.round((Date.now() - t0) / 1000) + ' s');
  }
} finally { await browser.close(); srv.kill(); }
