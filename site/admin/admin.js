// Central de comando do Studio Cover
Marca.montar();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const brl = (v) => 'R$ ' + (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl0 = (v) => 'R$ ' + Math.round(+v || 0).toLocaleString('pt-BR');
const dt = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(2, 4) + ' ' + s.slice(11, 16) : '—');
const STATUS = { active: 'Pago', trial: 'Teste', refunded: 'Reembolso', blocked: 'Bloqueado' };
// acesso liberado sem pagamento (convite / cortesia) aparece separado dos pagos
const stDe = (u) => (u.status === 'active' && !(+u.paid_value > 0) ? ['cortesia', 'Cortesia'] : [u.status, STATUS[u.status]]);
async function api(a, body, q = '') {
  const r = await fetch('/api/admin.php?a=' + a + q, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SC': '1' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin', cache: 'no-store' });
  const j = await r.json().catch(() => ({ ok: false, error: 'Erro no servidor (' + r.status + ')' }));
  if (r.status === 401 && a !== 'login') { boot(); throw new Error('login'); }
  return j;
}
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3500); }
function modal(html, bind) { $('mbody').innerHTML = html; $('modal').hidden = false; bind && bind($('mbody')); const f = $('mbody').querySelector('input,textarea'); f && f.focus(); }
const closeModal = () => ($('modal').hidden = true);
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-fechar]')) closeModal(); });
addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

// ---------- login ----------
async function boot() {
  const j = await fetch('/api/admin.php?a=estado', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json());
  if (j.admin) { $('vLogin').hidden = true; $('vPainel').hidden = false; $('euNome').textContent = j.admin.name || j.admin.email; tab(location.hash.slice(1) || 'geral'); return; }
  $('vPainel').hidden = true; $('vLogin').hidden = false;
  $('fLogin').hidden = j.precisa_criar; $('fPrimeiro').hidden = !j.precisa_criar;
  const ch = new URLSearchParams(location.search).get('chave'); if (ch) $('pChave').value = ch;
}
async function sub(form, action, body) {
  const b = form.querySelector('.btn'), m = form.querySelector('.msg'); b.disabled = true; m.textContent = '';
  const j = await api(action, body).catch(() => ({ ok: false, error: 'Sem conexão.' }));
  b.disabled = false;
  if (j.ok) { history.replaceState(null, '', '/admin/'); boot(); } else m.textContent = j.error;
}
$('fLogin').onsubmit = (e) => { e.preventDefault(); sub($('fLogin'), 'login', { email: $('lEmail').value, senha: $('lSenha').value }); };
$('fPrimeiro').onsubmit = (e) => { e.preventDefault(); sub($('fPrimeiro'), 'primeiro', { chave: $('pChave').value, nome: $('pNome').value, email: $('pEmail').value, senha: $('pSenha').value }); };
$('sair').onclick = async () => { await api('sair', {}); boot(); };

