// ===== Studio Cover · app =====
// Fluxo: escolhe o vídeo → o motor separa, afina e mixa → estúdio com prévia, editor de notas,
// mix, filtros de cinema e exportação. Tudo no aparelho do artista.
import * as cover from './pipeline.js';
import { TuneEditor } from './editor.js';
import { Grader, FILTERS, ORIGINAL } from './filters.js';
import { exportVideo, exportType } from './export.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const screen = (s) => (app.dataset.screen = s);
let toastT = 0;
const toast = (msg, ms = 3500) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); };

let file = null, refFile = null, state = null, result = null, wavUrl = null, videoUrl = null;
let filter = FILTERS[0], amount = 1, ab = false, pending = false;
const undo = [];
const video = $('video'), audio = new Audio();
audio.preload = 'auto';
const mixOpts = () => ({ reverb: +$('mReverb').value, fadeIn: +$('mFadeIn').value, fadeOut: +$('mFadeOut').value, trim: $('mTrim').checked });
const tuneOpts = () => ({ separate: $('optSeparate').checked, strength: +$('mStrength').value, scaleSnap: $('mSnap').checked, straighten: $('s').dataset.global != null ? +$('s').dataset.global : 1, useRef: $('mUseRef').checked });

// ---------- 1) Escolher o vídeo ----------
const drop = $('drop');
$('file').onchange = () => $('file').files[0] && start($('file').files[0]);
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) start(f); });
$('newBtn').onclick = () => location.reload();
$('refFile').onchange = () => { refFile = $('refFile').files[0] || null; $('refName').textContent = refFile ? refFile.name : 'opcional'; $('refPick').classList.toggle('on', !!refFile); };

// ---------- 2) Processar ----------
const W = { audio: [0, 3], download: [3, 15], separate: [18, 45], notes: [63, 5], ref: [68, 1], refsep: [68, 12], refnotes: [80, 3], tune: [83, 13], mix: [96, 4] };
const LABEL = { ref: 'Lendo a música original', refsep: 'Lendo a melodia da original', refnotes: 'Lendo a melodia da original', audio: 'Lendo o áudio', download: 'Baixando a IA', separate: 'Separando a voz', notes: 'Achando as notas', tune: 'Afinando nota por nota', mix: 'Mixando e masterizando' };
function progress(step, p) {
  const [a, w] = W[step] || [0, 0];
  const pct = Math.min(100, Math.round(a + w * p));
  $('ringBar').style.strokeDashoffset = 327 * (1 - pct / 100);
  $('ringPct').textContent = pct + '%';
  $('workStep').textContent = LABEL[step] || '';
  const order = Object.keys(W);
  const alias = { ref: 'refsep', refnotes: 'refsep' };
  document.querySelectorAll('#steps li').forEach((li) => {
    const i = order.indexOf(li.dataset.s), cur = order.indexOf(alias[step] || step);
    li.className = i < cur ? 'done' : i === cur ? 'on' : '';
  });
}
async function start(f) {
  file = f;
  screen('work'); progress('audio', 0);
  $('topinfo').textContent = f.name;
  try {
    videoUrl = URL.createObjectURL(f);
    video.src = videoUrl;
    $('steps').classList.toggle('ref', !!refFile);
    state = await cover.analyze(f, { ...tuneOpts(), reference: refFile }, progress);
    await cover.verify(state);
    progress('mix', 0);
    await remix();
    progress('mix', 1);
    await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })));
    openStudio();
  } catch (e) {
    console.error(e);
    screen('home');
    toast(/decode|Unable|EncodingError/i.test(e.message) ? 'Não consegui ler o áudio desse vídeo. Tente outro arquivo ou o Chrome atualizado.' : 'Deu erro: ' + e.message, 7000);
  }
}

