// ===== Tirar o áudio de dentro de um MP4/MOV sem depender do navegador =====
// O Safari do iPhone não lê o áudio de um .MOV direto ("Decoding failed"), mas lê AAC solto (ADTS).
// Aqui lemos o "índice" do arquivo (caixa moov), achamos a trilha de áudio AAC, juntamos os pedaços de
// áudio (lidos aos poucos do arquivo, sem carregar o vídeo inteiro na memória) e montamos um AAC solto.
// Também lemos a lista de edição (elst) para saber quantas amostras de "aquecimento" do AAC pular,
// senão a voz sairia uns milissegundos atrasada em relação à boca.

const u32 = (v, o) => v.getUint32(o);
const fourcc = (v, o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
const read = async (file, a, b) => new DataView(await file.slice(a, b).arrayBuffer());

// Caixas de um trecho: [{ type, start (do conteúdo), end }]
function boxes(v, start = 0, end = v.byteLength) {
  const out = [];
  for (let o = start; o + 8 <= end; ) {
    let size = u32(v, o), head = 8;
    const type = fourcc(v, o + 4);
    if (size === 1) { size = Number(v.getBigUint64(o + 8)); head = 16; } else if (size === 0) size = end - o;
    if (size < head) break;
    out.push({ type, start: o + head, end: Math.min(end, o + size) });
    o += size;
  }
  return out;
}
const child = (v, box, type) => boxes(v, box.start, box.end).find((b) => b.type === type);
const path = (v, box, ...types) => types.reduce((b, t) => b && child(v, b, t), box);

// Acha a caixa moov no arquivo (pode estar no começo ou no fim)
async function findMoov(file) {
  for (let o = 0; o + 8 <= file.size; ) {
    const h = await read(file, o, o + 16);
    let size = u32(h, 0);
    const type = fourcc(h, 4);
    if (size === 1) size = Number(h.getBigUint64(8)); else if (size === 0) size = file.size - o;
    if (type === 'moov') return read(file, o, o + size);
    if (size < 8) break;
    o += size;
  }
  throw new Error('não achei o índice do vídeo (moov)');
}

// Lê o tamanho variável dos descritores do esds
function descLen(v, o) { let n = 0, k = 0, b; do { b = v.getUint8(o + k++); n = (n << 7) | (b & 0x7f); } while (b & 0x80 && k < 4); return [n, k]; }

function audioConfig(v, entry) {
  // procura a caixa esds dentro da descrição do áudio (no MOV ela pode estar dentro de "wave")
  let e = -1;
  for (let o = entry.start; o < entry.end - 4; o++) if (fourcc(v, o) === 'esds') { e = o + 4; break; }
  if (e < 0) throw new Error('o áudio deste vídeo não é AAC');
  let o = e + 4; // versão e flags
  if (v.getUint8(o++) !== 0x03) throw new Error('esds inesperado');
  let [, k] = descLen(v, o); o += k;
  o += 2; const fl = v.getUint8(o++);
  if (fl & 0x80) o += 2;
  if (fl & 0x40) o += 1 + v.getUint8(o);
  if (fl & 0x20) o += 2;
  if (v.getUint8(o++) !== 0x04) throw new Error('esds sem configuração');
  [, k] = descLen(v, o); o += k + 13;
  if (v.getUint8(o++) !== 0x05) throw new Error('esds sem configuração do AAC');
  let ascLen; [ascLen, k] = descLen(v, o); o += k;
  const asc = new Uint8Array(v.buffer.slice(v.byteOffset + o, v.byteOffset + o + Math.max(2, ascLen)));
  const b0 = v.getUint8(o), b1 = v.getUint8(o + 1);
  const aot = b0 >> 3, sfi = ((b0 & 7) << 1) | (b1 >> 7);
  let ch = (b1 >> 3) & 15, rate = RATES[sfi] || 0;
  if (sfi === 15) { // frequência escrita por extenso (24 bits)
    const b2 = v.getUint8(o + 2), b3 = v.getUint8(o + 3), b4 = v.getUint8(o + 4);
    rate = ((b1 & 0x7f) << 17) | (b2 << 9) | (b3 << 1) | (b4 >> 7);
    ch = (b4 >> 3) & 15;
  }
  if (aot < 1 || aot > 42 || !rate) throw new Error(`tipo de AAC não suportado (${aot})`);
  // ADTS (o AAC solto que o decodeAudioData lê) só representa AAC comum com frequência da tabela
  return { aot, sfi, ch: ch || 2, rate, asc, adtsOk: aot >= 1 && aot <= 4 && sfi <= 12 };
}
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export async function extractAac(file, maxSec = 0) {
  const v = await findMoov(file);
  const moov = { start: 8, end: v.byteLength };
  const mvhd = child(v, moov, 'mvhd');
  const movieScale = v.getUint8(mvhd.start) === 1 ? u32(v, mvhd.start + 20) : u32(v, mvhd.start + 12);
  for (const trak of boxes(v, moov.start, moov.end).filter((b) => b.type === 'trak')) {
    const hdlr = path(v, trak, 'mdia', 'hdlr');
    if (!hdlr || fourcc(v, hdlr.start + 8) !== 'soun') continue;
    const mdhd = path(v, trak, 'mdia', 'mdhd');
    const scale = v.getUint8(mdhd.start) === 1 ? u32(v, mdhd.start + 20) : u32(v, mdhd.start + 12);
    const stbl = path(v, trak, 'mdia', 'minf', 'stbl');
    const stsd = child(v, stbl, 'stsd');
    const entry = boxes(v, stsd.start + 8, stsd.end)[0];
    if (!entry || entry.type !== 'mp4a') throw new Error(`o áudio deste vídeo não é AAC (${entry?.type})`);
    const cfg = audioConfig(v, entry);
    // tamanhos das amostras
    const stsz = child(v, stbl, 'stsz');
    const fixed = u32(v, stsz.start + 4), all = u32(v, stsz.start + 8);
    // vídeo mais longo que o limite: só lê o áudio dos primeiros minutos (cada quadro AAC tem 1024 amostras).
    // Antes lia e decodificava o áudio inteiro e só depois cortava: no iPhone isso era memória à toa.
    // MP4 "fragmentado" (alguns apps de gravação): o índice não lista o áudio; deixa o leitor do arquivo inteiro tentar
    if (!all) throw new Error('índice sem amostras de áudio (MP4 fragmentado)');
    const fullDur = (all * 1024) / scale;
    const count = maxSec > 0 ? Math.min(all, Math.ceil(((maxSec + 3) * scale) / 1024)) : all;
    const size = (i) => (fixed || u32(v, stsz.start + 12 + 4 * i));
    // onde começa cada pedaço (chunk)
    const stco = child(v, stbl, 'stco'), co64 = child(v, stbl, 'co64');
    const nch = u32(v, (stco || co64).start + 4);
    const chunkOff = (c) => (stco ? u32(v, stco.start + 8 + 4 * c) : Number(v.getBigUint64(co64.start + 8 + 8 * c)));
    // quantas amostras em cada pedaço
    const stsc = child(v, stbl, 'stsc');
    const ns = u32(v, stsc.start + 4);
    const runs = [];
    for (let i = 0; i < ns; i++) runs.push({ first: u32(v, stsc.start + 8 + 12 * i) - 1, per: u32(v, stsc.start + 12 + 12 * i) });
    // monta a lista (pedaço → amostras) e lê o arquivo pedaço a pedaço
    const frames = [];
    let s = 0;
    for (let c = 0, r = 0; c < nch && s < count; c++) {
      while (r + 1 < runs.length && runs[r + 1].first <= c) r++;
      let off = chunkOff(c), len = 0;
      const sizes = [];
      for (let k = 0; k < runs[r].per && s < count; k++, s++) { sizes.push(size(s)); len += size(s); }
      frames.push({ off, len, sizes });
    }
    const total = frames.reduce((a, f) => a + f.len + 7 * f.sizes.length, 0);
    const out = new Uint8Array(total);
    const sizes = new Uint32Array(s); // tamanho de cada quadro (para o leitor alternativo tirar o cabeçalho ADTS)
    let p = 0, fi = 0;
    for (let i = 0; i < frames.length; i += 64) { // lê 64 pedaços por vez
      const group = frames.slice(i, i + 64);
      const datas = await Promise.all(group.map((f) => file.slice(f.off, f.off + f.len).arrayBuffer()));
      group.forEach((f, gi) => {
        const d = new Uint8Array(datas[gi]);
        let q = 0;
        for (const sz of f.sizes) {
          const L = sz + 7; // cabeçalho ADTS de 7 bytes + o quadro AAC
          sizes[fi++] = sz;
          out[p] = 0xff; out[p + 1] = 0xf1;
          out[p + 2] = (((cfg.aot - 1) & 3) << 6) | ((cfg.sfi & 15) << 2) | ((cfg.ch >> 2) & 1);
          out[p + 3] = ((cfg.ch & 3) << 6) | (L >> 11);
          out[p + 4] = (L >> 3) & 0xff;
          out[p + 5] = ((L & 7) << 5) | 0x1f;
          out[p + 6] = 0xfc;
          out.set(d.subarray(q, q + sz), p + 7);
          p += L; q += sz;
        }
      });
    }
    // lista de edição: atraso inicial (edição vazia) e amostras de aquecimento a pular
    let delay = 0, skip = 0;
    const elst = path(v, trak, 'edts', 'elst');
    if (elst) {
      const ver = v.getUint8(elst.start), n = u32(v, elst.start + 4);
      let o = elst.start + 8;
      for (let i = 0; i < n; i++) {
        const dur = ver === 1 ? Number(v.getBigUint64(o)) : u32(v, o);
        const mt = ver === 1 ? Number(v.getBigInt64(o + 8)) : v.getInt32(o + 4);
        o += ver === 1 ? 20 : 12;
        if (mt === -1) { delay += dur / movieScale; continue; }

        skip = mt / scale; break;
      }
    }
    // lista de edição estranha (vídeo reeditado por outro app) não pode empurrar o áudio por minutos
    if (!(delay >= 0 && delay < 2)) delay = 0;
    if (!(skip >= 0 && skip < 2)) skip = 0;
    return { adts: p === out.length ? out : out.subarray(0, p), sizes: sizes.subarray(0, fi), cfg, delay, skip, fullDur };
  }
  throw new Error('este vídeo não tem áudio');
}

// Leitor alternativo (WebCodecs): em alguns Android (vivo, Xiaomi/Redmi, outros com chip MediaTek) o
// decodeAudioData do Chrome recusa o AAC ("Unable to decode audio data"), mas o AudioDecoder lê os mesmos
// quadros. Também lê HE-AAC e frequências fora da tabela do ADTS.
async function decodeWebCodecs(adts, sizes, cfg, sr) {
  if (typeof AudioDecoder === 'undefined') throw new Error('sem AudioDecoder');
  const conf = { codec: 'mp4a.40.' + cfg.aot, sampleRate: cfg.rate, numberOfChannels: cfg.ch, description: cfg.asc };
  const sup = await AudioDecoder.isConfigSupported(conf).catch(() => null);
  if (!sup || !sup.supported) throw new Error('AudioDecoder não lê este AAC');
  const parts = [[], []];
  let n = 0, outRate = 0, err = null;
  const dec = new AudioDecoder({
    output: (d) => {
      try {
        outRate = d.sampleRate;
        const f = d.numberOfFrames, nc = d.numberOfChannels;
        for (let c = 0; c < 2; c++) {
          const a = new Float32Array(f);
          d.copyTo(a, { planeIndex: Math.min(c, nc - 1), format: 'f32-planar' });
          parts[c].push(a);
        }
        n += f;
      } catch (e) { err = err || e; } finally { d.close(); }
    },
    error: (e) => { err = err || e; },
  });
  dec.configure(conf);
  const us = 1e6 * 1024 / cfg.rate;
  for (let i = 0, p = 0; i < sizes.length; i++) {
    if (err) break;
    const sz = sizes[i];
    dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(i * us), data: adts.subarray(p + 7, p + 7 + sz) }));
    p += sz + 7;
    while (dec.decodeQueueSize > 48 && !err) await new Promise((r) => setTimeout(r, 0));
  }
  if (!err) await dec.flush().catch((e) => { err = err || e; });
  try { dec.close(); } catch {}
  if (err) throw err instanceof Error ? err : new Error(String(err?.message || err));
  if (!n || !outRate) throw new Error('AudioDecoder não devolveu áudio');
  const join = (arr) => { const o = new Float32Array(n); let q = 0; for (const a of arr) { o.set(a, q); q += a.length; } return o; };
  let L = join(parts[0]), R = join(parts[1]);
  if (outRate !== sr) { // muda a taxa de amostra para a do estúdio
    const len = Math.max(1, Math.round(n * sr / outRate));
    const oc = new OfflineAudioContext(2, len, sr);
    const b = oc.createBuffer(2, n, outRate);
    b.copyToChannel(L, 0); b.copyToChannel(R, 1);
    const src = oc.createBufferSource(); src.buffer = b; src.connect(oc.destination); src.start();
    const r = await oc.startRendering();
    L = r.getChannelData(0); R = r.getChannelData(1);
  }
  return { numberOfChannels: 2, getChannelData: (c) => (c ? R : L) };
}