// ---------- abas ----------
const TABS = { geral: 'tGeral', origens: 'tOrig', financas: 'tFin', vistoria: 'tVist', alunos: 'tAlunos', funil: 'tFunil', afiliados: 'tAfiliados', depoimentos: 'tDepo', admins: 'tAdmins', config: 'tConfig' };
function tab(t) {
  if (!TABS[t]) t = 'geral';
  document.querySelectorAll('.nav > button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); $('maisBtn').classList.toggle('on', !!document.querySelector('.nav > button.mx.on'));
  Object.entries(TABS).forEach(([k, id]) => ($(id).hidden = k !== t));
  history.replaceState(null, '', '#' + t);
  $('vistBtn').hidden = t === 'vistoria';
  ({ geral: loadGeral, origens: loadOrigens, financas: loadFin, vistoria: loadVist, alunos: loadAlunos, funil: loadFunil, afiliados: loadAfiliados, depoimentos: loadDepo, admins: loadAdmins, config: loadConfig })[t]();
}
document.querySelectorAll('.nav > button[data-tab]').forEach((b) => (b.onclick = () => { document.querySelector('.nav').classList.remove('aberto'); tab(b.dataset.tab); }));
// celular: barra de baixo com 4 abas e o botão Mais, que abre as outras numa gaveta
$('maisBtn').onclick = (e) => { e.stopPropagation(); document.querySelector('.nav').classList.toggle('aberto'); };
document.addEventListener('click', (e) => { const n = document.querySelector('.nav'); if (n.classList.contains('aberto') && !n.contains(e.target)) n.classList.remove('aberto'); });
setInterval(() => { const n = ['depoBadge', 'vistBadge'].reduce((s, id) => s + (($(id) && !$(id).hidden && +$(id).textContent) || 0), 0); $('maisBadge').hidden = !n; $('maisBadge').textContent = n; }, 1500);

// ---------- números que contam ----------
function contar(root) {
  const fm = { brl: (v) => brl(v), n: (v) => Math.round(v).toLocaleString('pt-BR'), pc: (v) => Math.round(v * 100) + '%' };
  const els = [...root.querySelectorAll('.cnt')], t0 = performance.now(), ms = 1300;
  const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4);
    els.forEach((el) => (el.textContent = fm[el.dataset.f](+el.dataset.to * e))); if (k < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
  requestAnimationFrame(() => root.querySelectorAll('.barra').forEach((b) => b.classList.add('on')));
}


// ---------- gráfico do dia, ao vivo ----------
let hojeIds = null, hojeDesenhado = false;
// som de caixa registradora a cada venda nova (o navegador só deixa tocar depois do primeiro toque na página)
const caixa = new Audio('/admin/caixa.mp3?v=1'); caixa.preload = 'auto'; caixa.volume = 1;
let somLiberado = false;
addEventListener('pointerdown', () => { if (somLiberado) return; somLiberado = true; setTimeout(() => { const sb = $('somLib'); if (sb) sb.remove(); }, 400); caixa.muted = true; caixa.play().then(() => { caixa.pause(); caixa.currentTime = 0; caixa.muted = false; }).catch(() => { caixa.muted = false; }); }, { capture: true });
function chime() { if (Date.now() - (chime.t || 0) < 5000) return; chime.t = Date.now(); try { caixa.currentTime = 0; caixa.muted = false; caixa.play().catch(() => {}); setTimeout(() => { const b = caixa.cloneNode(); b.volume = 1; b.play().catch(() => {}); }, 1700); } catch {} }
// aviso no celular: o celular do administrador recebe uma notificação a cada venda
const iosAdm = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const instaladoAdm = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// vigia de vendas: confere a cada 20 s em qualquer aba, mesmo com o painel em segundo plano ou minimizado (antes só conferia com a Visão geral aberta e visível)
const vendasVistas = { ids: null };
async function vigiaVendas() {
  if (!$('vPainel') || $('vPainel').hidden) return;
  const j = await api('hoje').catch(() => null); if (!j || !j.ok) return;
  const ids = new Set(j.hoje.map((v) => v.id));
  if (vendasVistas.ids) {
    const novas = j.hoje.filter((v) => !vendasVistas.ids.has(v.id) && v.liquido > 0);
    if (novas.length) {
      chime(); toast(`💰 Nova venda! +${brl(novas.reduce((a, v) => a + v.liquido, 0))}`);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && !(() => { try { return localStorage.getItem('sc-adm-push'); } catch { return null; } })()) try { new Notification('💰 Mais uma venda do Studio Cover!', { body: '+' + brl(novas.reduce((a, v) => a + v.liquido, 0)) + ' líquido', icon: '/admin/icon-192.png' }); } catch {}
      if (!$('tGeral').hidden) loadHoje();
    }
  }
  vendasVistas.ids = ids;
}
setInterval(vigiaVendas, 20000); setTimeout(vigiaVendas, 3000);
// o navegador do computador só deixa tocar som depois de um clique na página: aviso discreto até o primeiro clique
setTimeout(() => { if (somLiberado || !$('vPainel') || $('vPainel').hidden) return; const d = document.createElement('button'); d.id = 'somLib'; d.className = 'somLib'; d.textContent = '🔊 Clique aqui para ligar o som da caixa registradora'; d.onclick = () => { d.remove(); chime.t = 0; chime(); }; document.body.appendChild(d); }, 2500);
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.tipo === 'venda') { chime(); if (!$('tGeral').hidden) loadHoje(); } });
async function ligarAvisoVenda() {
  if (iosAdm && !instaladoAdm) return modal(`<h3>💰 Aviso de venda no iPhone</h3><p>No iPhone o aviso só funciona com o painel instalado na tela de início:</p><p>1. Abra <b>studiocover.com.br/admin</b> no <b>Safari</b>.<br>2. Toque em <b>Compartilhar</b> (o quadrado com a seta) e em <b>Adicionar à Tela de Início</b>.<br>3. Abra o painel pelo ícone novo, toque em <b>💰 Aviso de venda</b> e em <b>Ligar aviso neste aparelho</b>.</p><button class="btn" data-fechar>Entendi</button>`);
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return toast('Este navegador não recebe avisos. Use o Chrome ou o Safari.');
  try {
    if (Notification.permission === 'denied') return toast('As notificações estão bloqueadas para este site. Libere nos ajustes do navegador.');
    if ((await Notification.requestPermission()) !== 'granted') return toast('Sem permissão de notificação, o aviso não chega.');
    const reg = await navigator.serviceWorker.register('/admin/push-sw.js', { scope: '/admin/' });
    await navigator.serviceWorker.ready;
    const { chave } = await api('push-chave');
    const key = Uint8Array.from(atob(chave.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (chave.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    const j = await api('push-salvar', { sub: sub.toJSON() }); if (!j.ok) return toast(j.error || 'Não deu para ligar.');
    try { localStorage.setItem('sc-adm-push', '1'); } catch {}
    const t = await api('push-teste', {});
    chime(); toast(t.enviados ? '💰 Aviso ligado! Chegou uma venda de teste aí no aparelho.' : 'Aviso ligado. Se o teste não chegar em 1 minuto, me avise.');
  } catch (e) { toast('Não deu para ligar o aviso: ' + e.message); }
}
$('somBtn').onclick = () => modal(`<h3>💰 Som e aviso de venda</h3><p>Com o painel aberto, cada venda nova toca uma <b>caixa registradora</b> bem alta. Toque em qualquer lugar do painel uma vez para o navegador liberar o som.</p><p>No celular, ligue o aviso: cada venda chega como notificação, com o valor, o nome e de onde veio.</p><button class="btn" id="mTestaSom">🔊 Ouvir o som</button> <button class="btn" id="mLigaPush" style="margin-top:10px">📲 Ligar aviso neste aparelho</button>`, (m) => { m.querySelector('#mTestaSom').onclick = chime; m.querySelector('#mLigaPush').onclick = () => { closeModal(); ligarAvisoVenda(); }; });
// renova em silêncio (o celular às vezes troca o endereço do aviso)
(async () => { try { if (localStorage.getItem('sc-adm-push') !== '1' || Notification.permission !== 'granted') return; const reg = await navigator.serviceWorker.getRegistration('/admin/'); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) api('push-salvar', { sub: sub.toJSON() }).catch(() => {}); } catch {} })();
let vista = 'hora'; // padrão: vendas de hoje hora a hora (ao vivo); o dia a dia só quando clicar
// 'periodo' (dia a dia do período escolhido) ou 'hora' (só hoje, por hora)
async function loadHoje() {
  const [j, sr] = await Promise.all([api('hoje'), api('serie', null, '&dias=' + dias)]); if (!j.ok) return;
  const vendas = j.hoje, ontem = j.ontem, agora = j.agora_min;
  const cum = (arr, ate = 1440) => arr.filter((v) => v.min <= ate).reduce((a, v) => a + v.liquido, 0);
  const total = cum(vendas), nV = vendas.filter((v) => v.liquido > 0).length, ontemAte = cum(ontem, agora), ontemTot = cum(ontem);
  const ymax = Math.max(total, ontemTot, j.media_7d, 280) * 1.18, W = 1000, H = 240;
  const X = (m) => (m / 1440) * W, Y = (v) => H - (Math.max(0, v) / ymax) * H;
  // curva suave que nunca desce entre dois pontos (monotone cubic), passando pelo total depois de cada venda
  const curva = (arr, fim) => {
    const P = [[0, 0]]; let c = 0;
    arr.forEach((v) => { if (v.min > fim) return; c += v.liquido; const x = Math.max(v.min, P[P.length - 1][0] + 1); P.push([x, c]); });
    if (fim > P[P.length - 1][0]) P.push([fim, c]);
    const xs = P.map((p) => X(p[0])), ys = P.map((p) => Y(p[1])), n = P.length;
    if (n < 2) return { d: `M0 ${H}`, c };
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i]; m[i] = (ys[i + 1] - ys[i]) / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; d += ` C${(xs[i] + h).toFixed(1)} ${(ys[i] + t[i] * h).toFixed(1)} ${(xs[i + 1] - h).toFixed(1)} ${(ys[i + 1] - t[i + 1] * h).toFixed(1)} ${xs[i + 1].toFixed(1)} ${ys[i + 1].toFixed(1)}`; }
    return { d, c };
  };
  const pt = curva(vendas, agora), po = curva(ontem, 1440);
  let c = 0;
  const pontos = vendas.map((v, i) => { c += v.liquido; return `<i class="pt ${v.af ? 'af' : ''} ${v.liquido < 0 ? 'rb' : ''} ${i === vendas.length - 1 ? 'ult' : ''}" style="left:${(v.min / 14.4).toFixed(2)}%;top:${((1 - Math.max(0, c) / ymax) * 100).toFixed(2)}%" title="${v.h} · ${esc(v.nome || 'cliente')} · ${v.liquido < 0 ? 'reembolso ' : '+'}${brl(Math.abs(v.liquido))}${v.af ? ' (afiliado)' : ''}"></i>`; }).join('');
  const dif = ontemAte > 0 ? (total - ontemAte) / ontemAte : null;
  const novas = hojeIds ? vendas.filter((v) => !hojeIds.has(v.id) && v.liquido > 0) : [];
  hojeIds = new Set(vendas.map((v) => v.id));
  const abas = `<div class="seg vista"><button data-v="hora" class="${vista === 'hora' ? 'on' : ''}">Hoje por hora</button><button data-v="periodo" class="${vista === 'periodo' ? 'on' : ''}">Dia a dia</button></div>`;
  $('fatBox').hidden = vista !== 'periodo';
  $('vistaSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === vista));
  if (vista === 'periodo') {
    $('hoje').innerHTML = '';
    // gráfico de faturamento do topo: o ponto de hoje acompanha as vendas ao vivo
    const fs = fatSerie; if (fs && fs.length) { const ult = fs[fs.length - 1], hojeD = sr && sr.ok ? sr.hoje : ult.d;
      if (ult.d === hojeD && Math.abs(ult.v - total) > 0.009) { fatPeriodo += total - ult.v; ult.v = total; desenhaFat(); }
      if (novas.length) { const fb = $('fatBox'); fb.classList.remove('nova'); void fb.offsetWidth; fb.classList.add('nova'); } }
  }
  else $('hoje').innerHTML = `<section class="hojeBox glass${novas.length ? ' nova' : ''}">
    <div class="hh"><div><span class="vivo"><i></i>AO VIVO · VENDAS DE HOJE</span>${abas}
      <div class="hv">${N2(total)}<small>líquido · ${nV} venda${nV === 1 ? '' : 's'}${nV ? ` · última às ${vendas.filter((v) => v.liquido > 0).slice(-1)[0].h}` : ''}</small></div></div>
      <div class="hcmp">${dif === null ? (ontemTot ? '' : '<span>Ontem: sem vendas</span>') : `<b class="${dif >= 0 ? 'up' : 'dn'}">${dif >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(dif) * 100)}%</b><span>vs ontem até esta hora (${brl0(ontemAte)})</span>`}
        <span>ontem fechou em ${brl0(ontemTot)} · média dos últimos 7 dias ${brl0(j.media_7d)}/dia</span></div></div>
    <div class="hg"><div class="hy"><span>${brl0(ymax)}</span><span>${brl0(ymax / 2)}</span><span>R$ 0</span></div>
      <div class="hc"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="gHoje" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd400" stop-opacity=".45"/><stop offset="1" stop-color="#ffd400" stop-opacity="0"/></linearGradient></defs>
        ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="gr"/>`).join('')}
        ${j.media_7d ? `<line x1="0" x2="${W}" y1="${Y(j.media_7d).toFixed(1)}" y2="${Y(j.media_7d).toFixed(1)}" class="md"/>` : ''}
        <path d="${po.d}" class="on"/>
        <path d="${pt.d} L${X(agora).toFixed(1)} ${H} Z" fill="url(#gHoje)" class="ar"/>
        <path d="${pt.d}" class="tl${hojeDesenhado ? '' : ' draw'}" pathLength="1"/>
        <line x1="${X(agora).toFixed(1)}" x2="${X(agora).toFixed(1)}" y1="0" y2="${H}" class="nw"/>
      </svg>${pontos}<span class="agora" style="left:${(agora / 14.4).toFixed(2)}%">agora ${j.agora}</span>
      ${j.media_7d ? `<span class="mdl" style="top:${((1 - j.media_7d / ymax) * 100).toFixed(1)}%">média/dia</span>` : ''}</div></div>
    <div class="hx">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span>${h}h</span>`).join('')}</div>
    <div class="hl"><span><i class="ly"></i>Hoje (líquido acumulado)</span><span><i class="lo"></i>Ontem</span><span><i class="lp"></i>Venda de afiliado</span>${j.media_7d ? '<span><i class="lm"></i>Média por dia (7 dias)</span>' : ''}</div>
  </section>`;
  hojeDesenhado = true;
  [...$('hoje').querySelectorAll('.vista button'), ...$('vistaSeg').querySelectorAll('button')].forEach((b) => (b.onclick = () => { vista = b.dataset.v; hojeDesenhado = false; loadHoje.ja = false; loadHoje(); if (vista === 'periodo') desenhaFat(); }));
  const hv = $('hoje').querySelector('.hv .cnt'); if (hv) { if (novas.length || !loadHoje.ja) contar($('hoje')); else { hv.textContent = brl(+hv.dataset.to); } }
  loadHoje.ja = true;
  if (novas.length) { chime(); toast(`💰 Nova venda! +${brl(novas.reduce((a, v) => a + v.liquido, 0))}${novas.some((v) => v.af) ? ' (afiliado)' : ''}`); }
  loadCad(j);
}
// vendas dia a dia (ou semana a semana no 1 ano) do período escolhido, atualizando ao vivo
function periodoHtml(sr, hojeTot, nova, abas) {
  const P = sr.pontos, n = P.length, tot = P.reduce((a, p) => a + p.l, 0), nv = P.reduce((a, p) => a + p.n, 0);
  const media = tot / Math.max(1, sr.dias) * (sr.semana ? 7 : 1);
  const ymax = Math.max(...P.map((p) => p.l), media, 200) * 1.18, W = 1000, H = 240, bw = W / n;
  const Y = (v) => H - (Math.max(0, v) / ymax) * H;
  const dif = sr.anterior > 0 ? (tot - sr.anterior) / sr.anterior : null;
  const per = { 7: 'últimos 7 dias', 30: 'últimos 30 dias', 90: 'últimos 90 dias', 365: 'últimos 12 meses' }[sr.dias] || `últimos ${sr.dias} dias`;
  const dm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const barras = P.map((p, i) => { const x = i * bw + bw * 0.14, w = bw * 0.72, hj = p.fim === sr.hoje;
    return `<rect x="${x.toFixed(1)}" y="${Y(p.l).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - Y(p.l)).toFixed(1)}" rx="${Math.min(4, w / 3).toFixed(1)}" class="vb${hj ? ' hj' : ''}"/>`
      + (p.af > 0 ? `<rect x="${x.toFixed(1)}" y="${Y(p.af).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - Y(p.af)).toFixed(1)}" rx="${Math.min(4, w / 3).toFixed(1)}" class="vba"/>` : ''); }).join('');
  const rotulos = n <= 31 ? P.map((p, i) => p.l > 0 ? `<span class="vbn" style="left:${((i + 0.5) / n * 100).toFixed(2)}%;top:${((1 - p.l / ymax) * 100).toFixed(2)}%">${p.l >= 1000 ? (p.l / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : Math.round(p.l)}</span>` : '').join('') : '';
  const tips = P.map((p, i) => `<i class="vbt" style="left:${(i / n * 100).toFixed(3)}%;width:${(100 / n).toFixed(3)}%" title="${sr.semana ? 'Semana de ' + dm(p.d) : dm(p.d)}${p.fim === sr.hoje ? ' (hoje)' : ''} · ${brl(p.l)} · ${p.n} venda${p.n === 1 ? '' : 's'}${p.af ? ' · afiliados ' + brl(p.af) : ''}"></i>`).join('');
  const passo = Math.ceil(n / (innerWidth < 600 ? 4 : 8)), eixo = P.map((p, i) => (i % passo === 0 || i === n - 1) ? `<span style="left:${((i + 0.5) / n * 100).toFixed(2)}%">${p.fim === sr.hoje && !sr.semana ? 'hoje' : dm(p.d)}</span>` : '').join('');
  return `<section class="hojeBox glass${nova ? ' nova' : ''}">
    <div class="hh"><div><span class="vivo"><i></i>AO VIVO · VENDAS DOS ${per.toUpperCase()}</span>${abas}
      <div class="hv">${N2(tot)}<small>líquido · ${nv} venda${nv === 1 ? '' : 's'} · hoje ${brl0(hojeTot)} até ${sr.agora}</small></div></div>
      <div class="hcmp">${dif === null ? '<span>Período anterior: sem vendas</span>' : `<b class="${dif >= 0 ? 'up' : 'dn'}">${dif >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(dif) * 100)}%</b><span>vs os ${sr.dias} dias anteriores (${brl0(sr.anterior)})</span>`}
        <span>média de ${brl0(media)} por ${sr.semana ? 'semana' : 'dia'}</span></div></div>
    <div class="hg"><div class="hy"><span>${brl0(ymax)}</span><span>${brl0(ymax / 2)}</span><span>R$ 0</span></div>
      <div class="hc"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="gVb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd400" stop-opacity=".95"/><stop offset="1" stop-color="#ffd400" stop-opacity=".25"/></linearGradient></defs>
        ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="gr"/>`).join('')}
        ${barras}
        ${media ? `<line x1="0" x2="${W}" y1="${Y(media).toFixed(1)}" y2="${Y(media).toFixed(1)}" class="md"/>` : ''}
      </svg>${rotulos}${tips}${media ? `<span class="mdl" style="top:${((1 - media / ymax) * 100).toFixed(1)}%">média/${sr.semana ? 'semana' : 'dia'}</span>` : ''}</div></div>
    <div class="vx">${eixo}</div>
    <div class="hl"><span><i class="ly"></i>Vendas (líquido)${sr.semana ? ' por semana' : ' por dia'}</span><span><i class="lp"></i>Parte de afiliados</span><span><i class="lh"></i>Hoje, ao vivo</span><span><i class="lm"></i>Média</span></div>
  </section>`;
}
// curva suave que nunca desce (monotone cubic) por pontos [x, y] já em pixels
function suave(P) {
  const n = P.length; if (n < 2) return n ? `M${P[0][0]} ${P[0][1]}` : '';
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]), dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i] || 0.01; m[i] = (ys[i + 1] - ys[i]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; d += ` C${(xs[i] + h).toFixed(1)} ${(ys[i] + t[i] * h).toFixed(1)} ${(xs[i + 1] - h).toFixed(1)} ${(ys[i + 1] - t[i + 1] * h).toFixed(1)} ${xs[i + 1].toFixed(1)} ${ys[i + 1].toFixed(1)}`; }
  return d;
}
// ---------- cadastros ao vivo (logo abaixo das vendas) ----------
let cadIds = null, cadDesenhado = false;
function loadCad(j) {
  const L = j.cad_lista || [], LO = j.cad_ontem_lista || [], agora = j.agora_min, W = 1000, H = 200;
  const tot = L.length, ontemAte = LO.filter((c) => c.min <= agora).length, ontemTot = LO.length;
  const hmax = Math.max(2, ...j.cad_hoje, ...j.cad_ontem), cmax = Math.max(4, tot, ontemTot) * 1.15;
  const X = (m) => (m / 1440) * W, Yb = (n) => H - (n / hmax) * H * 0.62, Yc = (n) => H - (n / cmax) * H;
  const bar = (n, h, cls) => (n ? `<rect x="${X(h * 60 + 5).toFixed(1)}" y="${Yb(n).toFixed(1)}" width="${X(50).toFixed(1)}" height="${(H - Yb(n)).toFixed(1)}" rx="4" class="${cls}"><title>${h}h: ${n} cadastro${n === 1 ? '' : 's'}${cls === 'cbo' ? ' (ontem)' : ''}</title></rect>` : '');
  const barsO = j.cad_ontem.map((n, h) => bar(n, h, 'cbo')).join('');
  const barsH = j.cad_hoje.map((n, h) => (h * 60 <= agora ? bar(n, h, 'cbh') : '')).join('');
  const acum = (arr, fim) => { const P = [[0, Yc(0)]]; arr.forEach((c, i) => { if (c.min <= fim) P.push([Math.max(X(c.min), P[P.length - 1][0] + 0.5), Yc(i + 1)]); }); P.push([X(fim), P[P.length - 1][1]]); return P; };
  const PH = acum(L, agora), dH = suave(PH), dO = suave(acum(LO, 1440));
  const pontos = L.map((c, i) => `<i class="cp ${c.af ? 'af' : ''} ${c.comprou ? 'cmp' : ''} ${i === L.length - 1 ? 'ult' : ''}" style="left:${(c.min / 14.4).toFixed(2)}%;top:${((1 - (i + 1) / cmax) * 100).toFixed(2)}%" title="${c.h} · ${esc(c.nome || 'sem nome')}${c.af ? ' · veio de afiliado' : ''}${c.comprou ? ' · já comprou' : c.testou ? ' · já testou' : ''}"></i>`).join('');
  const rotH = j.cad_hoje.map((n, h) => (h * 60 <= agora && n ? `<span class="cbn" style="left:${((h * 60 + 30) / 14.4).toFixed(2)}%;top:${((Yb(n) / H) * 100).toFixed(2)}%">${n}</span>` : '')).join('');
  const dif = ontemAte > 0 ? (tot - ontemAte) / ontemAte : null;
  const novos = cadIds ? L.filter((c) => !cadIds.has(c.id)) : [];
  cadIds = new Set(L.map((c) => c.id));
  const pico = j.cad_hoje.reduce((b, n, h) => (n > b[0] ? [n, h] : b), [0, 0]);
  const ult = L.slice(-8).reverse();
  $('cadHoje').innerHTML = `<section class="hojeBox cadBox glass${novos.length ? ' nova' : ''}">
    <div class="hh"><div><span class="vivo c"><i></i>AO VIVO · CADASTROS DE HOJE</span>
      <div class="hv"><b class="cnt" data-to="${tot}" data-f="n">0</b><small>cadastro${tot === 1 ? '' : 's'} no teste grátis${tot ? ` · último às ${L[L.length - 1].h}` : ''}${pico[0] ? ` · pico às ${pico[1]}h (${pico[0]})` : ''}</small></div></div>
      <div class="hcmp">${dif === null ? (ontemTot ? '' : '<span>Ontem: sem cadastros</span>') : `<b class="${dif >= 0 ? 'up' : 'dn'}">${dif >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(dif) * 100)}%</b><span>vs ontem até esta hora (${ontemAte})</span>`}
        <span>ontem fechou com ${ontemTot} · média dos últimos 7 dias ${String(j.cad_media_7d).replace('.', ',')}/dia</span></div></div>
    <div class="cadG"><div><div class="hg"><div class="hy"><span>${Math.round(cmax)}</span><span>${Math.round(cmax / 2)}</span><span>0</span></div>
      <div class="hc"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="gCad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ff3ff" stop-opacity=".9"/><stop offset="1" stop-color="#3fd0ff" stop-opacity=".25"/></linearGradient>
          <linearGradient id="gCadA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ff3ff" stop-opacity=".22"/><stop offset="1" stop-color="#6ff3ff" stop-opacity="0"/></linearGradient></defs>
        ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="gr"/>`).join('')}
        ${barsO}${barsH}
        <path d="${dO}" class="on"/>
        <path d="${dH} L${X(agora).toFixed(1)} ${H} L0 ${H} Z" fill="url(#gCadA)" class="ar"/>
        <path d="${dH}" class="tl c${cadDesenhado ? '' : ' draw'}" pathLength="1"/>
        <line x1="${X(agora).toFixed(1)}" x2="${X(agora).toFixed(1)}" y1="0" y2="${H}" class="nw"/>
      </svg>${rotH}${pontos}<span class="agora" style="left:${(agora / 14.4).toFixed(2)}%">agora ${j.agora}</span></div></div>
      <div class="hx">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span>${h}h</span>`).join('')}</div></div>
      <div class="cadUlt"><small>ÚLTIMOS CADASTROS</small>${ult.length ? ult.map((c) => `<div${novos.some((n) => n.id === c.id) ? ' class="novo"' : ''}><b>${c.h}</b><span>${esc(c.nome || 'sem nome')}</span>${c.comprou ? '<em class="g">comprou</em>' : c.testou ? '<em class="y">testou</em>' : ''}${c.af ? '<em class="p">afiliado</em>' : ''}</div>`).join('') : '<p>Nenhum cadastro hoje ainda.</p>'}</div></div>
    <div class="hl"><span><i class="lcy"></i>Cadastros acumulados hoje</span><span><i class="lc"></i>Cadastros por hora (número em cima)</span><span><i class="lco"></i>Por hora ontem</span><span><i class="lo"></i>Acumulado ontem</span><span><i class="lp"></i>Veio de afiliado</span></div>
  </section>`;
  cadDesenhado = true;
  contar($('cadHoje'));
  if (novos.length) toast(`🎁 ${novos.length === 1 ? 'Novo cadastro: ' + (novos[0].nome || 'sem nome') + ' às ' + novos[0].h : novos.length + ' cadastros novos'}`);
}
const N2 = (v) => `<b class="cnt" data-to="${+v || 0}" data-f="brl">0</b>`;
setInterval(() => { if (!document.hidden && $('vPainel') && !$('vPainel').hidden && !$('tGeral').hidden) loadHoje(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('tGeral').hidden && !$('vPainel').hidden) loadHoje(); });

// ---------- medidor de saúde financeira ----------
function medidor(t, probs) {
  const cl = (x) => Math.max(0, Math.min(1, x)), pc = (v) => Math.round(v * 100) + '%';
  const meta = t.meta_vendas_dia || 3, ritmo = t.vendas_7d / 7;
  const cresc = t.vendas_7d_ant ? t.vendas_7d / t.vendas_7d_ant : t.vendas_7d ? 1.2 : 0;
  const F = [
    ['🎯', 'Conversão do teste grátis', 25, cl(t.conversao_teste / 0.05), `${pc(t.conversao_teste)} de quem testa compra (bom: 5% ou mais)`, 'Reforce o funil: e-mails, avisos no app e a tela de assinatura para quem já testou.'],
    ['⚡', 'Ritmo de vendas', 20, cl(ritmo / meta), `${ritmo.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} venda${ritmo === 1 ? '' : 's'} por dia nos últimos 7 dias (meta ${meta})`, 'Mais tráfego: anúncios, posts com antes e depois e afiliados.'],
    ['📈', 'Crescimento', 20, cl((cresc - 0.5) / 0.7), t.vendas_7d_ant ? `${t.vendas_7d} vendas nos últimos 7 dias contra ${t.vendas_7d_ant} nos 7 anteriores` : `${t.vendas_7d} vendas nos últimos 7 dias`, 'As vendas caíram em relação à semana anterior: veja o que mudou nos anúncios.'],
    ['↩', 'Reembolsos', 20, cl(1 - t.taxa_reembolso / 0.15), `${pc(t.taxa_reembolso)} do vendido voltou (bom: abaixo de 5%)`, 'Muitos reembolsos: veja no "O app está funcionando?" se alguém está travando.'],
    ['🛰️', 'Sistema funcionando', 15, cl(1 - probs * 0.35), probs ? `${probs} problema${probs === 1 ? '' : 's'} apontado${probs === 1 ? '' : 's'} pelo vigia` : 'Site, app, checkout, e-mails e Eduzz ok', 'Veja o que o vigia apontou na aba Vistoria.'],
  ];
  const nota = Math.round(F.reduce((a, f) => a + f[2] * f[3], 0));
  const [rot, cor] = nota >= 80 ? ['EXCELENTE', '#2ee59d'] : nota >= 60 ? ['BOA', '#b8f04a'] : nota >= 40 ? ['ATENÇÃO', '#ffb02e'] : ['CRÍTICA', '#ff4d5e'];
  const pior = F.slice().sort((a, b) => a[3] - b[3])[0];
  const arco = (a0, a1, c) => { const p = (a) => [100 + 80 * Math.cos(Math.PI * (1 - a)), 100 - 80 * Math.sin(Math.PI * (1 - a))]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A80 80 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" stroke="${c}" />`; };
  return `<div class="saudeRow">
    <div class="ncard gauge" style="--cor:${cor}"><div class="nh"><i>🧭</i><small>SAÚDE DO NEGÓCIO</small></div>
      <svg viewBox="0 0 200 118" class="gz"><g class="seg">${arco(0, 0.4, '#ff4d5e')}${arco(0.4, 0.6, '#ffb02e')}${arco(0.6, 0.8, '#b8f04a')}${arco(0.8, 1, '#2ee59d')}</g>
        ${[0, 20, 40, 60, 80, 100].map((v) => { const a = Math.PI * (1 - v / 100); return `<text x="${(100 + 98 * Math.cos(a)).toFixed(1)}" y="${(104 - 98 * Math.sin(a)).toFixed(1)}">${v}</text>`; }).join('')}
        <g class="agulha" style="--rot:${(nota / 100) * 180 - 90}deg"><path d="M97 100 L100 30 L103 100 Z" fill="${cor}"/><circle cx="100" cy="100" r="8" fill="#0b0c16" stroke="${cor}" stroke-width="3"/></g></svg>
      <div class="gnota"><b class="cnt" data-to="${nota}" data-f="n" style="color:${cor}">0</b><span style="color:${cor}">${rot}</span></div>
      <p class="gdica">Ponto mais fraco agora: <b>${pior[1]}</b>. ${pior[5]}</p></div>
    <div class="ncard fatores"><div class="nh"><i>📊</i><small>O QUE ENTRA NA NOTA</small></div>
      ${F.map(([ic, nome, peso, v, txt]) => { const c2 = v >= 0.8 ? 'var(--g)' : v >= 0.5 ? 'var(--y)' : 'var(--r)'; return `<div class="fat"><div class="ft"><span>${ic} ${nome} <small>peso ${peso}</small></span><b style="color:${c2}">${Math.round(v * 100)}</b></div><div class="fb"><i style="width:${Math.max(3, v * 100)}%;background:${c2}"></i></div><small>${txt}</small></div>`; }).join('')}
    </div></div>`;
}

