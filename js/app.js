// ===== Studio Cover · app em 5 etapas =====
// 1 Vídeo → 2 Afinação → 3 Mix e master → 4 Cor → 5 Exportar.
// Em toda etapa há um player só e o botão ANTES | DEPOIS: ANTES = como estava antes desta etapa,
// DEPOIS = com esta etapa aplicada, no mesmo ponto do vídeo. Cada etapa tem aplicar e desfazer.
import * as cover from './pipeline.js?v=11';
import { TuneEditor } from './editor.js?v=11';
import { Grader, FILTERS, ORIGINAL, autoGrade, compose } from './filters.js?v=11';
import { exportVideo, exportType } from './export.js?v=11';

const $ = (id) => document.getElementById(id);
const app = $('app');
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const pct = (v) => Math.round(v * 100) + '%';
let toastT = 0;
const toast = (msg, ms = 3500) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); };

let file = null, refFile = null, state = null;
let tuned = false, mastered = null; // mastered = resultado do render (ou null)
let step = 2, side = 'B', pending = false;
let look = null, auto = null, amount = 1; // look = filtro escolhido; auto = Colorista
const undo = [];
const video = $('video');
const players = { A: new Audio(), B: new Audio(), C: new Audio() };
Object.values(players).forEach((a) => (a.preload = 'auto'));
const urls = {};
const wav = (key, ch) => { if (urls[key]) URL.revokeObjectURL(urls[key]); urls[key] = URL.createObjectURL(cover.toWav(ch, cover.SR)); return urls[key]; };
const tuneOpts = () => ({ separate: $('optSeparate').checked, strength: +$('q').dataset.global || 1, scaleSnap: $('mSnap').checked,
  straighten: $('s').dataset.global != null ? +$('s').dataset.global : 1, useRef: $('mUseRef').checked });
const mixOpts = () => ({ reverb: +$('mReverb').value, fadeIn: +$('mFadeIn').value, fadeOut: +$('mFadeOut').value, trim: $('mTrim').checked });

// ---------- 1) Vídeo ----------
const drop = $('drop');
$('file').onchange = () => $('file').files[0] && start($('file').files[0]);
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) start(f); });
$('newBtn').onclick = () => location.reload();
$('refFile').onchange = () => { refFile = $('refFile').files[0] || null; $('refName').textContent = refFile ? '✓ ' + refFile.name + ' (vamos afinar pela melodia dela)' : 'Opcional: a gente pega a melodia do cantor original no seu tom e afina você por ela.'; $('refPick').classList.toggle('on', !!refFile); };

