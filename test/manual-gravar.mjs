// Grava as telas do "Manual do usuário" (vídeos curtos de cada função) usando o app de verdade no Chromium, com tela de
// celular. (O Chromium grava a tela em 1x no canto do quadro: o montar corta esse canto.) Grava a sessão inteira, marca onde começa e termina cada vídeo, as legendas e os trechos de espera (que saem
// acelerados). Depois: node tools/manual-montar.mjs pasta  →  assets/manual/*.mp4 + capas.
// Uso: node test/manual-gravar.mjs solo.mp4 dupla.mp4 pasta_saida
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [solo, dupla, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8097' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const W = 390, H = 844;
const sessions = [];

async function session(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    recordVideo: { dir: out, size: { width: W * 2, height: H * 2 } } });
  const page = await ctx.newPage();
  const T0 = Date.now();
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  page.on('pageerror', (e) => console.log('[erro]', e.message));
  const now = () => (Date.now() - T0) / 1000;
  const clips = []; let clip = null;
  const wait = (ms) => page.waitForTimeout(ms);
  const api = {
    page, wait,
    begin(id) { clip = { id, start: now(), caps: [], fast: [] }; },
    end() { clip.end = now(); clips.push(clip); clip = null; },
    say(text) { clip.caps.push({ t: now(), text }); },
    async fast(fn) { const f = [now(), 0]; clip?.fast.push(f); await fn(); f[1] = now(); },
    // círculo amarelo no ponto do toque, para a pessoa ver onde tocar
    async ring(x, y) {
      await page.evaluate(([x, y]) => {
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;border:4px solid #ffd60a;background:rgba(255,214,10,.35);z-index:99999;pointer-events:none;transition:transform .5s,opacity .5s;box-shadow:0 0 18px #ffd60a`;
        document.body.appendChild(d);
        setTimeout(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; }, 650);
        setTimeout(() => d.remove(), 1300);
      }, [x, y]);
    },
    async box(sel) { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded().catch(() => {}); return el.boundingBox(); },
    async point(sel, ms = 900) { const b = await api.box(sel); await api.ring(b.x + b.width / 2, b.y + b.height / 2); await wait(ms); },
    async tap(sel, ms = 700) { await api.point(sel, 550); await page.locator(sel).first().click(); await wait(ms); },
    async idle() { await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 900000 }); },
    async upload(file, show) {
      if (!show) return page.setInputFiles('#file', file);
      await api.tap('#drop', 1800); // aparece o aviso "Antes de escolher o vídeo"
      await api.point('.av-b', 450);
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.av-b').click()]);
      await fc.setFiles(file);
    },
    async studio() { await page.waitForFunction(() => document.getElementById('app').dataset.screen === 'studio' && !document.getElementById('quick').hidden, null, { timeout: 900000 }); },
    // posição na tela de uma nota comprida no meio do painel
    async note() {
      return page.evaluate(() => {
        const ed = window.studio.editor, p = ed.state.plan, r = ed.c.getBoundingClientRect();
        let best = -1, bl = 0;
        p.forEach((n, i) => { const x = ed.X((n.start + n.end) / 2), y = ed.Y(n.target), len = n.end - n.start; if (x > 60 && x < ed.W - 40 && y > 40 && y < ed.H - 20 && len > bl) { best = i; bl = len; } });
        const n = p[best]; return { i: best, x: r.left + ed.X((n.start + n.end) / 2), y: r.top + ed.Y(n.target) };
      });
    },
  };
  await page.goto('http://localhost:8097/');
  await wait(1200);
  try { await fn(api); } catch (e) { console.log('FALHOU', name, e.message); await page.screenshot({ path: `${out}/${name}-erro.png` }); }
  const video = page.video();
  await ctx.close();
  const path = await video.path();
  fs.renameSync(path, `${out}/${name}.webm`);
  sessions.push({ name, file: `${name}.webm`, clips });
  console.log(name, clips.map((c) => `${c.id} ${(c.end - c.start).toFixed(1)}s`).join(', '));
}