// ---------- visão geral ----------
let dias = 30;
document.querySelectorAll('.segP').forEach((sg) => (sg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; dias = +b.dataset.d; document.querySelectorAll('.segP button').forEach((x) => x.classList.toggle('on', +x.dataset.d === dias)); $('tFin').hidden ? loadGeral() : loadFin(); }));
// ---------- vistoria de erros (de 10 em 10 minutos) ----------
const ROT = { novo: ['🆕 NOVO', 'r'], aumentou: ['📈 AUMENTOU', 'r'], voltou: ['🔁 VOLTOU', 'r'] };
const desde = (s) => { if (!s) return '—'; const m = Math.round((Date.now() - new Date(s.replace(' ', 'T') + '-03:00')) / 60000); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.floor(m / 60)} h` : dt(s); };
async function loadVigiaErros() {
  const j = await api('vigia-erros'); if (!j.ok) return;
  const v = j.vigia, gs = j.grupos || [], alertas = (v && v.alertas) || [];
  const agora = gs.filter((g) => g.status === 'aberto' && g.h1 > 0);
  const pend = gs.filter((g) => g.status === 'aberto' && !g.h1);
  const ok = gs.filter((g) => g.status !== 'aberto');
  const aps = (o) => Object.entries(o || {}).map(([a, n]) => `${esc(a)} (${n})`).join(' · ');
  const linha = (g) => {
    const al = alertas.find((a) => a.sig === g.sig);
    const sit = g.status === 'resolvido' ? (g.resolvido_por === 'claude' ? `<span class="st active">✅ Corrigido pelo Claude ${desde(g.resolvido_em)}</span>` : g.resolvido_por === 'auto' ? '<span class="st active">✅ Resolvido: 24h sem acontecer</span>' : '<span class="st active">✅ Marcado como corrigido por você</span>')
      : g.status === 'ignorado' ? '<span class="st">🔕 Ignorado</span>'
      : (g.h1 ? '<span class="st blocked">🔴 Acontecendo agora</span>' : '<span class="st trial">🟡 Pendente</span>') + ' <span class="st cortesia">🔧 O Claude está cuidando</span>';
    const bt = g.status === 'aberto' ? `<button class="btn sm ghost" data-erro="${g.sig}" data-st="resolvido" title="Avisa de novo se voltar a acontecer">✓ Já foi corrigido</button> <button class="btn sm ghost" data-erro="${g.sig}" data-st="ignorado" title="Não avisa mais deste erro">Ignorar</button>` : `<button class="btn sm ghost" data-erro="${g.sig}" data-st="aberto">Reabrir</button>`;
    return `<tr><td>${sit}${al ? ` <span class="st blocked">${ROT[al.motivo]?.[0] || ''}</span>` : ''}<b>${g.tipo === 'fechou' ? '📵' : '❌'} ${esc(g.etapa || 'app')}</b><small>${esc(g.msg)}</small><small>última vez <b>${desde(g.ultimo)}</b> · primeira ${dt(g.primeiro)} · ${g.total} no total</small>${g.resolvido_por === 'claude' && g.nota ? `<small>correção: ${esc(g.nota)}</small>` : ''}</td>
      <td>${g.h1 ? `<b style="color:#ff6b6b">${g.h1}</b>` : '0'}</td><td>${g.h24}<small>${g.pessoas_24h} pessoa${g.pessoas_24h === 1 ? '' : 's'}</small>${g.pagos_24h ? `<small style="color:var(--y)">💛 ${g.pagos_24h} cliente${g.pagos_24h === 1 ? '' : 's'} pago${g.pagos_24h === 1 ? '' : 's'} (prioridade)</small>` : ''}</td><td><small>${aps(g.aparelhos)}</small></td><td>${bt}</td></tr>`;
  };
  const tabela = (lista) => `<div class="glass tbl"><table><tr><th>Erro</th><th>Última hora</th><th>24h</th><th>Aparelhos</th><th></th></tr>${lista.map(linha).join('')}</table></div>`;
  const resumo = agora.length ? `<b>🔴 ${agora.length} erro${agora.length === 1 ? '' : 's'} acontecendo agora (na última hora)</b>`
    : pend.length ? `<b>🟡 Nada acontecendo agora. ${pend.length} erro${pend.length === 1 ? '' : 's'} ainda pendente${pend.length === 1 ? '' : 's'}: aconteceu nas últimas 24h e ninguém marcou como corrigido.</b>`
    : '<b>✅ Nenhum erro pendente</b>';
  $('vigiaErros').innerHTML = `<section class="bloco">
    <div class="bh"><span class="tag ${agora.length ? 'r' : 'g'}">🛰️ VISTORIA DE ERROS · A CADA 10 MIN</span><small>${v ? `última vistoria ${desde(v.quando)} · ${v.erros_1h} erro${v.erros_1h === 1 ? '' : 's'} na última hora · ${v.erros_24h} em 24h` : 'ainda não rodou'} <button class="btn sm ghost" id="vigiaAgora">Vistoriar agora</button></small></div>
    <div class="vigia ${agora.length ? 'mal' : pend.length ? '' : 'ok'}">${resumo}
      <small><b>Como funciona:</b> a vistoria encontra os erros a cada 10 minutos. O Claude confere esta lista de hora em hora, corrige no código e, quando a correção entra no ar, o erro fica verde sozinho (✅ Corrigido pelo Claude). Você não precisa avisar nem marcar nada, só acompanhar. Se um erro corrigido voltar, ele reaparece aqui como 🔁 VOLTOU e o Claude olha de novo. Erro de cliente pago (💛) vem primeiro na fila, e o cliente recebe na hora um pedido de desculpas no app e por e-mail.</small></div>
    ${agora.length ? `<h4 class="vh">🔴 Acontecendo agora</h4>${tabela(agora)}` : ''}
    ${pend.length ? `<h4 class="vh">🟡 Pendentes (aconteceram nas últimas 24h, não na última hora)</h4>${tabela(pend)}` : ''}
    ${ok.length ? `<details class="vh"><summary>✅ Resolvidos e ignorados (${ok.length})</summary>${tabela(ok)}</details>` : ''}
  </section>`;
  $('vigiaAgora').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Vistoriando…'; await api('vigia-agora', {}); toast('Vistoria feita.'); loadVigiaErros(); };
  $('vigiaErros').querySelectorAll('[data-erro]').forEach((b) => (b.onclick = async () => { const r = await api('erro-marcar', { sig: b.dataset.erro, status: b.dataset.st }); if (!r.ok) return toast(r.error || 'Não deu.'); toast(b.dataset.st === 'resolvido' ? 'Marcado como corrigido. Se voltar, a vistoria avisa.' : b.dataset.st === 'ignorado' ? 'Esse erro não vai mais gerar aviso.' : 'Reaberto.'); loadVigiaErros(); }));
}
setInterval(() => { if (!document.hidden && $('vigiaErros') && $('vigiaErros').offsetParent) loadVigiaErros().catch(() => {}); }, 60000);

// ---------- escudo de segurança (defesa: barra e bloqueia, nunca ataca ninguém) ----------
async function loadEscudo() {
  const j = await api('escudo'); if (!j.ok) return;
  const c = j.checagem, pr = (c && c.problemas) || {}, np = Object.keys(pr).length, cont = j.contagem || {}, nome = j.nomes || {};
  const barrados = ['armadilha', 'injecao', 'login_admin', 'login', 'chave', 'limite'].reduce((s, k) => s + ((cont[k] && cont[k].n) || 0), 0);
  const gh = j.github || {};
  const card = (cor, ico, rot, v, sub) => `<div class="ncard ${cor}"><div class="nh"><i>${ico}</i><small>${rot}</small></div><b class="cnt">${v}</b><span>${sub}</span></div>`;
  const ev = (e) => `<tr><td>${dt(e.created_at)}</td><td><b>${esc(nome[e.tipo] || e.tipo)}</b><small>${esc(e.detalhe || '')}</small></td><td>${esc(e.ip || '')}<small>${esc((e.ua || '').slice(0, 60))}</small></td></tr>`;
  $('escudo').innerHTML = `<section class="bloco">
    <div class="bh"><span class="tag ${np ? 'r' : 'g'}">🛡️ ESCUDO DE SEGURANÇA</span><small>${c ? `última checagem ${desde(c.quando)}` : 'ainda não rodou'} <button class="btn sm ghost" id="escAgora">Checar agora</button></small></div>
    <div class="vigia ${np ? 'mal' : 'ok'}">${np ? `<b>⚠️ A checagem achou ${np} ponto${np === 1 ? '' : 's'} de atenção</b><ul>${Object.values(pr).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : c ? '<b>✅ Site íntegro: nenhum arquivo alterado, nada secreto aberto na internet</b>' : '<b>⏳ A primeira checagem roda em poucos minutos</b>'}
      <small><b>Como funciona:</b> o escudo anota toda tentativa suspeita (senha errada em série, chave secreta errada, robô procurando falha, tentativa de injetar código) e bloqueia o IP por algumas horas quando passa do limite. A cada poucos minutos ele confere se algum arquivo do site foi mexido (se foi, volta ao original sozinho) e tira do ar qualquer arquivo estranho. Você recebe e-mail e aviso no celular. Ele só se defende: não ataca ninguém.</small></div>
    <div class="cards4">
      ${card(barrados ? 'r' : 'g', '🚫', 'Tentativas barradas (24h)', barrados, `${(cont.armadilha && cont.armadilha.n) || 0} robôs nas armadilhas · ${(cont.login_admin && cont.login_admin.n) || 0} senhas erradas no painel`)}
      ${card(j.bloqueados.length ? 'y' : 'g', '⛔', 'IPs bloqueados agora', j.bloqueados.length, 'bloqueio some sozinho em algumas horas')}
      ${card(c && c.restaurados && c.restaurados.length ? 'r' : 'g', '🧬', 'Arquivos do site', c && c.restaurados && c.restaurados.length ? c.restaurados.length + ' restaurado(s)' : 'íntegros', c && c.quarentena && c.quarentena.length ? c.quarentena.length + ' em quarentena' : 'nada estranho')}
      ${card(gh.ok ? 'g' : 'y', '🔑', 'Chave do GitHub', gh.ok ? 'ok' : gh.tem ? 'com problema' : 'falta', gh.ok ? `termina em …${esc(gh.final)} · testada ${desde(gh.testado)}` : 'para o código ficar privado')}
    </div>
    ${j.bloqueados.length ? `<h4 class="vh">⛔ Bloqueados agora</h4><div class="glass tbl"><table><tr><th>IP</th><th>Motivo</th><th>De onde (aproximado)</th><th>Até</th><th></th></tr>${j.bloqueados.map((b) => `<tr><td>${esc(b.ip)}${b.ip === j.meu_ip ? ' <span class="st trial">é você</span>' : ''}</td><td>${esc(b.motivo)}<small>${b.vezes > 1 ? b.vezes + 'ª vez' : ''}</small></td><td>${b.local ? '📍 ' + esc(b.local) : '<small>localização indisponível</small>'}</td><td>${dt(b.ate)}</td><td><button class="btn sm ghost" data-desb="${esc(b.ip)}">Desbloquear</button></td></tr>`).join('')}</table></div>` : ''}
    <details class="vh"${gh.ok ? '' : ' open'}><summary>🔑 Chave do GitHub (código privado): ${gh.ok ? '✅ funcionando' : 'cole aqui a chave github_pat_'}</summary><div class="glass formgrid">
      <p class="sub full">Com o código privado no GitHub, o site precisa desta chave para buscar a versão nova. Ela fica guardada fora do site, nunca aparece no painel (só o final), e só serve para LER o código.</p>
      <label class="full">Cole a chave (começa com github_pat_)<div class="copy"><input id="ghTok" type="password" autocomplete="off" placeholder="github_pat_..."><button type="button" class="btn sm" id="ghSalvar">Testar e salvar</button></div></label>
      <span class="msg full" id="ghMsg">${gh.ok ? `✅ Chave salva e testada${gh.privado ? ' · repositório já está privado' : ' · repositório ainda público'}` : ''}</span>
    </div></details>
    <details class="vh"><summary>📜 Últimos acontecimentos (${j.eventos.length})</summary><div class="glass tbl"><table><tr><th>Quando</th><th>O que</th><th>De onde</th></tr>${j.eventos.map(ev).join('')}</table></div></details>
  </section>`;
  $('escAgora').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Checando…'; const r = await api('escudo-agora', {}); toast(r.ok ? (r.escudo === 'ok' ? 'Tudo certo.' : 'Checagem feita: veja os pontos de atenção.') : r.error || 'Não deu.'); loadEscudo(); };
  $('ghSalvar').onclick = async (e) => { e.target.disabled = true; $('ghMsg').textContent = 'Testando com o GitHub…'; const r = await api('escudo-github', { token: $('ghTok').value }); e.target.disabled = false; $('ghMsg').textContent = r.ok ? '✅ Chave funcionando e salva.' : '❌ ' + r.error; if (r.ok) { $('ghTok').value = ''; setTimeout(loadEscudo, 1500); } };
  $('escudo').querySelectorAll('[data-desb]').forEach((b) => (b.onclick = async () => { const r = await api('escudo-desbloquear', { ip: b.dataset.desb }); toast(r.ok ? 'Desbloqueado.' : r.error || 'Não deu.'); loadEscudo(); }));
}

