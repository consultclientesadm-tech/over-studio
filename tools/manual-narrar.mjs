// Põe narração nos vídeos do "Manual do usuário" (depois do manual-montar). Cada legenda vira uma fala, que entra
// no ponto em que a legenda troca na tela. Se a fala passar do fim, o último quadro fica parado até ela acabar.
// 1) node tools/manual-narrar.mjs pasta_da_gravacao falas          → escreve pasta_da_gravacao/falas.tsv
// 2) KOKORO_DIR=... python tools/manual-voz.py pasta_da_gravacao/falas.tsv pasta_da_gravacao/voz
// 3) node tools/manual-narrar.mjs pasta_da_gravacao mixar          → assets/manual/*.mp4 com som
import fs from 'fs';
import { execFileSync } from 'child_process';
const [dir, modo] = process.argv.slice(2), dest = 'assets/manual';
const sessions = JSON.parse(fs.readFileSync(`${dir}/marcas.json`, 'utf8'));
const clips = sessions.flatMap((s) => s.clips);
// como se fala o que está escrito na legenda
const falar = (t) => t.replace(/…/g, '...').replace(/▶/g, 'play').replace(/ no \? /g, ' no ponto de interrogação ').replace(/ \? /g, ' ponto de interrogação ')
  .replace(/\bA IA\b/g, 'A inteligência artificial').replace(/\b(ANTES|DEPOIS|ORIGINAL|AFINADA|MIXADA)\b/g, (w) => w.toLowerCase()).replace(/Quem canta\?,/g, 'Quem canta,')
  .replace(/\b1 voz\b/g, 'uma voz');
if (modo === 'falas') {
  fs.writeFileSync(`${dir}/falas.tsv`, clips.flatMap((c) => c.caps.map((p, i) => `${c.id}_${i}\t${falar(p.text)}`)).join('\n') + '\n');
  console.log('falas.tsv:', clips.reduce((a, c) => a + c.caps.length, 0), 'falas');
} else {
  const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
  for (const c of clips) {
    const id = c.id, src = `${dest}/${id}.mp4`, mudo = `${dir}/${id}-mudo.mp4`;
    fs.copyFileSync(src, mudo);
    // momentos em que a faixa de legenda (topo do vídeo) troca de texto
    const log = execFileSync('sh', ['-c', `ffmpeg -v info -i ${mudo} -vf "crop=600:200:0:0,select='gt(scene,0.08)',showinfo" -an -f null - 2>&1`]).toString();
    const marcas = [0.25, ...[...log.matchAll(/pts_time:([0-9.]+)/g)].map((m) => +m[1] + 0.1)];
    const falas = c.caps.map((_, i) => `${dir}/voz/${id}_${i}.wav`);
    if (marcas.length !== falas.length) console.log(`  atenção ${id}: ${marcas.length} trocas de legenda para ${falas.length} falas`);
    // fala mais longa que o tempo da legenda: acelera um pouco (até 1,2x) para não ficar atrás da tela
    const vd0 = dur(mudo), tempo = falas.map((f, i) => { const slot = (i + 1 < marcas.length ? marcas[i + 1] : vd0) - marcas[Math.min(i, marcas.length - 1)] - 0.15; return Math.min(1.2, Math.max(1, dur(f) / Math.max(0.5, slot))); });
    let t = 0; const inicio = falas.map((f, i) => { const a = Math.max(marcas[Math.min(i, marcas.length - 1)], t); t = a + dur(f) / tempo[i] + 0.2; return a; });
    const vdur = dur(mudo), fim = Math.max(vdur, t + 0.3);
    const fc = falas.map((_, i) => `[${i + 1}:a]aresample=44100,atempo=${tempo[i].toFixed(3)},adelay=${Math.round(inicio[i] * 1000)}:all=1[a${i}]`).join(';')
      + `;${falas.map((_, i) => `[a${i}]`).join('')}amix=inputs=${falas.length}:normalize=0,loudnorm=I=-16:TP=-1.5,aresample=44100,apad,atrim=0:${fim.toFixed(2)}[a]`
      + `;[0:v]tpad=stop_mode=clone:stop_duration=${Math.max(0, fim - vdur).toFixed(2)}[v]`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mudo, ...falas.flatMap((f) => ['-i', f]), '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', src]);
    console.log(id, `${falas.length} falas`, `${vdur.toFixed(1)}s -> ${fim.toFixed(1)}s`, Math.round(fs.statSync(src).size / 1024) + ' KB');
  }
}
