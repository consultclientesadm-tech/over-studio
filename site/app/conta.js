// Studio Cover — conta do aluno dentro do app: login obrigatório, teste grátis (limite de vídeos e cobrança),
// avisos do funil, botão de instalar na tela de início (iPhone e Android) e menu da conta.
(function () {
  const api = async (a, body) => {
    const r = await fetch('/api/conta.php?a=' + a, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SC': '1' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) { location.href = '/entrar/?voltar=/app/'; throw new Error('login'); }
    return r.json();
  };
  let me = null, unread = 0, whats = '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const css = `
.sc-conta{display:flex;align-items:center;gap:6px;margin-left:4px}
.sc-chip{height:30px;min-width:30px;border-radius:20px;border:1px solid #33333c;background:#111116;color:#fff;font:700 12px 'Space Grotesk',sans-serif;display:inline-flex;align-items:center;gap:6px;padding:0 9px;cursor:pointer;position:relative}
.sc-chip.y{border-color:#ffd400;color:#ffd400}
.sc-dot{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#ff4d5e;box-shadow:0 0 8px #ff4d5e}
.sc-ov{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:grid;place-items:end center;padding:12px;animation:scf .2s}
@media(min-width:700px){.sc-ov{place-items:center}}
.sc-sh{width:100%;max-width:440px;max-height:86vh;overflow:auto;background:#0e0e12;border:1px solid #2a2a32;border-radius:24px;padding:22px 20px calc(18px + env(safe-area-inset-bottom));color:#f4f4f7;font-family:'Space Grotesk',sans-serif;box-shadow:0 0 60px rgba(255,212,0,.12);animation:scu .35s cubic-bezier(.2,.8,.2,1)}
.sc-sh h3{margin:0 0 6px;font:800 18px Orbitron,sans-serif;letter-spacing:.04em}.sc-sh p{color:#a5a5b0;font-size:14px;line-height:1.55;margin:6px 0}
.sc-sh .sc-b{display:flex;width:100%;height:52px;align-items:center;justify-content:center;border:0;border-radius:40px;background:linear-gradient(180deg,#ffe34d,#ffc400);color:#000;font:900 14px Orbitron,sans-serif;letter-spacing:.06em;text-decoration:none;margin-top:14px;cursor:pointer;box-shadow:0 0 28px rgba(255,212,0,.35)}
.sc-sh .sc-b2{display:flex;width:100%;height:46px;align-items:center;justify-content:center;border:1px solid #33333c;border-radius:40px;background:none;color:#ddd;font:600 14px 'Space Grotesk',sans-serif;margin-top:10px;cursor:pointer;text-decoration:none}
.sc-x{float:right;border:0;background:#1b1b22;color:#aaa;width:32px;height:32px;border-radius:50%;font-size:16px;cursor:pointer}
.sc-li{display:flex;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid #1d1d24;font-size:14px;cursor:pointer;color:#e8e8ee;text-decoration:none}
.sc-li:last-child{border:0}.sc-li i{font-style:normal;width:28px;text-align:center;font-size:18px}
.sc-n{padding:12px;border-radius:14px;background:#14141a;margin:8px 0;border:1px solid #22222a}.sc-n b{display:block;margin-bottom:4px}.sc-n.nova{border-color:rgba(255,212,0,.5)}.sc-n small{color:#777}
.sc-ios{display:grid;gap:12px;margin:14px 0}.sc-ios div{display:flex;gap:12px;align-items:center;background:#14141a;border-radius:14px;padding:12px;font-size:14px}
.sc-ios span{flex:none;width:30px;height:30px;border-radius:50%;background:#ffd400;color:#000;font:900 14px Orbitron;display:grid;place-items:center}
.sc-ios svg{flex:none}
.sc-meter{height:8px;border-radius:8px;background:#1b1b22;overflow:hidden;margin:12px 0 4px}.sc-meter i{display:block;height:100%;background:linear-gradient(90deg,#ffd400,#2ee59d)}
.sc-toast{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top));transform:translateX(-50%);z-index:85;width:min(420px,calc(100% - 20px));background:#121217;border:1px solid rgba(255,212,0,.45);border-radius:16px;padding:12px 14px;color:#fff;font:500 14px 'Space Grotesk',sans-serif;box-shadow:0 10px 40px #000a;animation:scd .4s cubic-bezier(.2,.8,.2,1);cursor:pointer}
.sc-toast b{color:#ffd400;display:block;font-size:13px;margin-bottom:2px}
@keyframes scf{from{opacity:0}}@keyframes scu{from{transform:translateY(40px);opacity:0}}@keyframes scd{from{transform:translate(-50%,-30px);opacity:0}}
`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function sheet(html, onClose) {
    const ov = document.createElement('div'); ov.className = 'sc-ov';
    ov.innerHTML = `<div class="sc-sh" role="dialog" aria-modal="true"><button class="sc-x" aria-label="Fechar">✕</button>${html}</div>`;
    const close = () => { ov.remove(); onClose && onClose(); };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.sc-x,[data-fechar]')) close(); });
    document.body.appendChild(ov); return { el: ov, close };
  }

  // ---------- instalar ----------
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const android = /Android/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; render(); });
  const shareIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b9cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const addIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/></svg>';
  async function install() {
    if (deferred) { deferred.prompt(); const r = await deferred.userChoice; deferred = null; render(); if (r.outcome === 'accepted') toast('Pronto!', 'O Studio Cover está na sua tela de início.'); return; }
    if (ios) {
      const safari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|Instagram|FBAN|FBAV/.test(navigator.userAgent);
      sheet(`<h3>Instalar no iPhone</h3><p>Deixe o Studio Cover na tela de início, igual a um aplicativo.</p>
        ${safari ? '' : '<p style="color:#ffd400">Abra este link no <b>Safari</b> para instalar (no navegador do Instagram ou do Chrome o iPhone não deixa).</p>'}
        <div class="sc-ios"><div><span>1</span>${shareIcon}<p style="margin:0">Toque em <b>Compartilhar</b> na barra do Safari</p></div>
        <div><span>2</span>${addIcon}<p style="margin:0">Role e toque em <b>Adicionar à Tela de Início</b></p></div>
        <div><span>3</span><img src="/assets/icon-180.png" width="26" height="26" style="border-radius:6px" alt=""><p style="margin:0">Toque em <b>Adicionar</b>. Pronto!</p></div></div>
        <button class="sc-b2" data-fechar>Entendi</button>`);
      return;
    }
    sheet(`<h3>Instalar no Android</h3><p>Escolha um jeito:</p>
      <a class="sc-b" href="/app/studio-cover.apk" download>BAIXAR O APLICATIVO (APK)</a>
      <p style="font-size:12.5px">Depois de baixar, abra o arquivo e permita "instalar apps desta fonte".</p>
      <p>Ou no Chrome: toque nos <b>⋮ três pontinhos</b> e em <b>Instalar app</b> / <b>Adicionar à tela inicial</b>.</p>
      <button class="sc-b2" data-fechar>Fechar</button>`);
  }

  // ---------- teste grátis e cobrança ----------
  function paywall() {
    const price = me.price ? `<p style="font:800 26px Orbitron;color:#ffd400;margin:12px 0 0">R$ ${esc(me.price)}</p>` : '';
    const url = me.checkout_url || '/#comprar';
    sheet(`<h3>Seu teste grátis terminou 🎬</h3>
      <p>Você viu o que o Studio Cover faz com os seus vídeos. Libere o acesso completo e faça quantos covers quiser: afinação, mix e master, cor de cinema e exportação na qualidade original.</p>
      ${price}<a class="sc-b" href="${esc(url)}" target="_blank" rel="noopener">LIBERAR MEU ACESSO</a>
      <p style="font-size:12.5px;text-align:center">Depois do pagamento o acesso libera sozinho, na mesma conta (${esc(me.email)}).</p>
      <button class="sc-b2" data-fechar>Agora não</button>`);
  }
  window.scGate = async (file) => {
    if (!me) return false;
    const audio = /^audio\//.test(file.type) || /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(file.name || '');
    try {
      const j = await api('usar', { tipo: audio ? 'audio' : 'video', mb: Math.round(file.size / 1048576) });
      if (j.paywall) { me = j.user; render(); paywall(); return false; }
      if (j.user) { me = j.user; render(); }
      if (me.trial && !me.paid) toast('Teste grátis', me.trial_left ? `Você ainda tem ${me.trial_left} vídeo${me.trial_left > 1 ? 's' : ''} grátis depois deste.` : 'Este é o seu último vídeo grátis.');
      return true;
    } catch (e) { return e.message !== 'login'; } // sem internet: deixa usar (o processamento é no aparelho)
  };

  // ---------- avisos ----------
  function toast(title, body, onClick) {
    document.querySelector('.sc-toast')?.remove();
    const t = document.createElement('div'); t.className = 'sc-toast'; t.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
    t.onclick = () => { t.remove(); onClick && onClick(); };
    document.body.appendChild(t); setTimeout(() => t.remove(), 6500);
  }
  async function avisos() {
    const j = await api('avisos');
    const items = (j.items || []).map((n) => `<div class="sc-n ${n.read_at ? '' : 'nova'}"><b>${esc(n.title)}</b>${esc(n.body)}${n.url ? `<br><a href="${esc(n.url)}" style="color:#ffd400">Abrir →</a>` : ''}<br><small>${esc(n.created_at.slice(0, 16).split(' ').reverse().join(' · ').replace(/(\d{4})-(\d\d)-(\d\d)/, '$3/$2'))}</small></div>`).join('');
    sheet(`<h3>Avisos</h3>${items || '<p>Nenhum aviso por enquanto.</p>'}`);
    if (unread) { api('lido', {}); unread = 0; render(); }
  }

  // ---------- menu ----------
  function menu() {
    const trial = me.trial && !me.paid;
    const n = Math.max(0, me.trial_left);
    sheet(`<h3>${esc(me.name || 'Minha conta')}</h3><p style="margin-top:0">${esc(me.email)}</p>
      ${trial ? `<div class="sc-n nova"><b>Teste grátis: ${n} vídeo${n === 1 ? '' : 's'} restante${n === 1 ? '' : 's'}</b>Libere o acesso completo para fazer quantos covers quiser.<a class="sc-b" href="${esc(me.checkout_url || '/#comprar')}" target="_blank" rel="noopener">LIBERAR ACESSO COMPLETO</a></div>` : me.paid ? `<div class="sc-n"><b style="color:#2ee59d">✓ Acesso completo</b>${me.expires_at ? 'Válido até ' + esc(me.expires_at.slice(0, 10).split('-').reverse().join('/')) : 'Vitalício'}</div>` : ''}
      <a class="sc-li" data-m="avisos"><i>🔔</i>Avisos ${unread ? `<b style="color:#ffd400">(${unread})</b>` : ''}</a>
      ${standalone ? '' : '<a class="sc-li" data-m="instalar"><i>📲</i>Instalar na tela de início</a>'}
      ${whats ? `<a class="sc-li" href="https://wa.me/${esc(whats.replace(/\D/g, ''))}" target="_blank" rel="noopener"><i>💬</i>Suporte no WhatsApp</a>` : ''}
      <a class="sc-li" data-m="sair"><i>↩</i>Sair da conta</a>`);
    document.querySelectorAll('.sc-li[data-m]').forEach((a) => (a.onclick = async () => {
      document.querySelector('.sc-ov')?.remove();
      if (a.dataset.m === 'avisos') avisos();
      if (a.dataset.m === 'instalar') install();
      if (a.dataset.m === 'sair') { await api('sair', {}); location.href = '/entrar/'; }
    }));
  }

  function render() {
    const top = document.querySelector('header.top'); if (!top || !me) return;
    let box = document.querySelector('.sc-conta');
    if (!box) { box = document.createElement('div'); box.className = 'sc-conta'; top.appendChild(box); }
    const trial = me.trial && !me.paid;
    box.innerHTML = `${!standalone && (deferred || ios || android) ? '<button class="sc-chip y" data-i>📲 Instalar</button>' : ''}
      ${trial ? `<button class="sc-chip y" data-t title="Teste grátis">🎁 ${Math.max(0, me.trial_left)}</button>` : ''}
      <button class="sc-chip" data-c aria-label="Minha conta">${esc((me.name || me.email || '?').trim()[0].toUpperCase())}${unread ? '<span class="sc-dot"></span>' : ''}</button>`;
    box.querySelector('[data-i]')?.addEventListener('click', install);
    box.querySelector('[data-t]')?.addEventListener('click', () => (me.can_use ? menu() : paywall()));
    box.querySelector('[data-c]').addEventListener('click', menu);
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
      if (!standalone && (ios || android) && !localStorage.getItem('sc-inst')) { localStorage.setItem('sc-inst', '1'); setTimeout(install, 1500); }
    } catch {}
    if (unread) setTimeout(async () => { const a = await api('avisos'); const n = (a.items || []).find((x) => !x.read_at); if (n) toast(n.title, n.body, avisos); }, 2500);
  })();
})();