const W = { audio: [0, 4], download: [4, 16], separate: [20, 62], notes: [82, 6], ref: [88, 1], refsep: [88, 9], refnotes: [97, 3] };
const LABEL = { audio: 'Lendo o áudio', download: 'Baixando a IA', separate: 'Separando a voz', notes: 'Achando as notas', ref: 'Lendo a original', refsep: 'Lendo a melodia da original', refnotes: 'Lendo a melodia da original' };
const MAX_SEC = 180; // limite de duração (3 minutos)
let t0 = 0, lastEta = 0;
function progress(st, p) {
  note({ stage: LABEL[st] || st, pct: Math.round(((W[st] || [0, 0])[0]) + ((W[st] || [0, 0])[1]) * p) });
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
  $('workStep').textContent = LABEL[st] || '';
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
let runInfo = null;
function note(patch) { if (!runInfo) return; Object.assign(runInfo, patch); try { localStorage.setItem(RUN, JSON.stringify(runInfo)); } catch {} }
function endRun() { runInfo = null; try { localStorage.removeItem(RUN); } catch {} }
try {
  const last = JSON.parse(localStorage.getItem(RUN) || 'null');
  if (last) {
    localStorage.removeItem(RUN);
    setTimeout(() => toast(`Na última tentativa o aparelho fechou o app em "${last.stage}" (${last.pct}%)${last.erro ? " · " + last.erro : ""}. Vídeo de ${last.mb} MB${last.dur ? ', ' + last.dur : ''}. ${last.mb > 300 ? 'Vídeo muito pesado: grave em 1080p (não 4K) ou corte antes de subir.' : 'Feche outros apps e abas e tente de novo.'}`, 12000), 400);
  }
} catch {}
async function start(f) {
  runInfo = { stage: 'Abrindo o vídeo', pct: 0, mb: Math.round(f.size / 1048576), dur: '', ua: navigator.userAgent.slice(0, 80) }; note({});
  file = f;
  app.dataset.screen = 'work'; progress('audio', 0);
  $('topinfo').textContent = f.name;
  $('steps').classList.toggle('ref', !!refFile);
  try {
    video.src = URL.createObjectURL(f); video.load();
    kick(); // o iPhone só carrega o vídeo depois de um play: toca mudo um instante, já no toque do usuário
    await videoReady();
    if (isFinite(video.duration) && video.duration > MAX_SEC + 15) throw new Error(`LIMITE`);
    note({ dur: isFinite(video.duration) ? fmt(video.duration) : '' });
    t0 = performance.now(); lastEta = 0; progress.sepStart = null; $('eta').textContent = '';
    state = await cover.analyze(f, { ...tuneOpts(), reference: refFile, autoTune: false }, progress);
    wav('orig', state.orig);
    wav('raw', cover.rawMix(state));
    note({ stage: 'Abrindo o estúdio', pct: 100 });
    openStudio();
    endRun();
  } catch (e) {
    console.error(e); endRun();
    app.dataset.screen = 'home';
    toast(e.message === 'LIMITE' ? `Esse vídeo tem ${fmt(video.duration)}. Por enquanto o limite é ${MAX_SEC / 60} minutos: corte no celular e suba de novo.`
      : /decod|Unable|EncodingError/i.test(e.message) ? 'Não consegui ler o áudio desse vídeo. Tente outro arquivo.' : 'Deu erro: ' + e.message, 8000);
  }
}

// ---------- Estúdio ----------
let grader = null, editor = null;
const frame = document.createElement('canvas'), fctx = frame.getContext('2d');
let lastVT = -1, lastEd = 0;
function grab() { if (video.readyState >= 2) { fctx.drawImage(video, 0, 0, frame.width, frame.height); lastVT = video.currentTime; } }
function openStudio() {
  app.dataset.screen = 'studio';
  $('newBtn').hidden = false;
  const cv = $('screen'), portrait = video.videoHeight >= video.videoWidth;
  // prévia mais leve no celular (o vídeo final continua em 1080p)
  const big = Math.min(innerWidth, innerHeight) >= 700 ? 1280 : 960, small = Math.round((big * 9) / 16);
  cv.width = portrait ? small : big; cv.height = portrait ? big : small;
  // o quadro do vídeo passa antes por um canvas 2D no tamanho da prévia: a placa de vídeo recebe
  // uma imagem pequena (não o 4K do iPhone) e o iPhone sempre entrega o quadro, mesmo pausado
  const sc = Math.min(1, big / Math.max(video.videoWidth, video.videoHeight));
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
  editor.load(state);
  $('seek').max = state.duration.toFixed(2); $('tEnd').textContent = fmt(state.duration);
  refreshRef(); refreshChips();
  go(2);
  requestAnimationFrame(loop);
  $('quick').hidden = false;
}

// Caminho rápido: um toque e o vídeo sai pronto (o cantor quer postar logo)
$('quickStep').onclick = () => ($('quick').hidden = true);
$('quickAll').onclick = async () => {
  $('quick').hidden = true;
  await doTune();
  if (!tuned) return;
  busy(true, 'Mixando e masterizando…'); await doMaster(false);
  busy(true, 'Colorista ajustando a cor…'); try { auto = await autoGrade(video); } catch (e) { console.warn(e); }
  look = { id: 'auto', name: 'Auto · Colorista' }; busy(false);
  go(5); toast('Pronto! Assista a prévia e baixe. Quer mudar algo? Toque na etapa lá em cima.', 6000);
};

// Etapas
function go(n) {
  const wasPlaying = playing();
  pause();
  step = n;
  $('studio').dataset.step = n;
  // afinação e mix: o próprio player do aparelho mostra o vídeo (leve). Cor e exportar: a prévia com o filtro.
  $('viewer').classList.toggle('live', n < 4);
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('on', +s.dataset.step === n));
  document.querySelectorAll('#stepper button').forEach((b) => { const k = +b.dataset.step; b.classList.toggle('on', k === n); b.classList.toggle('done', k < n); });
  $('prev').style.visibility = n > 2 ? 'visible' : 'hidden';
  $('next').hidden = n === 5;
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
    const url = urls[src[k].audio];
    if (url && players[k].src !== url) { const t = clipT(); players[k].src = url; players[k].currentTime = t; }
    $('ab' + k).classList.toggle('on', side === k);
  }
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
const cur = () => players[side];
const clipT = () => (cur() && !isNaN(cur().currentTime) ? cur().currentTime : +$('seek').value || 0);
const playing = () => want;
function seek(t) {
  t = Math.max(0, Math.min(t, state.duration - 0.05));
  for (const p of Object.values(players)) if (p.src) p.currentTime = t;
  video.currentTime = t;
  $('seek').value = t; $('tNow').textContent = fmt(t);
  editor?.setTime(t);
}
function pause() { want = false; Object.values(players).forEach((p) => p.pause()); video.pause(); video.playbackRate = 1; $('play').textContent = '▶'; grab(); loop.dirty = true; }
let want = false; // a pessoa apertou play
function play() {
  if (playing()) return pause();
  const t = +$('seek').value;
  want = true;
  if (Math.abs(video.currentTime - t) > 0.05) video.currentTime = t;
  cur().currentTime = t;
  video.play().catch(() => {}); cur().play().catch(() => {});
  $('play').textContent = '❚❚';
}

