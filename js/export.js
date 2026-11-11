// ===== Vídeo final =====
// Caminho principal (exportFull): lê o arquivo original quadro a quadro, aplica a cor e grava de novo com a
// mesma resolução, os mesmos quadros por segundo e a mesma qualidade (taxa de bits) do original. Não depende
// de tocar o vídeo em tempo real, então não perde quadro nem baixa a qualidade.
// Reserva (exportVideo): para navegador sem WebCodecs (iPhone com iOS antes do 16.4).
// Toca o vídeo cortado, desenha cada quadro com o filtro num quadro 1080p e grava junto com o áudio
// masterizado. Usa o gravador do próprio navegador (MediaRecorder): MP4 onde o navegador grava MP4
// (Chrome novo, Safari), WebM nos outros. Leva o tempo do próprio vídeo (1 minuto de vídeo = 1 minuto).
import { Grader } from './filters.js?v=37';

const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
export const exportType = () => TYPES.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

export async function exportVideo({ file, video, filter, amount = 1, channels, sr, start, end, onProgress = () => {} }) {
  if (file && window.VideoEncoder && window.VideoDecoder) {
    try { return await exportFull({ file, filter, amount, channels, sr, start, end, onProgress }); }
    catch (e) { if (e.final) throw e; console.warn('gravação quadro a quadro falhou, usando a reserva:', e); }
  }
  const type = exportType();
  if (!type) throw new Error('Este navegador não grava vídeo. Use o Chrome ou o Safari atualizados.');
  const portrait = video.videoHeight >= video.videoWidth;
  const canvas = document.createElement('canvas');
  canvas.width = portrait ? 1080 : 1920; canvas.height = portrait ? 1920 : 1080;
  const gr = new Grader(canvas);
  gr.set(filter, amount);
  // Áudio pronto, tocado por um "toca-discos" interno ligado direto no gravador (não sai na caixa de som)
  const C = window.AudioContext || window.webkitAudioContext;
  let ctx; try { ctx = new C({ sampleRate: sr }); } catch { ctx = new C(); }
  ctx.resume(); // ainda dentro do toque no botão: o iPhone só libera o som assim
  const buf = ctx.createBuffer(2, channels[0].length, sr);
  buf.copyToChannel(channels[0], 0); buf.copyToChannel(channels[1] || channels[0], 1);
  const dest = ctx.createMediaStreamDestination();
  const vStream = canvas.captureStream(30);
  const stream = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 14e6, audioBitsPerSecond: 256e3 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));

  const wasMuted = video.muted;
  video.pause(); video.muted = true;
  video.currentTime = start;
  await new Promise((r) => { video.addEventListener('seeked', r, { once: true }); setTimeout(r, 2000); });
  gr.draw(video);
  rec.start(1000);
  await ctx.resume();
  await video.play();
  // Começa o áudio do ponto em que o vídeo realmente está (o play pode demorar uns milissegundos)
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest);
  src.start(0, Math.max(0, video.currentTime - start));
  let done = false;
  await new Promise((resolve) => {
    const finish = () => { if (done) return; done = true; resolve(); };
    const frame = () => {
      if (done) return;
      gr.draw(video);
      onProgress(Math.min(1, (video.currentTime - start) / (end - start)));
      if (video.currentTime >= end - 0.02 || video.ended) return finish();
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(frame); else requestAnimationFrame(frame);
    };
    frame();
    src.onended = finish;
  });
  video.pause();
  rec.stop();
  await stopped;
  try { src.stop(); } catch { /* já parou */ }
  ctx.close();
  video.muted = wasMuted;
  onProgress(1);
  const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(parts, { type: type.split(';')[0] }), ext, width: canvas.width, height: canvas.height };
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// Junta os pedaços do arquivo em Blobs (ficam fora da memória do JavaScript sempre que o navegador pode).
// O começo fica guardado à parte porque o gravador volta nele no fim para escrever o tamanho final.
function blobTarget(MB) {
  const parts = []; // { pos, data: Uint8Array | Blob, n }
  const write = async ({ data, position }) => {
    for (const p of parts) {
      if (position >= p.pos && position < p.pos + p.n) {
        let u = p.data instanceof Blob ? new Uint8Array(await p.data.arrayBuffer()) : p.data;
        const k = Math.min(data.length, p.n - (position - p.pos));
        u.set(data.subarray(0, k), position - p.pos);
        p.data = parts.indexOf(p) === 0 ? u : new Blob([u]);
        if (k < data.length) await write({ data: data.subarray(k), position: position + k });
        return;
      }
    }
    const first = parts.length === 0;
    parts.push({ pos: position, n: data.length, data: first ? data.slice() : new Blob([data]) });
  };
  const target = new MB.StreamTarget(new WritableStream({ write }), { chunked: true, chunkSize: 8 * 1048576 });
  const blob = (type) => new Blob(parts.sort((a, b) => a.pos - b.pos).map((p) => p.data), { type });
  return { target, blob };
}

