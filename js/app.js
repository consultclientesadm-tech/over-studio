// ===== Studio Cover · app em 5 etapas =====
// 1 Vídeo → 2 Afinação → 3 Mix e master → 4 Cor → 5 Exportar.
// Em toda etapa há um player só e o botão ANTES | DEPOIS: ANTES = como estava antes desta etapa,
// DEPOIS = com esta etapa aplicada, no mesmo ponto do vídeo. Cada etapa tem aplicar e desfazer.
import * as cover from './pipeline.js?v=44';
import { prefetchModel } from './studio.js?v=41';
import { TuneEditor } from './editor.js?v=37';
import { Grader, FILTERS, ORIGINAL, autoGrade, compose } from './filters.js?v=40';
import { exportVideo, exportType } from './export.js?v=39';

const $ = (id) => document.getElementById(id);
const app = $('app');
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const pct = (v) => Math.round(v * 100) + '%';
let toastT = 0;
const toast = (msg, ms = 3500) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); };

let file = null, refFile = null, state = null, audioOnly = false;
let tuned = false, mastered = null; // mastered = resultado do render (ou null)
let step = 2, side = 'B', pending = false;
let look = null, auto = null, amount = 1; // look = filtro escolhido; auto = Colorista
const undo = [];
const video = $('video');
video.muted = true; video.defaultMuted = true; video.playsInline = true; // o som vem do player; vídeo mudo toca sozinho no celular
// Som da prévia: UM player de áudio comum (toca no iPhone mesmo com a chave do silencioso ligada,
// o que o Web Audio não faz) com o arquivo só do lado escolhido. Antes eram 3 players e 3 arquivos.
const tracks = { orig: null, raw: null, master: null };
const player = new Audio();
player.preload = 'auto'; player.setAttribute('playsinline', ''); player.playsInline = true;
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
let curKey = 'raw', srcKey = '', srcUrl = '', offset = 0, pendingT = null;
function loadKey(key) {
  if (srcKey === key && srcUrl) return;
  const ch = tracks[key] || tracks.raw; if (!ch) return;
  if (srcUrl) URL.revokeObjectURL(srcUrl);
  srcUrl = URL.createObjectURL(cover.toWav(ch, cover.SR)); srcKey = key;
  player.src = srcUrl; player.load(); pendingT = offset;
}
function setT(t) {
  offset = Math.max(0, t);
  if (player.readyState >= 1 && pendingT == null) { try { player.currentTime = offset; } catch { pendingT = offset; } } else pendingT = offset;
}
player.addEventListener('loadedmetadata', () => { if (pendingT != null) { try { player.currentTime = pendingT; } catch {} pendingT = null; } });
const aTime = () => (pendingT != null || player.readyState < 1 ? offset : (offset = player.currentTime));
let aWarned = false;
function aPlay() {
  const p = player.play();
  if (p) p.catch((e) => { if (e.name === 'NotAllowedError' && !aWarned) { aWarned = true; toast('Toque no ▶ para ouvir o som.'); } });
}
function aStart(t) { loadKey(curKey); setT(t); aPlay(); }
// Relógio da prévia: o tempo corre pelo relógio do aparelho, a partir do play. Som e imagem tocam soltos na
// velocidade normal a partir do mesmo ponto; nada fica perguntando a posição um do outro (no iPhone essa
// posição vem errada e fazia o vídeo pular sem parar, parecendo congelado).
const clk = { t0: 0, at: 0, run: false };
function clkSet(t) { clk.t0 = Math.max(0, t); clk.at = performance.now(); }
const ct = () => (clk.run ? clk.t0 + (performance.now() - clk.at) / 1000 : clk.t0);
player.addEventListener('playing', () => { if (want && Math.abs(player.currentTime - ct()) < 1.5) clkSet(player.currentTime); });
// atraso de saída do som do aparelho (alto-falante, fone com fio ou Bluetooth), medido pelo próprio sistema
let latCtx = null, latVal = 0, latAt = 0;
function outLat() {
  const now = performance.now(); if (now - latAt < 2000) return latVal; latAt = now;
  try {
    latCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const v = (latCtx.outputLatency || 0) + (latCtx.baseLatency || 0);
    latVal = Math.max(0, Math.min(0.4, isFinite(v) ? v : 0));
  } catch { latVal = 0; }
  return latVal;
}
function aStop() { aTime(); player.pause(); }
function aKey(key) {
  if (key === curKey && srcKey === key) return;
  const t = ct(), was = want; player.pause(); curKey = key;
  if (tracks[key] || tracks.raw) { loadKey(key); setT(t); if (was) aPlay(); }
}
const fresh = (key) => { if (srcKey !== key) return; srcKey = ''; if (curKey === key) { const t = ct(); player.pause(); loadKey(key); setT(t); if (want) aPlay(); } };
player.onended = () => pause();
// iPhone: libera o som no primeiro toque na tela, para os toques seguintes já tocarem
addEventListener('touchend', function unlock() { if (player.src) return removeEventListener('touchend', unlock); player.muted = true; const p = player.play(); if (p) p.then(() => { player.pause(); player.muted = false; }).catch(() => { player.muted = false; }); removeEventListener('touchend', unlock); }, { passive: true });
const tuneOpts = () => ({ separate: $('optSeparate').checked, strength: +$('q').dataset.global || 1, scaleSnap: $('mSnap').checked,
  straighten: $('s').dataset.global != null ? +$('s').dataset.global : 1, useRef: $('mUseRef').checked });
let compMode = 'auto';
// ---- Dupla, trio, backing vocal: cada voz tem a sua afinação, o seu mudo (na prévia) e o seu volume ----
let cur = 0; // voz aberta no painel de afinação
const muted = new Set();
const S = () => (state.parts ? state.parts[cur] : state); // o que o painel de afinação mostra e mexe
const pg = () => (state.parts ? state.parts.map((_, i) => (muted.has(i) ? 0 : 1)) : null);
const origTrack = () => (state.parts ? cover.rawMix(state, pg(), true) : state.orig);
const rawTrack = () => cover.rawMix(state, pg());
const dbG = (db) => (db <= -15 ? 0 : 10 ** (db / 20));
const voiceDb = (pre = 'm') => (state && state.parts ? state.parts.map((_, i) => +($(pre + 'V' + i)?.value || 0)) : null);
const mixOpts = () => ({ voiceGains: voiceDb(), voiceDb: +$('mVoice').value, bedDb: +$('mBed').value, eq: { low: +$('mLow').value, mid: +$('mMid').value, high: +$('mHigh').value }, comp: { mode: compMode, amount: +$('mComp').value }, reverb: +$('mReverb').value, fadeIn: +$('mFadeIn').value, fadeOut: +$('mFadeOut').value, trim: $('mTrim').checked });

// ---------- 1) Vídeo ----------
const drop = $('drop');
$('file').onchange = () => $('file').files[0] && start($('file').files[0]);
$('audioFile').onchange = () => $('audioFile').files[0] && start($('audioFile').files[0]);
// Só o áudio: a pessoa tirou o som do vídeo e sobe ele; no fim baixa o áudio pronto e junta no editor
const isAudio = (f) => /^audio\//.test(f.type) || (!/^video\//.test(f.type) && /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(f.name || ''));
// o celular recarregou a página no meio? continua o mesmo vídeo, sem a pessoa precisar subir de novo
setTimeout(async () => {
  if (!resumeInfo) return;
  let f = null, ref = null;
  try { f = await idb('readonly', (st) => st.get('video')); ref = await idb('readonly', (st) => st.get('ref')); } catch {}
  if (!f) return;
  try { localStorage.removeItem('sc-last'); } catch {}
  document.querySelector('.lastrun')?.remove();
  if (ref) { refFile = ref; }
  toast('O celular precisou recarregar a página. Continuando o seu vídeo de onde parou…', 6000);
  start(f, (resumeInfo.tries || 1) + 1);
}, 300);
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) start(f); });