async function loadAppSaude() {
  const j = await api('app-saude', null, '&dias=7'); if (!j.ok) return;
  const c = j.cont, pc = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const card = (cor, ico, rot, v, sub) => `<div class="ncard ${cor}"><div class="nh"><i>${ico}</i><small>${rot}</small></div><b class="cnt" data-to="${+v || 0}" data-f="n">0</b><span>${sub}</span></div>`;
  const tx = c.inicio ? c.abriu / c.inicio : 1, ruim = c.inicio >= 3 && tx < 0.7;
  const min = (s) => (s >= 60 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : s + ' s');
  $('appSaude').innerHTML = `<section class="bloco">
    <div class="bh"><span class="tag ${ruim ? 'r' : 'g'}">🩺 O APP ESTÁ FUNCIONANDO?</span><small>últimos 7 dias · o próprio app avisa o que aconteceu com cada vídeo${j.desde ? ' (desde ' + dt(j.desde) + ')' : ''}</small></div>
    ${!c.inicio ? `<div class="vigia"><b>Ainda sem dados do app.</b><small>${j.usos} vídeo${j.usos === 1 ? '' : 's'} começado${j.usos === 1 ? '' : 's'} nos últimos 7 dias. O diário de cada vídeo começa a chegar a partir de agora.</small></div>` : ''}
    <div class="cards4">
      ${card('y', '🎬', 'Vídeos começados', c.inicio, `${j.pessoas} pessoa${j.pessoas === 1 ? '' : 's'}`)}
      ${card(ruim ? 'r' : 'g', '✅', 'Abriram no estúdio', c.abriu, `${pc(c.abriu, c.inicio)} dos começados · tempo típico ${min(j.tempo_mediano)}`)}
      ${card('c', '⬇️', 'Vídeos exportados', c.exportou, `${c.pronto} usaram o "tudo automático" · ${c.quisbaixar || 0} no teste tocaram em baixar (viram a oferta)${c.liberou ? ` · ${c.liberou} compraram e baixaram na hora` : ''}`)}
      ${card(c.erro + c.fechou ? 'r' : 'g', '⚠️', 'Erros e travamentos', c.erro + c.fechou, `${c.erro} erro${c.erro === 1 ? '' : 's'} · ${c.fechou} vez${c.fechou === 1 ? '' : 'es'} o celular fechou o app`)}
    </div>
    ${j.aparelhos.length ? `<div class="glass tbl"><table><tr><th>Aparelho</th><th>Começou</th><th>Abriu</th><th>Exportou</th><th>Erros</th></tr>${j.aparelhos.map((a) => `<tr><td>${esc(a.aparelho)}${a.forca ? `<small>força ${a.forca} · ${a.compat === 'incompativel' ? '⛔ avisado: incompatível' : a.compat === 'fraco' ? '⚠️ avisado: no limite' : '✓ compatível'}</small>` : ''}</td><td>${a.inicio}</td><td>${a.abriu}</td><td>${a.exportou}</td><td>${a.erro + a.fechou ? `<b style="color:#ff6b6b">${a.erro + a.fechou}</b>` : '0'}</td></tr>`).join('')}</table></div>` : ''}
    ${j.problemas.length ? `<div class="glass tbl"><table><tr><th>Quando</th><th>Aluno</th><th>Aparelho</th><th>O que houve</th></tr>${j.problemas.map((p) => `<tr><td>${dt(p.quando)}</td><td>${esc(p.nome || '')}<small>${esc(p.email || '')}</small></td><td>${esc(p.aparelho)}${p.mem ? `<small>${esc(p.mem)} GB de memória</small>` : ''}${p.forca ? `<small>força ${esc(p.forca)}${p.compat && p.compat !== 'ok' ? ' · ' + (p.compat === 'incompativel' ? '⛔ incompatível' : '⚠️ no limite') : ''}</small>` : ''}</td><td>${p.tipo === 'fechou' ? '📵 O celular fechou o app' : '❌ Erro'} em <b>${esc(p.etapa)}</b>${p.mb ? ` · vídeo de ${esc(p.mb)} MB` : ''}<small>${esc(p.msg)}</small></td></tr>`).join('')}</table></div>` : ''}
  </section>`;
  contar($('appSaude'));
}
let fatSerie = null, fatPeriodo = 0;
function desenhaFat() {
  if (!fatSerie || $('fatBox').hidden) return;
  const per = { 7: '7 dias', 30: '30 dias', 90: '90 dias', 365: '12 meses' }[dias] || dias + ' dias';
  const hojeV = fatSerie[fatSerie.length - 1].v, comVenda = fatSerie.filter((p) => p.v > 0).length;
  $('fatPer').textContent = 'líquido · últimos ' + per;
  $('fatTot').textContent = brl(fatPeriodo);
  $('fatLeg').textContent = `Hoje: ${brl(hojeV)} · média ${brl0(fatPeriodo / fatSerie.length)}/dia · ${comVenda} dia${comVenda === 1 ? '' : 's'} com venda`;
  G.area($('cFat'), fatSerie, { color: '#ffd400', fmt: (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + 'k' : Math.round(v)) });
}
addEventListener('resize', () => { clearTimeout(desenhaFat.t); desenhaFat.t = setTimeout(desenhaFat, 200); });

// ---------- visão geral: comissões, termômetro e anúncios ----------
function renderGeral(j) {
  const t = j.tot, per = { 7: '7 dias', 30: '30 dias', 90: '90 dias', 365: '12 meses' }[dias];
  const probs = t.saude && t.saude.problemas ? Object.keys(t.saude.problemas).length : 0;
  const N = (v, f = 'brl') => `<b class="cnt" data-to="${+v || 0}" data-f="${f}">0</b>`;
  const liq = t.faturamento_periodo, ads = t.anuncios_periodo || 0, lucro = liq - ads, sp = t.socio_pct, lp = 100 - sp;
  const pessoa = (ini, nome, pct, cls) => `<div class="cpes ${cls}"><div class="cav"><span>${ini}</span></div><div><small>${nome} · ${pct}%</small>${N(liq * pct / 100)}
    <span>${ads ? `depois dos anúncios: <b>${brl(lucro * pct / 100)}</b>` : `no mês: ${brl(t.faturamento_mes * pct / 100)}`}</span></div></div>`;
  $('comBox').innerHTML = `<div class="comBox glass">
    <div class="cmain"><span class="tag y">💰 COMISSÃO DOS SÓCIOS · ${per.toUpperCase()}</span>
      <div class="ctot">${N(liq)}<small>líquido que caiu (já sem a taxa da Eduzz)</small></div>
      <div class="cchips"><span>🛒 <b>${t.vendas_periodo}</b> venda${t.vendas_periodo === 1 ? '' : 's'}</span><span>🎫 ticket <b>${brl0(t.ticket_medio)}</b></span><span>📅 hoje <b>${brl0(t.faturamento_hoje)}</b></span><span>🎁 <b>${t.testes_periodo}</b> cadastro${t.testes_periodo === 1 ? '' : 's'}</span><span>🎯 conversão <b>${Math.round(t.conversao_teste * 100)}%</b></span></div></div>
    <div class="cpess">${pessoa('L', 'Leo', lp, 'y')}${pessoa('R', 'Reinaldo', sp, 'c')}</div></div>`;
  contar($('comBox'));
  $('termo').innerHTML = `<div class="glass termoBox">${medidor(t, probs)}</div>`;
  contar($('termo'));
  renderAds(t, per);
  fatSerie = j.faturamento; fatPeriodo = liq; desenhaFat();
}
function renderAds(t, per) {
  const ads = t.anuncios_periodo || 0, liq = t.faturamento_periodo, v = t.vendas_periodo, cad = t.testes_periodo;
  const roas = ads ? liq / ads : null, roi = ads ? (liq - ads) / ads : null;
  const cor = roi === null ? '' : roi >= 1 ? 'g' : roi >= 0 ? 'y' : 'r';
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const L = t.anuncios_lista || [];
  $('adsBox').innerHTML = `<div class="glass adsBox">
    <div class="nh"><i>📣</i><small>ANÚNCIOS · ${per.toUpperCase()}</small></div>
    <div class="adsG">
      <div class="ak big ${cor}"><small>Retorno por real gasto</small><b>${roas === null ? '—' : brl(roas)}</b><span>${roas === null ? 'lance o gasto abaixo' : `para cada R$ 1 em anúncio`}</span></div>
      <div class="ak ${cor}"><small>ROI</small><b>${roi === null ? '—' : (roi >= 0 ? '+' : '') + Math.round(roi * 100) + '%'}</b><span>${roi === null ? '' : roi >= 0 ? 'lucro sobre o gasto' : 'gastou mais do que voltou'}</span></div>
      <div class="ak"><small>Investido</small><b>${brl0(ads)}</b><span>no período</span></div>
      <div class="ak"><small>Custo por venda</small><b>${ads && v ? brl0(ads / v) : '—'}</b><span>${v} venda${v === 1 ? '' : 's'}</span></div>
      <div class="ak"><small>Custo por cadastro</small><b>${ads && cad ? brl(ads / cad) : '—'}</b><span>${cad} no teste</span></div>
      <div class="ak ${cor}"><small>Lucro após anúncios</small><b>${brl0(liq - ads)}</b><span>líquido − anúncios</span></div>
    </div>
    <form class="adsF" id="adsF"><label>Impulsionamento (lançar à mão)<input name="valor" inputmode="decimal" placeholder="Ex.: 2.000" required></label><label>Dia<input name="dia" type="date" value="${hoje}" max="${hoje}"></label><label>Conta do anúncio<select name="conta"><option value="leo">Leo (leo-ads)</option><option value="reinaldo">Reinaldo (reinaldo-ads)</option><option value="">Outra / geral</option></select></label><label>Nota (opcional)<input name="nota" maxlength="80" placeholder="Instagram, TikTok…"></label><button class="btn sm">+ Lançar gasto</button></form>
    ${L.length ? `<details class="adsL"><summary>Gastos lançados (${L.length}) · total geral ${brl0(t.anuncios_total)}</summary>${L.map((a) => `<div><span>${a.dia.slice(8, 10)}/${a.dia.slice(5, 7)}/${a.dia.slice(2, 4)}</span><b>${brl(a.valor)}</b><em>${a.conta ? `<b>${esc(a.conta)}</b> ` : ''}${esc(a.nota || '')}</em><button class="lnk" data-del-ad="${a.id}" title="Apagar">✕</button></div>`).join('')}</details>` : '<p class="sub adsDica">Anúncios do Gerenciador entram sozinhos (aba Origens). Aqui você lança só o impulsionamento feito pelo Instagram.</p>'}
  </div>`;
  $('adsF').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); const r = await api('anuncio-add', Object.fromEntries(f)); if (!r.ok) return toast(r.error || 'Não deu.'); toast('Gasto lançado.'); const j = await getResumo(); if (j.ok) renderGeral(j); };
  $('adsBox').querySelectorAll('[data-del-ad]').forEach((b) => (b.onclick = async () => { if (!confirm('Apagar esse gasto?')) return; await api('anuncio-del', { id: b.dataset.delAd }); const j = await getResumo(); if (j.ok) renderGeral(j); }));
}
// selo de erros na última hora (menu e botão do canto)
async function vistBadge() {
  try { const j = await api('vigia-erros'); if (!j.ok) return; const n = (j.grupos || []).filter((g) => g.status === 'aberto').reduce((a, g) => a + (+g.h1 || 0), 0);
    [$('vistBadge'), $('vistBtnN')].forEach((el) => { el.hidden = !n; el.textContent = n > 99 ? '99+' : n; }); $('vistBtn').classList.toggle('alerta', !!n); } catch {}
}
$('vistBtn').onclick = () => tab('vistoria');
setInterval(() => { if (!document.hidden && $('vPainel') && !$('vPainel').hidden) vistBadge(); }, 60000);

