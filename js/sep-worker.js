// Ajudante da IA leve (celular): separa a voz aqui e depois é desligado, devolvendo toda a memória.
import { separateLite } from './studio.js?v=48';
onmessage = async (e) => {
  try {
    const { L, R, m1g } = e.data;
    if (m1g) self.scWasm1g = true;
    separateLite.noBed = true;
    const r = await separateLite([L, R], { onDownload: (p) => postMessage({ t: 'd', p }), onProgress: (p) => postMessage({ t: 'p', p }) });
    // sem copiar: manda os blocos de memória inteiros e o app pega só o trecho certo
    const voice = r.voice.map((x) => ({ b: x.buffer, o: x.byteOffset, n: x.length }));
    postMessage({ t: 'done', voice, L, R }, [...new Set([...voice.map((v) => v.b), L.buffer, R.buffer])]);
  } catch (err) { postMessage({ t: 'err', m: err.message || String(err) }); }
};
postMessage({ t: 'ready' });
