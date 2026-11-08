// ===== Studio Cover · app em 5 etapas =====
// 1 Vídeo → 2 Afinação → 3 Mix e master → 4 Cor → 5 Exportar.
// Em toda etapa há um player só e o botão ANTES | DEPOIS: ANTES = como estava antes desta etapa,
// DEPOIS = com esta etapa aplicada, no mesmo ponto do vídeo. Cada etapa tem aplicar e desfazer.
import * as cover from './pipeline.js?v=5';
import { TuneEditor } from './editor.js?v=5';
import { Grader, FILTERS, ORIGINAL, autoGrade, compose } from './filters.js?v=5';
import { exportVideo, exportType } from './export.js?v=5';

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
function progress(st, p) {
  const [a, w] = W[st] || [0, 0];
  const v = Math.min(100, Math.round(a + w * p));
  $('ringBar').style.strokeDashoffset = 327 * (1 - v / 100);
  $('ringPct').textContent = v + '%';
  $('workStep').textContent = LABEL[st] || '';
  const order = Object.keys(W), alias = { ref: 'refsep', refnotes: 'refsep' };
  document.querySelectorAll('#steps li').forEach((li) => { const i = order.indexOf(li.dataset.s), c = order.indexOf(alias[st] || st); li.className = (li.classList.contains('refstep') ? 'refstep ' : '') + (i < c ? 'done' : i === c ? 'on' : ''); });
}
async function start(f) {
  file = f;
  app.dataset.screen = 'work'; progress('audio', 0);
  $('topinfo').textContent = f.name;
  $('steps').classList.toggle('ref', !!refFile);
  try {
    video.src = URL.createObjectURL(f);
    state = await cover.analyze(f, { ...tuneOpts(), reference: refFile, autoTune: false }, progress);
    await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })));
    wav('orig', state.orig);
    wav('raw', cover.rawMix(state));
    openStudio();
  } catch (e) {
    console.error(e);
    app.dataset.screen = 'home';
    toast(/decod|Unable|EncodingError/i.test(e.message) ? 'Não consegui ler o áudio desse vídeo. Tente outro arquivo.' : 'Deu erro: ' + e.message, 7000);
  }
}

// ---------- Estúdio ----------
let grader = null, editor = null;
function openStudio() {
  app.dataset.screen = 'studio';
  $('newBtn').hidden = false;
  const cv = $('screen'), portrait = video.videoHeight >= video.videoWidth;
  cv.width = portrait ? 720 : 1280; cv.height = portrait ? 1280 : 720;
  const fit = () => {
    const r = $('viewer').getBoundingClientRect(), ar = portrait ? 9 / 16 : 16 / 9;
    let h = r.height, w = h * ar;
    if (w > r.width) { w = r.width; h = w / ar; }
    cv.style.width = Math.floor(w) + 'px'; cv.style.height = Math.floor(h) + 'px';
  };
  new ResizeObserver(fit).observe($('viewer')); fit();
  grader = new Grader(cv);
  editor = new TuneEditor($('editor'), { onSelect, onEdit, onSeek: (t) => seek(t) });
  editor.load(state);
  $('seek').max = state.duration.toFixed(2); $('tEnd').textContent = fmt(state.duration);
  refreshRef(); refreshChips();
  go(2);
  requestAnimationFrame(loop);
}