async function exportFull({ file, filter, amount, channels, sr, start, end, onProgress }) {
  const MB = await import('./vendor/mediabunny/mediabunny.min.js');
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  if (!vt || !(await vt.canDecode())) throw new Error('não decodifica este vídeo');
  const st = await vt.computePacketStats(120).catch(() => null);
  const srcRate = st?.averageBitrate || 16e6;
  // Mesma resolução do original (vídeo pequeno sobe para 1080p; acima de 4K desce para 4K)
  let W = vt.displayWidth, H = vt.displayHeight;
  const up = Math.max(1, 1080 / Math.min(W, H)), down = Math.min(1, 3840 / Math.max(W, H));
  const sc = up > 1 ? up : down;
  W = even(W * sc); H = even(H * sc);
  // Mesma qualidade: a taxa de bits do original (H.264 precisa de ~40% a mais que o HEVC do iPhone)
  const hevcSrc = (await vt.getCodecParameterString?.())?.startsWith('h') || vt.codec === 'hevc';
  const px = (W * H) / (1080 * 1920);
  let bitrate = Math.min(80e6, Math.max(12e6 * px, srcRate * (hevcSrc ? 1.4 : 1.1) * Math.max(1, sc * sc)));
  bitrate = Math.round(bitrate);
  let codec = await MB.getFirstEncodableVideoCodec(['avc', 'hevc'], { width: W, height: H, bitrate });
  if (!codec && Math.min(W, H) > 1080) { // aparelho que não grava 4K: grava em 1080p
    const k = 1080 / Math.min(W, H); W = even(W * k); H = even(H * k); bitrate = Math.round(Math.min(bitrate, 30e6));
    codec = await MB.getFirstEncodableVideoCodec(['avc', 'hevc'], { width: W, height: H, bitrate });
  }
  if (!codec) throw new Error('não grava vídeo neste navegador');
  const aac = await MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: sr, bitrate: 256e3 }).catch(() => false);
  const mov = !aac; // sem AAC (iPhone antigo): som sem compressão, num .mov que o iPhone abre normal

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const gr = new Grader(canvas);
  gr.set(filter, amount);
  const { target, blob } = blobTarget(MB);
  const output = new MB.Output({ format: mov ? new MB.MovOutputFormat({ fastStart: false }) : new MB.Mp4OutputFormat({ fastStart: false }), target });
  const vs = new MB.CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2, latencyMode: 'quality' });
  output.addVideoTrack(vs, { frameRate: st?.averagePacketRate ? Math.round(st.averagePacketRate) : undefined });
  const as = new MB.AudioBufferSource(mov ? { codec: 'pcm-s16' } : { codec: 'aac', bitrate: 256e3 });
  output.addAudioTrack(as);
  await output.start();

  const n = channels[0].length;
  const ab = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr });
  ab.copyToChannel(channels[0], 0); ab.copyToChannel(channels[1] || channels[0], 1);
  await as.add(ab);
  as.close();

  const sink = new MB.CanvasSink(vt, { width: W, height: H, fit: 'cover', poolSize: 2 });
  let frames = 0, slot = -1;
  const fps = st?.averagePacketRate > 10 ? Math.round(st.averagePacketRate) : 0;
  for await (const fr of sink.canvases(start, end)) {
    let t = fr.timestamp - start;
    if (t < -1e-3) continue;
    // encaixa cada quadro na grade de quadros por segundo (o iPhone grava com tempos levemente irregulares)
    if (fps) { let k = Math.round(t * fps); if (k <= slot) k = slot + 1; slot = k; t = k / fps; }
    gr.draw(fr.canvas);
    await vs.add(t, fps ? 1 / fps : fr.duration);
    frames++;
    onProgress(Math.min(0.99, t / (end - start)));
  }
  if (!frames) throw new Error('nenhum quadro lido');
  vs.close();
  await output.finalize();
  onProgress(1);
  const ext = mov ? 'mov' : 'mp4';
  return { blob: blob(mov ? 'video/quicktime' : 'video/mp4'), ext, width: W, height: H, fps: st?.averagePacketRate, bitrate };
}
