// Navegador que não abre a imagem do vídeo (ex.: Edge no Windows sem a extensão de HEVC, com vídeo do iPhone):
// converte o vídeo para H.264 aqui mesmo no aparelho (FFmpeg em WebAssembly, livre) e o resto do app segue igual.
// O FFmpeg (32 MB) só é baixado nesse caso.
const BASE = new URL('./vendor/ffmpeg/', import.meta.url).href;

// Internet do celular oscilou bem na hora de baixar uma peça do app ("Failed to fetch dynamically imported module"):
// tenta de novo sozinho, com outro endereço (o navegador guarda a falha do endereço antigo e não tentaria de novo).
async function importar(rel, base) {
  const u = new URL(rel, base).href;
  for (let n = 0; ; n++) {
    try { return await import(n ? u + (u.includes('?') ? '&' : '?') + 'r=' + n : u); }
    catch (e) { if (n >= 3 || !/dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch|Load failed|NetworkError/i.test(String(e && e.message))) throw e; await new Promise((r) => setTimeout(r, 1500 * (n + 1))); }
  }
}

export function canConvert() { return !!(self.crossOriginIsolated && self.SharedArrayBuffer && self.WebAssembly); }

async function loadFF() {
  const { FFmpeg } = await importar('./vendor/ffmpeg/ffmpeg/index.js', import.meta.url);
  const ff = new FFmpeg();
  await ff.load({ coreURL: BASE + 'core/ffmpeg-core.js', wasmURL: BASE + 'core/ffmpeg-core.wasm', workerURL: BASE + 'core/ffmpeg-core.worker.js' });
  return ff;
}

// Último recurso para o SOM: alguns Android (Xiaomi/Redmi/POCO, vivo) recusam o AAC tanto no decodeAudioData
// quanto no AudioDecoder (os dois usam o decodificador do próprio celular). O FFmpeg decodifica no app,
// sem depender do celular. Entrega estéreo na taxa pedida, no mesmo formato do decodeAudioData.
export async function decodeAudioSoft(bytes, ext, sr) {
  if (!canConvert()) throw new Error('sem FFmpeg (página sem isolamento)');
  const ff = await loadFF();
  try {
    await ff.writeFile('in.' + ext, bytes);
    const ret = await ff.exec(['-i', 'in.' + ext, '-vn', '-ac', '2', '-ar', String(sr), '-f', 'f32le', 'out.raw']);
    if (ret !== 0) throw new Error('FFmpeg não leu o áudio');
    const raw = await ff.readFile('out.raw');
    const n = Math.floor(raw.byteLength / 8);
    if (!n) throw new Error('FFmpeg não devolveu áudio');
    const f = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + n * 8));
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 2) { L[i] = f[j]; R[i] = f[j + 1]; }
    return { numberOfChannels: 2, getChannelData: (c) => (c ? R : L) };
  } finally { ff.terminate(); }
}

export async function toH264(file, onProgress = () => {}) {
  const { FFmpeg } = await importar('./vendor/ffmpeg/ffmpeg/index.js', import.meta.url);
  const ff = new FFmpeg();
  let dur = 0;
  ff.on('log', ({ message }) => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(message); if (m && !dur) dur = +m[1] * 3600 + +m[2] * 60 + +m[3]; });
  ff.on('progress', ({ progress, time }) => onProgress(Math.max(0, Math.min(1, dur && time > 0 ? time / 1e6 / dur : progress || 0))));
  await ff.load({ coreURL: BASE + 'core/ffmpeg-core.js', wasmURL: BASE + 'core/ffmpeg-core.wasm', workerURL: BASE + 'core/ffmpeg-core.worker.js' });
  try {
    const ext = (/\.(\w+)$/.exec(file.name || '') || [, 'mov'])[1].toLowerCase();
    await ff.writeFile('in.' + ext, new Uint8Array(await file.arrayBuffer()));
    // mesma resolução até 1080p (o lado menor), cor em 8 bits, imagem quase sem perda; o som o app já leu antes, então sai sem som
    const vf = "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)',format=yuv420p";
    const ret = await ff.exec(['-i', 'in.' + ext, '-map', '0:v:0', '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '17',
      '-an', '-movflags', '+faststart', 'out.mp4']);
    if (ret !== 0) throw new Error('não converteu o vídeo');
    const data = await ff.readFile('out.mp4');
    onProgress(1);
    return new File([data], (file.name || 'video').replace(/\.\w+$/, '') + '.mp4', { type: 'video/mp4' });
  } finally { ff.terminate(); }
}
