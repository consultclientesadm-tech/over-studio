// Abre a página de laboratório, processa um arquivo e tira foto da tela da afinação. Uso: node test/screens.mjs entrada saida.png
import { createRequire } from 'module';
import { spawn } from 'child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const [inp, png] = process.argv.slice(2);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8093' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[erro]', e.message));
try {
  await page.goto('http://localhost:8093/');
  await page.setInputFiles('#file', inp);
  await page.click('#go');
  await page.waitForSelector('#tuneCard:not([hidden])', { timeout: 900000 });
  console.log(await page.textContent('#status'));
  await page.locator('#tuneCard').screenshot({ path: png });
} finally { await browser.close(); srv.kill(); }
