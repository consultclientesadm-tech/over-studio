// Põe narração nos vídeos do "Manual do usuário". Cada legenda vira uma fala (arquivos <id>_<n>.mp3, voz pt-BR
// gerada com edge-tts) que entra no ponto em que a legenda troca. Se a fala passar do fim, o último quadro fica parado.
// Uso: node tools/manual-narrar.mjs pasta_com_os_mp3
import fs from 'fs';
import { execFileSync } from 'child_process';
const dir = process.argv[2], dest = 'assets/manual';
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
for (const id of ['comecar', 'afinar', 'painel', 'mix', 'cor', 'exportar', 'ajuda', 'dupla']) {
  const src = `${dest}/${id}.mp4`, mudo = `${dir}/${id}-mudo.mp4`;
  if (!fs.existsSync(mudo)) fs.copyFileSync(src, mudo); // guarda o original sem som
  // momentos em que a faixa de legenda (topo do vídeo) troca de texto
  const log = execFileSync('sh', ['-c', `ffmpeg -v info -i ${mudo} -vf "crop=600:200:0:0,select='gt(scene,0.08)',showinfo" -an -f null - 2>&1`]).toString();
  const marcas = [0.3, ...[...log.matchAll(/pts_time:([0-9.]+)/g)].map((m) => +m[1] + 0.15)];
  const falas = marcas.map((_, i) => `${dir}/${id}_${i}.mp3`).filter((f) => fs.existsSync(f));
  let t = 0; const inicio = falas.map((f, i) => { const a = Math.max(marcas[i], t); t = a + dur(f) + 0.15; return a; });
  const vdur = dur(mudo), fim = Math.max(vdur, t + 0.4);
  const ins = falas.flatMap((f) => ['-i', f]);
  const fc = falas.map((_, i) => `[${i + 1}:a]adelay=${Math.round(inicio[i] * 1000)}:all=1[a${i}]`).join(';')
    + `;${falas.map((_, i) => `[a${i}]`).join('')}amix=inputs=${falas.length}:normalize=0,loudnorm=I=-16:TP=-1.5,apad,atrim=0:${fim.toFixed(2)}[a]`
    + `;[0:v]tpad=stop_mode=clone:stop_duration=${Math.max(0, fim - vdur).toFixed(2)}[v]`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mudo, ...ins, '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', src]);
  console.log(id, `${falas.length} falas`, `${vdur.toFixed(1)}s -> ${fim.toFixed(1)}s`, Math.round(fs.statSync(src).size / 1024) + ' KB');
}
