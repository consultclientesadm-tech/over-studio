// Navegador que não abre a imagem do vídeo (ex.: Edge no Windows sem a extensão de HEVC, com vídeo do iPhone):
// converte o vídeo para H.264 aqui mesmo no aparelho (FFmpeg em WebAssembly, livre) e o resto do app segue igual.
// O FFmpeg (32 MB) só é baixado nesse caso.
const BASE = new URL('./vendor/ffmpeg/', import.meta.url).href;

export function canConvert() { return !!(self.crossOriginIsolated && self.SharedArrayBuffer && self.WebAssembly); }

export async function toH264(file, onProgress = () => {}) {
  const { FFmpeg } = await import('./vendor/ffmpeg/ffmpeg/index.js');
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
