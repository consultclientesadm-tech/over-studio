// Tira um PNG/JPG de cada <section class="s"> do artes.html
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, 'saida'));
  const so = process.argv[3]; // filtro opcional: prefixo do id (ex.: p01)
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await pg.goto('file://' + path.join(dir, 'artes.html'), { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.fonts.ready);
  const ids = await pg.$$eval('section.s', a => a.map(e => e.id));
  for (const id of ids) {
    if (so && !id.startsWith(so)) continue;
    await pg.locator('#' + id).screenshot({ path: path.join(dir, id + '.jpg'), type: 'jpeg', quality: 93 });
  }
  await b.close();
  console.log('ok', ids.length);
})();