// ---------- 3) Estúdio ----------
let grader = null, editor = null;
function openStudio() {
  screen('studio');
  $('newBtn').hidden = false;
  const cv = $('screen'), portrait = video.videoHeight >= video.videoWidth;
  // A tela do vídeo cabe inteira no espaço que sobrar, sem distorcer (conta feita a cada mudança de tamanho)
  const fit = () => {
    const r = $('viewer').getBoundingClientRect(), ar = portrait ? 9 / 16 : 16 / 9;
    let h = r.height, w = h * ar;
    if (w > r.width) { w = r.width; h = w / ar; }
    cv.style.width = Math.floor(w) + 'px'; cv.style.height = Math.floor(h) + 'px';
  };
  new ResizeObserver(fit).observe($('viewer')); fit();
  cv.width = portrait ? 720 : 1280; cv.height = portrait ? 1280 : 720;
  if (!grader) grader = new Grader(cv);
  grader.set(filter, amount);
  if (!editor) editor = new TuneEditor($('editor'), { onSelect, onEdit, onSeek: (t) => seek(t - result.start) });
  editor.load(state);
  refreshChips(); refreshRef();
  seek(0);
  buildFilters();
  requestAnimationFrame(loop);
}
async function remix() {
  result = await cover.render(state, mixOpts());
  if (wavUrl) URL.revokeObjectURL(wavUrl);
  wavUrl = URL.createObjectURL(cover.toWav(result.channels, result.sr));
  const t = audio.currentTime;
  audio.src = wavUrl;
  audio.currentTime = Math.min(t, result.end - result.start);
  $('seek').max = (result.end - result.start).toFixed(2);
  $('tEnd').textContent = fmt(result.end - result.start);
  refreshSummary();
}

// Player: vídeo mudo + áudio novo no mesmo relógio. No A/B, toca o som original do vídeo.
const clipT = () => (ab ? video.currentTime - result.start : audio.currentTime);
const playing = () => (ab ? !video.paused : !audio.paused);
function seek(t) {
  t = Math.max(0, Math.min(t, result.end - result.start));
  audio.currentTime = t; video.currentTime = result.start + t;
  $('seek').value = t; $('tNow').textContent = fmt(t);
  editor?.setTime(result.start + t);
}
function play() {
  if (playing()) { audio.pause(); video.pause(); $('play').textContent = '▶'; return; }
  const t = Math.min(+$('seek').value, result.end - result.start - 0.05);
  video.currentTime = result.start + t;
  if (ab) { video.muted = false; video.play(); } else { video.muted = true; audio.currentTime = t; audio.play(); video.play(); }
  $('play').textContent = '❚❚';
}
$('play').onclick = play;
$('back5').onclick = () => seek(clipT() - 5);
$('fwd5').onclick = () => seek(clipT() + 5);
$('seek').oninput = () => seek(+$('seek').value);
$('ab').onclick = () => {
  const was = playing(), t = clipT();
  audio.pause(); video.pause();
  ab = !ab; $('ab').classList.toggle('on', ab); $('abtag').hidden = !ab;
  seek(t); if (was) { $('play').textContent = '▶'; play(); }
};
audio.onended = () => { video.pause(); $('play').textContent = '▶'; };
video.onseeked = () => grader && grader.draw(video);
function loop() {
  if (app.dataset.screen !== 'studio') return;
  if (result) {
    if (!ab && !audio.paused) {
      const want = result.start + audio.currentTime;
      if (Math.abs(video.currentTime - want) > 0.08) video.currentTime = want;
    }
    if (ab && !video.paused && video.currentTime >= result.end) { video.pause(); $('play').textContent = '▶'; }
    if (playing()) { const t = clipT(); $('seek').value = t; $('tNow').textContent = fmt(t); editor.setTime(result.start + t); }
    if (playing() || loop.dirty) { grader.draw(video); loop.dirty = false; }
  }
  requestAnimationFrame(loop);
}

// Abas
$('tabs').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('.tabs button, .tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === b.dataset.tab));
  if (b.dataset.tab === 'tune') editor.resize();
  if (b.dataset.tab === 'look') drawThumbs();
};

