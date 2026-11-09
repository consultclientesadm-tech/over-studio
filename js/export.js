// ===== Vídeo final =====
// Toca o vídeo cortado, desenha cada quadro com o filtro num quadro 1080p e grava junto com o áudio
// masterizado. Usa o gravador do próprio navegador (MediaRecorder): MP4 onde o navegador grava MP4
// (Chrome novo, Safari), WebM nos outros. Leva o tempo do próprio vídeo (1 minuto de vídeo = 1 minuto).
import { Grader } from './filters.js?v=18';

const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
export const exportType = () => TYPES.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

export async function exportVideo({ video, filter, amount = 1, channels, sr, start, end, onProgress = () => {} }) {
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