let resumoJ = null;
async function getResumo() { const j = await api('resumo', null, '&dias=' + dias); if (j.ok) resumoJ = j; return j; }
async function loadGeral() {
  loadHoje(); vistBadge();
  const j = await getResumo(); if (!j.ok) return;
  renderGeral(j);
}
async function loadFin() { const j = await getResumo(); if (j.ok) renderFin(j); }
async function loadVist() {
  loadVigiaErros(); loadEscudo(); loadAppSaude();
  const j = resumoJ && resumoJ.dias === dias ? resumoJ : await getResumo();
  if (j && j.ok) $('vigiaSite').innerHTML = vigiaSiteHtml(j.tot);
}
function vigiaSiteHtml(t) {
  const sd = t.saude, probs = sd && sd.problemas ? Object.values(sd.problemas) : [];
  return !sd ? '<div class="vigia"><b>🛰️ Vigia do site</b> ainda não rodou. Ele roda junto com a tarefa de hora em hora.</div>'
    : probs.length ? `<div class="vigia mal"><b>⚠️ O vigia do site encontrou ${probs.length === 1 ? 'um problema' : probs.length + ' problemas'}</b><ul>${probs.map((m) => '<li>' + esc(m) + '</li>').join('')}</ul><small>Checado em ${esc(sd.quando)}. Os administradores recebem aviso por e-mail.</small></div>`
    : `<div class="vigia ok"><b>🛰️ Site funcionando</b><small>Site, app, checkout, e-mails e Eduzz checados em ${esc(sd.quando)}.</small></div>`;
}
function renderFin(j) {
  const t = j.tot;
  const pc = (v) => Math.round(v * 100) + '%';
  const per = { 7: '7 dias', 30: '30 dias', 90: '90 dias', 365: '12 meses' }[dias];
  const varMes = t.fat_mes_anterior > 0 ? (t.faturamento_mes - t.fat_mes_anterior) / t.fat_mes_anterior : null;
  // número que conta até o valor: data-to + data-f (brl | n | pc)
  const N = (v, f = 'n') => `<b class="cnt" data-to="${+v || 0}" data-f="${f}">0</b>`;
  const card = (cor, ico, rot, v, f, sub, extra = '') => `<div class="ncard ${cor}"><div class="nh"><i>${ico}</i><small>${rot}</small></div>${N(v, f)}<span>${sub}</span>${extra}</div>`;
  const pessoas = t.alunos_pagos + t.cortesias + t.em_teste + t.reembolsos + t.bloqueados;
  const fat = (v) => (pessoas ? Math.max(v ? 3 : 0, (v / pessoas) * 100) : 0);
  $('nums').innerHTML = `
  <section class="bloco">
    <div class="bh"><span class="tag y">💰 SAÚDE FINANCEIRA</span><small>valores líquidos: o que a Eduzz paga, já sem a taxa. Cortesia não entra aqui.</small></div>
    <div class="hero">
      <div class="hmain"><small>LÍQUIDO QUE CAIU PARA OS SÓCIOS</small>${N(t.faturamento_total, 'brl')}
        <span>${brl(t.bruto_total)} vendidos − ${brl(t.taxas_total)} taxa da Eduzz${t.comissoes_total ? ` − ${brl(t.comissoes_total)} comissão de afiliados` : ''}${t.reembolsado_total ? ` − ${brl(t.reembolsado_total)} reembolsados` : ''} · ${t.alunos_pagos} aluno${t.alunos_pagos === 1 ? '' : 's'} pagando</span>
        <div class="socios"><div><small>Leo (${100 - t.socio_pct}%)</small>${N(t.faturamento_total * (100 - t.socio_pct) / 100, 'brl')}</div><div><small>Reinaldo (${t.socio_pct}%)</small>${N(t.faturamento_total * t.socio_pct / 100, 'brl')}</div></div>
      </div>
      <div class="hgrid">
        ${card('y', '📅', 'No mês', t.faturamento_mes, 'brl', varMes === null ? `hoje: ${brl0(t.faturamento_hoje)}` : `${varMes >= 0 ? '▲' : '▼'} ${pc(Math.abs(varMes))} vs mês passado · hoje ${brl0(t.faturamento_hoje)}`)}
        ${card('y', '⏱', 'Nos últimos ' + per, t.faturamento_periodo, 'brl', `${t.vendas_periodo} venda${t.vendas_periodo === 1 ? '' : 's'} · ticket ${brl0(t.ticket_medio)}`)}
        ${card('g', '🔁', 'Receita recorrente / mês', t.mrr, 'brl', `carteira anual ativa: ${brl0(t.carteira_anual)}`)}
        ${card(t.taxa_reembolso > 0.1 ? 'r' : 'c', '↩', 'Reembolsos', t.reembolsado_total, 'brl', `${pc(t.taxa_reembolso)} do vendido · ${t.reembolsos_periodo} no período`)}
      </div>
    </div>
    <div class="origem">
      ${[['direto', '🎯', 'VENDAS DIRETAS (NOSSAS)', 'y', `${t.vendas_direto} venda${t.vendas_direto === 1 ? '' : 's'} · ${brl0(t.bruto_direto)} vendidos · no mês ${brl0(t.liq_direto_mes)}`],
         ['afiliado', '🤝', 'VENDAS DE AFILIADOS', 'p', `${t.vendas_afiliado} venda${t.vendas_afiliado === 1 ? '' : 's'} · ${brl0(t.bruto_afiliado)} vendidos · ${brl0(t.comissoes_total)} de comissão (${t.af_comissao_pct}%) · no mês ${brl0(t.liq_afiliado_mes)}`]]
        .map(([k, ico, rot, cor, sub]) => `<div class="ncard ${cor} og"><div class="nh"><i>${ico}</i><small>${rot} · LÍQUIDO</small></div>${N(t['liq_' + k], 'brl')}<span>${sub}</span>
          <div class="socios"><div><small>Leo (${100 - t.socio_pct}%)</small>${N(t['liq_' + k] * (100 - t.socio_pct) / 100, 'brl')}</div><div><small>Reinaldo (${t.socio_pct}%)</small>${N(t['liq_' + k] * t.socio_pct / 100, 'brl')}</div></div></div>`).join('')}
    </div>
  </section>
  <section class="bloco">
    <div class="bh"><span class="tag p">👥 ALUNOS</span><small>pagos, cortesias e teste grátis separados</small></div>
    <div class="cards4">
      ${card('g', '✅', 'Pagos', t.alunos_pagos, 'n', `${t.reembolsos} reembolso${t.reembolsos === 1 ? '' : 's'}`)}
      ${card('p', '🎟', 'Cortesia', t.cortesias, 'n', 'acesso liberado sem pagar')}
      ${card('y', '🎁', 'Em teste grátis', t.em_teste, 'n', `${t.teste_acabou} já usaram o teste`)}
      ${card('c', '🎯', 'Conversão do teste', t.conversao_teste, 'pc', `${t.testes_convertidos} de ${t.testes_total} compraram`)}
    </div>
    <div class="barra"><i class="g" style="--w:${fat(t.alunos_pagos)}%"></i><i class="p" style="--w:${fat(t.cortesias)}%"></i><i class="y" style="--w:${fat(t.em_teste)}%"></i><i class="r" style="--w:${fat(t.reembolsos + t.bloqueados)}%"></i></div>
    <p class="bleg"><span class="g">● Pagos ${t.alunos_pagos}</span><span class="p">● Cortesia ${t.cortesias}</span><span class="y">● Teste ${t.em_teste}</span><span class="r">● Reembolso/bloqueio ${t.reembolsos + t.bloqueados}</span><span>${t.total_contas} contas no total</span></p>
  </section>
  <section class="bloco">
    <div class="bh"><span class="tag c">⚡ USO DO APP</span><small>${per}</small></div>
    <div class="cards4">
      ${card('c', '🎬', 'Vídeos processados', t.videos_periodo, 'n', 'no período')}
      ${card('p', '📲', 'Ativos (7 dias)', t.ativos_7d, 'n', 'abriram o app')}
      ${card('y', '🆕', 'Cadastros no teste', t.testes_periodo, 'n', 'no período')}
      ${card(t.emails_falha_7d ? 'r' : 'g', '✉️', 'E-mails (7 dias)', t.emails_ok_7d, 'n', t.emails_falha_7d ? `${t.emails_falha_7d} falharam · veja em Funil` : 'todos entregues ao servidor')}
    </div>
  </section>`;
  contar($('nums'));
  G.ring($('cConv'), t.conversao_teste, { color: '#a77bff' });
  $('convLeg').textContent = `${t.testes_convertidos} compraram de ${t.testes_total} que testaram`;
  G.bars($('cVendas'), j.vendas, { color: '#2ee59d' });
  G.area($('cUso'), j.cadastros, { color: '#ffd400', second: j.videos, color2: '#2ee59d' });
  const parts = [{ v: t.alunos_pagos, c: '#2ee59d', n: 'Pagos' }, { v: t.cortesias, c: '#a77bff', n: 'Cortesia' }, { v: t.em_teste, c: '#ffd400', n: 'Teste' }, { v: t.reembolsos + t.bloqueados, c: '#ff4d5e', n: 'Reembolso/bloqueio' }];
  G.donut($('cBase'), parts);
  $('baseLeg').innerHTML = parts.map((p) => `<span style="color:${p.c}">●</span> ${p.n} ${p.v}`).join(' &nbsp; ');
  $('ultVendas').innerHTML = j.ultimas_vendas.length ? `<table><tr><th>Quando</th><th>Aluno</th><th>Venda</th><th>Líquido</th><th>Status</th><th></th></tr>${j.ultimas_vendas.map((v) => `<tr><td>${dt(v.created_at)}</td><td>${esc(v.name || '')}<small>${esc(v.email)}</small></td><td>${brl(v.bruto ?? v.value)}<small>taxa ${brl(Math.abs(v.taxa || 0))}</small></td><td><b>${brl(v.liquido ?? v.value)}</b><small>${brl((v.liquido ?? v.value) / 2)} cada</small></td><td><span class="st ${esc(v.status)}">${esc(v.status)}</span></td><td><button class="btn sm ghost" data-apagar-venda="${v.id}" title="Apagar venda lançada por engano">Apagar</button></td></tr>`).join('')}</table>` : '<p class="sub">Nenhuma venda ainda. Elas aparecem aqui assim que a Eduzz avisar.</p>';
}
$('ultVendas').onclick = async (e) => {
  const b = e.target.closest('[data-apagar-venda]'); if (!b) return;
  if (!confirm('Apagar esta venda do faturamento? Use só para venda de teste ou lançada por engano. Não mexe na Eduzz.')) return;
  const j = await api('venda-apagar', { id: +b.dataset.apagarVenda });
  if (j.ok) { toast('Venda apagada do faturamento.'); loadGeral(); } else toast(j.error || 'Não deu certo.');
};
let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => !$('tFin').hidden && resumoJ && renderFin(resumoJ), 300); });