// ---------- Avisos que explicam (em vez de o app só travar ou mostrar um erro seco) ----------
const MAX_SEC = 180; // limite de duração (3 minutos): o áudio inteiro fica na memória várias vezes (original, voz, base, afinada, mix)
const MIN = MAX_SEC / 60;
const CEL = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const MB_OK = 300; // vídeo de até 3 min em 1080p fica bem abaixo disso; acima, no celular, costuma ser 4K ou longo demais
const escH = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// janela com título, texto, lista de passos e botões [{ t, v, b (principal) }]; devolve o v do botão tocado (ou null)
function aviso(titulo, texto, passos = [], botoes = [{ t: 'Entendi', v: true, b: 1 }]) {
  return new Promise((res) => {
    const ov = document.createElement('div'); ov.className = 'av-ov';
    ov.innerHTML = `<div class="av-sh" role="dialog" aria-modal="true"><h3>${titulo}</h3>${texto ? `<p>${texto}</p>` : ''}
      ${passos.length ? `<ul>${passos.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
      ${botoes.map((b, i) => `<button type="button" class="${b.b ? 'av-b' : 'av-b2'}" data-i="${i}">${b.t}</button>`).join('')}</div>`;
    const fim = (v) => { ov.remove(); res(v); };
    ov.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) fim(botoes[+b.dataset.i].v); else if (e.target === ov) fim(null); });
    document.body.appendChild(ov);
  });
}
const DICAS = [
  `<b>Vídeo de até ${MIN} minutos</b> (se for maior, o app usa só os ${MIN} primeiros)`,
  `<b>Até ${MB_OK} MB</b>, de preferência gravado em <b>1080p</b>. Vídeo em 4K é aceito, mas o seu cover sempre sai em <b>1080p</b> (o padrão do Instagram, com a mesma qualidade), e o 4K pesa até 3 vezes mais para o celular`,
  'Feche os outros apps e deixe o Studio Cover aberto na tela até terminar',
  'Use pelo <b>ícone da tela de início</b> ou no Safari/Chrome (não no navegador do Instagram)',
];
// toda vez que a pessoa vai escolher o vídeo: lembra o que roda sem travar
drop.addEventListener('click', async (e) => {
  if (e.target.closest('input') || drop.dataset.liberado) return;
  e.preventDefault();
  const ok = await aviso('🎬 Antes de escolher o vídeo', 'Para o seu cover sair rápido e sem travar:', DICAS,
    [{ t: 'ESCOLHER O VÍDEO', v: true, b: 1 }, { t: 'Cancelar', v: false }]);
  if (!ok) return;
  drop.dataset.liberado = '1'; $('file').click(); setTimeout(() => delete drop.dataset.liberado, 500);
});
// duração do vídeo sem abrir ele inteiro (só o cabeçalho); 0 se não der para saber em poucos segundos
function duracaoDe(f) {
  return new Promise((res) => {
    const v = document.createElement('video'), u = URL.createObjectURL(f);
    const fim = (d) => { clearTimeout(t); v.removeAttribute('src'); try { v.load(); } catch {} URL.revokeObjectURL(u); res(isFinite(d) ? d : 0); };
    const t = setTimeout(() => fim(0), 4000);
    v.preload = 'metadata'; v.muted = true; v.onloadedmetadata = () => fim(v.duration); v.onerror = () => fim(0); v.src = u;
  });
}
// depois de escolher: vídeo longo ou pesado demais? explica antes de começar (e antes de gastar o teste grátis)
async function conferirVideo(f) {
  if (isAudio(f)) return true;
  const mb = Math.round(f.size / 1048576), dur = await duracaoDe(f);
  const longo = dur > MAX_SEC + 5, pesado = CEL && mb > MB_OK;
  if (!longo && !pesado) return true;
  const txt = [longo ? `Seu vídeo tem <b>${fmt(dur)}</b>. O limite é de <b>${MAX_SEC / 60} minutos</b>: o app vai usar só os ${MAX_SEC / 60} primeiros.` : '',
    pesado ? `Ele tem <b>${mb} MB</b>. Acima de ${MB_OK} MB o celular pode ficar sem memória e fechar o app no meio (não é defeito do app, é o limite do aparelho).` : ''].filter(Boolean).join(' ');
  const passos = [longo ? 'Corte o vídeo no celular (Fotos › Editar) só com o trecho que quer postar' : '',
    pesado ? 'Grave em <b>1080p</b> em vez de 4K (Ajustes › Câmera › Gravar vídeo, no iPhone): o cover sai em 1080p de qualquer jeito' : '',
    pesado ? 'Ou use <b>"Ou suba só o áudio"</b> ou o computador' : ''].filter(Boolean);
  return !!(await aviso(longo ? `⏱️ Vídeo maior que ${MIN} minutos` : '⚠️ Vídeo pesado para o celular', txt, passos,
    [{ t: 'Escolher outro vídeo', v: false, b: 1 }, { t: longo ? `Continuar com os ${MAX_SEC / 60} primeiros minutos` : 'Tentar mesmo assim', v: true }]));
}
// erro: em vez de um aviso seco, explica o que fazer
function ajudaErro(titulo, texto, mb) {
  const passos = [
    'Feche os outros apps e abas e tente de novo',
    `Use vídeo de <b>até ${MIN} minutos</b> e <b>até ${MB_OK} MB</b>${mb ? ` (o seu tinha ${mb} MB)` : ''}, gravado em <b>1080p</b>`,
    'Abra pelo <b>ícone da tela de início</b> (ou no Safari/Chrome), nunca pelo navegador do Instagram',
    'Se continuar, use <b>"Ou suba só o áudio"</b> ou o computador',
  ];
  return aviso(titulo, texto, passos);
}
$('newBtn').onclick = () => location.reload();
// IA já vai para o aparelho enquanto a pessoa escolhe o vídeo (direto para o armazenamento, sem pesar na memória)
setTimeout(() => { prefetchModel(); }, 1500);
$('refFile').onchange = () => { refFile = $('refFile').files[0] || null; $('refName').textContent = refFile ? '✓ ' + refFile.name + ' (vamos afinar pela melodia dela)' : 'Opcional: a gente pega a melodia do cantor original no seu tom e afina você por ela.'; $('refPick').classList.toggle('on', !!refFile); };

const W = { audio: [0, 4], download: [4, 16], separate: [20, 58], voices: [78, 4], notes: [82, 6], ref: [88, 1], refsep: [88, 9], refnotes: [97, 3] };
const LABEL = { audio: 'Lendo o áudio', download: 'Baixando a IA', separate: 'Separando a voz', voices: 'Vendo se é dupla ou trio', notes: 'Achando as notas', ref: 'Lendo a original', refsep: 'Lendo a melodia da original', refnotes: 'Lendo a melodia da original' };
let t0 = 0, lastEta = 0;
function progress(st, p) {
  // download em 100% = a IA já baixou e está sendo ligada (é aí que pesa na memória): registra separado
  note({ stage: st === 'download' && p >= 1 ? 'Ligando a IA' : LABEL[st] || st, pct: Math.round(((W[st] || [0, 0])[0]) + ((W[st] || [0, 0])[1]) * p) });
  const [a, w] = W[st] || [0, 0];
  const v = Math.min(100, Math.round(a + w * p));
  // tempo que falta, pela velocidade da separação (a parte que demora)
  const el = (performance.now() - t0) / 1000;
  if (st === 'separate' && p > 0.04 && performance.now() - lastEta > 1000) {
    lastEta = performance.now();
    const sepEl = el - (progress.sepStart ?? el), left = Math.max(1, (sepEl / p) * (1 - p) + 2);
    $('eta').textContent = left > 90 ? `Falta uns ${Math.round(left / 60)} min` : `Falta uns ${Math.max(5, Math.round(left / 5) * 5)} s`;
  }
  if (st === 'separate' && progress.sepStart == null) progress.sepStart = el;
  if (st !== 'separate' && st !== 'download') $('eta').textContent = '';
  $('ringBar').style.strokeDashoffset = 327 * (1 - v / 100);
  $('ringPct').textContent = v + '%';
  $('workStep').textContent = st === 'download' && p >= 1 ? 'Ligando a IA' : LABEL[st] || '';
  const order = Object.keys(W), alias = { ref: 'refsep', refnotes: 'refsep' };
  document.querySelectorAll('#steps li').forEach((li) => { const i = order.indexOf(li.dataset.s), c = order.indexOf(alias[st] || st); li.className = (li.classList.contains('refstep') ? 'refstep ' : '') + (i < c ? 'done' : i === c ? 'on' : ''); });
}
// O iPhone ignora o "preload" e não entrega o vídeo até alguém dar play. Um play mudo e pausa resolve.
function kick() { try { const p = video.play(); if (p) p.then(() => video.pause()).catch(() => {}); } catch {} }
// Espera o vídeo ter um quadro, mas nunca para sempre: no máximo uns segundos, tentando de novo no meio
async function videoReady() {
  const ok = () => video.readyState >= 2 || (video.readyState >= 1 && video.videoWidth > 0);
  for (let i = 0; i < 40 && !ok(); i++) { if (i === 10 || i === 25) kick(); await new Promise((r) => setTimeout(r, 200)); }
  video.pause(); // sem quadro ainda? segue mesmo assim: o iPhone entrega a imagem quando tocar
}
// Diário da última tentativa: se o celular fechar a página no meio, na volta o app conta em que ponto foi
const RUN = 'sc-run';
// diário enviado ao painel (só no domínio com conta): começou, abriu, exportou, erro, fechou no meio
const ev = (k, d = {}) => { try { window.scLog && window.scLog(k, d); } catch {} };
let runInfo = null;
function note(patch) { if (!runInfo) return; Object.assign(runInfo, patch); try { localStorage.setItem(RUN, JSON.stringify(runInfo)); } catch {} }
function endRun() { runInfo = null; const fp = forget(); try { localStorage.removeItem(RUN); localStorage.removeItem('sc-last'); } catch {} return fp; }
try {
  const last = JSON.parse(localStorage.getItem(RUN) || 'null');
  if (last && (last.tries || 1) < 2) { localStorage.removeItem(RUN); localStorage.setItem(RUN + '-resume', JSON.stringify(last)); }
  else if (last) {
    localStorage.removeItem(RUN);
    ev('fechou', { etapa: last.stage, pct: last.pct, mb: last.mb, dur: last.dur, msg: last.erro || '' });
    const msg = `Última tentativa: o aparelho fechou o app em "${last.stage}" (${last.pct}%) · vídeo de ${last.mb} MB${last.dur ? ', ' + last.dur : ''} · v37`;
    try { localStorage.setItem('sc-last', msg); } catch {}
    setTimeout(() => ajudaErro('O celular fechou o app no meio', `Na última tentativa o celular ficou sem memória e fechou o app em "${escH(last.stage)}". Isso acontece com vídeo longo ou pesado, ou com muitos apps abertos. Para dar certo:`, last.mb), 600);
  }
} catch {}
// ---- Guarda o vídeo no aparelho enquanto processa: se o celular recarregar a página no meio, o app continua sozinho ----
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('studio-cover', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => { const db = r.result, t = db.transaction('f', mode), st = t.objectStore('f'); let out; const q = fn(st); if (q) q.onsuccess = () => (out = q.result); t.oncomplete = () => { db.close(); res(out); }; t.onerror = () => { db.close(); rej(t.error); }; };
  });
}
const keep = (f, ref) => idb('readwrite', (st) => { st.put(f, 'video'); if (ref) st.put(ref, 'ref'); else st.delete('ref'); }).catch(() => {});
const forget = () => idb('readwrite', (st) => st.clear()).catch(() => {});
let resumeInfo = null;
try {
  const last = JSON.parse(localStorage.getItem(RUN + '-resume') || 'null');
  localStorage.removeItem(RUN + '-resume');
  if (last && (last.tries || 1) < 2) resumeInfo = last;
} catch {}
// registro fixo na tela inicial (o aviso some; este fica até a próxima tentativa dar certo)
// Aparelho abaixo do mínimo: avisa antes de a pessoa gastar tempo
try {
  const ua = navigator.userAgent, ios = ua.match(/OS (\d+)_\d+.* like Mac OS X/), mem = navigator.deviceMemory;
  const old = (ios && +ios[1] < 15) || (/Android/.test(ua) && mem && mem < 4);
  if (old && !window.scCompat) { const r = $('req'); r.classList.add('warn'); r.textContent = 'Este aparelho parece abaixo do mínimo (iPhone 13 ou Android com 4 GB). Pode fechar no meio. Se puder, use um celular mais novo ou o computador.'; }
} catch {}
// resultado do teste deste aparelho no cartão de requisitos da tela inicial
try { const c = window.scCompat, el = $('reqMeuApp'); if (c && el) c.ready.then((i) => { el.className = 'reqmeu ' + i.nivel; el.textContent = i.nivel === 'ok' ? '✓ Testamos o seu aparelho: ele é compatível.' : i.nivel === 'fraco' ? '⚠️ Seu aparelho está no limite: use vídeos curtos (até 1 minuto) ou o computador.' : '⛔ Seu aparelho não é compatível: use o computador ou um celular mais novo.'; }); } catch {}
try { const m = localStorage.getItem('sc-last'); if (m) { const d = document.createElement('p'); d.className = 'lastrun'; d.textContent = m; $('home').appendChild(d); } } catch {}
async function start(f, tries = 1) {
  // versão com conta (domínio próprio): confere o teste grátis / acesso antes de processar
  if (tries === 1 && !(await conferirVideo(f))) { $('file').value = ''; $('audioFile').value = ''; return; }
  if (tries === 1 && window.scGate && !(await window.scGate(f))) { $('file').value = ''; $('audioFile').value = ''; return; }
  runInfo = { stage: 'Abrindo o vídeo', pct: 0, mb: Math.round(f.size / 1048576), dur: '', ua: navigator.userAgent.slice(0, 80), tries }; note({});
  ev('inicio', { mb: Math.round(f.size / 1048576), audio: isAudio(f) ? 1 : 0, tries });
  if (tries === 1) await Promise.race([keep(f, refFile), new Promise((r) => setTimeout(r, 5000))]);
  file = f;
  audioOnly = isAudio(f); app.classList.toggle('audio', audioOnly);
  if (!audioOnly && tries === 1 && f.size > 300 * 1048576 && /iPhone|iPad|Android/i.test(navigator.userAgent))
    toast(`Vídeo grande (${Math.round(f.size / 1048576)} MB): pode demorar mais no celular. Se o celular fechar o app, use "Ou suba só o áudio" ou o computador.`, 9000);
  app.dataset.screen = 'work'; progress('audio', 0);
  $('topinfo').textContent = f.name;
  $('steps').classList.toggle('ref', !!refFile);
  try {
    // primeiro só o áudio (o vídeo 4K aberto ao mesmo tempo que a IA estourava a memória do iPhone)
    t0 = performance.now(); lastEta = 0; progress.sepStart = null; $('eta').textContent = '';
    state = await cover.analyze(f, { ...tuneOpts(), reference: refFile, autoTune: false, maxSec: MAX_SEC }, progress);
    note({ dur: fmt(state.duration), stage: 'Abrindo a imagem do vídeo', pct: 99 });
    cur = 0; muted.clear();
    tracks.orig = origTrack(); tracks.raw = rawTrack();
    video.src = URL.createObjectURL(f); video.load();
    kick();
    if (!audioOnly) await videoReady();
    if (!audioOnly && (!video.videoWidth || video.error)) await convertVideo();
    note({ stage: 'Abrindo o estúdio', pct: 100 });
    openStudio();
    ev('abriu', { seg: Math.round((performance.now() - t0) / 1000), dur: Math.round(state.duration || 0), mb: Math.round(f.size / 1048576), vozes: state.voices?.count || 1, junto: state.voices?.together || 0 });
    if (window.scOk) window.scOk(); // teste grátis: conta aqui, quando a pessoa já vê e ouve o antes e depois
    if (state.cortado) toast(`Seu vídeo tem ${fmt(state.cortado)}. Usei os primeiros ${MAX_SEC / 60} minutos (o limite por vídeo). Se quiser outro trecho, corte no celular e suba de novo.`, 9000);
    const fp = endRun();
    // teste grátis: guarda o vídeo no aparelho; se a pessoa comprar e a página recarregar, ele sai pronto de novo sem subir outra vez
    if (window.scTeste && window.scTeste()) fp.then(() => idb('readwrite', (st) => st.put(f, 'pendente'))).catch(() => {});
  } catch (e) {
    // O celular perdeu o acesso ao arquivo escolhido (vídeo na nuvem/Google Fotos, app foi para o fundo):
    // tenta de novo com a cópia que guardamos no aparelho ao escolher o vídeo
    if (tries === 1 && LEITURA.test(String(e.message) + ' ' + (e.name || ''))) {
      let copia = null;
      try { copia = await idb('readonly', (st) => st.get('video')); if (copia) await copia.slice(0, 65536).arrayBuffer(); } catch { copia = null; }
      if (copia) { console.warn('arquivo original ilegível; usando a cópia guardada'); endRun(); return start(copia, 2); }
    }
    console.error(e); endRun(); ev('erro', { etapa: 'abrir o vídeo', msg: String(e.message).slice(0, 160), mb: Math.round(f.size / 1048576), dur: Math.round(e.duration || 0), nome: String(f.name || '').slice(-12), tipo: f.type || '', causa: e.causa || '' });
    app.dataset.screen = 'home';
    const mbE = Math.round(f.size / 1048576);
    if (e.message === 'LIMITE') aviso(`⏱️ Vídeo maior que ${MIN} minutos`, `Esse vídeo tem ${fmt(e.duration || video.duration)}. O limite é de ${MAX_SEC / 60} minutos.`, ['Corte o vídeo no celular (Fotos › Editar) só com o trecho que quer postar e suba de novo']);
    else if (/decod|Unable|EncodingError|não é AAC|não tem áudio/i.test(e.message)) aviso('Não consegui ler o áudio desse vídeo', escH(e.message), ['Grave com a câmera do próprio celular (MP4 ou MOV)', 'Se o vídeo veio de outro app ou do WhatsApp, salve o original e suba de novo', 'Ou use <b>"Ou suba só o áudio"</b>']);
    else if (LEITURA.test(String(e.message) + ' ' + (e.name || ''))) perdeuArquivo();
    else ajudaErro('Não deu certo desta vez', escH(e.message), mbE);
  }
}
// "could not be read" (Chrome) / "The I/O read operation failed." (Safari/iPhone): o aparelho tirou o acesso ao arquivo.
// "A requested file or directory could not be found" (Chrome/Android, NotFoundError): o arquivo sumiu depois de escolhido
// (vídeo do Google Fotos/Drive que era só uma cópia temporária, ou a galeria apagou/moveu a cópia).
const LEITURA = /could not be read|NotReadable|I\/O read operation|permission problems|file or directory could not be found|NotFoundError/i;
function perdeuArquivo() {
  app.dataset.screen = 'home';
  return aviso('O celular perdeu o acesso a esse vídeo', 'O aparelho não deixou mais o app ler o arquivo. Isso acontece quando o vídeo está na nuvem (iCloud, Google Fotos, Drive) ou quando o app fica em segundo plano enquanto abre.',
    ['Abra o vídeo na galeria e espere ele baixar inteiro no aparelho', 'Toque em <b>Novo vídeo</b> e escolha o vídeo de novo', 'Deixe o app aberto na tela até terminar de abrir', 'Se o vídeo veio do WhatsApp ou do Drive, salve no aparelho primeiro']);
}

// O navegador leu o som mas não abre a imagem (Edge sem HEVC com vídeo do iPhone): converte aqui no aparelho
async function convertVideo() {
  let conv; try { conv = await import('./convert.js?v=37'); } catch { return; }
  if (!conv.canConvert()) return;
  note({ stage: 'Convertendo o vídeo para este navegador', pct: 99 });
  $('workStep').textContent = 'Preparando a imagem do vídeo para este navegador (só neste caso)';
  $('eta').textContent = '';
  const ring = (p) => { $('ringBar').style.strokeDashoffset = 327 * (1 - p); $('ringPct').textContent = Math.round(p * 100) + '%'; };
  ring(0);
  try {
    const tc = performance.now();
    const out = await conv.toH264(file, ring);
    console.info('conversão do vídeo:', Math.round((performance.now() - tc) / 1000) + ' s');
    file = out;
    URL.revokeObjectURL(video.src);
    video.src = URL.createObjectURL(out); video.load(); kick();
    await videoReady();
  } catch (e) { console.warn('conversão', e); }
}

// ---------- Estúdio ----------
let grader = null, editor = null;
const frame = document.createElement('canvas'), fctx = frame.getContext('2d');
let lastVT = -1, lastEd = 0;
// O filtro aproximado em CSS enquanto o vídeo toca (a placa de vídeo do celular aplica de graça, sem travar).
// O arquivo final e o quadro pausado usam o filtro completo.
function cssLook(f, k = 1) {
  if (!f || f.id === 'original' || !k) return '';
  const m = (v, base) => base + (v - base) * k;
  const warm = f.temp > 0 ? f.temp * 1.8 : 0, cool = f.temp < 0 ? f.temp * 70 : 0;
  return `brightness(${m(1 + f.exposure * 1.4 - f.fade * 0.3, 1).toFixed(3)}) contrast(${m(1 + (f.contrast - 1) * 1.5 - f.fade * 0.6, 1).toFixed(3)}) saturate(${m(f.saturation, 1).toFixed(3)})`
    + (warm ? ` sepia(${(warm * k).toFixed(3)})` : '') + (cool ? ` hue-rotate(${(cool * k).toFixed(1)}deg)` : '');
}
function grab() { if (!audioOnly && video.readyState >= 2 && frame.width) { fctx.drawImage(video, 0, 0, frame.width, frame.height); lastVT = video.currentTime; } }
function openStudio() {
  app.dataset.screen = 'studio';
  $('newBtn').hidden = false;
  const cv = $('screen'), portrait = video.videoHeight >= video.videoWidth;
  // prévia mais leve no celular (o vídeo final continua em 1080p)
  const big = Math.min(innerWidth, innerHeight) >= 700 ? 1280 : 960, small = Math.round((big * 9) / 16);
  cv.width = portrait ? small : big; cv.height = portrait ? big : small;
  // o quadro do vídeo passa antes por um canvas 2D no tamanho da prévia: a placa de vídeo recebe
  // uma imagem pequena (não o 4K do iPhone) e o iPhone sempre entrega o quadro, mesmo pausado
  const sc = Math.min(1, big / Math.max(video.videoWidth || 1, video.videoHeight || 1));
  frame.width = Math.round(video.videoWidth * sc); frame.height = Math.round(video.videoHeight * sc);
  const fit = () => {
    const r = $('viewer').getBoundingClientRect(), ar = portrait ? 9 / 16 : 16 / 9;
    let h = r.height, w = h * ar;
    if (w > r.width) { w = r.width; h = w / ar; }
    cv.style.width = video.style.width = Math.floor(w) + 'px'; cv.style.height = video.style.height = Math.floor(h) + 'px';
  };
  new ResizeObserver(fit).observe($('viewer')); fit();
  grader = new Grader(cv);
  editor = new TuneEditor($('editor'), { onSelect, onEdit, onSeek: (t) => seek(t) });
  editor.load(S());
  voiceBar(); voiceVols();
  $('seek').max = state.duration.toFixed(2); $('tEnd').textContent = fmt(state.duration);
  refreshRef(); refreshChips();
  noImage();
  go(2);
  requestAnimationFrame(loop);
  $('quick').hidden = false;
}

// O navegador abriu o som mas não a imagem (ex.: Edge no Windows sem a extensão de HEVC não abre o vídeo do iPhone).
// Em vez de deixar a área do vídeo vazia, explica e manda abrir no Chrome (que abre HEVC sozinho).
function noImage() {
  const box = $('noImg'); if (box) box.remove();
  if (audioOnly || (video.videoWidth && !video.error)) return;
  const edge = /Edg\//.test(navigator.userAgent), ff = /Firefox\//.test(navigator.userAgent);
  const nav = edge ? 'O Microsoft Edge' : ff ? 'O Firefox' : 'Este navegador';
  const d = document.createElement('div'); d.id = 'noImg';
  d.innerHTML = `<b>${nav} não abriu a imagem deste vídeo</b><span>Vídeo de iPhone vem no formato HEVC, que ${edge ? 'o Edge só abre com uma extensão paga da Microsoft' : 'este navegador não abre'}. O som funciona, mas para ver e exportar o vídeo abra o Studio Cover no <b>Google Chrome</b> ou direto no celular.</span><button type="button">Copiar o link para abrir no Chrome</button>`;
  d.querySelector('button').onclick = async (e) => { try { await navigator.clipboard.writeText(location.origin + location.pathname); e.target.textContent = 'Link copiado. Cole no Chrome.'; } catch { e.target.textContent = location.origin + location.pathname; } };
  $('viewer').appendChild(d);
  toast(`${nav} não abriu a imagem deste vídeo do iPhone. Use o Google Chrome ou o celular.`, 9000);
}

// Caminho rápido: um toque e o vídeo sai pronto (o cantor quer postar logo)
$('quickStep').onclick = () => ($('quick').hidden = true);
$('quickAll').onclick = async () => {
  $('quick').hidden = true;
  await doTune();
  if (!tuned) return;
  busy(true, 'Mixando e masterizando…'); await doMaster(false);
  if (!audioOnly) { busy(true, 'Colorista ajustando a cor…'); try { auto = await autoGrade(video); } catch (e) { console.warn(e); } }
  look = FILTERS[0]; busy(false); // pronto já sai com o visual de câmera de cinema
  go(5); ev('pronto', {}); if (window.scPronto) window.scPronto(); toast('Pronto! Assista a prévia e baixe. Quer mudar algo? Toque na etapa lá em cima.', 6000);
};

// Etapas
function go(n) {
  if (n !== 2) closePop();
  if (n >= 3 && masterStale && mastered) { masterStale = false; busy(true, 'Atualizando a mix…'); doMaster(false).then(() => { busy(false); refreshAB(); if (step === 5) refreshSummary(); }); }
  if (audioOnly && n === 4) n = step > 4 ? 3 : 5; // só áudio: não tem etapa de cor
  const wasPlaying = playing();
  pause();
  step = n;
  $('studio').dataset.step = n;
  // afinação e mix: o próprio player do aparelho mostra o vídeo (leve). Cor e exportar: a prévia com o filtro.
  // em todas as etapas, tocando = o próprio player do aparelho (liso no celular). Pausado = quadro com o filtro exato.
  $('viewer').classList.add('live');
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('on', +s.dataset.step === n));
  document.querySelectorAll('#stepper button').forEach((b) => { const k = +b.dataset.step; b.classList.toggle('on', k === n); b.classList.toggle('done', k < n); });
  $('prev').style.visibility = n > 2 ? 'visible' : 'hidden';
  $('next').hidden = n === 5;
  document.querySelectorAll('.bedrow').forEach((r) => (r.hidden = !state.bed));
  if (n === 2) editor.resize();
  if (n === 4) buildFilters();
  if (n === 5) refreshSummary();
  refreshAB();
  seek(+$('seek').value);
  if (wasPlaying) play();
}
$('stepper').onclick = (e) => { const b = e.target.closest('button'); if (b && +b.dataset.step >= 2) go(+b.dataset.step); };
$('prev').onclick = () => go(Math.max(2, step - 1));
let warned = {};
$('next').onclick = () => {
  if (step === 2 && !tuned && !warned[2]) { warned[2] = 1; return toast('A voz ainda não foi afinada. Toque em "Afinar automático", ou em Próximo de novo para seguir sem afinar.', 5000); }
  if (step === 3 && !mastered && !warned[3]) { warned[3] = 1; return toast('Ainda sem mix e master. Toque em "Mixar e masterizar", ou em Próximo de novo para seguir assim.', 5000); }
  go(Math.min(5, step + 1));
};

// O que cada lado do botão mostra em cada etapa (na mix são três: original, afinada, mixada)
function sources() {
  const finalAudio = mastered ? 'master' : 'raw';
  const filt = currentFilter();
  if (step === 2) return { A: { name: 'ANTES', audio: 'orig', label: 'voz como foi cantada' }, B: { name: 'DEPOIS', audio: 'raw', label: tuned ? 'voz afinada' : 'ainda sem afinar' } };
  if (step === 3) return { A: { name: 'ORIGINAL', audio: 'orig', label: 'sem afinar' }, B: { name: 'AFINADA', audio: 'raw', label: tuned ? 'sem mix' : 'ainda sem afinar' },
    C: { name: 'MIXADA', audio: finalAudio, label: mastered ? 'afinada + mix e master' : 'toque em Mixar' } };
  return { A: { name: 'ANTES', audio: finalAudio, label: 'sem cor', filter: ORIGINAL }, B: { name: 'DEPOIS', audio: finalAudio, label: filt.name, filter: filt } };
}
function refreshAB() {
  const src = sources();
  if (!src[side]) side = 'B';
  if (step === 3 && side === 'B' && mastered && refreshAB.lastStep !== 3) side = 'C';
  refreshAB.lastStep = step;
  $('abC').hidden = !src.C;
  $('ab').classList.toggle('three', !!src.C);
  for (const k of ['A', 'B', 'C']) {
    if (!src[k]) continue;
    $('ab' + k + 'n').textContent = src[k].name; $('ab' + k + 'txt').textContent = src[k].label;

    $('ab' + k).classList.toggle('on', side === k);
  }
  aKey(src[side].audio);
  video.style.filter = cssLook(src[side].filter, amount);
  $('tag').textContent = src[side].name; $('tag').classList.toggle('before', side === 'A');
  grader.set(src[side].filter || ORIGINAL, amount);
  loop.dirty = true;
}
$('ab').onclick = (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.v === side) return;
  const was = playing(), t = clipT();
  pause(); side = b.dataset.v; refreshAB(); seek(t); if (was) play();
};

// Player: um áudio de cada vez (o do lado escolhido), preso no relógio do vídeo
const clipT = () => (state ? ct() : +$('seek').value || 0);
const playing = () => want;
function seek(t) {
  t = Math.max(0, Math.min(t, state.duration - 0.05));
  setT(t); clkSet(t);
  video.currentTime = t;
  $('seek').value = t; $('tNow').textContent = fmt(t);
  editor?.setTime(t);
}
// ---- Vigia da imagem: se o vídeo parar enquanto o som toca, tenta destravar e mostra o motivo na tela ----
let vErr = '';
function vplay() { wd.fAt = performance.now(); const p = video.play(); if (p) p.then(() => { vErr = ''; }).catch((e) => { vErr = e.name || 'erro'; }); }
const diag = document.createElement('div'); diag.id = 'diag'; diag.hidden = true; $('viewer').appendChild(diag);
const wd = { ct: -1, at: 0, fix: 0, shown: false, frames: 0, fAt: 0, fN: 0 };
// conta os quadros que o aparelho realmente desenha na tela (o tempo do vídeo pode andar sem a imagem mudar)
if (video.requestVideoFrameCallback) { const onF = () => { wd.frames++; video.requestVideoFrameCallback(onF); }; video.requestVideoFrameCallback(onF); }
function watchdog(now) {
  if (!want || video.seeking) { wd.ct = video.currentTime; wd.at = now; return; }
  const moved = video.currentTime !== wd.ct;
  if (moved) { wd.ct = video.currentTime; wd.at = now; }
  // tempo andando mas nenhum quadro desenhado há 2,5 s: a imagem está parada mesmo
  if (video.requestVideoFrameCallback) { if (wd.frames !== wd.fN) { wd.fN = wd.frames; wd.fAt = now; } }
  const noPaint = video.requestVideoFrameCallback && wd.fAt && now - wd.fAt > 2500;
  if (moved && !noPaint) { if (wd.shown) { diag.hidden = true; wd.shown = false; } return; }
  const still = noPaint ? now - wd.fAt : now - wd.at;
  if (still > 1200 && now - wd.fix > 3000) { wd.fix = now; video.currentTime = ct(); vplay(); } // 1ª tentativa: reposiciona e dá play
  if (still > 2500 && !wd.shown) {
    wd.shown = true;
    const info = `${noPaint ? 'tempo anda, imagem não desenha' : 'imagem parada'} · estado ${video.readyState}/${video.networkState} · ${video.paused ? 'pausado' : 'tocando'}${vErr ? ' · ' + vErr : ''}${video.error ? ' · erro ' + video.error.code : ''} · ${video.videoWidth}×${video.videoHeight} · ${(file && Math.round(file.size / 1048576)) || '?'} MB`;
    diag.textContent = vErr === 'NotAllowedError' ? 'Toque aqui para soltar a imagem' : info; diag.hidden = false;
    console.warn(info); try { localStorage.setItem('sc-diag', info); } catch {}
  }
}
// toque no número da versão (ao lado do logo): mostra os números da prévia ao vivo, para um print
let diagLive = false;
document.querySelector('.brand .ver')?.addEventListener('click', () => { diagLive = !diagLive; diag.hidden = !diagLive; });
function diagTick(now) {
  if (!diagLive || now - (diagTick.t || 0) < 250) return; diagTick.t = now;
  diag.hidden = false;
  diag.textContent = `imagem ${video.currentTime.toFixed(2)} · som ${player.currentTime.toFixed(2)} · relógio ${ct().toFixed(2)} · quadros ${wd.frames} · estado ${video.readyState}/${player.readyState} · vel ${video.playbackRate} · ${video.paused ? 'img pausada' : 'img tocando'}${vErr ? ' · ' + vErr : ''} · ${video.videoWidth}×${video.videoHeight}`;
}
diag.onclick = () => { vplay(); diag.hidden = true; wd.shown = false; };
function pause() { clk.t0 = ct(); clk.run = false; want = false; aStop(); video.pause(); video.playbackRate = 1; $('play').textContent = '▶'; grab(); loop.dirty = true; }
let want = false; // a pessoa apertou play
function play() {
  if (playing()) return pause();
  let t = +$('seek').value;
  // terminou? o play recomeça do início
  const s0 = mastered && step >= 3 ? mastered.start || 0 : 0, e0 = mastered && step >= 3 ? mastered.end || state.duration : state.duration;
  if (t >= Math.min(e0, state.duration) - 0.3 || player.ended) { t = s0; seek(t); }
  want = true; clkSet(t); clk.run = true;
  if (Math.abs(video.currentTime - t) > 0.05) video.currentTime = t;
  vplay(); aStart(t); wd.ct = -1;
  $('play').textContent = '❚❚';
}

$('play').onclick = play;
// celular: app em segundo plano ou tela bloqueada → pausa (o sistema cortaria o som de qualquer jeito)
document.addEventListener('visibilitychange', () => { if (document.hidden && want) pause(); });
addEventListener('pagehide', () => { if (want) pause(); });
// celular pode derrubar a placa de vídeo da página (pouca memória): recria a prévia em vez de ficar preta
$('screen').addEventListener('webglcontextlost', (e) => e.preventDefault());
$('screen').addEventListener('webglcontextrestored', () => { try { grader = new Grader($('screen')); refreshAB(); loop.dirty = true; } catch (e) { console.warn(e); } });
// Prévia em tela cheia (a mesma prévia, só que grande; o arquivo final sai em 1080p)
function theater(on) { app.classList.toggle('theater', on); $('fsTxt').textContent = on ? '✕ Fechar' : '⛶ Tela cheia'; loop.dirty = true; }
$('fsBtn').onclick = () => theater(!app.classList.contains('theater'));
$('watchBtn').onclick = () => { theater(true); seek(mastered ? mastered.start : 0); if (!playing()) play(); };
addEventListener('keydown', (e) => { if (e.key === 'Escape') theater(false); });
$('back5').onclick = () => seek(clipT() - 5);
$('fwd5').onclick = () => seek(clipT() + 5);
$('seek').oninput = () => seek(+$('seek').value);
video.onseeked = () => { grab(); loop.dirty = true; };
function loop(now) {
  if (app.dataset.screen !== 'studio') return;
  if (playing()) {
    // O som nunca para (é ele que a pessoa está avaliando). O vídeo roda solto e só é ajustado de leve
    // pela velocidade; pulo só se ficar mais de 1 s atrás, e no máximo um a cada 3 s (pular seguido congela).
    // Ajuste raro: só muda a velocidade quando passa de 0,12 s e volta ao normal abaixo de 0,04 s
    // (mexer a cada quadro trava o vídeo no iPhone). Pulo só acima de 0,8 s, no máximo um a cada 4 s.
    // o som manda (a posição dele é confiável, os números do iPhone mostraram); o relógio só cobre enquanto o som carrega
    const aOk = !player.paused && player.readyState >= 2 && pendingT == null;
    if (aOk) clkSet(player.currentTime);
    // o som sai pela caixa ou fone com um pequeno atraso (fone Bluetooth chega a 0,2 s): a imagem espera por ele
    const t = ct(), drift = video.currentTime - (t - outLat()), ad = Math.abs(drift);
    if (!video.seeking && ad > 0.25 && now - (loop.jump || 0) > 2000) { video.currentTime = t - outLat() + 0.06; loop.jump = now; video.playbackRate = 1; }
    else if (!video.seeking) {
      const r = video.playbackRate;
      // passou de 0,05 s: acelera ou segura a imagem de leve até encostar no som (bem abaixo do que o olho percebe)
      if (ad > 0.05 && r === 1) video.playbackRate = drift > 0 ? 0.95 : 1.05;
      else if (r !== 1 && (ad < 0.015 || (drift > 0) !== (r < 1))) video.playbackRate = 1;
    }
    if (video.paused && !video.ended && now - (loop.kick || 0) > 1000) { loop.kick = now; vplay(); }
    $('seek').value = t; $('tNow').textContent = fmt(t);
    if (step === 2 && now - lastEd > 80) { editor.setTime(t); lastEd = now; }
  }
  if (lastVT < 0 && video.readyState >= 2) { grab(); loop.dirty = true; } // primeiro quadro assim que existir
  if (loop.dirty && !playing()) { grader.draw(frame); loop.dirty = false; }
  watchdog(now); diagTick(now);
  $('viewer').classList.toggle('playing', playing());
  requestAnimationFrame(loop);
}

function busy(on, txt) { $('busy').hidden = !on; if (txt) $('busyTxt').textContent = txt; busyPct(0); }
function busyPct(p) { $('busyBar').style.strokeDashoffset = 327 * (1 - Math.max(0, Math.min(1, p))); }

// ---------- 2) Afinação ----------
function refreshChips() {
  const P = S(), b = P.before, a = P.after, edited = Object.keys(P.edits || {}).length;
  $('chips').innerHTML = `${state.parts ? `<span class="chip"><b>${P.name}</b></span>` : ''}<span class="chip">Tom <b>${state.key.name}</b></span>
    <span class="chip ${tuned ? '' : 'bad'}">Faixa verde antes <b>${b.band}%</b></span>
    ${tuned ? `<span class="chip ${a.band >= 99 ? 'good' : 'bad'}">depois <b>${a.band}%</b></span>` : ''}
    ${edited ? `<span class="chip">Editadas <b>${edited}</b></span>` : ''}
    ${state.ref ? `<span class="chip">Original <b>${state.ref.shift >= 0 ? '+' : ''}${state.ref.shift} semitons</b></span>` : ''}`;
  $('tuneAuto').hidden = tuned; $('tuneUndo').hidden = !tuned; $('tuneAgain').hidden = !tuned;
}
async function doTune() {
  pause(); busy(true, 'Afinando e conferindo cada nota…');
  try {
    await cover.retune(state, tuneOpts(), (s, p) => busyPct(p));
    await cover.verify(state);
    tuned = true; setPending(false);
    tracks.raw = rawTrack(); fresh('raw');
    if (mastered) await doMaster(false);
    editor.load(S()); refreshChips(); side = 'B'; refreshAB();
    toast(`Afinado${state.parts ? ` (${state.parts.length} vozes, cada uma separada)` : ''}: ${state.after.band}% da voz na faixa verde. Compare no ANTES | DEPOIS.`);
  } catch (e) { console.error(e); ev('erro', { etapa: 'afinar', msg: String(e.message).slice(0, 160) }); toast('Deu erro: ' + e.message, 6000); }
  busy(false);
}
$('tuneAuto').onclick = doTune;
$('tuneAgain').onclick = () => { pushUndo(); doTune(); };
$('tuneUndo').onclick = async () => {
  pause(); cover.untune(state, tuneOpts()); tuned = false;
  tracks.raw = rawTrack(); fresh('raw');
  if (mastered) { busy(true, 'Refazendo a mix…'); await doMaster(false); busy(false); }
  editor.load(S()); refreshChips(); refreshAB(); toast('Afinação desfeita: a voz voltou a ser a original.');
};
function onSelect(i) {
  $('selInfo').innerHTML = i >= 0 ? `Nota <b>${i + 1}</b> escolhida: arraste para cima ou para baixo, ou use Subir e Descer. A mudança já vale sozinha.` : 'Toque numa nota e arraste para qualquer nota. Zoom: pinça com dois dedos ou rodinha do mouse. Fundo amarelo = tônica, verde = escala do tom, escuro = fora da escala.';
  $('selInfo').classList.toggle('on', i >= 0);
  const n = S().plan[i], ed = (S().edits || {})[i] || {};
  $('qLabel').textContent = i >= 0 ? 'Quantizar nota' : 'Quantizar tudo';
  $('sLabel').textContent = i >= 0 ? 'Endireitar nota' : 'Endireitar tudo';
  $('q').value = i >= 0 ? ed.quantize ?? n.q : $('q').dataset.global || 1;
  $('s').value = i >= 0 ? ed.straighten ?? n.st : $('s').dataset.global ?? 1;
  $('qOut').textContent = pct(+$('q').value); $('sOut').textContent = pct(+$('s').value);
}
function pushUndo() { undo.push(JSON.stringify({ v: cur, edits: S().edits, q: $('q').dataset.global, s: $('s').dataset.global })); }
function setPending(v = true) { pending = v; }
function onEdit(i, patch) {
  pushUndo();
  const P = S();
  P.edits[i] = { ...(P.edits[i] || {}), ...patch };
  if (patch.target != null) { P.plan[i].target = patch.target; P.plan[i].manual = true; }
  setPending(); editor.draw(); refreshChips(); autoApply(i);
}
// Cada mudança de nota já vale sozinha, sem tocar em Aplicar: afina só aquele pedacinho (rápido).
// Mudança geral (quantizar tudo, prender no tom) afina a voz inteira.
let dirty = new Set(), dirtyAll = false, autoT = 0, applying = null, masterStale = false;
function autoApply(i) {
  if (i == null) dirtyAll = true; else dirty.add(i);
  clearTimeout(autoT); autoT = setTimeout(runAuto, 450);
}
async function runAuto() {
  if (applying) { await applying; }
  if (!dirtyAll && !dirty.size) return;
  const all = dirtyAll, idx = [...dirty]; dirty = new Set(); dirtyAll = false;
  applying = (async () => {
    if (all) { await doTune(); if (mastered) masterStale = false; return; }
    const was = playing(), t = clipT(); if (was) pause();
    $('popBar')?.classList.add('working');
    try {
      await cover.retuneLocal(S(), tuneOpts(), idx);
      if (state.parts) await cover.verify(state); // resumo da dupla
      setPending(false);
      tracks.raw = rawTrack(); fresh('raw');
      if (mastered) masterStale = true;
      editor.draw(); refreshChips();
    } catch (e) { console.error(e); ev('erro', { etapa: 'automático', msg: String(e.message).slice(0, 160) }); toast('Deu erro: ' + e.message, 6000); }
    $('popBar')?.classList.remove('working');
    seek(t); if (was) play();
  })();
  await applying; applying = null;
  if (dirty.size || dirtyAll) runAuto();
}
const needSel = () => (editor.sel < 0 ? (toast('Toque numa nota primeiro'), false) : true);
$('nUp').onclick = () => needSel() && onEdit(editor.sel, { target: editor.stepFrom(S().plan[editor.sel].target, 1), bypass: false });
$('nDown').onclick = () => needSel() && onEdit(editor.sel, { target: editor.stepFrom(S().plan[editor.sel].target, -1), bypass: false });
$('nOrig').onclick = () => { if (!needSel()) return; S().plan[editor.sel].q = 0; S().plan[editor.sel].st = 0; onEdit(editor.sel, { bypass: true }); };
$('nAuto').onclick = () => { if (!needSel()) return; pushUndo(); delete S().edits[editor.sel]; S().plan[editor.sel].manual = false; setPending(); refreshChips(); autoApply(editor.sel); };
$('q').oninput = () => ($('qOut').textContent = pct(+$('q').value));
$('s').oninput = () => ($('sOut').textContent = pct(+$('s').value));
$('q').onchange = () => { if (editor.sel >= 0) onEdit(editor.sel, { quantize: +$('q').value, bypass: false }); else { pushUndo(); $('q').dataset.global = $('q').value; setPending(); autoApply(); } };
$('s').onchange = () => { if (editor.sel >= 0) onEdit(editor.sel, { straighten: +$('s').value, bypass: false }); else { pushUndo(); $('s').dataset.global = $('s').value; setPending(); autoApply(); } };
// Painel de notas grande, como um pop-up na tela toda. O vídeo fica escondido atrás (o som continua),
// então o celular não gasta força desenhando o vídeo enquanto a pessoa mexe nas notas.
const isPop = () => $('studio').classList.contains('pop');
function openPop() {
  if (isPop()) return;
  $('studio').classList.add('pop'); app.classList.add('popopen');
  try { history.pushState({ pop: 1 }, ''); } catch {}
  syncPop(); setTimeout(() => editor?.resize(), 30);
}
function closePop(fromBack) {
  if (!isPop()) return;
  $('studio').classList.remove('pop'); app.classList.remove('popopen');
  if (!fromBack) try { if (history.state?.pop) history.back(); } catch {}
  setTimeout(() => editor?.resize(), 30);
}
addEventListener('popstate', () => closePop(true));
addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
// computador: barra de espaço dá play/pause no estúdio (fora de campos de texto)
const spaceOk = (e) => (e.code === 'Space' || e.key === ' ') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey
  && !(e.target.closest && e.target.closest('input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable]'))
  && $('studio') && $('studio').offsetParent !== null && !$('play').disabled;
addEventListener('keydown', (e) => { if (!spaceOk(e)) return; e.preventDefault(); $('play').click(); });
addEventListener('keyup', (e) => { if ((e.code === 'Space' || e.key === ' ') && spaceOk(e)) e.preventDefault(); }); // sem o "clique" do botão em foco
$('expandBtn').onclick = () => (isPop() ? closePop() : openPop());
$('popClose').onclick = () => closePop();
$('popPlay').onclick = () => $('play').click();
function syncPop() { $('popPlay').textContent = $('play').textContent; $('popTime').textContent = $('tNow').textContent; }
new MutationObserver(() => isPop() && syncPop()).observe($('play'), { childList: true, characterData: true, subtree: true });
new MutationObserver(() => isPop() && syncPop()).observe($('tNow'), { childList: true, characterData: true, subtree: true });
// no celular, tocar no painel pequeno abre o grande (lá a pessoa escolhe a nota com o dedo com folga)
$('editor').parentElement.addEventListener('pointerdown', (e) => {
  if (isPop() || innerWidth >= 900) return;
  e.preventDefault(); e.stopPropagation(); openPop();
}, true);
$('moreBtn').onclick = () => { $('more').hidden = !$('more').hidden; $('moreBtn').classList.toggle('on', !$('more').hidden); requestAnimationFrame(() => editor.resize()); };
$('zIn').onclick = () => editor.zoom(1.5);
$('zOut').onclick = () => editor.zoom(1 / 1.5);
$('showOrig').onclick = () => { editor.showOrig = !editor.showOrig; $('showOrig').classList.toggle('on', editor.showOrig); editor.draw(); };
$('undo').onclick = async () => {
  const u = undo.pop(); if (!u) return toast('Nada para desfazer');
  const o = JSON.parse(u);
  if (state.parts && o.v != null && o.v !== cur) await pickVoice(o.v);
  const P = S(), old = P.edits || {};
  const gChanged = (o.q ?? null) !== ($('q').dataset.global ?? null) || (o.s ?? null) !== ($('s').dataset.global ?? null);
  const changed = [...new Set([...Object.keys(old), ...Object.keys(o.edits || {})])].filter((k) => JSON.stringify(old[k]) !== JSON.stringify((o.edits || {})[k])).map(Number);
  P.edits = o.edits || {};
  for (const k of changed) if (P.plan[k]) { P.plan[k].manual = P.edits[k]?.target != null; if (P.edits[k]?.target != null) P.plan[k].target = P.edits[k].target; }
  if (o.q != null) $('q').dataset.global = o.q; else delete $('q').dataset.global;
  if (o.s != null) $('s').dataset.global = o.s; else delete $('s').dataset.global;
  setPending(); refreshChips(); editor.draw();
  if (gChanged) autoApply(); else changed.forEach((k) => autoApply(k));
  toast('Desfeito.');
};
$('apply').onclick = async () => { clearTimeout(autoT); await runAuto(); closePop(); };
$('mSnap').onchange = () => { pushUndo(); setPending(); autoApply(); };
$('mUseRef').onchange = () => { pushUndo(); setPending(); autoApply(); };
function refreshRef() { $('mUseRef').disabled = !state.ref; $('mRefTxt').textContent = state.ref ? 'Trocar música original' : 'Subir música original'; }
$('mRefFile').onchange = async () => {
  const f = $('mRefFile').files[0]; if (!f) return;
  pause(); busy(true, 'Lendo a melodia da original…');
  try {
    const r = await cover.setReference(state, f, (s, p) => busyPct(p));
    $('mUseRef').checked = true; refreshRef();
    toast(`Original lida: diferença de ${r.shift} semitons.`);
    busy(false); await doTune();
  } catch (e) { console.error(e); toast('Não consegui ler a música original: ' + e.message, 6000); busy(false); }
};

// ---------- Dupla, trio: abas das vozes no painel de afinação ----------
const ORD = ['primeira', 'segunda', 'terceira', 'quarta'];
const volTxt = (v) => (v <= -15 ? 'mudo' : (v > 0 ? '+' : '') + (+v).toFixed(v % 1 ? 1 : 0) + ' dB');
function voiceBar() {
  const box = $('voiceBar'), K = state.parts ? state.parts.length : 1;
  $('studio').classList.toggle('multi', K > 1);
  const pick = [[1, '👤', '1 voz'], [2, '👥', 'Dupla'], [3, '👥', 'Trio']].map(([k, ic, t]) => `<button type="button" data-k="${k}" class="${K === k ? 'on' : ''}" data-help="${k === 1 ? 'Uma pessoa cantando: a voz é afinada inteira.' : `${t}: o app separa ${k} vozes (a Voz 1 é a mais aguda) e afina cada uma por conta própria, com mudo e volume de cada voz.`}"><i>${ic}${k === 3 ? '👤' : ''}</i>${t}</button>`).join('');
  let html = `<div class="vqrow"><span class="vqlbl">Quem canta?</span><div class="vpick" role="group" aria-label="Quantas pessoas cantam">${pick}</div></div>`;
  if (K > 1) {
    html += `<div class="vbinfo">Toque numa voz para ouvir e afinar só ela. <b>🔊/🔇</b> liga ou deixa muda cada voz.</div>
    <div class="vbtabs"${muted.size && K === 2 ? ' style="grid-template-columns:repeat(2,minmax(0,1fr)) auto"' : ''}>${state.parts.map((p, i) => `<div class="vtab${i === cur ? ' on' : ''}${muted.has(i) ? ' muted' : ''}"><button type="button" class="vsel" data-i="${i}" data-help="Escolhe a ${p.name}: a prévia toca só ela e o painel de afinação mostra e mexe só nas notas dela. Para ouvir todas juntas, toque em Ouvir todas.">${p.name}<small>${ORD[i] || ''} voz${i === 0 ? ' · mais aguda' : ''}</small></button><button type="button" class="vmute${muted.has(i) ? ' on' : ''}" data-m="${i}" aria-label="${muted.has(i) ? 'Ligar' : 'Deixar muda'} a ${p.name}" data-help="Liga ou deixa muda a ${p.name} na prévia, para ouvir só uma voz e saber quem é quem. Não muda o vídeo final: lá vale o volume de cada voz (na Mix).">${muted.has(i) ? '🔇<small>muda</small>' : '🔊<small>ouvindo</small>'}</button></div>`).join('')}${muted.size ? '<button type="button" class="vall" data-help="Volta a tocar todas as vozes juntas na prévia.">🔊<small>ouvir todas</small></button>' : ''}</div>`;
  }
  box.innerHTML = html;
}
// toca só as vozes ligadas (o resto fica mudo na prévia) e refaz o som da prévia
function hear(on) {
  muted.clear(); state.parts.forEach((_, k) => { if (!on.includes(k)) muted.add(k); });
  tracks.orig = origTrack(); tracks.raw = rawTrack(); fresh('orig'); fresh('raw'); voiceBar();
}
// escolher uma voz = afinar só ela E ouvir só ela (as outras ficam mudas na prévia, até tocar em Ouvir todas)
async function pickVoice(i) {
  if (!state.parts) return;
  if (i !== cur) { clearTimeout(autoT); await runAuto(); } // o que estava mexendo na voz anterior vale antes de trocar
  const was = cur; cur = i;
  if (i !== was) { editor.sel = -1; editor.load(S()); onSelect(-1); refreshChips(); }
  hear([i]); toast(`Tocando só a ${state.parts[i].name}`);
}
$('voiceBar').addEventListener('click', async (e) => {
  const sel = e.target.closest('.vsel'), mu = e.target.closest('.vmute');
  if (sel) return pickVoice(+sel.dataset.i);
  if (mu) {
    const i = +mu.dataset.m; if (muted.has(i)) muted.delete(i); else muted.add(i);
    tracks.orig = origTrack(); tracks.raw = rawTrack(); fresh('orig'); fresh('raw'); voiceBar();
    const on = state.parts.map((p, k) => (muted.has(k) ? null : p.name)).filter(Boolean);
    toast(on.length ? `Tocando só: ${on.join(' e ')}` : 'Todas as vozes mudas na prévia.');
    return;
  }
  if (e.target.closest('.vall')) { hear(state.parts.map((_, k) => k)); toast('Tocando todas as vozes juntas'); return; }
  const pk = e.target.closest('.vpick button'); if (pk) setVoices(+pk.dataset.k);
});
// Quantas pessoas cantam, escolhido na mão (Ajustes): 1 junta as vozes; 2, 3 ou 4 separa nessa quantidade
async function setVoices(K) {
  const now = state.parts ? state.parts.length : 1;
  if (K === now) return toast(K === 1 ? 'Já está como uma voz só.' : `Já está separado em ${K} vozes.`);
  pause(); busy(true, K === 1 ? 'Juntando as vozes…' : `Separando as ${K} vozes…`);
  try {
    clearTimeout(autoT); await runAuto();
    if (state.parts) await cover.joinVoices(state, tuneOpts());
    if (K > 1) await cover.splitInto(state, K, tuneOpts(), (s, p) => busyPct(p));
    cur = 0; muted.clear(); undo.length = 0;
    const was = tuned; tuned = false;
    tracks.orig = origTrack(); tracks.raw = rawTrack(); fresh('orig'); fresh('raw');
    editor.sel = -1; editor.load(S()); voiceBar(); voiceVols(); refreshChips();
    busy(false);
    if (was) await doTune(); else if (mastered) { busy(true, 'Refazendo a mix…'); await doMaster(false); busy(false); }
    refreshAB(); toast(K === 1 ? 'Pronto: agora é uma voz só.' : `Pronto: ${K} vozes separadas. A Voz 1 é a mais aguda.`, 5000);
    ev('vozes', { k: K, auto: state.voices?.count || 1 });
  } catch (err) { console.error(err); busy(false); toast('Deu erro: ' + err.message, 6000); }
}
$('panelBtn').onclick = () => openPop();
// Volume de cada voz (Mix e Exportar andam juntos). No mínimo (−15 dB) a voz fica muda no vídeo final.
function voiceVols() {
  for (const pre of ['m', 'e']) $(pre + 'Voice').previousElementSibling.textContent = state.parts ? 'Volume de todas as vozes' : 'Volume da voz';
  for (const pre of ['m', 'e']) {
    const box = $(pre + 'Voices'); box.innerHTML = '';
    if (!state.parts) continue;
    box.insertAdjacentHTML('beforeend', '<div class="vvhead"><b>Volume de cada voz</b><small>Toda para a esquerda = a voz fica muda no vídeo final</small></div>');
    state.parts.forEach((p, i) => {
      const l = document.createElement('label'); l.className = 'row vol';
      l.dataset.help = `Volume só da ${p.name} (${ORD[i] || ''} voz) em relação às outras e à música. Toda para a esquerda = ${p.name} muda no vídeo final.`;
      l.innerHTML = `<span>${p.name} <small>${ORD[i] || ''}</small></span><input type="range" id="${pre}V${i}" min="-15" max="9" step="0.5" value="0"><output>0 dB</output>`;
      box.appendChild(l);
      const r = l.querySelector('input'), o = l.querySelector('output');
      r.addEventListener('input', () => {
        o.textContent = volTxt(+r.value);
        const other = $((pre === 'm' ? 'e' : 'm') + 'V' + i); if (other && other.value !== r.value) { other.value = r.value; other.dispatchEvent(new Event('input')); }
      });
      r.addEventListener('change', async () => {
        if (syncing.size) return; syncing.add(r.id);
        const was = playing(), t = clipT(); pause(); busy(true, 'Ajustando os volumes…');
        try { await doMaster(false); } catch (err) { console.error(err); }
        busy(false); if (step === 3) side = 'C'; refreshAB(); if (step === 5) refreshSummary(); seek(t); if (was) play();
        syncing.delete(r.id);
      });
    });
  }
}

// ---------- 3) Mix e master ----------
async function doMaster(show = true) {
  if (show) { pause(); busy(true, 'Mixando e masterizando…'); }
  mastered = await cover.render(state, mixOpts());
  tracks.master = mastered.full; fresh('master');
  $('mixApply').hidden = true; $('mixUndo').hidden = false; compInfo();
  if (show) { busy(false); side = 'C'; refreshAB(); toast('Mix e master prontos. Alterne entre ORIGINAL, AFINADA e MIXADA.'); }
}
$('mixApply').onclick = () => doMaster();
$('mixUndo').onclick = () => { pause(); mastered = null; side = 'B'; $('mixApply').hidden = false; $('mixUndo').hidden = true; refreshAB(); toast('Mix e master desfeitos.'); };
document.querySelectorAll('.row input[type=range]').forEach((r) => {
  const o = r.nextElementSibling;
  const upd = () => (o.textContent = r.id === 'mReverb' || r.id === 'fAmount' || r.id === 'mComp' ? pct(+r.value) : /Voice|Bed|Low|Mid|High/.test(r.id) ? (+r.value > 0 ? '+' : '') + (+r.value).toFixed(+r.value % 1 ? 1 : 0) + ' dB' : (+r.value).toFixed(1) + ' s');
  r.addEventListener('input', upd); upd();
});
// Volume da voz e da melodia: os controles da Mix e do Exportar andam juntos; mexer já mixa de novo
for (const k of ['Voice', 'Bed']) for (const [a, b] of [['m', 'e'], ['e', 'm']]) {
  $(a + k).addEventListener('input', () => { if ($(b + k).value !== $(a + k).value) { $(b + k).value = $(a + k).value; $(b + k).dispatchEvent(new Event('input')); } });
}
const syncing = new Set(); // as duas réguas disparam "change": mixa uma vez só
['mVoice', 'mBed', 'eVoice', 'eBed'].forEach((id) => $(id).addEventListener('change', async () => {
  if (syncing.size) return; syncing.add(id);
  const was = playing(), t = clipT(); pause(); busy(true, 'Ajustando os volumes…');
  await doMaster(false); busy(false);
  if (step === 3) side = 'C'; refreshAB(); if (step === 5) refreshSummary(); seek(t); if (was) play();
  syncing.delete(id);
}));
function compInfo() {
  const c = mastered && mastered.comp, n = (v, d = 1) => v.toFixed(d).replace('.', ',');
  $('compInfo').innerHTML = (c ? `${c.mode === 'auto' ? 'Automático escolheu' : 'Compressão'} <b>${n(c.ratio)}:1</b>. ` : '') +
    `Volume final no padrão do Spotify: <b>${mastered && mastered.lufs > -69 ? n(mastered.lufs) : '−14'} LUFS</b>, pico em −1 dB.`;
}
async function remix() {
  if (!mastered) return;
  const was = playing(), t = clipT(); pause(); busy(true, 'Mixando…'); await doMaster(false); busy(false); if (step === 3) side = 'C'; refreshAB(); seek(t); if (was) play();
}
$('compMode').querySelectorAll('button').forEach((b) => (b.onclick = () => {
  if (compMode === b.dataset.m) return;
  compMode = b.dataset.m; $('compMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  if (compMode === 'manual' && mastered && mastered.comp) { $('mComp').value = Math.round(mastered.comp.amount * 20) / 20; $('mComp').dispatchEvent(new Event('input')); }
  $('compRow').hidden = compMode === 'auto'; remix();
}));
$('eqReset').onclick = () => { let ch = false; for (const id of ['mLow', 'mMid', 'mHigh']) { if (+$(id).value) ch = true; $(id).value = 0; $(id).dispatchEvent(new Event('input')); } if (ch) remix(); };
['mLow', 'mMid', 'mHigh', 'mComp'].forEach((id) => $(id).addEventListener('change', remix));
['mReverb', 'mFadeIn', 'mFadeOut', 'mTrim'].forEach((id) => $(id).addEventListener('change', async () => {
  if (!mastered) return;
  const was = playing(), t = clipT(); pause(); busy(true, 'Mixando…'); await doMaster(false); busy(false); refreshAB(); seek(t); if (was) play();
}));

// ---------- 4) Cor ----------
const currentFilter = () => {
  if (!look || look.id === 'original') return look || ORIGINAL;
  if (look.id === 'auto') return auto || ORIGINAL;
  return compose(auto, look);
};
async function buildFilters() {
  if (!auto) { busy(true, 'Colorista analisando a luz do vídeo…'); try { auto = await autoGrade(video); } catch (e) { console.warn(e); } busy(false); seek(+$('seek').value); }
  if (!look) look = { id: 'auto', name: 'Auto · Colorista' };
  const box = $('filters'); box.innerHTML = '';
  const list = [ORIGINAL, { id: 'auto', name: 'Auto · Colorista' }, ...FILTERS];
  list.forEach((f) => {
    const b = document.createElement('button');
    b.innerHTML = `<canvas width="90" height="160"></canvas>${f.name}`;
    b.classList.toggle('on', f.id === look.id);
    b.onclick = () => { look = f; box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); side = 'B'; refreshAB(); refreshSummary(); };
    box.appendChild(b);
  });
  refreshAB();
  setTimeout(drawThumbs, 50);
}
let thumbGr = null;
function drawThumbs() {
  if (!video.videoWidth) return;
  grab();
  const portrait = video.videoHeight >= video.videoWidth;
  if (!thumbGr) { const c = document.createElement('canvas'); thumbGr = new Grader(c); }
  thumbGr.c.width = portrait ? 180 : 320; thumbGr.c.height = portrait ? 320 : 180;
  const list = [ORIGINAL, { id: 'auto' }, ...FILTERS];
  list.forEach((f, i) => {
    const real = f.id === 'original' ? ORIGINAL : f.id === 'auto' ? auto || ORIGINAL : compose(auto, f);
    thumbGr.set(real, 1); thumbGr.draw(frame);
    const cv = $('filters').children[i]?.querySelector('canvas'); if (!cv) return;
    cv.width = thumbGr.c.width; cv.height = thumbGr.c.height; cv.style.aspectRatio = portrait ? '9 / 16' : '16 / 9';
    cv.getContext('2d').drawImage(thumbGr.c, 0, 0);
  });
}
$('fAmount').addEventListener('input', () => { amount = +$('fAmount').value; refreshAB(); });

// ---------- 5) Exportar ----------
function refreshSummary() {
  if (!state) return;
  const portrait = video.videoHeight >= video.videoWidth, type = exportType();
  const s = mastered ? mastered.start : 0, e = mastered ? mastered.end : state.duration;
  $('dlBed').hidden = !state.bed;
  $('dlWav').textContent = audioOnly ? 'Baixar o áudio pronto (WAV)' : 'Baixar só o áudio (WAV)';
  $('exportSub').textContent = audioOnly ? 'Baixe o áudio pronto e junte de volta no seu vídeo no editor (CapCut, InShot etc.), alinhando pelo começo.' : 'O vídeo sai em 1080p (o padrão do Instagram, TikTok e Reels), com os mesmos quadros por segundo e a qualidade do original. Deixe a tela aberta até terminar.';
  if (audioOnly) {
    $('summary').innerHTML = `<div>Afinação<b>${tuned ? `sim · ${state.after.band}% na faixa` : 'não'}</b></div><div>Mix e master<b>${mastered ? 'sim' : 'não'}</b></div><div>Duração<b>${fmt(e - s)}</b></div><div>Formato<b>WAV</b></div>`;
    return;
  }
  $('summary').innerHTML = `<div>Afinação<b>${tuned ? `sim · ${state.after.band}% na faixa` : 'não'}</b></div><div>Mix e master<b>${mastered ? 'sim' : 'não'}</b></div>
    ${state.parts ? `<div>Vozes<b>${state.parts.length} (${state.parts.map((p, i) => `${p.name} ${volTxt(+$('eV' + i).value)}`).join(', ')})</b></div>` : ''}<div>Cor<b>${currentFilter().name}</b></div><div>Duração<b>${fmt(e - s)}</b></div>
    <div>Resolução<b>${Math.max(1080, Math.min(video.videoWidth, video.videoHeight)) === 1080 && !(portrait ? video.videoWidth > 1080 : video.videoHeight > 1080) ? (portrait ? '1080 × 1920' : '1920 × 1080') : `${video.videoWidth} × ${video.videoHeight}`} (como o original)</b></div><div>Formato<b>${window.VideoEncoder || type.startsWith('video/mp4') ? 'MP4' : type ? 'WebM' : '—'}</b></div>`;
}
$('exportBtn').onclick = async () => {
  pause();
  if (window.scAntesExportar && !(await window.scAntesExportar('o vídeo pronto'))) return;
  if (pending) toast('Você tem edições de afinação que ainda não foram aplicadas.');
  $('exportBtn').disabled = true; $('exportBar').hidden = false; $('ready').hidden = true;
  if (thumbGr) { thumbGr.release(); thumbGr = null; } // libera memória de vídeo para a gravação (as miniaturas refazem depois)
  try {
    const ch = mastered ? mastered.channels : cover.rawMix(state, state.parts ? voiceDb('e').map(dbG) : null);
    const s = mastered ? mastered.start : 0, e = mastered ? mastered.end : state.duration;
    const out = await exportVideo({ file, video, filter: currentFilter(), amount, channels: ch, sr: cover.SR, start: s, end: e,
      onProgress: (p) => { $('exportBar').firstElementChild.style.width = Math.round(p * 100) + '%'; } });
    const a = $('download');
    a.href = URL.createObjectURL(out.blob);
    a.download = `${(file.name || 'cover').replace(/\.[^.]+$/, '')}-studio-cover.${out.ext}`;
    $('readyInfo').textContent = `${out.width} × ${out.height} · ${out.ext.toUpperCase()} · ${Math.max(1, Math.round(out.blob.size / 1048576))} MB, com o som e a cor que você escolheu.`;
    $('ready').hidden = false; $('ready').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Vídeo pronto!'); ev('exportou', { mb: Math.round(out.blob.size / 1048576), w: out.width, h: out.height, ext: out.ext });
  } catch (e) { console.error(e); ev('erro', { etapa: 'exportar', msg: String(e.message).slice(0, 160) }); toast('Deu erro: ' + e.message, 7000); }
  $('exportBtn').disabled = false;
  seek(0);
};
$('dlWav').onclick = async () => { if (window.scAntesExportar && !(await window.scAntesExportar('o áudio pronto'))) return; ev('exportou', { audio: 1 }); const a = document.createElement('a'); const u = URL.createObjectURL(cover.toWav(tracks[mastered ? 'master' : 'raw'], cover.SR)); a.href = u; a.download = `${((file && file.name) || 'cover').replace(/\.[^.]+$/, '')}-studio-cover.wav`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 30000); };

window.studio = { audio: () => ({ currentTime: aTime() }), get state() { return state; }, get mastered() { return mastered; }, get tuned() { return tuned || null; }, cover, select: (i) => editor.select(i), go, get editor() { return editor; } };

// ---------- Ajuda: com o "?" do topo ligado, tocar em qualquer botão mostra o que ele faz (em vez de executar) ----------
let helpOn = false;
document.querySelectorAll('[data-help]').forEach((el) => (el.title = el.dataset.help));
document.addEventListener('click', (e) => {
  if (!helpOn) return;
  const el = e.target.closest('[data-help]'); if (!el || e.target.closest('#tip')) return;
  e.preventDefault(); e.stopPropagation();
  $('tipTxt').textContent = el.dataset.help; $('tip').hidden = false;
}, true);
$('tipOk').onclick = () => ($('tip').hidden = true);
// Manual do usuário (vídeos curtos): o código e os vídeos só carregam quando a pessoa abre
const abrirManual = (id) => { ev('manual', { tela: app.dataset.screen || '' }); import('./manual.js?v=1').then((m) => m.openManual(id, (v) => ev('manual_video', { video: v }))).catch(() => toast('Não deu para abrir o manual. Confira a internet e tente de novo.')); };
$('manBtn').onclick = () => abrirManual();
$('manHome').onclick = () => abrirManual();
$('helpBtn').onclick = () => {
  helpOn = !helpOn; app.classList.toggle('helpon', helpOn);
  toast(helpOn ? 'Modo ajuda ligado: toque em qualquer botão com borda tracejada para saber o que ele faz. Toque no ? de novo para usar o app.' : 'Modo ajuda desligado.', 5000);
};

// Qualquer erro aparece na tela (e fica no diário), para a gente saber exatamente o que houve num aparelho real
addEventListener('error', (e) => {
  // "Script error." sem arquivo = erro de algo de fora do app (extensão, tradutor, navegador do Instagram). Não para o app:
  // só registra, sem assustar a pessoa com um aviso de erro.
  const fora = /^Script error\.?$/i.test(String(e.message)) && !e.filename;
  ev('erro', { etapa: fora ? 'externo' : 'app', msg: String(e.message).slice(0, 160), em: String(e.filename || '').split('/').pop() + ':' + e.lineno, tela: app.dataset.screen || '' });
  if (fora) return;
  note({ erro: String(e.message).slice(0, 120) }); toast('Erro: ' + e.message, 9000);
});
addEventListener('unhandledrejection', (e) => {
  const m = String(e.reason?.message || e.reason).slice(0, 120);
  // internet caiu num pedido de fundo (Failed to fetch / Load failed / NetworkError): não é falha do app nem para o vídeo.
  // Só registra como "rede", sem mostrar erro técnico na tela.
  if (/^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|Network request failed)$/i.test(m)) { ev('erro', { etapa: 'rede', msg: m, tela: app.dataset.screen || '' }); e.preventDefault(); return; }
  note({ erro: m }); ev('erro', { etapa: 'app', msg: m, tela: app.dataset.screen || '' });
  // leitura do arquivo falhou fora do fluxo principal: explica o que fazer em vez de mostrar a mensagem técnica
  if (LEITURA.test(m + ' ' + (e.reason?.name || ''))) { e.preventDefault(); if (app.dataset.screen !== 'studio') perdeuArquivo(); return; }
  toast('Erro: ' + m, 9000);
});

// Só a voz / só a música (WAV), no mesmo trecho do vídeo final
async function dlStem(mk, nome) {
  if (window.scAntesExportar && !(await window.scAntesExportar(nome === 'so-voz' ? 'só a voz' : 'só a música'))) return;
  const ch = mk(); ev('exportou', { audio: 1, stem: nome });
  const s = mastered ? mastered.start : 0, e = mastered ? mastered.end : state.duration;
  const a = Math.round(s * cover.SR), b = Math.min(ch[0].length, Math.round(e * cover.SR));
  const cut = [0, 1].map((c) => (ch[c] || ch[0]).slice(a, b));
  const el = document.createElement('a'); const u = URL.createObjectURL(cover.toWav(cut, cover.SR));
  el.href = u; el.download = `${((file && file.name) || 'cover').replace(/\.[^.]+$/, '')}-${nome}.wav`; el.click(); setTimeout(() => URL.revokeObjectURL(u), 30000);
}
$('dlVoice').onclick = () => dlStem(() => cover.voiceMix(state, voiceDb('e'), false, true), 'so-voz');
$('dlBed').onclick = () => dlStem(() => state.bed, 'so-musica');

// vídeo do teste guardado no aparelho (a pessoa comprou depois): nome do arquivo, e refazer tudo automático para baixar
window.scVideoGuardado = async () => { try { const f = await idb('readonly', (st) => st.get('pendente')); return f ? (f.name || 'seu vídeo') : ''; } catch { return ''; } };
window.scRefazerGuardado = async () => {
  let f = null; try { f = await idb('readonly', (st) => st.get('pendente')); } catch {}
  if (!f) return;
  await start(f);
  if (app.dataset.screen === 'studio') $('quickAll').click();
};