// ---------- Editor de notas ----------
function refreshChips() {
  const b = state.before, a = state.after, edited = Object.keys(state.edits || {}).length;
  $('chips').innerHTML = `<span class="chip">Tom <b>${state.key.name}</b></span>
    <span class="chip">Faixa verde antes <b>${b.band}%</b></span>
    <span class="chip ${a.band >= 99 ? 'good' : 'bad'}">depois <b>${a.band}%</b></span>
    <span class="chip">Desvio <b>${b.avgCents}→${a.avgCents} cents</b></span>
    ${edited ? `<span class="chip">Editadas <b>${edited}</b></span>` : ''}
    ${state.ref ? `<span class="chip">Original <b>${state.ref.shift >= 0 ? '+' : ''}${state.ref.shift} semitons · ${state.plan.filter((n) => n.viaRef).length} notas pela referência</b></span>` : ''}`;
}
const pct = (v) => Math.round(v * 100) + '%';
function onSelect(i) {
  const n = state.plan[i], ed = (state.edits || {})[i] || {};
  $('qLabel').textContent = i >= 0 ? 'Quantizar nota' : 'Quantizar tudo';
  $('sLabel').textContent = i >= 0 ? 'Endireitar nota' : 'Endireitar tudo';
  $('q').value = i >= 0 ? ed.quantize ?? n.q : $('mStrength').value;
  $('s').value = i >= 0 ? ed.straighten ?? n.st : $('s').dataset.global || 1;
  $('qOut').textContent = pct(+$('q').value); $('sOut').textContent = pct(+$('s').value);
}
function pushUndo() { undo.push(JSON.stringify({ edits: state.edits, strength: $('mStrength').value, st: $('s').dataset.global })); }
function setPending(v = true) { pending = v; $('apply').disabled = !v; }
function onEdit(i, patch) {
  pushUndo();
  state.edits[i] = { ...(state.edits[i] || {}), ...patch };
  if (patch.target != null) { state.plan[i].target = patch.target; state.plan[i].manual = true; }
  setPending(); editor.draw(); refreshChips();
}
$('nUp').onclick = () => editor.sel >= 0 && onEdit(editor.sel, { target: state.plan[editor.sel].target + 1, bypass: false });
$('nDown').onclick = () => editor.sel >= 0 && onEdit(editor.sel, { target: state.plan[editor.sel].target - 1, bypass: false });
$('nOrig').onclick = () => { if (editor.sel < 0) return toast('Toque numa nota primeiro'); onEdit(editor.sel, { bypass: true }); state.plan[editor.sel].q = 0; state.plan[editor.sel].st = 0; editor.draw(); };
$('nAuto').onclick = () => { if (editor.sel < 0) return toast('Toque numa nota primeiro'); pushUndo(); delete state.edits[editor.sel]; setPending(); refreshChips(); };
$('q').oninput = () => { $('qOut').textContent = pct(+$('q').value); };
$('s').oninput = () => { $('sOut').textContent = pct(+$('s').value); };
$('q').onchange = () => { if (editor.sel >= 0) onEdit(editor.sel, { quantize: +$('q').value, bypass: false }); else { pushUndo(); $('mStrength').value = $('q').value; setPending(); } };
$('s').onchange = () => { if (editor.sel >= 0) onEdit(editor.sel, { straighten: +$('s').value, bypass: false }); else { pushUndo(); $('s').dataset.global = $('s').value; setPending(); } };
$('zIn').onclick = () => editor.zoom(1.5);
$('zOut').onclick = () => editor.zoom(1 / 1.5);
$('showOrig').classList.add('on');
$('showOrig').onclick = () => { editor.showOrig = !editor.showOrig; $('showOrig').classList.toggle('on', editor.showOrig); editor.draw(); };
$('undo').onclick = () => {
  const u = undo.pop(); if (!u) return toast('Nada para desfazer');
  const o = JSON.parse(u);
  state.edits = o.edits; $('mStrength').value = o.strength; if (o.st) $('s').dataset.global = o.st;
  setPending(); refreshChips(); toast('Desfeito. Toque em "Aplicar afinação" para ouvir.');
};
async function applyTuning() {
  audio.pause(); video.pause(); $('play').textContent = '▶';
  busy(true, 'Afinando e conferindo…');
  try {
    await cover.retune(state, tuneOpts(), (s, p) => busyPct(p));
    await cover.verify(state);
    busy(true, 'Mixando…');
    await remix();
    editor.load(state); refreshChips(); setPending(false);
    toast(state.after.band >= 99 ? `Pronto: ${state.after.band}% da voz na faixa verde.` : `Pronto: ${state.after.band}% na faixa verde.`);
  } catch (e) { console.error(e); toast('Deu erro: ' + e.message, 6000); }
  busy(false);
}
$('apply').onclick = applyTuning;
$('mRetune').onclick = () => { pushUndo(); applyTuning(); };

function busy(on, txt) { $('busy').hidden = !on; if (txt) $('busyTxt').textContent = txt; busyPct(0); }
function busyPct(p) { $('busyBar').style.strokeDashoffset = 327 * (1 - Math.max(0, Math.min(1, p))); }