// ---------- alunos ----------
let fStatus = '', pag = 1, buscaT;
$('fStatus').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; fStatus = b.dataset.s; pag = 1; $('fStatus').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadAlunos(); };
$('busca').oninput = () => { clearTimeout(buscaT); buscaT = setTimeout(() => { pag = 1; loadAlunos(); }, 300); };
let alunos = [];
async function loadAlunos() {
  const j = await api('alunos', null, `&busca=${encodeURIComponent($('busca').value)}&status=${fStatus}&pag=${pag}`); if (!j.ok) return;
  alunos = j.items;
  $('alunosSub').textContent = `${j.total} ${j.total === 1 ? 'conta' : 'contas'}`;
  $('tblAlunos').innerHTML = alunos.length ? `<table><tr><th>Aluno</th><th>Status</th><th>Vídeos</th><th>Pagou</th><th>Acesso até</th><th>Cadastro</th><th>Visto</th></tr>${alunos.map((u) => `<tr class="click" data-id="${u.id}">
    <td><b>${esc(u.name || '—')}</b><small>${esc(u.email)}${+u.tem_senha ? '' : ' · <span style="color:#ff9d00">sem senha</span>'}</small></td>
    <td><span class="st ${stDe(u)[0]}">${stDe(u)[1]}</span>${u.status === 'trial' ? `<small>${u.trial_left} grátis</small>` : ''}</td>
    <td>${u.videos_used}</td><td>${+u.paid_value ? brl(u.paid_value) : '—'}</td><td>${u.status === 'active' ? (u.expires_at ? dt(u.expires_at).slice(0, 8) : 'vitalício') : '—'}</td>
    <td>${dt(u.created_at).slice(0, 8)}<small>${esc(u.source)}</small></td><td>${u.last_seen ? dt(u.last_seen) : '—'}</td></tr>`).join('')}</table>` : '<p class="sub">Nenhum aluno encontrado.</p>';
  $('tblAlunos').querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => editAluno(alunos.find((u) => u.id == tr.dataset.id))));
  const pages = Math.ceil(j.total / j.por_pag);
  $('pager').innerHTML = pages > 1 ? `<button class="btn sm ghost" ${pag <= 1 ? 'disabled' : ''} data-p="-1">←</button> página ${pag} de ${pages} <button class="btn sm ghost" ${pag >= pages ? 'disabled' : ''} data-p="1">→</button>` : '';
  $('pager').querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { pag += +b.dataset.p; loadAlunos(); }));
}
function editAluno(u) {
  modal(`<h3>${esc(u.name || u.email)}</h3><p class="sub">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}<br>Cadastro ${dt(u.created_at)} · origem ${esc(u.source)} · ${u.videos_used} vídeos · funil passo ${u.funnel_step}${+u.unsub ? ' · saiu da lista' : ''}</p>
    <label>Nome<input id="eNome" value="${esc(u.name)}"></label>
    <label>Status<select id="eStatus">${Object.entries({ ...STATUS, active: 'Acesso liberado (pago ou cortesia)' }).map(([k, v]) => `<option value="${k}" ${k === u.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Vídeos grátis restantes (teste)<input id="eTrial" type="number" min="0" value="${u.trial_left}"></label>
    <label>Acesso até <small>(vazio = vitalício; ao mudar para Pago sem data, usa os dias da configuração)</small><input id="eExp" type="datetime-local" value="${u.expires_at ? u.expires_at.replace(' ', 'T').slice(0, 16) : ''}"></label>
    <div class="acts"><button class="btn sm" id="eSalvar">Salvar</button><button class="btn sm ghost" id="eLink">Link de criar senha</button><button class="btn sm ghost" id="eAviso">Aviso no app</button><button class="btn sm red" id="eApagar">Apagar</button></div>
    <p class="msg" id="eMsg"></p><div id="eOut"></div>`, () => {
    $('eSalvar').onclick = async () => {
      const exp = $('eExp').value ? $('eExp').value.replace('T', ' ') + ':00' : '';
      const j = await api('aluno-salvar', { id: u.id, name: $('eNome').value, status: $('eStatus').value, trial_left: +$('eTrial').value, expires_at: exp });
      if (j.ok) { closeModal(); toast('Aluno atualizado.'); loadAlunos(); } else $('eMsg').textContent = j.error;
    };
    $('eLink').onclick = async () => {
      const j = await api('aluno-link', { id: u.id, enviar: true });
      $('eOut').innerHTML = j.ok ? `<label>Link (vale 7 dias) ${j.email_enviado ? '<span style="color:#2ee59d">· enviado por e-mail</span>' : '<span style="color:#ff9d00">· e-mail não saiu, mande pelo WhatsApp</span>'}<div class="copy"><input value="${esc(j.link)}" readonly><button class="btn sm ghost" type="button" onclick="navigator.clipboard.writeText(this.previousElementSibling.value);toast('Copiado!')">Copiar</button></div></label>` : '';
    };
    $('eAviso').onclick = () => aviso({ grupo: 'um', id: u.id, nome: u.name || u.email });
    $('eApagar').onclick = async () => { if (!confirm(`Apagar ${u.email}? Isso não tem volta.`)) return; const j = await api('aluno-apagar', { id: u.id }); if (j.ok) { closeModal(); toast('Apagado.'); loadAlunos(); } };
  });
}
$('novoAluno').onclick = () => modal(`<h3>Liberar acesso</h3><p class="sub">Para cortesia, parceiro ou suporte. A pessoa recebe o link para criar a senha.</p>
  <label>Nome<input id="nNome"></label><label>E-mail<input id="nEmail" type="email"></label>
  <label>Tipo<select id="nTipo"><option value="active">Cortesia (acesso completo, sem pagar)</option><option value="trial">Teste grátis</option></select></label>
  <div class="acts"><button class="btn sm" id="nOk">Liberar e mandar o e-mail</button></div><p class="msg" id="nMsg"></p><div id="nOut"></div>`, () => {
  $('nOk').onclick = async () => {
    const j = await api('aluno-criar', { nome: $('nNome').value, email: $('nEmail').value, tipo: $('nTipo').value, enviar: true });
    if (!j.ok) return ($('nMsg').textContent = j.error);
    $('nOut').innerHTML = `<label>Pronto ${j.email_enviado ? '<span style="color:#2ee59d">· e-mail enviado</span>' : '<span style="color:#ff9d00">· o e-mail não saiu; mande este link</span>'}<div class="copy"><input value="${esc(j.link)}" readonly><button class="btn sm ghost" type="button" onclick="navigator.clipboard.writeText(this.previousElementSibling.value);toast('Copiado!')">Copiar</button></div></label>`;
    loadAlunos();
  };
});
function aviso(pre = {}) {
  modal(`<h3>Aviso no app</h3><p class="sub">${pre.grupo === 'um' ? 'Para ' + esc(pre.nome) : 'Aparece no sininho do app e como alerta quando a pessoa abrir.'}</p>
    ${pre.grupo === 'um' ? '' : '<label>Para quem<select id="aGrupo"><option value="todos">Todos</option><option value="pagos">Só pagos</option><option value="cortesias">Só cortesias</option><option value="teste">Só em teste grátis</option></select></label>'}
    <label>Título<input id="aTit" maxlength="80"></label><label>Texto<textarea id="aTxt" maxlength="300"></textarea></label><label>Link (opcional)<input id="aLink" placeholder="https://"></label>
    <div class="acts"><button class="btn sm" id="aOk">Enviar aviso</button></div><p class="msg" id="aMsg"></p>`, () => {
    $('aOk').onclick = async () => {
      const j = await api('avisar', { grupo: pre.grupo || $('aGrupo').value, id: pre.id, titulo: $('aTit').value, texto: $('aTxt').value, link: $('aLink').value });
      if (j.ok) { closeModal(); toast(`Aviso enviado para ${j.enviados} ${j.enviados === 1 ? 'pessoa' : 'pessoas'}.`); } else $('aMsg').textContent = j.error;
    };
  });
}
$('avisoGrupo').onclick = () => aviso();

// ---------- funil ----------
async function loadFunil() {
  const [j, e] = await Promise.all([api('funil'), api('emails')]); if (!j.ok) return;
  const total = Object.values(j.contagem).reduce((a, b) => a + b, 0);
  $('funilFlow').innerHTML = `<div class="passo"><span class="d">CADASTRO</span><b>Boas-vindas + ${'teste grátis'}</b><span class="n">${total}</span><small> em teste</small></div>` +
    j.passos.map((p) => `<div class="passo"><span class="d">DIA ${p.dia}</span><b>${esc(p.assunto.replace('{nome}', 'Fulano'))}</b><span class="n">${j.contagem[p.passo] || 0}</span><small> pararam aqui</small></div>`).join('');
  $('cronInfo').textContent = j.cron_last ? `Última rodada automática: ${dt(j.cron_last)}` : 'A tarefa automática ainda não rodou. Configure no Plesk (Tarefas agendadas, a cada hora): php api/cron.php';
  const ok = e.items.filter((m) => +m.ok).length, bad = e.items.length - ok;
  $('saudeEmail').innerHTML = `<span class="st active">${ok} enviados</span> <span class="st ${bad ? 'blocked' : 'active'}">${bad} falharam</span>`;
  emailStats(e);
  emailTabela(e.items);
}
let emFiltro = 'todos';
function emailTabela(items) {
  const L = items.filter((m) => emFiltro === 'todos' || (emFiltro === 'abriram' ? m.opened_at : emFiltro === 'clicaram' ? m.clicked_at : +m.ok && +m.rastreado && !m.opened_at));
  const vis = (m) => !+m.ok ? `<span class="st blocked">falhou</span><small>${esc(m.error)}</small>` : !+m.rastreado ? '<span class="st">enviado</span><small>antes do rastreio</small>'
    : m.clicked_at ? `<span class="st active">🖱 clicou</span><small>${dt(m.clicked_at)}${+m.clicks > 1 ? ` · ${m.clicks} cliques` : ''}</small>`
    : m.opened_at ? `<span class="st trial">👁 abriu</span><small>${dt(m.opened_at)}${+m.opens > 1 ? ` · ${m.opens} vezes` : ''}</small>` : '<span class="st nao">não abriu ainda</span>';
  $('tblEmails').innerHTML = `<div class="seg emf">${[['todos', 'Todos'], ['abriram', '👁 Abriram'], ['clicaram', '🖱 Clicaram'], ['nao', 'Não abriram']].map(([k, r]) => `<button data-f="${k}" class="${emFiltro === k ? 'on' : ''}">${r}</button>`).join('')}</div>` +
    (L.length ? `<table><tr><th>Quando</th><th>Para</th><th>E-mail</th><th>Viu?</th></tr>${L.map((m) => `<tr><td>${dt(m.created_at)}</td><td>${esc(m.name || '')}<small>${esc(m.email)}</small></td><td>${esc(m.subject)}<small>${esc(m.kind)}</small></td><td>${vis(m)}</td></tr>`).join('')}</table>` : '<p class="sub">Nenhum e-mail neste filtro.</p>');
  $('tblEmails').querySelectorAll('.emf button').forEach((b) => (b.onclick = () => { emFiltro = b.dataset.f; emailTabela(items); }));
}
function emailStats(e) {
  const P = e.por_email || [], fun = P.filter((p) => p.funil), soma = (L, k) => L.reduce((a, p) => a + p[k], 0);
  const env = soma(P, 'enviados'), ab = soma(P, 'abriram'), cl = soma(P, 'clicaram'), pc = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const card = (cor, ico, rot, v, f, sub) => `<div class="ncard ${cor}"><div class="nh"><i>${ico}</i><small>${rot}</small></div><b class="cnt" data-to="${+v || 0}" data-f="${f}">0</b><span>${sub}</span></div>`;
  const barra = (p) => `<div class="emb"><div class="emn"><b>${esc(p.nome)}</b><small>${p.enviados} enviado${p.enviados === 1 ? '' : 's'} · ${p.abriram} abriram (${pc(p.abriram, p.enviados)}) · ${p.clicaram} clicaram (${pc(p.clicaram, p.enviados)})</small></div>
    <div class="emt"><i class="e" style="--w:100%"></i><i class="a" style="--w:${p.enviados ? (p.abriram / p.enviados) * 100 : 0}%"></i><i class="c" style="--w:${p.enviados ? (p.clicaram / p.enviados) * 100 : 0}%"></i></div></div>`;
  $('emStats').innerHTML = `<section class="bloco"><div class="bh"><span class="tag c">📬 QUEM ABRIU E CLICOU</span><small>${e.rastreio_desde ? 'contando desde ' + dt(e.rastreio_desde) : 'começa a contar a partir dos próximos e-mails enviados'} · iPhone pode marcar como aberto sozinho, o clique é o número mais confiável</small></div>
    <div class="cards4">${card('c', '📤', 'E-mails rastreados', env, 'n', `${fun.length} tipo${fun.length === 1 ? '' : 's'} do funil com envio`)}${card('y', '👁', 'Taxa de abertura', env ? ab / env : 0, 'pc', `${ab} de ${env} abriram`)}${card('g', '🖱', 'Taxa de clique', env ? cl / env : 0, 'pc', `${cl} clicaram no botão`)}${card('p', '🎯', 'Clique de quem abriu', ab ? cl / ab : 0, 'pc', 'de quem abriu, quantos clicaram')}</div>
    ${P.length ? `<div class="glass embox"><div class="ch"><b>Cada e-mail do funil</b><span class="emleg"><span><i class="e"></i>Enviados</span><span><i class="a"></i>Abriram</span><span><i class="c"></i>Clicaram</span></span></div>${(fun.length ? fun : P).map(barra).join('')}
      ${fun.length && P.length > fun.length ? `<details><summary>Outros e-mails (senha, acesso, afiliados)</summary>${P.filter((p) => !p.funil).map(barra).join('')}</details>` : ''}</div>` : '<div class="vigia"><b>Ainda sem e-mails rastreados.</b><small>Os próximos e-mails do funil já saem com o rastreio, e os números aparecem aqui.</small></div>'}
  </section>`;
  contar($('emStats')); requestAnimationFrame(() => $('emStats').querySelectorAll('.emt').forEach((x) => x.classList.add('on')));
}
$('reenviarEmails').onclick = async (ev) => {
  if (!confirm('Mandar de novo os e-mails que falharam? Só vai para quem ainda faz sentido (ex.: quem ainda não comprou recebe o "teste terminou").')) return;
  ev.target.disabled = true; toast('Reenviando…');
  const j = await api('emails-reenviar', {}); ev.target.disabled = false;
  toast(j.ok ? `Reenviados: ${j.reenviados}. Pulados: ${j.pulados}.${j.falharam_agora ? ' Falharam agora: ' + j.falharam_agora : ''}` : j.error); loadFunil();
};
$('rodarFunil').onclick = async () => { const j = await api('funil-rodar', {}); toast(`Funil rodou: ${j.enviados} envio(s).`); loadFunil(); };

// ---------- depoimentos (prova social) ----------
const DEPO_ST = { novo: ['trial', 'Novo'], aprovado: ['active', 'Aprovado'], usado: ['cortesia', 'Já usado'], recusado: ['blocked', 'Não usar'], enviando: ['nao', 'Enviando…'] };
let depoJ = null;
async function loadDepo() {
  const j = await api('depo'); if (!j.ok) return; depoJ = j;
  const c = j.contagem, P = j.pessoas;
  const card = (cor, ico, rot, v, sub) => `<div class="ncard ${cor}"><div class="nh"><i>${ico}</i><small>${rot}</small></div><b class="cnt" data-to="${+v || 0}" data-f="n">0</b><span>${sub}</span></div>`;
  const wa = (p) => { const n = String(p.phone || '').replace(/\D/g, ''); const tel = n ? (n.length <= 11 ? '55' + n : n) : ''; return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(p.whats); };
  const quando = (p) => p.enviou ? '<span class="st active">✅ mandou</span>' : p.pedido_at ? `<span class="st trial">pedido</span><small>${dt(p.pedido_at)}</small>` : +p.unsub ? '<span class="st nao">saiu da lista</span>' : '<span class="st nao">ainda não pedido</span>';
  $('depoPedir').innerHTML = `<section class="bloco"><div class="bh"><span class="tag y">📣 PEDIR DEPOIMENTO</span><small>Cada pessoa recebe um link próprio. O e-mail vai uma vez só por pessoa.</small></div>
    <div class="cards4">${card('y', '💳', 'Compradores', c.compradores, 'assinaram e pagaram')}${card('c', '🎬', 'Testaram e baixaram', c.testaram, 'baixaram o vídeo pronto no teste')}${card('p', '📨', 'Já pedidos', c.pedidos, `${c.a_pedir} ainda sem pedido`)}${card('g', '💬', 'Mandaram', c.enviaram, 'depoimentos recebidos')}</div>
    <div class="glass" style="margin-top:14px"><div class="ch"><b>Quem pode receber o pedido</b><span class="acts"><label class="sub" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="depoBonus" ${j.bonus ? 'checked' : ''}> +1 vídeo grátis para quem está no teste e manda</label><button class="btn sm ghost" id="depoPrevia">Ver o e-mail e o WhatsApp</button><button class="btn sm" id="depoEnviar" ${c.a_pedir ? '' : 'disabled'}>Enviar e-mail para ${c.a_pedir} pessoa${c.a_pedir === 1 ? '' : 's'}</button></span></div>
    <div class="tbl">${P.length ? `<table><tr><th>Pessoa</th><th>Grupo</th><th>Pedido</th><th></th></tr>${P.map((p) => `<tr><td>${esc(p.name || '')}<small>${esc(p.email)}${p.phone ? ' · ' + esc(p.phone) : ''}</small></td><td>${p.comprou ? '<span class="st pago">comprou</span>' : '<span class="st trial">testou e baixou</span>'}${p.exportou_at ? `<small>baixou ${dt(p.exportou_at)}</small>` : ''}</td><td>${quando(p)}</td>
      <td style="white-space:nowrap"><a class="btn sm ghost" href="${wa(p)}" target="_blank" rel="noopener" data-wa="${p.id}">WhatsApp</a> <button class="btn sm ghost" data-copia="${p.id}">Copiar link</button></td></tr>`).join('')}</table>` : '<p class="sub">Ainda ninguém comprou ou baixou um vídeo.</p>'}</div></div></section>`;
  contar($('depoPedir'));
  const P2 = Object.fromEntries(P.map((p) => [p.id, p]));
  $('depoPedir').querySelectorAll('[data-wa]').forEach((a) => (a.onclick = () => { api('depo-marcar', { id: +a.dataset.wa }).then(() => setTimeout(loadDepo, 800)); }));
  $('depoPedir').querySelectorAll('[data-copia]').forEach((b) => (b.onclick = async () => { const p = P2[b.dataset.copia]; try { await navigator.clipboard.writeText(p.whats); toast('Mensagem com o link copiada.'); } catch { prompt('Copie a mensagem:', p.whats); } }));
  $('depoBonus').onchange = async (e) => { const r = await api('config-salvar', { depo_bonus: e.target.checked ? '1' : '0' }); toast(r.ok ? 'Salvo.' : r.error); };
  $('depoPrevia').onclick = async () => {
    const v = await api('depo-previa'); if (!v.ok) return toast(v.error);
    const bloco = (t, x) => `<h3 style="margin:14px 0 6px">${t}</h3><p class="sub">Assunto: <b>${esc(x.assunto)}</b></p><iframe style="width:100%;height:430px;border:1px solid var(--line);border-radius:14px;background:#050506" srcdoc="${esc(x.html)}"></iframe><p class="sub" style="margin-top:8px">WhatsApp:</p><pre style="white-space:pre-wrap;background:rgba(255,255,255,.04);padding:12px;border-radius:12px;font:13px/1.5 inherit">${esc(x.whats)}</pre>`;
    modal(`<h2>Como chega o pedido</h2>${bloco('Para quem comprou', v.comprador)}${bloco('Para quem testou e baixou', v.testou)}<button class="btn sm ghost" data-fechar>Fechar</button>`);
  };
  $('depoEnviar').onclick = async (ev) => {
    if (!confirm(`Mandar o pedido de depoimento por e-mail para ${c.a_pedir} pessoa(s)? Cada uma recebe uma vez só.`)) return;
    ev.target.disabled = true; toast('Enviando…');
    const r = await api('depo-pedir', {}); toast(r.ok ? `Enviados: ${r.enviados}. Pulados: ${r.pulados}.` : r.error); loadDepo();
  };
  // recebidos
  const arq = (d, f) => { const u = `/api/admin.php?a=depo-arquivo&id=${d.id}&tipo=${f.tipo}`; const vid = /^(mp4|mov|m4v|webm|3gp|hevc)$/.test(f.ext), aud = /^(m4a|mp3|wav|aac)$/.test(f.ext);
    return `<div class="dpa"><small>${esc(j.tipos[f.tipo] || f.tipo)} · ${(f.tam / 1048576).toFixed(1)} MB${+f.recebido < +f.tam ? ' · incompleto' : ''}</small>${vid ? `<video src="${u}" controls playsinline preload="metadata"></video>` : aud ? `<audio src="${u}" controls preload="none"></audio>` : `<img src="${u}" alt="">`}<a href="${u}&baixar=1" class="btn sm ghost">Baixar</a></div>`; };
  const L = j.items;
  $('depoLista').innerHTML = `<section class="bloco"><div class="bh"><span class="tag g">💬 RECEBIDOS</span><small>${L.length} depoimento${L.length === 1 ? '' : 's'}. Só use nas redes o que tem ✅ autorização.</small></div>${L.length ? L.map((d) => { const s = DEPO_ST[d.status] || ['', d.status];
    return `<div class="glass dpo"><div class="ch"><b>${esc(d.nome || d.email)}${d.instagram ? ` <a href="https://instagram.com/${esc(d.instagram)}" target="_blank" rel="noopener" style="color:var(--y)">@${esc(d.instagram)}</a>` : ''} ${d.nota ? '<span style="color:var(--y)">' + '★'.repeat(+d.nota) + '</span>' : ''}</b><span class="acts"><span class="st ${s[0]}">${s[1]}</span>
      <select data-st="${d.id}">${['novo', 'aprovado', 'usado', 'recusado'].map((k) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${DEPO_ST[k][1]}</option>`).join('')}</select><button class="btn sm ghost" data-del="${d.id}">Apagar</button></span></div>
      <p style="font-size:16px;line-height:1.5;margin:6px 0">“${esc(d.texto)}”</p>
      <p class="sub">${dt(d.created_at)} · ${esc(d.email)}${d.cidade ? ' · ' + esc(d.cidade) : ''} · ${+d.aut_imagem ? '✅ autorizou usar nas redes' + (+d.aut_nome ? ' com nome e @' : ' (sem mostrar o nome)') : '🔒 NÃO autorizou uso público'}${+d.bonus ? ' · 🎁 ganhou +1 vídeo' : ''}</p>
      ${d.arquivos.length ? `<div class="dpas">${d.arquivos.map((f) => arq(d, f)).join('')}</div>` : ''}</div>`; }).join('') : '<div class="vigia"><b>Nenhum depoimento ainda.</b><small>Quando alguém mandar, aparece aqui e chega um e-mail para os administradores.</small></div>'}</section>`;
  $('depoLista').querySelectorAll('[data-st]').forEach((x) => (x.onchange = async () => { await api('depo-status', { id: +x.dataset.st, status: x.value }); loadDepo(); }));
  $('depoLista').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Apagar este depoimento e os vídeos dele?')) return; await api('depo-apagar', { id: +b.dataset.del }); loadDepo(); }));
  const novos = L.filter((d) => d.status === 'novo').length; $('depoBadge').hidden = !novos; $('depoBadge').textContent = novos;
}

// ---------- afiliados ----------
// ---------- origens: de qual página e canal vêm as vendas ----------
let orDias = 7;
$('segOr').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; orDias = +b.dataset.d; $('segOr').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadOrigens(); };
const PAG = { home: '🎁 Página com teste grátis', vsl: '🎬 /vsl (compra direta)', 'link-afiliado': '🤝 Link de afiliado', 'sem-rastreio': '❔ Sem rastreio (antes de 13/11)' };
// nome amigável do canal (Origens)
function fonteNome(f, c) {
  const N = { 'anuncio-meta': '📣 Anúncio Meta', 'meta-sem-utm': '📣 Anúncio Meta (provável, link sem UTM)', 'comentarios-ig': '💬 Comentários do Instagram (direct)', whatsapp: '🟢 WhatsApp', afiliado: '🤝 Afiliado', direto: 'Direto (digitou o site)' };
  if (N[f]) return N[f];
  if (f === 'instagram' && /reinaldo|criativo|teste-gratis|vsl/.test(c || '')) return N['comentarios-ig']; // links do direct anteriores à separação
  if (f === 'instagram') return '📷 Instagram (orgânico, sem UTM)';
  return esc(f || 'direto');
}
async function loadOrigens() {
  const j = await api('origens', null, '&dias=' + orDias); if (!j.ok) return;
  const L = j.linhas, pc = (a, b) => (b ? (Math.round((a / b) * 1000) / 10).toLocaleString('pt-BR') + '%' : '—');
  const soma = (arr, k) => arr.reduce((t, r) => t + (+r[k] || 0), 0);
  const agrupa = (fk) => { const m = {}; L.forEach((r) => { const k = fk(r); m[k] ??= { k, visitas: 0, cadastros: 0, vendas: 0, liquido: 0, direta: 0, teste: 0, afiliado: 0 }; ['visitas', 'cadastros', 'vendas', 'liquido', 'direta', 'teste', 'afiliado'].forEach((x) => (m[k][x] += +r[x] || 0)); }); return Object.values(m).sort((a, b) => b.vendas - a.vendas || b.liquido - a.liquido || b.visitas - a.visitas); };
  const card = (cor, ico, rot, v, f, sub) => `<div class="ncard ${cor}"><div class="nh"><i>${ico}</i><small>${rot}</small></div><b class="cnt" data-to="${+v || 0}" data-f="${f}">0</b><span>${sub}</span></div>`;
  const V = soma(L, 'visitas'), C = soma(L, 'cadastros'), N = soma(L, 'vendas');
  $('orNums').innerHTML = `<div class="cards4" style="margin-bottom:16px">
    ${card('c', '👀', 'Visitas nas páginas', V, 'n', 'pessoas diferentes a cada 30 min')}
    ${card('y', '🎁', 'Testes grátis', C, 'n', `${pc(C, V)} das visitas`)}
    ${card('g', '💰', 'Vendas', N, 'n', `${pc(N, V)} das visitas`)}
    ${card('p', '💵', 'Líquido', soma(L, 'liquido'), 'brl', 'o que a Eduzz paga')}</div>`;
  contar($('orNums'));
  const cam = (r) => [r.direta && `${r.direta} direta${r.direta > 1 ? 's' : ''}`, r.teste && `${r.teste} depois do teste`, r.afiliado && `${r.afiliado} de afiliado`].filter(Boolean).join(' · ');
  const tabela = (rows, nome) => rows.length ? `<table><tr><th>${nome}</th><th>Visitas</th><th>Testes grátis</th><th>Vendas</th><th>Conversão</th><th>Líquido</th></tr>${rows.map((r) => `<tr>
    <td>${r.k}</td><td>${r.visitas}</td><td>${r.cadastros}<small>${pc(r.cadastros, r.visitas)} das visitas</small></td>
    <td><b style="color:#2ee59d">${r.vendas}</b><small>${cam(r)}</small></td><td><b>${pc(r.vendas, r.visitas)}</b><small>visita → venda</small></td><td>${brl(r.liquido)}${r.vendas ? `<small>${brl(r.liquido / r.vendas)} por venda</small>` : ''}</td></tr>`).join('')}</table>` : '<p class="sub">Ainda sem dados neste período.</p>';
  $('orPag').innerHTML = tabela(agrupa((r) => PAG[r.pagina] || esc(r.pagina)), 'Página');
  $('orCan').innerHTML = tabela(agrupa((r) => r.pagina === 'sem-rastreio' && !r.fonte ? PAG['sem-rastreio'] : `<b>${fonteNome(r.fonte, r.campanha)}</b>${r.campanha ? `<small>${esc(r.campanha)}</small>` : '<small>sem campanha</small>'}`), 'Canal · campanha');
  const AN = j.anuncios || [], nomeConta = (c) => (c === '?' ? 'Anúncio sem UTM (conta não identificada)' : c ? c[0].toUpperCase() + c.slice(1) : 'Geral (sem conta)');
  $('orAds').innerHTML = AN.length ? `<table><tr><th>Conta</th><th>Investido</th><th>Vendas</th><th>Líquido</th><th>Retorno por R$ 1</th><th>ROI</th><th>Custo por venda</th></tr>${AN.map((a) => { const roas = a.gasto ? a.liquido / a.gasto : null, roi = a.gasto ? (a.liquido - a.gasto) / a.gasto : null, cor = roi === null ? '' : roi >= 0 ? 'color:#2ee59d' : 'color:#ff6b78';
    return `<tr><td><b>${esc(nomeConta(a.conta))}</b></td><td>${a.gasto ? `<b>${brl(a.gasto)}</b><small>gerenciador ${brl(a.gasto_auto || 0)} · impulsion. ${brl(a.gasto_manual || 0)}</small>` : '—'}</td><td><b>${a.vendas}</b><small>${a.vsl} /vsl · ${a.home} página com teste</small></td><td>${brl(a.liquido)}</td><td style="${cor}"><b>${roas === null ? '—' : brl(roas)}</b></td><td style="${cor}">${roi === null ? '—' : (roi >= 0 ? '+' : '') + Math.round(roi * 100) + '%'}</td><td>${a.gasto && a.vendas ? brl(a.gasto / a.vendas) : '—'}</td></tr>`; }).join('')}</table>`
    : '<p class="sub">Ainda sem gasto lançado nem venda de anúncio no período. Lance o gasto de cada conta na Visão geral (📣 Anúncios) e use os parâmetros de URL no anúncio.</p>';
  const MC = j.meta_contas || [];
  $('orMeta').innerHTML = `${MC.length ? `<table><tr><th>De quem</th><th>Conta de anúncios</th><th>Atualizado</th><th></th></tr>${MC.map((c) => `<tr><td><b>${esc(nomeConta(c.dono))}</b></td><td>${esc(c.nome)}<small>${esc(c.act)}</small></td><td>${c.erro ? `<span style="color:#ff6b78">⚠ ${esc(c.erro)}</span>` : c.ultimo ? dt(c.ultimo) : '—'}</td><td><button class="btn sm ghost" data-meta-del="${c.id}">Desconectar</button></td></tr>`).join('')}</table>` : '<p class="sub">Nenhuma conta conectada ainda.</p>'}
    <form class="adsF" id="metaF" style="margin-top:12px"><label>De quem<select name="dono"><option value="leo">Leo</option><option value="reinaldo">Reinaldo</option></select></label><label>ID da conta de anúncios<input name="act" inputmode="numeric" placeholder="Ex.: 1234567890" required></label><label>Token (só leitura)<input name="token" type="password" autocomplete="off" placeholder="cole o token aqui" required></label><button class="btn sm">Conectar</button>${MC.length ? ' <button class="btn sm ghost" type="button" id="metaSync">↻ Atualizar agora</button>' : ''}</form>`;
  $('metaF').onsubmit = async (e) => { e.preventDefault(); toast('Conferindo com o Meta…'); const r = await api('meta-conectar', Object.fromEntries(new FormData(e.target))); if (!r.ok) return toast(r.error || 'Não deu.'); toast('Conectado: ' + r.nome); loadOrigens(); };
  if ($('metaSync')) $('metaSync').onclick = async () => { toast('Puxando do Meta…'); await api('meta-sync', {}); loadOrigens(); };
  $('orMeta').querySelectorAll('[data-meta-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Desconectar essa conta? O gasto dela some do painel.')) return; await api('meta-remover', { id: b.dataset.metaDel }); loadOrigens(); }));
  $('orUlt').innerHTML = j.ultimas.length ? `<table><tr><th>Quando</th><th>Aluno</th><th>Página</th><th>Canal · campanha</th><th>Caminho</th><th>Líquido</th></tr>${j.ultimas.map((v) => `<tr><td>${dt(v.created_at)}</td><td>${esc(v.name || '—')}</td><td>${PAG[v.or_pagina || 'sem-rastreio'] || esc(v.or_pagina)}</td><td>${v.or_fonte ? `<b>${fonteNome(v.or_fonte, v.or_campanha)}</b>` : '—'}${v.or_campanha ? `<small>${esc(v.or_campanha)}</small>` : ''}</td><td>${esc(v.or_caminho || '—')}</td><td>${brl(v.liquido)}</td></tr>`).join('')}</table>` : '<p class="sub">Nenhuma venda ainda.</p>';
  $('orNota').textContent = `Como ler: "compra direta" é quem clicou em comprar na página; "depois do teste" é quem fez o teste grátis e comprou pelo app ou pelo e-mail do funil (a venda fica com a página e o canal do cadastro). Use links com ?utm_source=canal&utm_campaign=nome (ex.: whatsapp, reinaldo-vsl) para separar cada anúncio.${j.desde_rastreio ? ' Visitas contadas desde ' + dt(j.desde_rastreio) + '.' : ''}`;
}

