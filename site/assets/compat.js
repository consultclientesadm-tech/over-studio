// Studio Cover — o aparelho dá conta? A IA roda dentro do aparelho, então celular fraco trava ou fecha no meio.
// Mede de verdade (um teste de força de ~50 ms), lê a memória, o sistema e o modelo, e avisa a pessoa
// em todas as páginas: na página de vendas (antes de comprar), no cadastro, no obrigado e dentro do app.
// Níveis: 'ok' (não mostra nada), 'fraco' (roda no MODO LEVE: mais leve para o celular, mesmo vídeo em 1080p) e
// 'incompativel' (vermelho, só quando o navegador não tem o básico ou o aparelho é fraco demais de verdade).
// Desde 14/11 (pedido do Leo): Samsung simples e celular de 3–4 GB não são mais barrados, usam o modo leve.
// Uso: <script src="/assets/compat.js?v=4" defer></script>. Links com data-compat pedem confirmação antes de seguir.
(function () {
  if (window.scCompat) return;
  const VERSAO = 2;
  // Força medida: ~ pontos do Geekbench 6 (1 núcleo). iPhone 13 ≈ 2300; Galaxy A12/A13/A21s ≈ 350–450; Galaxy A34/A54 ≈ 1000.
  // Ajustar aqui com os números reais do painel (cada vídeo do app manda a força do aparelho no diário).
  const MIN_OK = 650;
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const mobile = ios || android || /Mobi/i.test(ua);
  const iosV = (() => { const m = ua.match(/OS (\d+)[_.](\d+)/); return ios && m ? +m[1] + +m[2] / 100 : 0; })();
  // navegador de dentro do Instagram/Facebook/TikTok: tem pouca memória e não deixa baixar o vídeo pronto (erros reais do painel)
  const inApp = /Instagram/.test(ua) ? 'Instagram' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook' : /musical_ly|BytedanceWebview|TikTok/i.test(ua) ? 'TikTok' : '';
  const mem = navigator.deviceMemory || 0; // só Chrome/Samsung/Edge; arredondado (2, 4, 8)
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const sstore = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} } };

  // Samsung de entrada (Galaxy A01–A14 4G, M01–M14, J): processador fraco, travam com a IA. A2x/A3x antigos ficam no limite.
  const modeloFraco = (m) => /\bSM-(A0\d\d|A1[0-3]\d|A145|M0\d\d|M1[0-4]\d|J\d\d\d|G53\d|G57\d|G6[01]\d|T2\d\d|T5[0-6]\d)/i.test(m) ? 2
    : /\bSM-(A2[0-3]\d|A3[0-2]\d|M2[0-3]\d|M3[0-2]\d)/i.test(m) ? 1 : 0;

  function forca() { // menor tempo de 5 voltas de um cálculo parecido com o do app (contas com números e vetores)
    const N = 1 << 15, a = new Float32Array(N), b = new Float32Array(N);
    for (let i = 0; i < N; i++) a[i] = Math.sin(i * 0.01);
    let best = 1e9, s = 0;
    for (let r = 0; r < 5; r++) {
      const t = performance.now();
      for (let k = 0; k < 12; k++) for (let i = 1; i < N - 1; i++) { const v = a[i - 1] * 0.25 + a[i] * 0.5 + a[i + 1] * 0.25; b[i] = v * Math.cos(v) + b[i] * 0.5; s += b[i]; }
      const o = {}; for (let i = 0; i < 3000; i++) o['k' + (i % 300)] = (o['k' + (i % 300)] || 0) + i;
      best = Math.min(best, performance.now() - t);
    }
    if (s === 42) console.log(s);
    return Math.round(10000 / Math.max(best, 0.5));
  }
  function recursos() {
    const f = [];
    if (typeof WebAssembly !== 'object') f.push('WebAssembly');
    if (typeof Worker !== 'function') f.push('Worker');
    try { const c = document.createElement('canvas'); if (!(c.getContext('webgl2') || c.getContext('webgl'))) f.push('WebGL'); } catch (e) { f.push('WebGL'); }
    return f;
  }

  function avaliar(score, modelo) {
    const motivos = []; let nivel = 'ok';
    const pior = (n, m) => { motivos.push(m); if (n === 'incompativel' || nivel === 'ok') nivel = n; };
    const falta = recursos();
    if (falta.length) pior('incompativel', 'O navegador não tem ' + falta.join(', ') + '.');
    if (ios && iosV && iosV < 15) pior('incompativel', 'iOS ' + Math.floor(iosV) + ' é antigo demais.');
    else if (ios && iosV && iosV < 16.4) pior('fraco', 'Atualize o iPhone (Ajustes › Geral › Atualização de Software): com iOS antigo o vídeo sai com menos qualidade.');
    if (ios && Math.min(screen.width, screen.height) <= 320) pior('incompativel', 'Este iPhone é antigo demais.');
    else if (ios && Math.min(screen.width, screen.height) === 375 && Math.max(screen.width, screen.height) === 667) pior('fraco', 'iPhone de tela pequena (8, SE ou mais antigo) pode fechar o app no meio.');
    // Android com 2 GB ou menos não aguenta; 3–4 GB roda no modo leve
    if (android && mem && mem <= 2) pior('incompativel', 'Memória pequena (' + mem + ' GB).');
    else if (android && mem && mem < 6) pior('fraco', 'Memória de ' + mem + ' GB: roda no modo leve.');
    const mf = modelo ? modeloFraco(modelo) : 0;
    if (mf) pior('fraco', 'Modelo mais simples (' + modelo + '): roda no modo leve.');
    if (score) {
      // a medida varia muito (um Galaxy S20 FE que rodou bem já mediu 141 num momento ocupado): sozinha nunca barra
      if (score < MIN_OK) pior('fraco', 'Processador mais simples: roda no modo leve.');
    }
    return { v: VERSAO, nivel, motivos, inApp, score: score || 0, mem, modelo: modelo || '', ios: iosV, mobile, leve: mobile && nivel !== 'ok', t: Date.now() };
  }

  // aparelho para a aba Alunos do painel (pedido do Leo, 14/11): o servidor lê este cookie no cadastro, no login e no app.
  // Android: o modelo de verdade (SM-A546E, Redmi Note 12…), que o Chrome esconde do user agent. iPhone: o tamanho da tela (dá a família).
  function guardaAparelho(modelo) {
    let v = '';
    if (ios) v = 'iph:' + Math.min(screen.width, screen.height) + 'x' + Math.max(screen.width, screen.height);
    else if (modelo) v = modelo;
    v = String(v).replace(/[^\w .+\-()\/:]/g, '').slice(0, 40);
    if (v) try { document.cookie = 'sc_ap=' + encodeURIComponent(v) + ';path=/;max-age=31536000;SameSite=Lax' + (location.protocol === 'https:' ? ';Secure' : ''); } catch (e) {}
  }
  if (ios) guardaAparelho('');
  let info = null;
  try { const c = JSON.parse(store.get('sc-compat') || 'null'); if (c && c.v === VERSAO && Date.now() - c.t < 14 * 864e5) info = c; } catch (e) {}
  const ready = (async () => {
    let modelo = '';
    try { if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) modelo = (await navigator.userAgentData.getHighEntropyValues(['model'])).model || ''; } catch (e) {}
    if (!modelo) { const m = ua.match(/;\s*((?:SM|GT)-[A-Z0-9]+)/i); if (m) modelo = m[1]; }
    guardaAparelho(modelo);
    await new Promise((r) => (document.readyState === 'complete' ? setTimeout(r, 300) : addEventListener('load', () => setTimeout(r, 300), { once: true })));
    let score = forca();
    if (score < MIN_OK) { await new Promise((r) => setTimeout(r, 1200)); score = Math.max(score, forca()); } // celular ocupado carregando a página: mede de novo
    if (info && info.score) score = Math.max(score, info.score); // guarda a melhor medida (evita falso alarme num momento lento)
    info = avaliar(score, modelo);
    store.set('sc-compat', JSON.stringify(info));
    return info;
  })();
  if (!info) info = avaliar(0, '');

  // ---------- avisos na tela ----------
  const LINK = 'studiocover.com.br';
  const css = `
.scc-bar{position:relative;z-index:60;display:flex;gap:10px;align-items:flex-start;margin:0;padding:12px 44px 12px 14px;font:500 13.5px/1.45 'Space Grotesk',system-ui,sans-serif;color:#fff;text-align:left;border-bottom:1px solid}
.scc-bar.incompativel{background:linear-gradient(180deg,#3a0d12,#22080b);border-color:#ff4d5e}
.scc-bar.fraco{background:linear-gradient(180deg,#2c2504,#181503);border-color:#ffd400}
.scc-bar.dentro{border:1px solid;border-radius:16px;margin:4px 0 14px}
.scc-bar b{display:block;font-size:14px}.scc-bar.incompativel b{color:#ff8a95}.scc-bar.fraco b{color:#ffd400}
.scc-bar i{font-style:normal;font-size:20px;line-height:1.2}
.scc-bar button.scc-x{position:absolute;top:8px;right:8px;width:30px;height:30px;border-radius:50%;border:0;background:#0006;color:#ccc;font-size:15px;cursor:pointer}
.scc-bar a,.scc-bar button.scc-l{color:#ffd400;background:none;border:0;padding:0;font:inherit;text-decoration:underline;cursor:pointer}
.scc-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.78);display:grid;place-items:center;padding:14px;font-family:'Space Grotesk',system-ui,sans-serif}
.scc-sh{width:100%;max-width:430px;max-height:92vh;overflow:auto;background:#0e0e12;border:1px solid #ff4d5e;border-radius:22px;padding:18px 18px;color:#f4f4f7;box-shadow:0 0 60px rgba(255,77,94,.25)}
.scc-sh h3{margin:0 0 6px;font:800 16px/1.3 Orbitron,system-ui,sans-serif;color:#ff8a95}.scc-sh p{margin:6px 0;color:#c4c4cc;font-size:14px;line-height:1.5}
.scc-sh ul{margin:6px 0;padding-left:18px;color:#c4c4cc;font-size:13.5px;line-height:1.5}
.scc-b{display:flex;width:100%;min-height:50px;align-items:center;justify-content:center;border:0;border-radius:40px;background:linear-gradient(180deg,#ffe34d,#ffc400);color:#000;font:900 13.5px Orbitron,system-ui,sans-serif;letter-spacing:.05em;margin-top:14px;cursor:pointer}
.scc-b2{display:flex;width:100%;min-height:44px;align-items:center;justify-content:center;border:1px solid #33333c;border-radius:40px;background:none;color:#ddd;font:600 14px 'Space Grotesk',system-ui,sans-serif;margin-top:10px;cursor:pointer}`;
  let estilo = false;
  const addCss = () => { if (estilo) return; estilo = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
  const copiar = (btn) => { const ok = () => { btn.textContent = 'Link copiado ✓'; }; try { navigator.clipboard.writeText('https://' + LINK).then(ok, () => prompt('Copie o link:', 'https://' + LINK)); } catch (e) { prompt('Copie o link:', 'https://' + LINK); } };
  const textos = (i) => i.nivel === 'incompativel'
    ? { t: 'Seu aparelho não é compatível com o Studio Cover', d: 'Este celular não tem força para processar o vídeo (a IA roda dentro do aparelho) e pode travar ou fechar no meio. Use pelo computador (' + LINK + ') ou por um celular mais novo.' }
    : { t: 'Seu celular usa o modo leve', d: 'O Studio Cover se ajusta ao seu celular: processa de um jeito mais leve e o vídeo sai em 1080p do mesmo jeito. Só leva um pouco mais de tempo. Feche os outros apps antes de começar.' };
  const REQ = '<ul><li>iPhone 13 ou mais novo (iOS atualizado)</li><li>Android com 3 GB de memória ou mais (celulares mais simples, como Galaxy A e M, usam o modo leve automático)</li><li>Computador com Chrome, Edge ou Safari atualizado</li></ul>';

  // abre esta mesma página no navegador de verdade (Android: Chrome direto; iPhone: instruções do Safari)
  function abrirFora() {
    const url = location.href.replace(/^https?:\/\//, '');
    if (android) { location.href = 'intent://' + url + '#Intent;scheme=https;package=com.android.chrome;end'; return; }
    addCss();
    const ov = document.createElement('div'); ov.className = 'scc-ov';
    ov.innerHTML = `<div class="scc-sh" style="border-color:#ffd400"><h3 style="color:#ffd400">Abrir no Safari</h3><p>1. Toque nos <b>três pontinhos (…)</b> no canto da tela do ${inApp}.</p><p>2. Toque em <b>Abrir no navegador</b> (ou "Abrir no Safari").</p><p>Ou copie o link e cole no Safari.</p><button type="button" class="scc-b" data-copiar>COPIAR LINK</button><button type="button" class="scc-b2" data-fechar>Fechar</button></div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-fechar]')) ov.remove(); });
    ov.querySelector('[data-copiar]').onclick = (e) => { const b = e.currentTarget; try { navigator.clipboard.writeText(location.href).then(() => (b.textContent = 'Link copiado ✓'), () => prompt('Copie o link:', location.href)); } catch (er) { prompt('Copie o link:', location.href); } };
    document.body.appendChild(ov);
  }
  function barraInApp() {
    if (!inApp || sstore.get('scc-x-inapp') || document.querySelector('.scc-bar.inapp') || !document.body) return;
    addCss();
    const el = document.createElement('div'); el.className = 'scc-bar fraco inapp' + (document.getElementById('home') ? ' dentro' : ''); el.setAttribute('role', 'alert');
    el.innerHTML = `<i>↗️</i><div><b>Abra no ${ios ? 'Safari' : 'Chrome'} para usar o Studio Cover</b>Você está no navegador do ${inApp}, que tem pouca memória e não deixa baixar o vídeo pronto. <button type="button" class="scc-l" data-fora>Abrir no ${ios ? 'Safari' : 'Chrome'}</button></div><button type="button" class="scc-x" aria-label="Fechar aviso">✕</button>`;
    el.querySelector('.scc-x').onclick = () => { el.remove(); sstore.set('scc-x-inapp', '1'); };
    el.querySelector('[data-fora]').onclick = abrirFora;
    const alvo = document.getElementById('home') || document.body; alvo.insertBefore(el, alvo.firstChild);
  }
  function barra() {
    const i = info; if (!i || i.nivel !== 'incompativel' || sstore.get('scc-x-' + i.nivel) || document.querySelector('.scc-bar') || !document.body) return;
    addCss();
    const x = textos(i), el = document.createElement('div');
    el.className = 'scc-bar ' + i.nivel + (document.getElementById('home') ? ' dentro' : ''); el.setAttribute('role', 'alert');
    el.innerHTML = `<i>${i.nivel === 'incompativel' ? '⛔' : '⚠️'}</i><div><b>${x.t}</b>${x.d} <button type="button" class="scc-l" data-req>Ver aparelhos compatíveis</button></div><button type="button" class="scc-x" aria-label="Fechar aviso">✕</button>`;
    el.querySelector('.scc-x').onclick = () => { el.remove(); sstore.set('scc-x-' + i.nivel, '1'); };
    el.querySelector('[data-req]').onclick = () => modal(false);
    const alvo = document.getElementById('home') || document.body; alvo.insertBefore(el, alvo.firstChild);
  }
  function modal(comprando) {
    return new Promise((res) => {
      addCss();
      const i = info, x = textos(i), ov = document.createElement('div'); ov.className = 'scc-ov';
      ov.innerHTML = `<div class="scc-sh" role="dialog" aria-modal="true"><h3>${i.nivel === 'ok' ? 'Aparelhos compatíveis' : (i.nivel === 'incompativel' ? '⛔ ' : '⚠️ ') + x.t}</h3>
        ${i.nivel === 'ok' ? '' : `<p>${x.d}</p>`}<p><b>Funciona bem em:</b></p>${REQ}
        ${comprando ? '<p><b>Se comprar, use pelo computador ou por um desses aparelhos.</b></p>' : ''}
        <button type="button" class="scc-b" data-copiar>COPIAR LINK P/ O COMPUTADOR</button>
        ${comprando ? '<button type="button" class="scc-b2" data-seguir>Entendi, quero continuar mesmo assim</button>' : ''}
        <button type="button" class="scc-b2" data-fechar>${comprando ? 'Voltar' : 'Fechar'}</button></div>`;
      const fim = (v) => { ov.remove(); res(v); };
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-fechar]')) fim(false); });
      ov.querySelector('[data-copiar]').onclick = (e) => copiar(e.currentTarget);
      const s = ov.querySelector('[data-seguir]'); if (s) s.onclick = () => fim(true);
      document.body.appendChild(ov);
    });
  }
  // pede confirmação antes de comprar / começar quando o aparelho não é compatível (true = pode seguir)
  async function confirmar() {
    if (info.nivel !== 'incompativel') await Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]);
    if (info.nivel !== 'incompativel') return true;
    return modal(true);
  }
  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('[data-compat]');
    if (!a || a.dataset.compatOk || info.nivel !== 'incompativel') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (await modal(true)) { a.dataset.compatOk = '1'; a.click(); setTimeout(() => delete a.dataset.compatOk, 500); }
  }, true);

  // No app e no cadastro não tem faixa no topo (espantava quem ia usar): lá fica o link discreto "Veja se o seu aparelho
  // é compatível" embaixo do envio, e a confirmação só aparece na hora de começar. A faixa fica na página de vendas e no obrigado.
  const discreto = !!document.getElementById('home') || /^\/(app|entrar)\//.test(location.pathname);
  const mostrar = () => { if (discreto) return; barra(); ready.then(() => barra()); if (/^\/obrigado\//.test(location.pathname)) barraInApp(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mostrar); else mostrar();
  window.scCompat = { get info() { return info; }, ready, confirmar, modal: () => modal(false), inApp, abrirFora };
})();