// Decodifica o AAC solto no tamanho de amostra pedido, já aplicando o atraso e o pulo do aquecimento
export async function decodeVideoAudio(file, sr, maxSec = 0) {
  const { adts, sizes, cfg, delay, skip, fullDur } = await extractAac(file, maxSec);
  const ctx = new OfflineAudioContext(2, 1, sr);
  let ab = null, err1 = null;
  if (cfg.adtsOk) {
    // o decodeAudioData "consome" o buffer que recebe; se der para tentar o leitor alternativo depois,
    // entrega uma cópia (alguns MB) para o original continuar inteiro
    const alt = typeof AudioDecoder !== 'undefined';
    const whole = adts.byteOffset === 0 && adts.byteLength === adts.buffer.byteLength;
    const buf = alt ? adts.slice().buffer : whole ? adts.buffer : adts.buffer.slice(adts.byteOffset, adts.byteOffset + adts.byteLength);
    try { ab = await ctx.decodeAudioData(buf); } catch (e) { err1 = e; console.warn('decodeAudioData recusou o AAC:', e && e.message); }
  }
  let err2 = null, err3 = null;
  if (!ab) {
    try { ab = await decodeWebCodecs(adts, sizes, cfg, sr); } catch (e) { err2 = e; console.warn('leitor alternativo falhou:', e && e.message); }
  }
  // Xiaomi/Redmi/POCO e vivo: os dois leitores do celular recusam o AAC. O FFmpeg do app lê sem depender dele.
  if (!ab && cfg.adtsOk) {
    try { ab = await (await import('./convert.js?v=38')).decodeAudioSoft(adts, 'aac', sr); } catch (e) { err3 = e; console.warn('FFmpeg falhou no áudio:', e && e.message); }
  }
  if (!ab) {
    const err = err1 || err2 || err3 || new Error('Unable to decode audio data');
    const m = (x) => String((x && x.message) || x || '-').slice(0, 40);
    err.causa = `aac ${cfg.aot}/${cfg.rate}/${cfg.ch} wc:${m(err2)} ff:${m(err3)}`;
    err.tentouFF = true;
    throw err;
  }
  const cut = Math.round(skip * sr), pad = Math.round(delay * sr);
  const take = (c) => {
    const src = ab.getChannelData(Math.min(c, ab.numberOfChannels - 1)).subarray(cut);
    const o = new Float32Array(src.length + pad); o.set(src, pad); return o;
  };
  const out = [take(0), take(1)];
  out.fullDur = fullDur;
  return out;
}