async function loadAfiliados() {
  const j = await api('afiliados'); if (!j.ok) return;
  const L = j.afiliados, soma = (k) => L.reduce((t, a) => t + (+a[k] || 0), 0);
  const pc = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const card = (cor, ico, rot, v, f, sub) => `<div class="ncard ${cor}"><div class="nh"><i>${ico}</i><small>${rot}</small></div><b class="cnt" data-to="${+v || 0}" data-f="${f}">0</b><span>${sub}</span></div>`;
  $('afNums').innerHTML = `<div class="cards4" style="margin-bottom:16px">
    ${card('c', '🤝', 'Afiliados ativos', L.filter((a) => +a.ativo).length, 'n', `${L.length} no total`)}
    ${card('p', '👆', 'Cliques nos links', soma('cliques'), 'n', `${soma('cliques_30d')} nos últimos 30 dias`)}
    ${card('y', '🎁', 'Cadastros grátis', soma('cadastros'), 'n', `${soma('testaram')} testaram · ${pc(soma('cadastros'), soma('cliques'))} dos cliques`)}
    ${card('g', '💰', 'Vendas de afiliados', soma('compraram'), 'n', `${brl(soma('vendido'))} vendidos`)}</div>`;
  contar($('afNums'));
  $('tblAf').innerHTML = L.length ? `<table><tr><th>Afiliado</th><th>Link</th><th>Cliques</th><th>Cadastros</th><th>Testaram</th><th>Compraram</th><th>Vendido</th><th>Eduzz</th><th></th></tr>${L.map((a) => `<tr${+a.ativo ? '' : ' style="opacity:.5"'}>
    <td>${esc(a.nome || '—')}<small>${esc(a.email)} · ${({ convite: 'convite', assinante: 'assinante', cadastro: 'cadastro aberto', admin: 'criado no painel' })[a.origem] || ''}${+a.tem_senha ? '' : ' · <span style="color:#ff9d00">sem senha ainda</span>'}</small></td>
    <td><button class="btn sm ghost" data-cp="${esc(a.link)}" title="${esc(a.link)}">?af=${esc(a.codigo)} ⧉</button></td>
    <td>${a.cliques}<small>${a.cliques_30d} em 30d</small></td><td>${a.cadastros}<small>${pc(a.cadastros, a.cliques)}</small></td><td>${a.testaram}</td>
    <td><b style="color:#2ee59d">${a.compraram}</b><small>${pc(a.compraram, a.cadastros)} dos cadastros</small></td><td>${brl(+a.vendido)}</td>
    <td>${a.link_eduzz ? '<span style="color:#2ee59d">✓ link</span>' : '<span style="color:#ff6b6b">sem link</span>'}${a.eduzz_id ? `<small>id ${esc(a.eduzz_id)}</small>` : ''}</td>
    <td><button class="btn sm ghost" data-ed="${a.id}">Editar</button></td></tr>`).join('')}</table>`
    : '<p class="sub">Nenhum afiliado ainda. Toque em "+ Novo afiliado" para criar o primeiro.</p>';
  $('tblAf').querySelectorAll('[data-cp]').forEach((b) => (b.onclick = () => { navigator.clipboard.writeText(b.dataset.cp); toast('Link do afiliado copiado.'); }));
  $('tblAf').querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => editarAf(L.find((a) => a.id == b.dataset.ed))));
}
const afCampos = (a = {}) => `<label>Nome<input id="fNome" value="${esc(a.nome || '')}"></label>
  <label>Link de afiliado da Eduzz <small>a compra dos leads dele vai por aqui (o afiliado também pode colar no painel dele)</small><input id="fLink" value="${esc(a.link_eduzz || '')}" placeholder="https://chk.eduzz.com/..."></label>
  <label>ID de afiliado na Eduzz <small>opcional: reconhece vendas dele que não passaram pelo teste</small><input id="fEid" value="${esc(a.eduzz_id || '')}"></label>`;
