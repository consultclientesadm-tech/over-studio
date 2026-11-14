// Confere as páginas do cliente em outra língua: abre cada uma no Chromium (fuso de Nova York) e lista o que
// ficou em português na tela. Uso: (cd site && php -S 127.0.0.1:8099 router) e depois node test/i18n.test.mjs [en] [pasta_fotos]
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const lang = process.argv[2] || 'en', dir = process.argv[3] || '';
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const PAGES = ['/', '/vsl/', '/entrar/', '/entrar/?teste', '/obrigado/', '/afiliados/', '/afiliado/', '/depoimento/', '/privacidade/', '/termos/', '/app/'];
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: lang === 'pt-pt' ? 'pt-PT' : lang, timezoneId: lang === 'en' ? 'America/New_York' : 'Europe/Paris', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route(/fonts\.(googleapis|gstatic)|connect\.facebook|cdn\.jsdelivr/, (r) => r.abort());
let total = 0; const FALTA = new Set();
for (const p of PAGES) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [erro js]', p, e.message));
  await page.goto(BASE + p + (p.includes('?') ? '&' : '?') + 'lang=' + lang, { waitUntil: 'load' }).catch((e) => console.log('  não abriu', p, e.message));
  await page.waitForTimeout(1500);
  const falta = await page.evaluate(() => Object.keys((window.scI18n && scI18n._.miss) || {}));
  falta.forEach((k) => FALTA.add(k));
  const sobra = await page.evaluate(() => {
    const PT = /[ãõçáéíóúâêôà]|\b(você|não|para|seu|sua|vídeo|voz|que|uma|da|de|dos|das|na|em|ao|pelo|pela|mais|agora|toque|aqui|isso|então|ou|já|até|sem|quando|depois|DEPOIS|ANTES|e|o|os|afinad[ao]|grátis|cantor|música)\b/;
    const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const el = n.parentElement; if (!el || el.closest('script,style,[data-noi18n],svg')) continue;
      const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t.length > 2 && PT.test(t)) out.add(t.slice(0, 140));
    }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach((e) => ['placeholder', 'title', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v && PT.test(v)) out.add('@' + a + ': ' + v); }));
    return [...out];
  });
  console.log(`${p}: ${sobra.length} em português`); sobra.slice(0, 40).forEach((t) => console.log('   ·', t)); total += sobra.length;
  if (dir) await page.screenshot({ path: `${dir}/${lang}${p.replace(/[/?=]+/g, '-')}.png` });
  await page.close();
}
await browser.close();
console.log('total em português:', total);
if (process.env.FALTA) (await import('fs')).writeFileSync(process.env.FALTA, JSON.stringify([...FALTA], null, 1));
