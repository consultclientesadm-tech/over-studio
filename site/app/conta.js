// Studio Cover — conta do aluno dentro do app: login obrigatório, teste grátis (limite de vídeos e cobrança),
// avisos do funil, botão de instalar na tela de início (iPhone e Android) e menu da conta.
(function () {
  const api = async (a, body) => {
    const r = await fetch('/api/conta.php?a=' + a, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SC': '1' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) { location.href = '/entrar/?voltar=/app/'; throw new Error('login'); }
    return r.json();
  };
  let me = null, unread = 0, whats = '';
  // diário do app para o painel (vídeo começou, abriu, exportou, erro, fechou no meio)
  let nLog = 0;
  window.scLog = (k, d) => {
    if (++nLog > 60) return;
    const c = navigator.connection || {};
    const cp = (window.scCompat && window.scCompat.info) || {};
    const body = JSON.stringify({ k, d: { ...d, mem: navigator.deviceMemory || 0, net: c.effectiveType || '', forca: cp.score || 0, compat: cp.nivel || '', modelo: cp.modelo || '' } });
    try { fetch('/api/conta.php?a=evento', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-SC': '1' }, body }).catch(() => {}); } catch {}
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const css = `
.sc-conta{display:flex;align-items:center;gap:6px;margin-left:4px}
.sc-chip{height:30px;min-width:30px;border-radius:20px;border:1px solid #33333c;background:#111116;color:#fff;font:700 12px 'Space Grotesk',sans-serif;display:inline-flex;align-items:center;gap:6px;padding:0 9px;cursor:pointer;position:relative}
.sc-chip.y{border-color:#ffd400;color:#ffd400}
@media(max-width:430px){.sc-it{display:none}.sc-conta{gap:4px}}
.sc-ind{position:relative;height:32px;border-radius:999px;padding:0 13px 0 10px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;text-decoration:none;font:700 12.5px 'Space Grotesk',sans-serif;letter-spacing:0;color:#062417;background:linear-gradient(180deg,#5ff0b6,#22c985);border:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 2px 0 #0f7a4f,0 0 14px rgba(46,229,157,.45);animation:scInd 1.8s ease-in-out infinite;cursor:pointer}
.sc-ind svg{width:16px;height:16px;stroke-width:2.2}
.sc-ind::after{content:'';position:absolute;inset:-4px;border-radius:999px;border:2px solid rgba(46,229,157,.7);animation:scIndR 1.8s ease-out infinite;pointer-events:none}
@keyframes scInd{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 2px 0 #0f7a4f,0 0 8px rgba(46,229,157,.3)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 2px 0 #0f7a4f,0 0 22px rgba(46,229,157,.8)}}
@keyframes scIndR{0%{transform:scale(.9);opacity:.9}100%{transform:scale(1.25);opacity:0}}
@media(max-width:430px){.sc-ind{width:32px;padding:0;justify-content:center}.sc-ind .sc-it{display:none}header.top .manbtn span,header.top .brand .ver{display:none}}
.sc-indb{display:flex;align-items:center;gap:12px;width:100%;margin:12px 0 0;padding:12px 14px;border-radius:18px;text-decoration:none;color:#eafff5;background:linear-gradient(180deg,#0f2a1f,#0b1c15);border:1.5px solid rgba(46,229,157,.7);box-shadow:0 0 0 1px rgba(46,229,157,.15),0 0 22px rgba(46,229,157,.22);animation:scInd2 2s ease-in-out infinite;text-align:left}
.sc-indb i{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(180deg,#5ff0b6,#22c985);color:#062417;box-shadow:0 0 14px rgba(46,229,157,.6)}
.sc-indb i svg{width:22px;height:22px;stroke-width:2.2}
.sc-indb b{display:block;font:800 15px 'Space Grotesk',sans-serif;color:#5ff0b6}.sc-indb small{display:block;font-size:12.5px;color:#b9d9cb;margin-top:2px;line-height:1.35}
.sc-indb em{margin-left:auto;font-style:normal;font:700 22px 'Space Grotesk',sans-serif;color:#5ff0b6}
@keyframes scInd2{0%,100%{box-shadow:0 0 0 1px rgba(46,229,157,.15),0 0 10px rgba(46,229,157,.15)}50%{box-shadow:0 0 0 1px rgba(46,229,157,.35),0 0 28px rgba(46,229,157,.4)}}
.app[data-screen="home"] .sc-conta{flex:1;margin-left:8px}.app[data-screen="home"] .sc-conta .sc-chip.y{display:none}.app[data-screen="home"] .sc-ind{margin:0 auto;width:auto;padding:0 14px 0 11px}.app[data-screen="home"] .sc-ind .sc-it{display:inline}
.sc-instb{display:flex;align-items:center;gap:12px;width:100%;margin:0 0 14px;padding:14px;border-radius:18px;cursor:pointer;color:#fff7cc;background:linear-gradient(180deg,#2a2306,#171303);border:2px solid #ffd400;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 22px rgba(255,212,0,.25);animation:scInst 2s ease-in-out infinite;text-align:left;font-family:'Space Grotesk',sans-serif}
.sc-instb i{flex:none;width:48px;height:48px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(180deg,#ffe34d,#ffc400);color:#000;box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 2px 0 #8a6d00}
.sc-instb i svg{width:26px;height:26px;stroke-width:2.2}
.sc-instb b{display:block;font:800 17px 'Space Grotesk',sans-serif;color:#ffd400;line-height:1.25}.sc-instb small{display:block;font-size:14px;color:#efe3b0;margin-top:3px;line-height:1.35}
.sc-instb em{flex:none;margin-left:auto;font-style:normal;font:900 13px Orbitron,sans-serif;letter-spacing:.04em;color:#000;background:linear-gradient(180deg,#ffe34d,#ffc400);border-radius:30px;padding:12px 14px}
@media(max-width:380px){.sc-instb em{display:none}}
@keyframes scInst{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 8px rgba(255,212,0,.15)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 28px rgba(255,212,0,.45)}}
.sc-sh.sc-g p{font-size:16px}.sc-sh.sc-g .sc-ios div{font-size:16px;padding:14px}.sc-sh.sc-g .sc-b2{height:52px;font-size:16px}
.sc-av{background:#2a1a06;border:1px solid #ffb020;border-radius:14px;padding:12px 14px;margin:10px 0;color:#ffe2a8;font-size:16px;line-height:1.5}
@media(prefers-reduced-motion:reduce){.sc-ind,.sc-ind::after,.sc-indb,.sc-instb{animation:none}}
.sc-dot{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#ff4d5e;box-shadow:0 0 8px #ff4d5e}
.sc-ov{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:grid;place-items:end center;padding:12px;animation:scf .2s}
@media(min-width:700px){.sc-ov{place-items:center}}
.sc-sh{width:100%;max-width:440px;max-height:86vh;overflow:auto;background:#0e0e12;border:1px solid #2a2a32;border-radius:24px;padding:22px 20px calc(18px + env(safe-area-inset-bottom));color:#f4f4f7;font-family:'Space Grotesk',sans-serif;box-shadow:0 0 60px rgba(255,212,0,.12);animation:scu .35s cubic-bezier(.2,.8,.2,1)}
.sc-sh h3{margin:0 0 6px;font:800 18px Orbitron,sans-serif;letter-spacing:.04em}.sc-sh p{color:#a5a5b0;font-size:14px;line-height:1.55;margin:6px 0}
.sc-sh .sc-b{display:flex;width:100%;height:52px;align-items:center;justify-content:center;border:0;border-radius:40px;background:linear-gradient(180deg,#ffe34d,#ffc400);color:#000;font:900 14px Orbitron,sans-serif;letter-spacing:.06em;text-decoration:none;margin-top:14px;cursor:pointer;box-shadow:0 0 28px rgba(255,212,0,.35)}
.sc-sh .sc-b2{display:flex;width:100%;height:46px;align-items:center;justify-content:center;border:1px solid #33333c;border-radius:40px;background:none;color:#ddd;font:600 14px 'Space Grotesk',sans-serif;margin-top:10px;cursor:pointer;text-decoration:none}
.sc-x{float:right;border:0;background:#1b1b22;color:#aaa;width:32px;height:32px;border-radius:50%;font-size:16px;cursor:pointer}
.sc-li{display:flex;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid #1d1d24;font-size:14px;cursor:pointer;color:#e8e8ee;text-decoration:none}
.sc-li:last-child{border:0}.sc-li i{font-style:normal;width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:9px;background:#000;border:1px solid #26262d;color:#ffd400}.sc-li i .ic{width:18px;height:18px}
.sc-n{padding:12px;border-radius:14px;background:#14141a;margin:8px 0;border:1px solid #22222a}.sc-n b{display:block;margin-bottom:4px}.sc-n.nova{border-color:rgba(255,212,0,.5)}.sc-n small{color:#777}
.sc-ios{display:grid;gap:12px;margin:14px 0}.sc-ios div{display:flex;gap:12px;align-items:center;background:#14141a;border-radius:14px;padding:12px;font-size:14px}
.sc-ios span{flex:none;width:30px;height:30px;border-radius:50%;background:#ffd400;color:#000;font:900 14px Orbitron;display:grid;place-items:center}
.sc-ios svg{flex:none}
.sc-meter{height:8px;border-radius:8px;background:#1b1b22;overflow:hidden;margin:12px 0 4px}.sc-meter i{display:block;height:100%;background:linear-gradient(90deg,#ffd400,#2ee59d)}
.sc-toast{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top));transform:translateX(-50%);z-index:85;width:min(420px,calc(100% - 20px));background:#121217;border:1px solid rgba(255,212,0,.45);border-radius:16px;padding:12px 14px;color:#fff;font:500 14px 'Space Grotesk',sans-serif;box-shadow:0 10px 40px #000a;animation:scd .4s cubic-bezier(.2,.8,.2,1);cursor:pointer}
.sc-toast b{color:#ffd400;display:block;font-size:13px;margin-bottom:2px}
.sc-bar{position:fixed;left:0;right:0;bottom:0;z-index:70;display:flex;align-items:center;gap:10px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(20,18,4,.96),rgba(8,8,10,.98));border-top:1px solid rgba(255,212,0,.55);box-shadow:0 -10px 40px rgba(255,212,0,.15);color:#fff;font:600 13.5px 'Space Grotesk',sans-serif;cursor:pointer;animation:scu .45s cubic-bezier(.2,.8,.2,1)}
.sc-bar p{flex:1;margin:0;line-height:1.3;transition:opacity .35s}.sc-bar p.f{opacity:0}
.sc-bar button{flex:none;height:40px;padding:0 16px;border:0;border-radius:30px;background:linear-gradient(180deg,#ffe34d,#ffc400);color:#000;font:900 12px Orbitron,sans-serif;letter-spacing:.05em;cursor:pointer;animation:scp 1.6s ease-in-out infinite}
@keyframes scp{0%,100%{box-shadow:0 0 0 0 rgba(255,212,0,.6)}50%{box-shadow:0 0 0 9px rgba(255,212,0,0)}}
.sc-marca{align-self:start;justify-self:end;margin:10px;z-index:4;pointer-events:none;font:700 10.5px 'Space Grotesk',sans-serif;letter-spacing:.08em;color:#ffd400;background:rgba(0,0,0,.55);border:1px solid rgba(255,212,0,.5);border-radius:20px;padding:5px 10px}
body.sc-tem-bar{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
.sc-dor{background:#1a1406;border:1px solid rgba(255,212,0,.35);border-radius:14px;padding:12px 14px;margin:12px 0;color:#ffe9a0;font-weight:600;font-size:14.5px;line-height:1.45}
.sc-preco{text-align:center;margin:14px 0 0}.sc-preco b{display:block;font:900 30px Orbitron,sans-serif;color:#ffd400;text-shadow:0 0 22px rgba(255,212,0,.35)}.sc-preco small{color:#9a9aa6;font-size:12.5px}
.sc-ul{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:7px;font-size:14px;color:#dcdce4}.sc-ul li:before{content:'✓ ';color:#2ee59d;font-weight:900}
@keyframes scf{from{opacity:0}}@keyframes scu{from{transform:translateY(40px);opacity:0}}@keyframes scd{from{transform:translate(-50%,-30px);opacity:0}}
`;
  const I = (n) => (window.ic ? window.ic(n) : '');
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function sheet(html, onClose, cls) {
    const ov = document.createElement('div'); ov.className = 'sc-ov';
    ov.innerHTML = `<div class="sc-sh${cls ? ' ' + cls : ''}" role="dialog" aria-modal="true"><button class="sc-x" aria-label="Fechar">✕</button>${html}</div>`;
    const close = () => { ov.remove(); onClose && onClose(); };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.sc-x,[data-fechar]')) close(); });
    document.body.appendChild(ov); return { el: ov, close };
  }

  // ---------- instalar ----------
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const android = /Android/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; try { e.userChoice.catch(() => {}); } catch {} render(); });
  const shareIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b9cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const addIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/></svg>';
  // por que instalar: instalado, o app abre sozinho (sem o navegador do Instagram, tradutor, extensões ou outras
  // abas disputando a memória), que é de onde vem a maioria dos travamentos que a vistoria pega
  const porque = '<div class="sc-dor" style="margin:10px 0">Pelo ícone da tela de início o Studio Cover <b>trava bem menos</b>: abre sozinho, com a memória do celular só para ele, sem o navegador do Instagram, tradutor ou outras abas atrapalhando.</div>';
  const mobile = ios || android;
  window.scInstalar = () => install(true); // o aviso de erro do app (navegador falhou) abre o passo a passo de instalar
  async function install(forte) {
    forte = forte === true;
    // o Chrome só abre a janela de instalar com um toque da pessoa; sem toque (oferta automática) cai nas instruções abaixo
    const toque = !navigator.userActivation || navigator.userActivation.isActive;
    if (deferred && toque) {
      try { await deferred.prompt(); const r = await deferred.userChoice; deferred = null; render(); if (r.outcome === 'accepted') toast('Pronto!', 'O Studio Cover está na sua tela de início. Use sempre pelo ícone.'); return; } catch (e) {}
    }
    const titulo = (onde) => forte ? `<h3>Importante: instale o app ${onde}</h3>` : `<h3>Instale o app ${onde}</h3>`;
    const inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|; wv\)/.test(navigator.userAgent);
    const nomeApp = esc((window.scCompat && window.scCompat.inApp) || 'Instagram');
    const fechar = '<button class="sc-b2" data-fechar>Entendi, fechar</button>';
    const copiar = (s) => { const b = s.el.querySelector('[data-copiar]'); if (!b) return; b.onclick = async () => {
      const u = 'https://' + location.host + '/app/?instalar=1';
      try { await navigator.clipboard.writeText(u); b.textContent = 'LINK COPIADO'; } catch { prompt('Copie o link:', u); } }; };
    if (ios) {
      const safari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent) && !inApp;
      const fora = inApp
        ? `<div class="sc-av"><b>Você está dentro do ${nomeApp}.</b> Por aqui não dá para instalar. Toque nos <b>três pontinhos</b> (em cima, à direita) e em <b>Abrir no navegador externo</b>. Se não aparecer, toque em <b>Copiar o link</b> aqui embaixo, abra o <b>Safari</b> e cole o link.</div><button class="sc-b" data-copiar>COPIAR O LINK</button>`
        : safari ? '' : `<div class="sc-av">No iPhone, o jeito mais fácil é pelo <b>Safari</b>. Toque em <b>Copiar o link</b>, abra o Safari e cole o link.</div><button class="sc-b" data-copiar>COPIAR O LINK</button>`;
      copiar(sheet(`${titulo('no iPhone')}<p>Deixe o Studio Cover na tela de início, igual a um aplicativo, e abra sempre por ele.</p>${fora}
        <div class="sc-ios"><div><span>1</span>${shareIcon}<p style="margin:0">No Safari, toque em <b>Compartilhar</b> (o quadrado com a seta para cima). Se não aparecer, toque antes nos <b>três pontinhos</b> da barra.</p></div>
        <div><span>2</span>${addIcon}<p style="margin:0">Role a lista e toque em <b>Adicionar à Tela de Início</b></p></div>
        <div><span>3</span><img src="/assets/icon-180.png?v=2" width="26" height="26" style="border-radius:6px" alt=""><p style="margin:0">Toque em <b>Adicionar</b>. Depois, abra sempre pelo ícone amarelo do Studio Cover.</p></div></div>
        ${porque}${fechar}`, null, 'sc-g'));
      return;
    }
    const chrome = /Chrome\//.test(navigator.userAgent) && !/SamsungBrowser|EdgA|OPR|MiuiBrowser|YaBrowser/.test(navigator.userAgent) && !inApp;
    const abrirChrome = 'intent://' + location.host + '/app/?instalar=1#Intent;scheme=https;package=com.android.chrome;end';
    const fora = inApp
      ? `<div class="sc-av"><b>Você está dentro do ${nomeApp}.</b> Por aqui não dá para instalar. Toque no botão abaixo para abrir no <b>Chrome</b> (ou nos <b>três pontinhos</b> e em <b>Abrir no Chrome</b>).</div><a class="sc-b" href="${abrirChrome}">ABRIR NO CHROME</a>`
      : chrome || !android ? '' : `<div class="sc-av">Para instalar, abra no <b>Chrome</b>:</div><a class="sc-b" href="${abrirChrome}">ABRIR NO CHROME</a>`;
    sheet(`${titulo(android ? 'no Android' : 'no computador')}<p>Deixe o Studio Cover na tela de início, igual a um aplicativo, e abra sempre por ele.</p>${fora}
      <div class="sc-ios"><div><span>1</span><p style="margin:0">No Chrome, toque nos <b>três pontinhos</b> (em cima, à direita)</p></div>
      <div><span>2</span>${addIcon}<p style="margin:0">Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b></p></div>
      <div><span>3</span><img src="/assets/icon-180.png?v=2" width="26" height="26" style="border-radius:6px" alt=""><p style="margin:0">Confirme em <b>Instalar</b>. Depois, abra sempre pelo ícone amarelo do Studio Cover.</p></div></div>
      ${porque}${fechar}`, null, 'sc-g');
  }
  // cliente pago usando pelo navegador do celular: lembra de instalar (bem visível), no máximo 1 vez a cada 12 h
  function lembraInstalar(ja) {
    if (standalone || !mobile || !me || !me.paid) return;
    try { if (!ja && sessionStorage.getItem('sc-inst-s')) return; } catch {}
    try { const t = +localStorage.getItem('sc-inst-pago') || 0; if (!ja && Date.now() - t < 12 * 3600e3) return; localStorage.setItem('sc-inst-pago', String(Date.now())); } catch {}
    if (document.querySelector('.sc-ov') || document.querySelector('[data-screen="work"]')) return;
    install(true);
  }

  // ---------- teste grátis e cobrança ----------
  const precoHtml = () => {
    if (me.preco_fmt) return `<div class="sc-preco"><b>${esc(me.preco_fmt)}</b><small>1 ano de acesso</small></div>`; // fora do Brasil (dólar ou euro)
    const n = +me.installments || 0, v = me.installment_value;
    if (n > 1 && v) return `<div class="sc-preco"><small>${n}x de</small><b>R$ ${esc(v)}</b><small>ou R$ ${esc(me.price)} à vista · 1 ano de acesso</small></div>`;
    return me.price ? `<div class="sc-preco"><b>R$ ${esc(me.price)}</b><small>1 ano de acesso</small></div>` : '';
  };
  function paywall() {
    const url = me.checkout_url || '/#comprar';
    sheet(`<h3>Seu próximo cover está travado</h3>
      <p>Você ouviu como a sua voz fica afinada e mixada. Sem o Studio Cover, o próximo vídeo volta a ser o áudio cru do celular: aquela nota que escapa, a voz embolada na base, o som baixinho.</p>
      <div class="sc-dor">Amanhã você vai postar mais um cover desafinado... ou vai postar com som de estúdio?</div>
      <ul class="sc-ul"><li>Covers ilimitados, direto do celular</li><li>Afinação natural, sem voz de robô</li><li>Mix e master na hora, sem pagar estúdio</li><li>Cor de cinema e exportação na qualidade original</li></ul>
      ${precoHtml()}<a class="sc-b" href="${esc(url)}" target="_blank" rel="noopener">LIBERAR MEU ACESSO AGORA</a>
      <p style="font-size:12.5px;text-align:center">O acesso libera sozinho nesta mesma conta (${esc(me.email)}) assim que o pagamento cair. O vídeo que você testou fica guardado neste aparelho e sai pronto para baixar.</p>
      <button class="sc-b2" data-fechar>Agora não</button>`).el.querySelector('.sc-b').addEventListener('click', vigiaCompra);
  }
  // barra fixa que acompanha quem já usou o teste grátis
  const DORES = ['Seu próximo cover está travado.', 'Amanhã você vai postar mais um cover desafinado?', 'Aquela nota que escapou não precisa ir para o ar.', 'Estúdio cobra R$ 150 por música. Aqui é ilimitado.', 'Quantos covers vão ficar parados na galeria?'];
  let barTimer = null;
  function bar() {
    const preso = me && me.trial && !me.paid && !me.can_use;
    let el = document.querySelector('.sc-bar');
    if (!preso) { el?.remove(); document.body.classList.remove('sc-tem-bar'); clearInterval(barTimer); return; }
    if (el) return;
    el = document.createElement('div'); el.className = 'sc-bar'; el.setAttribute('role', 'button');
    el.innerHTML = `<p>${DORES[0]}</p><button>LIBERAR</button>`;
    el.onclick = paywall; document.body.appendChild(el); document.body.classList.add('sc-tem-bar');
    let i = 0; const p = el.querySelector('p');
    barTimer = setInterval(() => { p.classList.add('f'); setTimeout(() => { i = (i + 1) % DORES.length; p.textContent = DORES[i]; p.classList.remove('f'); }, 350); }, 5500);
  }
  window.scGate = async (file) => {
    if (!me) return false;
    if (window.scCompat && !(await window.scCompat.confirmar())) return false; // aparelho incompatível: avisa antes de gastar o teste
    if (window.scCompat && window.scCompat.inApp && !(() => { try { return sessionStorage.getItem('sc-inapp-ok'); } catch (e) { return null; } })()) { // navegador do Instagram/Facebook: costuma fechar no meio e não deixa baixar
      const ok = await new Promise((res) => {
        const nav = ios ? 'Safari' : 'Chrome';
        const s = sheet(`<h3>Abra no ${nav} antes de começar</h3><p>Você está no navegador do ${esc(window.scCompat.inApp)}. Ele tem pouca memória (o vídeo pode parar no meio) e não deixa baixar o vídeo pronto.</p>
          <button class="sc-b" data-fora>ABRIR NO ${nav.toUpperCase()}</button><button class="sc-b2" data-mesmo>Tentar aqui mesmo assim</button>`, () => res(false));
        s.el.querySelector('[data-fora]').onclick = () => { s.close(); window.scCompat.abrirFora(); };
        s.el.querySelector('[data-mesmo]').onclick = () => { try { sessionStorage.setItem('sc-inapp-ok', '1'); } catch (e) {} s.el.remove(); res(true); };
      });
      if (!ok) return false;
    }
    const audio = /^audio\//.test(file.type) || /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(file.name || '');
    try {
      const j = await api('usar', { tipo: audio ? 'audio' : 'video', mb: Math.round(file.size / 1048576) });
      if (j.paywall) { me = j.user; render(); paywall(); return false; }
      if (j.user) { me = j.user; render(); }
      const rd = j.restam_depois;
      if (me.trial && !me.paid) toast('Teste grátis', rd ? `Você ainda tem ${rd} vídeo${rd > 1 ? 's' : ''} grátis depois deste.` : 'Este é o seu vídeo grátis: você vê e ouve o antes e depois aqui no app. Para baixar, é só liberar o acesso completo.');
      return true;
    } catch (e) { return e.message !== 'login'; } // sem internet: deixa usar (o processamento é no aparelho)
  };

  // o vídeo abriu no estúdio (a pessoa já vê e ouve o antes e depois): aqui desconta o vídeo do teste grátis.
  // Se der erro antes de abrir, a pessoa não perde o teste. No teste ela usa tudo, mas só baixa depois de comprar.
  window.scOk = async () => { marca(); try { const j = await api('consumir', {}); if (j.user) { me = j.user; render(); } } catch (e) {} };
  // pessoa no teste (sem compra e sem download de presente): o app guarda o vídeo para ele sair pronto depois da compra
  window.scTeste = () => !!(me && !me.paid && !(me.baixar_livre > 0) && !liberado);
  // selo discreto de prévia sobre o vídeo do teste (some quando libera o acesso)
  function marca() {
    const v = document.getElementById('viewer'); if (!v) return;
    let m = document.querySelector('.sc-marca');
    if (!window.scTeste()) { m?.remove(); return; }
    if (!m) { m = document.createElement('div'); m.className = 'sc-marca'; m.textContent = 'PRÉVIA · TESTE GRÁTIS'; v.appendChild(m); }
  }

  // vídeo ficou pronto (prévia na tela): quem está no teste já vê a oferta, sem esperar baixar
  window.scPronto = () => {
    if (!me || !me.trial || me.paid) return;
    setTimeout(() => {
      if (document.querySelector('.sc-ov')) return;
      const url = me.checkout_url || '/#comprar';
      const s = sheet(`<h3>Ficou com som de estúdio</h3>
        <p>Essa é a sua voz afinada e mixada, do jeito que vai para o ar. Toque no play e compare o antes e o depois.</p>
        <p>Para <b>baixar este vídeo</b> e fazer todos os próximos assim, libere o acesso completo: sem limite de vídeos, sem pagar estúdio.</p>
        <ul class="sc-ul"><li>Baixe este cover na hora, sem refazer</li><li>Covers ilimitados, direto do celular</li><li>Afinação natural, mix, master e cor de cinema</li></ul>
        ${precoHtml()}<a class="sc-b" href="${esc(url)}" target="_blank" rel="noopener" data-compra>LIBERAR E BAIXAR MEU COVER</a>
        <button class="sc-b2" data-fechar>Primeiro quero ver o antes e depois</button>`);
      s.el.querySelector('[data-compra]').addEventListener('click', vigiaCompra);
    }, 9000);
  };
  // ---------- baixar: no teste só baixa quem comprou ----------
  let liberado = false, vigia = null;
  const ofertaAberta = () => document.querySelector('.sc-ov [data-baixar-oferta]');
  // a pessoa foi para o checkout: confere o pagamento a cada 5 s (até 30 min) para liberar o download aqui mesmo, sem refazer o vídeo
  function vigiaCompra() {
    clearInterval(vigia); const ate = Date.now() + 30 * 60000;
    vigia = setInterval(async () => {
      if (Date.now() > ate || !me || me.paid) { clearInterval(vigia); return; }
      try { const r = await api('me'); if (r.user && r.user.paid) { clearInterval(vigia); me = r.user; pagou(); } } catch (e) {}
    }, 5000);
  }
  // pagamento caiu com o vídeo ainda aberto: libera o download na hora
  function pagou() {
    render(); marca();
    window.scLog && window.scLog('liberou', {});
    if (ofertaAberta()) return; // a própria oferta troca para o botão de baixar
    if (document.getElementById('viewer') && document.querySelector('[data-screen="studio"]')) toast('Acesso liberado!', 'Agora é só tocar em Baixar: o seu vídeo sai na hora.');
    else if (window.scVideoGuardado) guardadoDepoisDaCompra();
    setTimeout(() => lembraInstalar(true), 2500); // acabou de comprar: ensina a instalar (se nada estiver aberto na tela)
  }
  function ofertaBaixar(oQue) {
    return new Promise((res) => {
      const url = me.checkout_url || '/#comprar';
      const s = sheet(`<div data-baixar-oferta><h3>Seu cover está pronto para baixar</h3>
        <p>No teste grátis você vê e ouve o antes e depois aqui no app. Para baixar ${oQue} e postar, libere o acesso completo.</p>
        <ul class="sc-ul"><li>Baixa <b>este mesmo vídeo</b> na hora, sem refazer</li><li>Covers ilimitados por 1 ano, direto do celular</li><li>Afinação natural, mix, master e cor de cinema</li></ul>
        ${precoHtml()}<a class="sc-b" href="${esc(url)}" target="_blank" rel="noopener" data-compra>LIBERAR E BAIXAR AGORA</a>
        <p style="font-size:12.5px;text-align:center" data-espera>Depois de pagar, volte para esta tela: o download libera aqui mesmo, sozinho.</p>
        <button class="sc-b2" data-fechar>Agora não</button></div>`, () => { clearInterval(tick); res(false); });
      s.el.querySelector('[data-compra]').addEventListener('click', () => { vigiaCompra(); s.el.querySelector('[data-espera]').innerHTML = 'Esperando o pagamento… Pix e cartão liberam em segundos. <b>Não feche esta tela.</b>'; });
      // pagou com a oferta aberta: troca o conteúdo por um botão de baixar (o toque da pessoa garante o download no iPhone)
      const tick = setInterval(() => {
        if (!me || !me.paid) return; clearInterval(tick);
        const box = s.el.querySelector('[data-baixar-oferta]');
        box.innerHTML = `<h3>Pagamento confirmado!</h3><p>Seu acesso completo está liberado nesta conta. Toque para baixar o seu cover.</p><button class="sc-b" data-ja>BAIXAR AGORA</button>`;
        box.querySelector('[data-ja]').onclick = () => { s.el.remove(); res(true); };
      }, 700);
    });
  }
  // navegador do Instagram/Facebook: costuma não deixar salvar o arquivo no celular
  const avisoInApp = () => new Promise((res) => {
    const app = window.scCompat && window.scCompat.inApp;
    if (!app) return res(true);
    const nav = ios ? 'Safari' : 'Chrome';
    const s = sheet(`<h3>Baixe pelo ${nav}</h3><p>O navegador do ${esc(app)} costuma não deixar salvar o vídeo pronto no celular.</p>
      <p>Se não salvar, abra o Studio Cover no ${nav}, entre com a mesma conta e faça de novo: com o acesso completo os vídeos são ilimitados.</p>
      <button class="sc-b" data-fora>ABRIR NO ${nav.toUpperCase()}</button><button class="sc-b2" data-aqui>Tentar baixar aqui mesmo</button>`, () => res(false));
    s.el.querySelector('[data-fora]').onclick = () => { s.el.remove(); res(false); window.scCompat.abrirFora(); };
    s.el.querySelector('[data-aqui]').onclick = () => { s.el.remove(); res(true); };
  });
  // o app chama antes de baixar o vídeo, o áudio ou só a voz/base
  window.scAntesExportar = async (oQue = 'o vídeo pronto') => {
    if (!me) return true; // versão sem conta
    if (me.paid || liberado) return avisoInApp();
    try {
      const j = await api('baixar', {});
      if (j.user) { me = j.user; render(); }
      if (j.ok) { liberado = true; marca(); if (j.presente) toast('Download de presente', 'Obrigado pelo seu depoimento! Este vídeo está liberado para baixar.'); return avisoInApp(); }
    } catch (e) { if (e.message === 'login') return false; }
    window.scLog && window.scLog('quisbaixar', { oque: oQue.slice(0, 30) });
    const ok = await ofertaBaixar(oQue);
    if (ok) return avisoInApp();
    return false;
  };
  // comprou depois de fechar a tela (o celular recarregou a página): o vídeo do teste ficou guardado no aparelho
  async function guardadoDepoisDaCompra() {
    if (!me.paid || !window.scVideoGuardado || document.querySelector('.sc-ov')) return;
    const nome = await window.scVideoGuardado(); if (!nome) return;
    const s = sheet(`<h3>Acesso liberado!</h3><p>O vídeo que você testou (<b>${esc(nome)}</b>) ficou guardado neste aparelho. Toque abaixo e ele sai pronto de novo, afinado, mixado e com cor de cinema, para você baixar.</p>
      <button class="sc-b" data-refaz>FAZER E BAIXAR MEU VÍDEO</button><button class="sc-b2" data-fechar>Agora não</button>`);
    s.el.querySelector('[data-refaz]').onclick = () => { s.el.remove(); window.scRefazerGuardado(); };
  }

  // ---------- avisos ----------
  function toast(title, body, onClick) {
    document.querySelector('.sc-toast')?.remove();
    const t = document.createElement('div'); t.className = 'sc-toast'; t.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
    t.onclick = () => { t.remove(); onClick && onClick(); };
    document.body.appendChild(t); setTimeout(() => t.remove(), 6500);
  }
  async function avisos() {
    let j;
    try { j = await api('avisos'); } catch (e) { if (e.message !== 'login') toast('Sem conexão', 'Não deu para abrir os avisos agora. Confira a internet e tente de novo.'); return; }
    const items = (j.items || []).map((n) => `<div class="sc-n ${n.read_at ? '' : 'nova'}"><b>${esc(n.title)}</b>${esc(n.body)}${n.url ? `<br><a href="${esc(n.url)}" style="color:#ffd400">Abrir →</a>` : ''}<br><small>${esc(n.created_at.slice(0, 16).split(' ').reverse().join(' · ').replace(/(\d{4})-(\d\d)-(\d\d)/, '$3/$2'))}</small></div>`).join('');
    sheet(`<h3>Avisos</h3>${items || '<p>Nenhum aviso por enquanto.</p>'}`);
    if (unread) { api('lido', {}).catch(() => {}); unread = 0; render(); }
  }

  // ---------- notificação no celular ----------
  const podePush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && (!ios || standalone);
  async function ativarPush() {
    try {
      if (Notification.permission === 'denied') { toast('Avisos bloqueados', 'Libere as notificações do Studio Cover nos ajustes do celular.'); return false; }
      const perm = await Notification.requestPermission(); if (perm !== 'granted') return false;
      const reg = await navigator.serviceWorker.register('/app/push-sw.js', { scope: '/app/avisos/' });
      await navigator.serviceWorker.ready.catch(() => {}); if (!reg.active) await new Promise((r) => { const w = reg.installing || reg.waiting; if (!w) return r(); w.addEventListener('statechange', () => w.state === 'activated' && r()); setTimeout(r, 4000); });
      const { chave } = await api('push-chave');
      const key = Uint8Array.from(atob(chave.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (chave.length % 4)) % 4)), (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      await api('push-salvar', { sub: sub.toJSON() });
      try { localStorage.setItem('sc-push', '1'); } catch {}
      toast('Avisos ligados', 'Você vai receber as novidades do Studio Cover aqui no celular.'); render(); return true;
    } catch (e) { toast('Não deu para ligar os avisos', 'Tente de novo pelo menu da conta.'); return false; }
  }
  const pushLigado = () => podePush && Notification.permission === 'granted' && (() => { try { return localStorage.getItem('sc-push') === '1'; } catch { return false; } })();
  // renova a inscrição em silêncio (o celular às vezes troca o endereço)
  async function pushRenova() {
    if (!pushLigado()) return;
    try { const reg = await navigator.serviceWorker.getRegistration('/app/avisos/'); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) api('push-salvar', { sub: sub.toJSON() }).catch(() => {}); else ativarPush(); } catch {}
  }
  function convitePush() {
    if (!podePush || Notification.permission !== 'default') return;
    try { const t = +localStorage.getItem('sc-push-perg') || 0; if (Date.now() - t < 3 * 86400000) return; localStorage.setItem('sc-push-perg', String(Date.now())); } catch {}
    const s = sheet(`<h3>Ligar os avisos?</h3><p>Receba no celular as dicas, novidades e avisos da sua conta do Studio Cover.</p>
      <button class="sc-b" data-sim>LIGAR AVISOS</button><button class="sc-b2" data-fechar>Agora não</button>`);
    s.el.querySelector('[data-sim]').onclick = () => { s.close(); ativarPush(); };
  }

  // ---------- menu ----------
  function menu() {
    const trial = me.trial && !me.paid;
    const n = Math.max(0, me.trial_left);
    sheet(`<h3>${esc(me.name || 'Minha conta')}</h3><p style="margin-top:0">${esc(me.email)}</p>
      ${trial ? `<div class="sc-n nova"><b>Teste grátis: ${n} vídeo${n === 1 ? '' : 's'} restante${n === 1 ? '' : 's'}</b>No teste você vê e ouve o antes e depois. Libere o acesso completo para baixar os seus vídeos e fazer quantos covers quiser.<a class="sc-b" href="${esc(me.checkout_url || '/#comprar')}" target="_blank" rel="noopener">LIBERAR ACESSO COMPLETO</a></div>` : me.paid ? `<div class="sc-n"><b style="color:#2ee59d">✓ Acesso completo</b>${me.expires_at ? 'Válido até ' + esc(me.expires_at.slice(0, 10).split('-').reverse().join('/')) : 'Vitalício'}</div>` : ''}
      ${(me.afiliado ? `<a class="sc-li" href="/afiliado/?de=app"><i>${I('money')}</i>Meu painel de afiliado</a>` : `<a class="sc-n" href="/afiliados/?utm_source=app&utm_medium=menu" style="display:block;text-decoration:none;color:inherit;border-color:rgba(46,229,157,.45)"><b style="color:#2ee59d">Indique e ganhe</b>Indique o Studio Cover para outros cantores e ganhe perto de R$ 140 por assinatura, também nas renovações. <u style="color:#ffd400">Ver como funciona →</u></a>`)}
      <a class="sc-li" data-m="avisos"><i>${I('bell')}</i>Avisos ${unread ? `<b style="color:#ffd400">(${unread})</b>` : ''}</a>
      ${standalone ? '' : `<a class="sc-li" data-m="instalar"><i>${I('install')}</i>Instalar na tela de início</a>`}
      ${podePush && !pushLigado() ? `<a class="sc-li" data-m="push"><i>${I('bell')}</i>Ligar avisos no celular</a>` : ''}
      ${whats ? `<a class="sc-li" href="https://wa.me/${esc(whats.replace(/\D/g, ''))}" target="_blank" rel="noopener"><i>${I('chat')}</i>Suporte no WhatsApp</a>` : ''}
      <a class="sc-li" data-m="aparelho"><i>${I('phone')}</i>Meu aparelho é compatível?</a>
      <a class="sc-li" data-m="dados"><i>${I('lock')}</i>Privacidade e meus dados</a>
      <a class="sc-li" data-m="sair"><i>${I('logout')}</i>Sair da conta</a>`);
    document.querySelectorAll('.sc-li[data-m]').forEach((a) => (a.onclick = async () => {
      document.querySelector('.sc-ov')?.remove();
      if (a.dataset.m === 'avisos') avisos();
      if (a.dataset.m === 'instalar') install();
      if (a.dataset.m === 'push') ativarPush();
      if (a.dataset.m === 'sair') { await api('sair', {}).catch(() => {}); location.href = '/entrar/'; }
      if (a.dataset.m === 'aparelho') aparelho();
      if (a.dataset.m === 'dados') meusDados();
    }));
  }

  async function aparelho() {
    const c = window.scCompat; if (!c) return;
    const i = await c.ready.catch(() => c.info);
    if (i.nivel !== 'ok') return c.modal();
    sheet(`<h3>✓ Aparelho compatível</h3><p>Testamos este aparelho e ele dá conta do Studio Cover. Dica: feche outros apps antes de processar vídeos longos.</p><button class="sc-b2" data-fechar>Fechar</button>`);
  }
  // LGPD: ver a política, baixar uma cópia dos dados, sair dos e-mails, apagar a conta
  function meusDados() {
    const s = sheet(`<h3>Privacidade e meus dados</h3>
      <p>Seus vídeos nunca saem do seu aparelho: todo o processamento acontece aqui. Guardamos só o necessário para a sua conta funcionar (nome, e-mail, compras e o uso do app).</p>
      <a class="sc-li" href="/privacidade/?de=app"><i>${I('doc')}</i>Política de privacidade</a>
      <a class="sc-li" href="/termos/?de=app"><i>${I('doc')}</i>Termos de uso</a>
      <a class="sc-li" href="/api/conta.php?a=meus-dados" download="meus-dados-studio-cover.json"><i>${I('download')}</i>Baixar uma cópia dos meus dados</a>
      <a class="sc-li" data-apagar><i>${I('trash')}</i><span style="color:#ff8a95">Apagar minha conta</span></a>`);
    s.el.querySelector('[data-apagar]').onclick = () => { s.close(); apagar(); };
  }
  function apagar() {
    const s = sheet(`<h3>Apagar minha conta</h3>
      <p>Isto apaga o seu nome, e-mail, senha, avisos e o histórico do app, e você perde o acesso na hora. Não dá para desfazer.</p>
      ${me.paid ? '<p><b>Você tem a assinatura ativa.</b> Apagar a conta não cancela a cobrança: cancele a renovação na Eduzz (no e-mail da compra, ou em "Minhas compras" da Eduzz) antes de apagar.</p>' : ''}
      <p style="font-size:12.5px">Os registros de compra ficam guardados pelo prazo da lei (obrigação fiscal), sem o seu nome.</p>
      <input type="password" id="scApSenha" placeholder="Digite a sua senha para confirmar" autocomplete="current-password" style="width:100%;height:48px;border-radius:14px;border:1px solid #33333c;background:#0b0b0f;color:#fff;font:500 16px 'Space Grotesk',sans-serif;padding:0 14px;margin-top:8px">
      <p id="scApMsg" style="color:#ff8a95;min-height:18px"></p>
      <button class="sc-b" data-ok style="background:#ff4d5e;color:#fff">APAGAR MINHA CONTA</button><button class="sc-b2" data-fechar>Cancelar</button>`);
    s.el.querySelector('[data-ok]').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { const j = await api('apagar-conta', { senha: s.el.querySelector('#scApSenha').value }); if (j.ok) { location.href = '/entrar/?apagada'; return; } s.el.querySelector('#scApMsg').textContent = j.error || 'Não deu certo.'; }
      catch { s.el.querySelector('#scApMsg').textContent = 'Sem conexão.'; }
      b.disabled = false;
    };
  }

  function render() {
    const top = document.querySelector('header.top'); if (!top || !me) return;
    let box = document.querySelector('.sc-conta');
    if (!box) { box = document.createElement('div'); box.className = 'sc-conta'; top.appendChild(box); }
    const trial = me.trial && !me.paid;
    box.innerHTML = `${!standalone && (deferred || ios || android) ? `<button class="sc-chip y" data-i aria-label="Instalar">${I('install')}<span class="sc-it"> Instalar</span></button>` : ''}
      ${trial ? (me.can_use ? `<button class="sc-chip y" data-t title="Testes grátis que faltam">${I('ticket')} ${Math.max(0, me.trial_left)}</button>` : `<button class="sc-chip y" data-t title="Liberar acesso">${I('lock')} Liberar</button>`) : ''}
      <a class="sc-ind" href="${me.afiliado ? '/afiliado/?de=app' : '/afiliados/?utm_source=app&utm_medium=topo'}" title="Indique e ganhe" aria-label="Indique e ganhe">${I('gift')}<span class="sc-it">Indique e ganhe</span></a>
      <button class="sc-chip" data-c aria-label="Minha conta">${esc((me.name || me.email || '?').trim()[0].toUpperCase())}${unread ? '<span class="sc-dot"></span>' : ''}</button>`;
    box.querySelector('[data-i]')?.addEventListener('click', install);
    box.querySelector('[data-t]')?.addEventListener('click', () => (me.can_use ? menu() : paywall()));
    box.querySelector('[data-c]').addEventListener('click', menu);
    // Indique e ganhe também em destaque na tela de entrada (para todo mundo; a trava de "só cliente" fica na hora de se afiliar)
    const man = document.getElementById('manHome');
    if (man && !document.getElementById('scIndHome')) {
      const a = document.createElement('a'); a.id = 'scIndHome'; a.className = 'sc-indb';
      a.innerHTML = `<i>${I('gift')}</i><span><b>Indique e ganhe</b><small>Indique o Studio Cover para outros cantores e ganhe perto de R$ 140 por assinatura.</small></span><em>›</em>`;
      man.after(a);
    }
    // Instalar na tela de início: cartão grande no topo da tela inicial, sempre que não estiver instalado
    const hero = document.querySelector('#home .hero');
    if (hero && !standalone && (mobile || deferred) && !document.getElementById('scInstHome')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'scInstHome'; b.className = 'sc-instb';
      b.innerHTML = `<i>${I('install')}</i><span><b>Instale o app na sua tela de início</b><small>${ios ? 'Veja como fazer no iPhone: são 3 toques.' : android ? 'Veja como fazer no Android: são 3 toques.' : 'Abra pelo ícone, igual a um aplicativo.'} Pelo ícone o app trava bem menos.</small></span><em>INSTALAR</em>`;
      b.addEventListener('click', () => install());
      hero.prepend(b);
    }
    const ih = document.getElementById('scIndHome'); if (ih) ih.href = me.afiliado ? '/afiliado/?de=app' : '/afiliados/?utm_source=app&utm_medium=entrada';
    bar();
  }

  // ---------- início ----------
  (async () => {
    let j;
    try { j = await api('me'); } catch { return; }
    if (!j.user) { location.href = '/entrar/?voltar=/app/'; return; }
    me = j.user; unread = j.unread || 0; whats = j.whatsapp || '';
    if (me.blocked) { sheet('<h3>Acesso suspenso</h3><p>O seu acesso foi cancelado (reembolso ou bloqueio). Se acha que é um engano, fale com o suporte.</p>'); }
    if (document.readyState === 'loading') await new Promise((r) => addEventListener('DOMContentLoaded', r));
    render();
    // primeira vez no app: oferece instalar
    try {
      const pede = new URLSearchParams(location.search).has('instalar');
      // abriu pelo navegador do celular (não pelo ícone): ensina a instalar logo ao abrir, 1 vez por visita
      const preso0 = me.trial && !me.paid && !me.can_use;
      let ja = false; try { ja = !!sessionStorage.getItem('sc-inst-s'); } catch {}
      if (!standalone && !me.blocked && (pede || (mobile && !ja && !preso0))) {
        try { sessionStorage.setItem('sc-inst-s', '1'); localStorage.setItem('sc-inst', '1'); localStorage.setItem('sc-inst-pago', String(Date.now())); } catch {}
        setTimeout(() => { if (!document.querySelector('.sc-ov')) install(!!(me && me.paid)); }, pede ? 700 : 1200);
      }
    } catch {}
    const preso = me.trial && !me.paid && !me.can_use;
    if (preso && !me.blocked) setTimeout(paywall, 1200); // terminou o teste: toda vez que abre o app
    else if (me.paid) { setTimeout(guardadoDepoisDaCompra, 1500); setTimeout(() => lembraInstalar(false), 3500); } // comprou e o vídeo do teste ficou guardado: oferece fazer e baixar; depois lembra de instalar
    else if (standalone || android) setTimeout(convitePush, 4000);
    pushRenova();
    document.addEventListener('visibilitychange', async () => { // voltou para o app depois de um tempo: confere se pagou e lembra
      if (document.visibilityState !== 'visible' || !me || me.paid) return;
      const fora = Date.now() - (window.scSaiu || Date.now()); if (fora < 120000) return;
      try { const r = await api('me'); if (r.user) { const antes = me.paid; me = r.user; render(); if (!antes && me.paid) pagou(); else if (me.trial && !me.paid && !me.can_use && !document.querySelector('.sc-ov') && !document.querySelector('[data-screen="studio"]')) paywall(); } } catch {}
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') window.scSaiu = Date.now(); });
    if (unread) setTimeout(async () => { try { const a = await api('avisos'); const n = (a.items || []).find((x) => !x.read_at); if (n) toast(n.title, n.body, avisos); } catch {} }, 2500);
  })();
})();
