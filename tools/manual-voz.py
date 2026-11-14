# Narração do "Manual do usuário" com a mesma voz da VSL (Kokoro, voz pm_alex), grátis e no próprio computador.
# Precisa de: pip install kokoro-onnx soundfile, e dos arquivos kokoro-v1.0.onnx e voices-v1.0.bin
# (github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0) na pasta indicada em KOKORO_DIR.
# Uso: KOKORO_DIR=pasta python tools/manual-voz.py falas.tsv pasta_saida   (falas.tsv sai do manual-narrar.mjs)
import os, sys, soundfile as sf
from kokoro_onnx import Kokoro
d = os.environ.get('KOKORO_DIR', '.')
k = Kokoro(os.path.join(d, 'kokoro-v1.0.onnx'), os.path.join(d, 'voices-v1.0.bin'))
out = sys.argv[2]
import os; os.makedirs(out, exist_ok=True)
for line in open(sys.argv[1], encoding='utf8'):
    line = line.rstrip('\n')
    if not line: continue
    i, t = line.split('\t', 1)
    a, sr = k.create(t, voice='pm_alex', speed=1.12, lang='pt-br')
    sf.write(f'{out}/{i}.wav', a, sr)
    print(i, round(len(a)/sr, 2))
