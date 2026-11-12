import subprocess,sys
V='/mnt/project-files/studio-cover/vsl-nova.mp4'
OUT='/mnt/project-files/studio-cover-instagram/reels'
import os; os.makedirs(OUT,exist_ok=True)
S16=(138.98,146.55)
R={
   'reel2-afinacao':([(59.73,100.5),S16],'h2.png'),
   'reel3-separa-voz':([(44.33,59.73),S16],'h3.png'),
   'reel4-mix-cor':([(101.0,138.9),S16],'h4.png')}
for name,(segs,hook) in R.items():
    inputs=['-i',V,'-loop','1','-t','3','-i','fim.png']
    if hook: inputs+=['-loop','1','-t','3','-i',hook]
    fc=[];parts=[]
    for k,(a,b) in enumerate(segs):
        d=b-a
        fc.append(f"[0:v]trim={a}:{b},setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,fps=30,format=yuv420p[v{k}]")
        fc.append(f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.05,afade=t=out:st={d-0.15}:d=0.15[a{k}]")
        parts.append(f"[v{k}][a{k}]")
    fc.append("[1:v]scale=1080:1920,fps=30,format=yuv420p,fade=t=in:d=0.3[vf]")
    fc.append("anullsrc=r=48000:cl=stereo,atrim=0:3[af]")
    parts.append("[vf][af]")
    fc.append(''.join(parts)+f"concat=n={len(parts)}:v=1:a=1[vc][ac]")
    if hook:
        fc.append("[2:v]format=rgba,fade=t=out:st=2.4:d=0.5:alpha=1[hk]")
        fc.append("[vc][hk]overlay=0:0:enable='lt(t,3)'[vo]")
        vout='[vo]'
    else: vout='[vc]'
    cmd=['ffmpeg','-v','error','-y',*inputs,'-filter_complex',';'.join(fc),'-map',vout,'-map','[ac]','-c:v','libx264','-preset','medium','-crf','19','-c:a','aac','-b:a','160k','-ar','48000','-movflags','+faststart',f'{OUT}/{name}.mp4']
    subprocess.run(cmd,check=True)
    print(name, subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'{OUT}/{name}.mp4'],capture_output=True,text=True).stdout.strip())
