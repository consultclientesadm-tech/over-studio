// Ajudante da IA leve (celular): separa a voz aqui e depois é desligado, devolvendo toda a memória.
import { separateLite } from './studio.js?v=19';
onmessage = async (e) => {
  try {
    const { L, R } = e.data;
    const r = await separateLite([L, R], { onDownload: (p) => postMessage({ t: 'd', p }), onProgress: (p) => postMessage({ t: 'p', p }) });
    const voice = r.voice.map((x) => x.slice()), bed = r.bed;
    postMessage({ t: 'done', voice, bed }, [...voice, ...bed].map((x) => x.buffer));
  } catch (err) { postMessage({ t: 'err', m: err.message || String(err) }); }
};