// ---------- Música original (modo referência) ----------
function refreshRef() {
  $('mUseRef').disabled = !state.ref;
  $('mRefTxt').textContent = state.ref ? 'Trocar a música original' : 'Subir a música original';
}
$('mUseRef').addEventListener('change', () => { pushUndo(); applyTuning(); });
$('mRefFile').onchange = async () => {
  const f = $('mRefFile').files[0]; if (!f) return;
  audio.pause(); video.pause(); $('play').textContent = '▶';
  busy(true, 'Lendo a melodia da original…');
  try {
    const r = await cover.setReference(state, f, (s, p) => busyPct(p));
    $('mUseRef').checked = true; refreshRef();
    toast(`Original lida: diferença de ${r.shift} semitons. Afinando…`);
    await applyTuning();
  } catch (e) { console.error(e); toast('Não consegui ler a música original: ' + e.message, 6000); busy(false); }
};

// ---------- Mix ----------
document.querySelectorAll('.row input[type=range]').forEach((r) => {
  const o = r.nextElementSibling;
  const upd = () => (o.textContent = r.id === 'mStrength' || r.id === 'fAmount' || r.id === 'mReverb' ? pct(+r.value) : (+r.value).toFixed(1) + ' s');
  r.addEventListener('input', upd); upd();
});
let remixT = 0;
const remixSoon = () => { clearTimeout(remixT); remixT = setTimeout(async () => { const was = playing(); audio.pause(); video.pause(); busy(true, 'Mixando…'); await remix(); busy(false); seek(+$('seek').value); if (was) { $('play').textContent = '▶'; play(); } }, 250); };
['mReverb', 'mFadeIn', 'mFadeOut', 'mTrim'].forEach((id) => $(id).addEventListener('change', remixSoon));
['mStrength', 'mSnap'].forEach((id) => $(id).addEventListener('change', () => { pushUndo(); setPending(); toast('Toque em "Afinar tudo de novo" para aplicar.'); }));

// ---------- Filtros ----------
let thumbGr = null;
function buildFilters() {
  const box = $('filters'); box.innerHTML = '';
  [ORIGINAL, ...FILTERS].forEach((f) => {
    const b = document.createElement('button');
    b.innerHTML = `<canvas width="90" height="160"></canvas>${f.name}`;
    b.classList.toggle('on', f === filter);
    b.onclick = () => { filter = f; grader.set(filter, amount); loop.dirty = true; box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); refreshSummary(); };
    b.dataset.id = f.id;
    box.appendChild(b);
  });
}
function drawThumbs() {
  if (!video.videoWidth) return;
  if (!thumbGr) { const c = document.createElement('canvas'); c.width = 180; c.height = 320; thumbGr = new Grader(c); }
  const portrait = video.videoHeight >= video.videoWidth;
  thumbGr.c.width = portrait ? 180 : 320; thumbGr.c.height = portrait ? 320 : 180;
  [ORIGINAL, ...FILTERS].forEach((f, i) => {
    thumbGr.set(f, 1); thumbGr.draw(video);
    const cv = $('filters').children[i]?.querySelector('canvas');
    if (!cv) return;
    cv.width = thumbGr.c.width; cv.height = thumbGr.c.height; cv.style.aspectRatio = portrait ? '9 / 16' : '16 / 9';
    cv.getContext('2d').drawImage(thumbGr.c, 0, 0);
  });
}
$('fAmount').addEventListener('input', () => { amount = +$('fAmount').value; grader.set(filter, amount); loop.dirty = true; });

// ---------- Exportar ----------
function refreshSummary() {
  if (!result || !state) return;
  const portrait = video.videoHeight >= video.videoWidth;
  const type = exportType();
  $('summary').innerHTML = `<div>Duração<b>${fmt(result.end - result.start)}</b></div><div>Resolução<b>${portrait ? '1080 × 1920' : '1920 × 1080'}</b></div>
    <div>Filtro<b>${filter.name}</b></div><div>Formato<b>${type.startsWith('video/mp4') ? 'MP4' : type ? 'WebM' : '—'}</b></div>`;
}
$('exportBtn').onclick = async () => {
  audio.pause(); video.pause(); $('play').textContent = '▶';
  if (pending) toast('Você tem ajustes de afinação que ainda não foram aplicados.');
  $('exportBtn').disabled = true; $('exportBar').hidden = false; $('download').hidden = true;
  try {
    const out = await exportVideo({ video, filter, amount, channels: result.channels, sr: result.sr, start: result.start, end: result.end,
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
$('dlWav').onclick = () => { const a = document.createElement('a'); a.href = wavUrl; a.download = 'studio-cover-audio.wav'; a.click(); };

window.studio = { get state() { return state; }, get result() { return result; }, cover, start, select: (i) => editor.select(i) }; // para testes