$('play').onclick = play;
// Prévia em tela cheia (a mesma prévia, só que grande; o arquivo final sai em 1080p)
function theater(on) { app.classList.toggle('theater', on); $('fsTxt').textContent = on ? '✕ Fechar' : '⛶ Tela cheia'; loop.dirty = true; }
$('fsBtn').onclick = () => theater(!app.classList.contains('theater'));
$('watchBtn').onclick = () => { theater(true); seek(mastered ? mastered.start : 0); if (!playing()) play(); };
addEventListener('keydown', (e) => { if (e.key === 'Escape') theater(false); });
$('back5').onclick = () => seek(clipT() - 5);
$('fwd5').onclick = () => seek(clipT() + 5);
$('seek').oninput = () => seek(+$('seek').value);
Object.values(players).forEach((p) => (p.onended = () => pause()));
video.onseeked = () => { grab(); loop.dirty = true; };
function loop(now) {
  if (app.dataset.screen !== 'studio') return;
  if (playing()) {
    // O som nunca para (é ele que a pessoa está avaliando). O vídeo roda solto e só é ajustado de leve
    // pela velocidade; pulo só se ficar mais de 1 s atrás, e no máximo um a cada 3 s (pular seguido congela).
    const t = cur().currentTime, drift = video.currentTime - t;
    if (!video.seeking && Math.abs(drift) > 1 && now - (loop.jump || 0) > 3000) { video.currentTime = t; loop.jump = now; }
    else if (!video.seeking) { const r = Math.abs(drift) < 0.05 ? 1 : 1 - Math.max(-0.1, Math.min(0.1, drift * 0.5)); if (Math.abs(video.playbackRate - r) > 0.01) video.playbackRate = r; }
    if (video.paused && !video.ended) video.play().catch(() => {});
    $('seek').value = t; $('tNow').textContent = fmt(t);
    if (step === 2 && now - lastEd > 80) { editor.setTime(t); lastEd = now; }
    if (step >= 4 && video.currentTime !== lastVT) { grab(); loop.dirty = true; }
  }
  if (lastVT < 0 && video.readyState >= 2) { grab(); loop.dirty = true; } // primeiro quadro assim que existir
  if (loop.dirty && (step >= 4 || !playing())) { grader.draw(frame); loop.dirty = false; }
  $('viewer').classList.toggle('playing', playing());
  requestAnimationFrame(loop);
}

function busy(on, txt) { $('busy').hidden = !on; if (txt) $('busyTxt').textContent = txt; busyPct(0); }
function busyPct(p) { $('busyBar').style.strokeDashoffset = 327 * (1 - Math.max(0, Math.min(1, p))); }

