// Manual do usuário: lista de vídeos curtos (com narração e legenda) de cada função. Só carrega quando a pessoa abre o
// manual: as capas vêm ao abrir e cada vídeo só baixa quando a pessoa toca nele. Nada disso pesa para abrir o app.
const V = 2; // trocar quando regravar os vídeos
const BASE = new URL('../assets/manual/', import.meta.url).href;
export const VIDEOS = [
  { id: 'comecar', t: 'Começar: subir o vídeo', d: 'Responder as 2 perguntas, escolher o vídeo e deixar tudo pronto num toque.', s: 29 },
  { id: 'afinar', t: 'Afinar automático', d: 'Afinar a voz inteira e comparar o ANTES e o DEPOIS.', s: 18 },
  { id: 'painel', t: 'Painel de afinação', d: 'Mexer nota por nota: subir, descer, desfazer e ouvir.', s: 19 },
  { id: 'dupla', t: 'Dupla e trio', d: 'Quem canta, ouvir só a Voz 1 ou só a Voz 2 e o volume de cada voz.', s: 24 },
  { id: 'mix', t: 'Mix e master', d: 'Juntar voz e base, comparar e girar os botões de volume.', s: 21 },
  { id: 'cor', t: 'Cor do vídeo', d: 'Escolher o filtro e a intensidade.', s: 13 },
  { id: 'exportar', t: 'Exportar e baixar', d: 'Gerar o vídeo final e baixar para postar.', s: 12 },
  { id: 'ajuda', t: 'Botão ? (ajuda)', d: 'Saber o que cada botão faz, sem mexer em nada.', s: 13 },
];
const dur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
let ov = null, cur = -1, onPlay = null;

function build() {
  ov = document.createElement('div');
  ov.className = 'man-ov'; ov.hidden = true;
  ov.innerHTML = `<div class="man" role="dialog" aria-modal="true" aria-label="Manual do usuário">
    <header class="man-h"><b>${window.ic ? window.ic('book') : ''} Manual do usuário</b><button type="button" class="pill man-x" data-x aria-label="Fechar o manual">${window.ic ? window.ic('close') : ''} Fechar</button></header>
    <div class="man-list">
      <p class="man-sub">Vídeos curtos, com narração. Toque num para assistir (ligue o som).</p>
      ${VIDEOS.map((v, i) => `<button type="button" class="man-item" data-i="${i}"><span class="man-img"><img alt="" data-src="${BASE}${v.id}.jpg?v=${V}"><i>${window.ic ? window.ic('play') : ''}</i></span>
        <span class="man-txt"><b>${i + 1}. ${v.t}</b><small>${v.d}</small>${v.s ? `<em>${dur(v.s)}</em>` : ''}</span></button>`).join('')}
      <button type="button" class="pill man-sair" data-x>Fechar o manual e voltar ao app</button>
    </div>
    <div class="man-play" hidden>
      <div class="man-vt"><b></b></div>
      <video playsinline controls preload="none"></video>
      <div class="man-nav"><button type="button" class="pill" data-x>Fechar</button><button type="button" class="pill" data-back>← Todos os vídeos</button><button type="button" class="pill" data-next>Próximo →</button></div>
    </div>
  </div>`;
  document.getElementById('app').appendChild(ov);
  const vid = ov.querySelector('video');
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-x]')) return close();
    if (e.target.closest('[data-back]')) return list();
    if (e.target.closest('[data-next]')) return play((cur + 1) % VIDEOS.length);
    const it = e.target.closest('.man-item'); if (it) play(+it.dataset.i);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) close(); });
  vid.addEventListener('ended', () => { ov.querySelector('[data-next]').classList.add('on'); });
}
function list() {
  const vid = ov.querySelector('video'); vid.pause(); vid.removeAttribute('src'); vid.load();
  ov.querySelector('.man-play').hidden = true; ov.querySelector('.man-list').hidden = false; cur = -1;
}
function play(i) {
  cur = i; const v = VIDEOS[i], vid = ov.querySelector('video');
  ov.querySelector('.man-list').hidden = true; ov.querySelector('.man-play').hidden = false;
  ov.querySelector('.man-vt b').textContent = `${i + 1}. ${v.t}`;
  ov.querySelector('[data-next]').classList.remove('on');
  ov.querySelector('[data-next]').textContent = i + 1 < VIDEOS.length ? `Próximo: ${VIDEOS[i + 1].t} →` : 'Voltar ao primeiro →';
  vid.poster = `${BASE}${v.id}.jpg?v=${V}`;
  vid.src = `${BASE}${v.id}.mp4?v=${V}`;
  vid.play().catch(() => {});
  try { onPlay && onPlay(v.id); } catch (e) {}
}
function close() { list(); ov.hidden = true; }
export function openManual(id, cb) {
  onPlay = cb; if (!ov) build();
  ov.querySelectorAll('img[data-src]').forEach((im) => { im.src = im.dataset.src; im.removeAttribute('data-src'); });
  ov.hidden = false;
  const i = VIDEOS.findIndex((v) => v.id === id);
  if (i >= 0) play(i); else list();
}
