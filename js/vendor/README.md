# Bibliotecas de terceiros (código aberto)

- `ort/` — ONNX Runtime Web 1.24.3 (Microsoft, licença MIT). Roda a IA no navegador.
- `demucs/` — demucs-web 1.0.2 (timcsy, licença MIT), com ajustes do Afina.ai (guarda só a faixa da voz).
- `stretch.js` (era stretch.mjs) — Signalsmith Stretch 1.3.2 (Geraint Luff, licença MIT), só o motor WASM.
- `../../assets/ai/htdemucs.*.bin` — modelo HTDemucs (Meta, MIT) exportado em ONNX por timcsy/demucs-web-onnx
  (revisão 92e33df), dividido em 4 pedaços. SHA-256 do arquivo inteiro: e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077
- `../../assets/ai/spleeter-*.bin` — Spleeter 2 faixas (Deezer, licença MIT), convertido para ONNX (pesos fp16) pelo projeto
  sherpa-onnx (k2-fsa, Apache-2.0): arquivos `vocals.fp16.onnx` e `accompaniment.fp16.onnx` renomeados. É a IA leve usada no celular.