// ---------- 2) Afinação ----------
function refreshChips() {
  const b = state.before, a = state.after, edited = Object.keys(state.edits || {}).length;
  $('chips').innerHTML = `<span class="chip">Tom <b>${state.key.name}</b></span>
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
    wav('raw', cover.rawMix(state));
    if (mastered) await doMaster(false);
    editor.load(state); refreshChips(); side = 'B'; refreshAB();
    toast(`Afinado: ${state.after.band}% da voz na faixa verde. Compare no ANTES | DEPOIS.`);
  } catch (e) { console.error(e); toast('Deu erro: ' + e.message, 6000); }
  busy(false);
}
$('tuneAuto').onclick = doTune;
$('tuneAgain').onclick = () => { pushUndo(); doTune(); };
$('tuneUndo').onclick = async () => {
  pause(); cover.untune(state, tuneOpts()); tuned = false;
  wav('raw', cover.rawMix(state));
  if (mastered) { busy(true, 'Refazendo a mix…'); await doMaster(false); busy(false); }
  editor.load(state); refreshChips(); refreshAB(); toast('Afinação desfeita: a voz voltou a ser a original.');
};
function onSelect(i) {
  $('selInfo').innerHTML = i >= 0 ? `Nota <b>${i + 1}</b> escolhida: use Subir, Descer, Original ou Auto, e depois <b>Aplicar</b>.` : 'Toque numa nota no painel para editar só ela. Arraste para os lados para andar na música.';
  $('selInfo').classList.toggle('on', i >= 0);
  const n = state.plan[i], ed = (state.edits || {})[i] || {};
  $('qLabel').textContent = i >= 0 ? 'Quantizar nota' : 'Quantizar tudo';
  $('sLabel').textContent = i >= 0 ? 'Endireitar nota' : 'Endireitar tudo';
  $('q').value = i >= 0 ? ed.quantize ?? n.q : $('q').dataset.global || 1;
  $('s').value = i >= 0 ? ed.straighten ?? n.st : $('s').dataset.global ?? 1;
  $('qOut').textContent = pct(+$('q').value); $('sOut').textContent = pct(+$('s').value);
}
function pushUndo() { undo.push(JSON.stringify({ edits: state.edits, q: $('q').dataset.global, s: $('s').dataset.global })); }
function setPending(v = true) { pending = v; $('apply').disabled = !v; }
function onEdit(i, patch) {
  pushUndo();
  state.edits[i] = { ...(state.edits[i] || {}), ...patch };
  if (patch.target != null) { state.plan[i].target = patch.target; state.plan[i].manual = true; }
  setPending(); editor.draw(); refreshChips();
}
const needSel = () => (editor.sel < 0 ? (toast('Toque numa nota primeiro'), false) : true);
$('nUp').onclick = () => needSel() && onEdit(editor.sel, { target: state.plan[editor.sel].target + 1, bypass: false });
$('nDown').onclick = () => needSel() && onEdit(editor.sel, { target: state.plan[editor.sel].target - 1, bypass: false });
$('nOrig').onclick = () => { if (!needSel()) return; onEdit(editor.sel, { bypass: true }); state.plan[editor.sel].q = 0; state.plan[editor.sel].st = 0; editor.draw(); };
$('nAuto').onclick = () => { if (!needSel()) return; pushUndo(); delete state.edits[editor.sel]; setPending(); refreshChips(); };
$('q').oninput = () => ($('qOut').textContent = pct(+$('q').value));
$('s').oninput = () => ($('sOut').textContent = pct(+$('s').value));
$('q').onchange = () => { if (editor.sel >= 0) onEdit(editor.sel, { quantize: +$('q').value, bypass: false }); else { pushUndo(); $('q').dataset.global = $('q').value; setPending(); } };
$('s').onchange = () => { if (editor.sel >= 0) onEdit(editor.sel, { straighten: +$('s').value, bypass: false }); else { pushUndo(); $('s').dataset.global = $('s').value; setPending(); } };
$('expandBtn').onclick = () => { const on = !$('studio').classList.contains('expand'); $('studio').classList.toggle('expand', on); $('expandBtn').classList.toggle('on', on); $('expandTxt').textContent = on ? '⤡ Diminuir painel' : '⤢ Expandir painel'; };
$('moreBtn').onclick = () => { $('more').hidden = !$('more').hidden; $('moreBtn').classList.toggle('on', !$('more').hidden); requestAnimationFrame(() => editor.resize()); };
$('zIn').onclick = () => editor.zoom(1.5);
$('zOut').onclick = () => editor.zoom(1 / 1.5);
$('showOrig').onclick = () => { editor.showOrig = !editor.showOrig; $('showOrig').classList.toggle('on', editor.showOrig); editor.draw(); };
$('undo').onclick = () => {
  const u = undo.pop(); if (!u) return toast('Nada para desfazer');
  const o = JSON.parse(u); state.edits = o.edits;
  if (o.q != null) $('q').dataset.global = o.q; else delete $('q').dataset.global;
  if (o.s != null) $('s').dataset.global = o.s; else delete $('s').dataset.global;
  setPending(); refreshChips(); toast('Desfeito. Toque em "Aplicar edições" para ouvir.');
};
$('apply').onclick = doTune;
$('mSnap').onchange = () => { pushUndo(); setPending(); };
$('mUseRef').onchange = () => { pushUndo(); setPending(); };
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

// ---------- 3) Mix e master ----------
async function doMaster(show = true) {
  if (show) { pause(); busy(true, 'Mixando e masterizando…'); }
  mastered = await cover.render(state, mixOpts());
  wav('master', mastered.full);
  $('mixApply').hidden = true; $('mixUndo').hidden = false;
  if (show) { busy(false); side = 'C'; refreshAB(); toast('Mix e master prontos. Alterne entre ORIGINAL, AFINADA e MIXADA.'); }
}
$('mixApply').onclick = () => doMaster();
$('mixUndo').onclick = () => { pause(); mastered = null; side = 'B'; $('mixApply').hidden = false; $('mixUndo').hidden = true; refreshAB(); toast('Mix e master desfeitos.'); };
document.querySelectorAll('.row input[type=range]').forEach((r) => {
  const o = r.nextElementSibling;
  const upd = () => (o.textContent = r.id === 'mReverb' || r.id === 'fAmount' ? pct(+r.value) : (+r.value).toFixed(1) + ' s');
  r.addEventListener('input', upd); upd();
});
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
  $('summary').innerHTML = `<div>Afinação<b>${tuned ? `sim · ${state.after.band}% na faixa` : 'não'}</b></div><div>Mix e master<b>${mastered ? 'sim' : 'não'}</b></div>
    <div>Cor<b>${currentFilter().name}</b></div><div>Duração<b>${fmt(e - s)}</b></div>
    <div>Resolução<b>${portrait ? '1080 × 1920' : '1920 × 1080'}</b></div><div>Formato<b>${type.startsWith('video/mp4') ? 'MP4' : type ? 'WebM' : '—'}</b></div>`;
}
$('exportBtn').onclick = async () => {
  pause();
  if (pending) toast('Você tem edições de afinação que ainda não foram aplicadas.');
  $('exportBtn').disabled = true; $('exportBar').hidden = false; $('ready').hidden = true;
  try {
    const ch = mastered ? mastered.channels : cover.rawMix(state);
    const s = mastered ? mastered.start : 0, e = mastered ? mastered.end : state.duration;
    const out = await exportVideo({ video, filter: currentFilter(), amount, channels: ch, sr: cover.SR, start: s, end: e,
      onProgress: (p) => { $('exportBar').firstElementChild.style.width = Math.round(p * 100) + '%'; } });
    const a = $('download');
    a.href = URL.createObjectURL(out.blob);
    a.download = `${(file.name || 'cover').replace(/\.[^.]+$/, '')}-studio-cover.${out.ext}`;
    $('readyInfo').textContent = `${out.width} × ${out.height} · ${out.ext.toUpperCase()} · ${Math.max(1, Math.round(out.blob.size / 1048576))} MB, com o som e a cor que você escolheu.`;
    $('ready').hidden = false; $('ready').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Vídeo pronto!');
  } catch (e) { console.error(e); toast('Deu erro: ' + e.message, 7000); }
  $('exportBtn').disabled = false;
  seek(0);
};
$('dlWav').onclick = () => { const a = document.createElement('a'); a.href = urls[mastered ? 'master' : 'raw']; a.download = 'studio-cover-audio.wav'; a.click(); };

window.studio = { audio: () => players[side], get state() { return state; }, get mastered() { return mastered; }, get tuned() { return tuned || null; }, cover, select: (i) => editor.select(i), go };

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
$('helpBtn').onclick = () => {
  helpOn = !helpOn; app.classList.toggle('helpon', helpOn);
  toast(helpOn ? 'Modo ajuda ligado: toque em qualquer botão com borda tracejada para saber o que ele faz. Toque no ? de novo para usar o app.' : 'Modo ajuda desligado.', 5000);
};

// Qualquer erro aparece na tela (e fica no diário), para a gente saber exatamente o que houve num aparelho real
addEventListener('error', (e) => { note({ erro: String(e.message).slice(0, 120) }); toast('Erro: ' + e.message, 9000); });
addEventListener('unhandledrejection', (e) => { const m = String(e.reason?.message || e.reason).slice(0, 120); note({ erro: m }); toast('Erro: ' + m, 9000); });
