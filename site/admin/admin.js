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
const TABS = { geral: 'tGeral', alunos: 'tAlunos', funil: 'tFunil', admins: 'tAdmins', config: 'tConfig' };
function tab(t) {
  if (!TABS[t]) t = 'geral';
  document.querySelectorAll('.nav > button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  Object.entries(TABS).forEach(([k, id]) => ($(id).hidden = k !== t));
  history.replaceState(null, '', '#' + t);
  ({ geral: loadGeral, alunos: loadAlunos, funil: loadFunil, admins: loadAdmins, config: loadConfig })[t]();
}
document.querySelectorAll('.nav > button').forEach((b) => (b.onclick = () => tab(b.dataset.tab)));

// ---------- números que contam ----------
function contar(root) {
  const fm = { brl: (v) => brl(v), n: (v) => Math.round(v).toLocaleString('pt-BR'), pc: (v) => Math.round(v * 100) + '%' };
  const els = [...root.querySelectorAll('.cnt')], t0 = performance.now(), ms = 1300;
  const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4);
    els.forEach((el) => (el.textContent = fm[el.dataset.f](+el.dataset.to * e))); if (k < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
  requestAnimationFrame(() => root.querySelectorAll('.barra').forEach((b) => b.classList.add('on')));
}

// ---------- visão geral ----------
let dias = 30;
$('periodo').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; dias = +b.dataset.d; $('periodo').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadGeral(); };
async function loadGeral() {
  const j = await api('resumo', null, '&dias=' + dias); if (!j.ok) return;
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
    <div class="bh"><span class="tag y">💰 SAÚDE FINANCEIRA</span><small>só dinheiro de venda pela Eduzz. Cortesia não entra aqui.</small></div>
    <div class="hero">
      <div class="hmain"><small>FATURAMENTO LÍQUIDO TOTAL</small>${N(t.faturamento_total, 'brl')}
        <span>${t.alunos_pagos} aluno${t.alunos_pagos === 1 ? '' : 's'} pagando · ${brl(t.bruto_total)} vendidos − ${brl(t.reembolsado_total)} reembolsados</span>
        <div class="socios"><div><small>Leo (50%)</small>${N(t.faturamento_total / 2, 'brl')}</div><div><small>Reinaldo (50%)</small>${N(t.faturamento_total / 2, 'brl')}</div></div>
      </div>
      <div class="hgrid">
        ${card('y', '📅', 'No mês', t.faturamento_mes, 'brl', varMes === null ? `hoje: ${brl0(t.faturamento_hoje)}` : `${varMes >= 0 ? '▲' : '▼'} ${pc(Math.abs(varMes))} vs mês passado · hoje ${brl0(t.faturamento_hoje)}`)}
        ${card('y', '⏱', 'Nos últimos ' + per, t.faturamento_periodo, 'brl', `${t.vendas_periodo} venda${t.vendas_periodo === 1 ? '' : 's'} · ticket ${brl0(t.ticket_medio)}`)}
        ${card('g', '🔁', 'Receita recorrente / mês', t.mrr, 'brl', `carteira anual ativa: ${brl0(t.carteira_anual)}`)}
        ${card(t.taxa_reembolso > 0.1 ? 'r' : 'c', '↩', 'Reembolsos', t.reembolsado_total, 'brl', `${pc(t.taxa_reembolso)} do vendido · ${t.reembolsos_periodo} no período`)}
      </div>
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
  $('fatTot').textContent = brl(t.faturamento_periodo);
  G.area($('cFat'), j.faturamento, { color: '#ffd400', fmt: (v) => (v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v)) });
  G.ring($('cConv'), t.conversao_teste, { color: '#a77bff' });
  $('convLeg').textContent = `${t.testes_convertidos} compraram de ${t.testes_total} que testaram`;
  G.bars($('cVendas'), j.vendas, { color: '#2ee59d' });
  G.area($('cUso'), j.cadastros, { color: '#ffd400', second: j.videos, color2: '#2ee59d' });
  const parts = [{ v: t.alunos_pagos, c: '#2ee59d', n: 'Pagos' }, { v: t.cortesias, c: '#a77bff', n: 'Cortesia' }, { v: t.em_teste, c: '#ffd400', n: 'Teste' }, { v: t.reembolsos + t.bloqueados, c: '#ff4d5e', n: 'Reembolso/bloqueio' }];
  G.donut($('cBase'), parts);
  $('baseLeg').innerHTML = parts.map((p) => `<span style="color:${p.c}">●</span> ${p.n} ${p.v}`).join(' &nbsp; ');
  $('ultVendas').innerHTML = j.ultimas_vendas.length ? `<table><tr><th>Quando</th><th>Aluno</th><th>Valor</th><th>Status</th><th></th></tr>${j.ultimas_vendas.map((v) => `<tr><td>${dt(v.created_at)}</td><td>${esc(v.name || '')}<small>${esc(v.email)}</small></td><td>${brl(v.value)}</td><td><span class="st ${esc(v.status)}">${esc(v.status)}</span></td><td><button class="btn sm ghost" data-apagar-venda="${v.id}" title="Apagar venda lançada por engano">Apagar</button></td></tr>`).join('')}</table>` : '<p class="sub">Nenhuma venda ainda. Elas aparecem aqui assim que a Eduzz avisar.</p>';
}
$('ultVendas').onclick = async (e) => {
  const b = e.target.closest('[data-apagar-venda]'); if (!b) return;
  if (!confirm('Apagar esta venda do faturamento? Use só para venda de teste ou lançada por engano. Não mexe na Eduzz.')) return;
  const j = await api('venda-apagar', { id: +b.dataset.apagarVenda });
  if (j.ok) { toast('Venda apagada do faturamento.'); loadGeral(); } else toast(j.error || 'Não deu certo.');
};
let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => !$('tGeral').hidden && loadGeral(), 300); });

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
  $('tblEmails').innerHTML = e.items.length ? `<table><tr><th>Quando</th><th>Para</th><th>Tipo</th><th>Assunto</th><th></th></tr>${e.items.map((m) => `<tr><td>${dt(m.created_at)}</td><td>${esc(m.email)}</td><td>${esc(m.kind)}</td><td>${esc(m.subject)}</td><td>${+m.ok ? '<span class="st active">enviado</span>' : `<span class="st blocked">falhou</span><small>${esc(m.error)}</small>`}</td></tr>`).join('')}</table>` : '<p class="sub">Nenhum e-mail ainda.</p>';
}
$('reenviarEmails').onclick = async (ev) => {
  if (!confirm('Mandar de novo os e-mails que falharam? Só vai para quem ainda faz sentido (ex.: quem ainda não comprou recebe o "teste terminou").')) return;
  ev.target.disabled = true; toast('Reenviando…');
  const j = await api('emails-reenviar', {}); ev.target.disabled = false;
  toast(j.ok ? `Reenviados: ${j.reenviados}. Pulados: ${j.pulados}.${j.falharam_agora ? ' Falharam agora: ' + j.falharam_agora : ''}` : j.error); loadFunil();
};
$('rodarFunil').onclick = async () => { const j = await api('funil-rodar', {}); toast(`Funil rodou: ${j.enviados} envio(s).`); loadFunil(); };

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