try {
  // 1) Começar: subir o vídeo e Deixar tudo pronto
  await session('a', async (s) => {
    s.begin('comecar');
    s.say('Primeiro, responda: a sua música tem instrumental ou playback? Toque em Sim ou em Não.');
    await s.wait(1600);
    await s.tap('.sn[data-sep="1"]', 1400);
    s.say('Se quiser, suba a música do cantor original. É opcional: o app afina você pela melodia dele.');
    await s.point('#refPick', 2600);
    s.say('Agora toque em Escolher o vídeo e pegue o seu cover na galeria do celular.');
    await s.wait(1000);
    await s.upload(solo, true);
    await s.wait(1500);
    s.say('A IA separa a sua voz do violão ou da base, no seu próprio celular. Deixe esta tela aberta.');
    await s.fast(() => s.studio());
    await s.wait(1000);
    s.say('Quer tudo pronto num toque só? Toque em Deixar tudo pronto.');
    await s.wait(1800);
    await s.tap('#quickAll', 300);
    s.say('O app afina, mixa, masteriza e coloca cor de cinema sozinho.');
    await s.fast(async () => { await s.page.waitForFunction(() => document.getElementById('busy').hidden && document.querySelector('.step.on')?.dataset.step === '5', null, { timeout: 900000 }); });
    await s.wait(800);
    s.say('Pronto! Agora é só gerar o vídeo final. E você ainda pode mudar qualquer etapa.');
    await s.wait(3500);
    s.end();
  });

  // 2) a 8) passo a passo, uma voz
  await session('b', async (s) => {
    await s.upload(solo, false);
    await s.studio(); await s.wait(800);
    s.begin('afinar');
    s.say('Prefere fazer com calma? Toque em Fazer passo a passo.');
    await s.wait(1500);
    await s.tap('#quickStep', 900);
    s.say('Na Afinação, toque em Afinar automático.');
    await s.wait(1200);
    await s.tap('#tuneAuto', 300);
    await s.fast(() => s.idle());
    await s.wait(500);
    s.say('Toque em ANTES para ouvir como você cantou…');
    await s.tap('#abA', 300); await s.tap('#play', 2600);
    s.say('…e em DEPOIS para ouvir a voz afinada, no mesmo ponto do vídeo.');
    await s.tap('#abB', 2800); await s.tap('#play', 400);
    s.say('Não gostou? Desfazer afinação volta a sua voz do jeito que foi gravada.');
    await s.point('#tuneUndo', 2600);
    s.end();

    s.begin('painel');
    s.say('Para mexer nota por nota, toque em Painel de afinação.');
    await s.wait(1200);
    await s.tap('#panelBtn', 1000);
    s.say('Cada bloco é uma nota da sua voz. Toque na nota que quer mudar.');
    await s.wait(1200);
    let n = await s.note();
    await s.ring(n.x, n.y); await s.wait(500); await s.page.mouse.click(n.x, n.y); await s.wait(1300);
    s.say('Use Subir e Descer para trocar a nota. A mudança já vale na hora.');
    await s.tap('#nUp', 1500);
    await s.tap('#nDown', 1500);
    s.say('Errou? Desfazer volta a última mudança. Auto devolve a nota para o automático.');
    await s.point('#undo', 1300); await s.point('#nAuto', 1300);
    s.say('Toque no ▶ para ouvir. Quando terminar, toque em Fechar painel.');
    await s.tap('#popPlay', 2200); await s.tap('#popPlay', 300);
    await s.tap('#popClose', 1500);
    s.end();

    s.begin('mix');
    s.say('Toque em Próximo para ir para Mix e master.');
    await s.wait(1000);
    await s.tap('#next', 900);
    s.say('Toque em Mixar e masterizar: voz e base juntas, no volume certo das redes.');
    await s.wait(1000);
    await s.tap('#mixApply', 300);
    await s.fast(() => s.idle());
    await s.wait(500);
    s.say('Compare: ORIGINAL, AFINADA e MIXADA.');
    await s.tap('#abA', 900); await s.tap('#abB', 900); await s.tap('#abC', 1000);
    s.say('Voz baixa ou alta demais? Gire o botão Volume da voz: arraste para cima para aumentar. O mesmo vale para a base.');
    { // gira o potenciômetro de verdade, com o dedo
      const b = await s.box('.row:has(#mVoice) .pot'); const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await s.ring(x, y); await s.wait(500);
      await s.page.mouse.move(x, y); await s.page.mouse.down();
      for (let i = 1; i <= 12; i++) { await s.page.mouse.move(x, y - i * 2.5); await s.wait(45); }
      await s.page.mouse.up();
    }
    await s.wait(500); await s.idle(); await s.wait(1200);
    await s.point('.row:has(#mBed) .pot', 1600);
    s.say('Embaixo tem mais: equalizador, compressor, reverb e fades. Role a tela para ver.');
    await s.page.evaluate(() => document.querySelector('.step.on').scrollBy({ top: 600, behavior: 'smooth' })); await s.wait(2600);
    s.end();

    s.begin('cor');
    s.say('Toque em Próximo para ir para a Cor.');
    await s.wait(900);
    await s.tap('#next', 800); await s.idle();
    s.say('Toque num filtro para escolher a cara do seu vídeo.');
    await s.wait(1000);
    await s.tap('#filters button:nth-child(4)', 1500);
    await s.tap('#filters button:nth-child(2)', 1500);
    s.say('Intensidade deixa o filtro mais forte ou mais suave. ANTES mostra o vídeo sem cor.');
    await s.point('#fAmount', 1200);
    await s.tap('#abA', 1200); await s.tap('#abB', 1400);
    s.end();

    s.begin('exportar');
    s.say('Toque em Próximo para ir para Exportar.');
    await s.wait(900);
    await s.tap('#next', 1000);
    s.say('Antes, se quiser, assista a prévia em tela cheia.');
    await s.point('#watchBtn', 1500);
    s.say('Toque em Gerar vídeo final e deixe a tela aberta até terminar.');
    await s.wait(800);
    await s.tap('#exportBtn', 300);
    await s.fast(() => s.page.waitForSelector('#ready:not([hidden])', { timeout: 900000 }));
    await s.wait(600);
    s.say('Pronto! Toque em Baixar meu vídeo pronto e poste onde quiser.');
    await s.point('#download', 2600);
    s.end();

    s.begin('ajuda');
    s.say('Ficou com dúvida num botão? Toque no ? lá em cima.');
    await s.page.click('#stepper button[data-step="2"]'); await s.wait(1200);
    await s.tap('#helpBtn', 1500);
    s.say('Agora toque em qualquer botão: o app explica o que ele faz, sem fazer nada.');
    await s.wait(800);
    await s.tap('#tuneAgain', 3000);
    await s.tap('#tipOk', 600);
    s.say('Toque no ? de novo para voltar a usar o app.');
    await s.tap('#helpBtn', 2200);
    s.end();
  });

  // 4) Dupla e trio
  await session('c', async (s) => {
    await s.page.evaluate(() => { document.getElementById('optSeparate').checked = false; });
    await s.upload(dupla, false);
    await s.studio(); await s.wait(500);
    await s.page.click('#quickStep'); await s.wait(800);
    s.begin('dupla');
    s.say('Cantou em dupla ou trio? O app percebe sozinho e separa cada voz.');
    await s.wait(2200);
    s.say('Em Quem canta?, você também escolhe na mão: 1 voz, Dupla ou Trio.');
    await s.point('#voiceBar .vpick', 2400);
    s.say('A Voz 1 é a mais aguda. Toque numa voz para ouvir e afinar só ela.');
    await s.tap('#voiceBar .vsel[data-i="1"]', 300); await s.tap('#play', 2400); await s.tap('#play', 300);
    await s.tap('#voiceBar .vsel[data-i="0"]', 300); await s.tap('#play', 2200); await s.tap('#play', 300);
    s.say('Para ouvir as vozes juntas de novo, toque em Ouvir todas as vozes juntas.');
    await s.tap('#voiceBar .vall', 1800);
    s.say('Afinar automático afina cada voz separada.');
    await s.tap('#tuneAuto', 300);
    await s.fast(() => s.idle());
    await s.wait(1200);
    s.say('Na Mix, cada voz tem o seu volume. Lá embaixo é muda.');
    await s.page.click('#next'); await s.wait(700);
    await s.point('#mVoices', 2600);
    s.end();
  });
} finally {
  fs.writeFileSync(`${out}/marcas.json`, JSON.stringify(sessions, null, 1));
  await browser.close(); srv.kill();
}