$('convAf').onclick = () => modal(`<h3>Convite de afiliado</h3><p class="sub">Quem recebe este link cria a conta de afiliado direto, sem precisar assinar o Studio Cover. Vale 30 dias e serve para 1 pessoa.</p>
  <label>Nome de quem vai receber <small>opcional, já aparece preenchido para ele</small><input id="cvNome" autocomplete="off"></label>
  <div class="acts"><button class="btn sm" id="cvOk">Gerar link de convite</button></div><p class="msg" id="cvMsg"></p><div id="cvOut"></div>`, () => {
  $('cvOk').onclick = async () => {
    const j = await api('afiliado-convite', { nome: $('cvNome').value }); if (!j.ok) return ($('cvMsg').textContent = j.error);
    $('cvOut').innerHTML = `<label>Link do convite (mande pelo WhatsApp)<div class="copy"><input value="${esc(j.link)}" readonly></div></label>`;
    try { await navigator.clipboard.writeText(j.link); $('cvMsg').textContent = 'Link copiado.'; } catch {}
  };
});
$('novoAf').onclick = () => modal(`<h3>Novo afiliado</h3><p class="sub">Ele recebe um e-mail para criar a senha do painel dele.</p>
  <label>E-mail<input id="fEmail" type="email" autocomplete="off"></label>${afCampos()}
  <label>Código do link <small>vira studiocover.com.br/?af=codigo (vazio = parte do e-mail)</small><input id="fCod" placeholder="joao"></label>
  <label class="sw"><input type="checkbox" id="fEnv" checked><span></span> Enviar o e-mail de acesso agora</label>
  <div class="acts"><button class="btn sm" id="fOk">Criar afiliado</button></div><p class="msg" id="fMsg"></p><div id="fOut"></div>`, () => {
  $('fOk').onclick = async () => {
    const j = await api('afiliado-criar', { email: $('fEmail').value, nome: $('fNome').value, codigo: $('fCod').value, link_eduzz: $('fLink').value, eduzz_id: $('fEid').value, enviar: $('fEnv').checked });
    if (!j.ok) return ($('fMsg').textContent = j.error);
    loadAfiliados();
    $('fMsg').textContent = j.email_enviado === false ? 'Afiliado criado, mas o e-mail não saiu.' : 'Afiliado criado' + (j.email_enviado ? ' e e-mail enviado.' : '.');
    $('fOut').innerHTML = `<label>Link de divulgação<div class="copy"><input value="${esc(j.link)}" readonly></div></label>${j.senha ? `<label>Link para ele criar a senha (vale 7 dias)<div class="copy"><input value="${esc(j.senha)}" readonly></div></label>` : ''}`;
  };
});
function editarAf(a) {
  modal(`<h3>${esc(a.nome || a.email)}</h3><p class="sub">${esc(a.email)} · link ${esc(a.link)}</p>${afCampos(a)}
    <label class="sw"><input type="checkbox" id="fAt" ${+a.ativo ? 'checked' : ''}><span></span> Ativo (desligado: o link para de valer e ele não entra no painel)</label>
    <div class="acts"><button class="btn sm" id="fSalvar">Salvar</button><button class="btn sm ghost" id="fAcesso">Reenviar acesso por e-mail</button><button class="btn sm ghost" id="fLinkS">Gerar link de senha</button></div><p class="msg" id="fMsg"></p><div id="fOut"></div>`, () => {
    $('fSalvar').onclick = async () => { const j = await api('afiliado-editar', { id: a.id, nome: $('fNome').value, link_eduzz: $('fLink').value, eduzz_id: $('fEid').value, ativo: $('fAt').checked }); if (j.ok) { closeModal(); toast('Afiliado salvo.'); loadAfiliados(); } else $('fMsg').textContent = j.error; };
    $('fAcesso').onclick = async () => { const j = await api('afiliado-acesso', { id: a.id, enviar: true }); $('fMsg').textContent = j.ok && j.email_enviado ? 'E-mail enviado.' : 'O e-mail não saiu.'; };
    $('fLinkS').onclick = async () => { const j = await api('afiliado-acesso', { id: a.id }); if (j.ok) $('fOut').innerHTML = `<div class="copy"><input value="${esc(j.link)}" readonly></div>`; };
  });
}

// ---------- admins ----------
async function loadAdmins() {
  const j = await api('admins'); if (!j.ok) return;
  $('tblAdmins').innerHTML = `<table><tr><th>Nome</th><th>E-mail</th><th>Criado</th><th>Último acesso</th><th></th></tr>${j.items.map((a) => `<tr><td>${esc(a.name)}${a.id === j.eu ? ' <small style="display:inline;color:#ffd400">(você)</small>' : ''}</td><td>${esc(a.email)}</td><td>${dt(a.created_at)}</td><td>${dt(a.last_login)}</td><td>${a.id === j.eu ? '' : `<button class="btn sm red" data-del="${a.id}">Remover</button>`}</td></tr>`).join('')}</table>`;
  $('tblAdmins').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Remover este administrador?')) return; const r = await api('admin-apagar', { id: +b.dataset.del }); r.ok ? loadAdmins() : toast(r.error); }));
}
$('novoAdmin').onclick = () => modal(`<h3>Novo administrador</h3><p class="sub">Ex.: o seu sócio. Combine a senha com ele pessoalmente e peça para ele trocar no primeiro acesso.</p>
  <label>Nome<input id="dNome"></label><label>E-mail<input id="dEmail" type="email" autocomplete="off"></label><label>Senha inicial (8+ caracteres, letras e números)<input id="dSenha" type="password" autocomplete="new-password"></label>
  <div class="acts"><button class="btn sm" id="dOk">Criar administrador</button></div><p class="msg" id="dMsg"></p>`, () => {
  $('dOk').onclick = async () => { const j = await api('admin-criar', { nome: $('dNome').value, email: $('dEmail').value, senha: $('dSenha').value }); if (j.ok) { closeModal(); toast('Administrador criado.'); loadAdmins(); } else $('dMsg').textContent = j.error; };
});
$('fMinhaSenha').onsubmit = async (e) => { e.preventDefault(); const j = await api('minha-senha', { atual: $('sAtual').value, nova: $('sNova').value }); toast(j.ok ? 'Senha trocada.' : j.error); if (j.ok) e.target.reset(); };

// ---------- config ----------
async function loadConfig() {
  const [j, w] = await Promise.all([api('config'), api('webhooks')]); if (!j.ok) return;
  const f = $('fConfig');
  for (const [k, v] of Object.entries(j.config)) { const el = f.elements[k]; if (!el) continue; if (el.type === 'checkbox') el.checked = v === '1'; else el.value = v; }
  $('whUrl').value = j.config.webhook_url;
  $('tblWh').innerHTML = w.items.length ? `<table><tr><th>Quando</th><th>Resultado</th><th>Conteúdo</th></tr>${w.items.map((x) => `<tr><td>${dt(x.created_at)}</td><td>${esc(x.result)}</td><td><pre>${esc(x.body)}</pre></td></tr>`).join('')}</table>` : '<p class="sub">Nada recebido ainda. Depois de colar a URL na Eduzz, faça uma venda de teste.</p>';
}
$('fConfig').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target, body = {};
  for (const el of f.elements) if (el.name) body[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
  const j = await api('config-salvar', body);
  $('cfgMsg').textContent = j.ok ? 'Salvo ✓' : j.error; $('cfgMsg').className = 'msg' + (j.ok ? ' ok' : '');
};
$('copiarWh').onclick = () => { navigator.clipboard.writeText($('whUrl').value); toast('URL copiada.'); };
$('novoWh').onclick = async () => { if (!confirm('Gerar outra URL? A antiga para de funcionar e você precisa colar a nova na Eduzz.')) return; await api('webhook-novo-token', {}); loadConfig(); };
$('testeEmail').onclick = async () => { toast('Enviando…'); const j = await api('email-teste', { para: $('testePara').value.trim() || undefined }); toast(j.ok ? 'E-mail enviado! Confira a sua caixa (e o spam).' : 'Não saiu: ' + j.error); };

boot();
