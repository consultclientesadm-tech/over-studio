# Cover Studio

O artista sobe o vídeo de cover gravado no celular e recebe o vídeo pronto para as redes: voz afinada
(sem cara de robô), mixada e masterizada com o instrumental, corte das pausas, fade-in e fade-out, reverb
opcional, 10 filtros de cinema e saída em 1080p. Tudo com IAs grátis e de código aberto.

## Situação

| Passo | O que é | Situação |
| --- | --- | --- |
| 1 | Motor de áudio a partir do vídeo | pronto, testado com áudio de teste |
| 2 | Vídeo 1080p e os 10 filtros de cinema | a fazer |
| 3 | Tela do artista (subir, prévia, opções, baixar) | a fazer (hoje há uma página de laboratório) |
| 4 | Publicar no Plesk | a fazer |

## Como o motor funciona (`js/pipeline.js`)

Roda no navegador do artista, então não custa servidor.

1. **Áudio do vídeo:** o navegador lê o áudio do MP4/MOV direto.
2. **Separação:** IA HTDemucs (Meta) no computador, Spleeter (Deezer) no celular. Desligável para gravação só de voz.
3. **Notas e tom:** melodia quadro a quadro (YIN), trechos estáveis viram notas (como os blocos do VariAudio
   do Cubase); o tom vem da voz e do instrumental.
4. **Afinação estilo VariAudio:** o centro de cada nota vai para a nota certa; vibrato, deslizes e ataques
   ficam como a pessoa cantou; o timbre (formantes) é mantido. Força ajustável. Opção de prender no tom:
   uma nota que caiu num semitom fora do tom vai para a nota do tom mais próxima. Motor: Signalsmith Stretch.
5. **Mix e master:** EQ e compressor na voz, espaço para a voz no instrumental, compressor de mix, limitador
   (pico em −1 dB), reverb ajustável.
6. **Corte e fades:** acha o começo e o fim reais da música e devolve os pontos de corte, para o vídeo ser
   cortado igual. A duração nunca muda, então a boca continua batendo com a voz.

`analyze()` faz a parte pesada uma vez; `render()` refaz só a mixagem a cada ajuste (reverb, fades, corte).

Veio do Afina.ai (repositório `treino-vocal`, arquivos `js/studio.js` e `js/mystage.js`).

## Rodar

```
node server.js        # http://localhost:8080 (página de laboratório)
npm run sample        # gera voz e vídeo de teste em test/out (precisa de ffmpeg)
npm test              # testa o motor no Chromium (precisa do pacote playwright)
```

## Limites conhecidos

- Corrigir uma nota errada do violão não é possível com IA grátis hoje (o violão toca várias notas juntas).
- Upscale com IA precisa de placa de vídeo; a primeira versão entrega 1080p com nitidez e redução de ruído.

## Créditos (código aberto)

Ver `js/vendor/README.md`: ONNX Runtime Web (MIT), demucs-web (MIT), HTDemucs (MIT), Spleeter (MIT),
Signalsmith Stretch (MIT).