// Etapas
function go(n) {
  const wasPlaying = playing();
  pause();
  step = n;
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
const playing = () => !!cur() && !cur().paused;
function seek(t) {
  t = Math.max(0, Math.min(t, state.duration - 0.05));
  for (const p of Object.values(players)) if (p.src) p.currentTime = t;
  video.currentTime = t;
  $('seek').value = t; $('tNow').textContent = fmt(t);
  editor?.setTime(t);
}
function pause() { Object.values(players).forEach((p) => p.pause()); video.pause(); $('play').textContent = '▶'; }
function play() {
  if (playing()) return pause();
  const t = +$('seek').value;
  video.currentTime = t; cur().currentTime = t;
  cur().play(); video.play();
  $('play').textContent = '❚❚';
}
$('play').onclick = play;
$('back5').onclick = () => seek(clipT() - 5);
$('fwd5').onclick = () => seek(clipT() + 5);
$('seek').oninput = () => seek(+$('seek').value);
Object.values(players).forEach((p) => (p.onended = () => pause()));
video.onseeked = () => (loop.dirty = true);
function loop() {
  if (app.dataset.screen !== 'studio') return;
  if (playing()) {
    const t = cur().currentTime;
    if (Math.abs(video.currentTime - t) > 0.08) video.currentTime = t;
    $('seek').value = t; $('tNow').textContent = fmt(t); editor.setTime(t);
  }
  if (playing() || loop.dirty) { grader.draw(video); loop.dirty = false; }
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
  const portrait = video.videoHeight >= video.videoWidth;
  if (!thumbGr) { const c = document.createElement('canvas'); thumbGr = new Grader(c); }
  thumbGr.c.width = portrait ? 180 : 320; thumbGr.c.height = portrait ? 320 : 180;
  const list = [ORIGINAL, { id: 'auto' }, ...FILTERS];
  list.forEach((f, i) => {
    const real = f.id === 'original' ? ORIGINAL : f.id === 'auto' ? auto || ORIGINAL : compose(auto, f);
    thumbGr.set(real, 1); thumbGr.draw(video);
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
  $('exportBtn').disabled = true; $('exportBar').hidden = false; $('download').hidden = true;
  try {
    const ch = mastered ? mastered.channels : cover.rawMix(state);
    const s = mastered ? mastered.start : 0, e = mastered ? mastered.end : state.duration;
    const out = await exportVideo({ video, filter: currentFilter(), amount, channels: ch, sr: cover.SR, start: s, end: e,
      onProgress: (p) => { $('exportBar').firstElementChild.style.width = Math.round(p * 100) + '%'; } });
    const a = $('download');
    a.href = URL.createObjectURL(out.blob);
    a.download = `${(file.name || 'cover').replace(/\.[^.]+$/, '')}-studio-cover.${out.ext}`;
    a.hidden = false; a.textContent = `Baixar o vídeo (${(out.blob.size / 1048576).toFixed(0)} MB)`;
    toast('Vídeo pronto!');
  } catch (e) { console.error(e); toast('Deu erro: ' + e.message, 7000); }
  $('exportBtn').disabled = false;
  seek(0);
};
$('dlWav').onclick = () => { const a = document.createElement('a'); a.href = urls[mastered ? 'master' : 'raw']; a.download = 'studio-cover-audio.wav'; a.click(); };

window.studio = { get state() { return state; }, get mastered() { return mastered; }, get tuned() { return tuned || null; }, cover, select: (i) => editor.select(i), go };

// ---------- Ajuda: um "?" em cada botão explica o que ele faz ----------
const HELP_KEY = 'sc-help';
let helpOn = true;
try { helpOn = localStorage.getItem(HELP_KEY) !== '0'; } catch {}
app.classList.toggle('helpon', helpOn);
document.querySelectorAll('[data-help]').forEach((el) => {
  el.title = el.dataset.help;
  const q = document.createElement('i');
  q.className = 'qh'; q.textContent = '?'; q.setAttribute('role', 'button'); q.setAttribute('aria-label', 'O que é isto?');
  el.appendChild(q);
});
document.addEventListener('click', (e) => {
  const q = e.target.closest('.qh'); if (!q) return;
  e.preventDefault(); e.stopPropagation();
  $('tipTxt').textContent = q.parentElement.dataset.help; $('tip').hidden = false;
}, true);
$('tipOk').onclick = () => ($('tip').hidden = true);
$('helpBtn').onclick = () => {
  helpOn = !helpOn; app.classList.toggle('helpon', helpOn);
  try { localStorage.setItem(HELP_KEY, helpOn ? '1' : '0'); } catch {}
  toast(helpOn ? 'Ajuda ligada: toque no "?" de qualquer botão para ver o que ele faz.' : 'Ajuda desligada. Toque no ? lá em cima para ligar de novo.');
};
