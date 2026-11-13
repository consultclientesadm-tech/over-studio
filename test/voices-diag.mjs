// Diagnóstico da detecção de vozes num áudio real (com a separação da IA). Uso: node test/voices-diag.mjs test/out/a.wav
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [f, save] = process.argv.slice(2);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8097' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await (await browser.newContext(process.env.MOBILE ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true } : {})).newPage();
try {
  await page.goto('http://localhost:8097/lab.html');
  await page.waitForFunction(() => window.cover);
  const r = await page.evaluate(async ([u, save]) => {
    const b = await (await fetch(u)).blob();
    const st = await window.cover.analyze(new File([b], 'in.wav', { type: 'audio/wav' }), { autoTune: false });
    const m = st.multi, hist = [0, 0, 0, 0, 0];
    for (const fr of m.frames) hist[fr.length]++;
    const sec = m.frames.map((fr) => fr.slice(1).map((p) => +p.e.toFixed(2)));
    const e2 = sec.filter((x) => x.length).map((x) => x[0]).sort((a, b) => a - b);
    const out = { voices: st.voices, hist, lines: m.lines.length, lineLens: m.lines.map((l) => l.pts.length).sort((a, b) => b - a).slice(0, 20), e2med: e2[Math.floor(e2.length / 2)] };
    // pitches por segundo (amostra) para olhar
    out.sample = m.frames.filter((_, i) => i % 22 === 0).map((fr, i) => fr.map((p) => +p.m.toFixed(1) + '/' + p.e.toFixed(2)).join(' '));
    if (save) { const v = st.voice; const wav = await window.cover.toWav(v, 44100).arrayBuffer(); const u8 = new Uint8Array(wav); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); out.wav = btoa(s); }
    return out;
  }, ['/' + f, !!save]);
  if (r.wav) { fs.writeFileSync(save, Buffer.from(r.wav, 'base64')); delete r.wav; }
  console.log(JSON.stringify(r, null, 0));
} finally { await browser.close(); srv.kill(); }
