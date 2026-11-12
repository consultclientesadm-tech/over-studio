#!/usr/bin/env python3
"""Gera as artes do Instagram do Studio Cover (1080x1350) em HTML.
Depois: node tools/instagram/fotografar.js <saida>"""
import os, random, json, sys

AQUI = os.path.dirname(os.path.abspath(__file__))
LP = 'file://' + os.path.abspath(os.path.join(AQUI, '..', '..', 'site', 'assets', 'lp')) + '/'
LOGO = open(os.path.join(AQUI, '..', '..', 'site', 'assets', 'logo.svg')).read()
LOGO_P = LOGO.replace('<rect width="512" height="512" fill="#050506"/>', '').replace('id="h"', 'id="hx"').replace('url(#h)', 'url(#hx)')

SB = '<div class="sb"><span class="t">9:41</span><span class="ics"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg viewBox="0 0 16 12"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.3-1.3A10.3 10.3 0 0 0 8 .3 10.3 10.3 0 0 0 .7 3.3L2 4.6a8.5 8.5 0 0 1 6-2.4Zm0 3.6c1.3 0 2.6.5 3.5 1.4l1.3-1.3A6.8 6.8 0 0 0 8 3.9a6.8 6.8 0 0 0-4.8 2l1.3 1.3c1-.9 2.2-1.4 3.5-1.4Zm0 3.6c-.6 0-1.1.2-1.5.6L8 11.5l1.5-1.5c-.4-.4-.9-.6-1.5-.6Z"/></svg><svg viewBox="0 0 27 12"><rect x=".5" y=".5" width="23" height="11" rx="3.2" fill="none" stroke="#fff" stroke-opacity=".5"/><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="24.6" y="4" width="1.8" height="4" rx=".9" fill-opacity=".5"/></svg></span></div>'


def phone(img, w, x, y, rot='', full=False, z=5):
    t = f'transform:{rot};' if rot else ''
    return (f'<div class="iph{" full" if full else ""}" style="--w:{w}px;left:{x}px;top:{y}px;{t}z-index:{z}">'
            '<i class="bt a"></i><i class="bt v1"></i><i class="bt v2"></i><i class="bt p"></i><div class="bz"></div>'
            f'<div class="scr">{SB}<div class="isl"></div><div class="vw"><img src="{LP}{img}.webp"></div><div class="hi"></div></div><div class="gl"></div></div>')


def onda(x, y, n=28, h=90, seed=1, gap=8, w=8):
    r = random.Random(seed)
    bars = ''.join(f'<i style="height:{int(h*(0.18+0.82*min(1,abs(r.gauss(0,0.55)))) if i%7 else h*0.95)}px;width:{w}px"></i>' for i in range(n))
    return f'<div class="onda" style="left:{x}px;top:{y}px;height:{h}px;gap:{gap}px">{bars}</div>'


def glow(x, y, s=1100):
    return f'<div class="glow" style="left:{x-s//2}px;top:{y-s//2}px;width:{s}px;height:{s}px"></div>'


def holo(x, y, s):
    return f'<div class="holo" style="left:{x-s//2}px;top:{y-s//2}px;width:{s}px;height:{s}px"></div>'


def bloco(x, y, w, html, extra=''):
    return f'<div class="bloco" style="left:{x}px;top:{y}px;width:{w}px;{extra}">{html}</div>'


def centro(html, extra=''):
    return f'<div class="bloco centro" style="left:64px;right:64px;top:150px;bottom:{CB}px;{extra}">{html}</div>'


CB = 150


def lista(itens, ini=1):
    return '<div class="lista">' + ''.join(
        f'<div class="it"><div class="n">{ini+i:02d}</div><div class="tx"><b>{a}</b>{b}</div></div>' for i, (a, b) in enumerate(itens)) + '</div>'


POSTS = []


def post(titulo, tipo, legenda, slides):
    POSTS.append({'titulo': titulo, 'tipo': tipo, 'legenda': legenda, 'slides': slides})


def S(inner, am=False):
    return {'inner': inner, 'am': am}

# ---------------------------------------------------------------- conteúdo
# 1 — apresentação (carrossel)
post('Apresentação: estúdio no celular', 'carrossel',
     '''Você canta bem. Mas o vídeo que você grava no celular não mostra isso. 🎙️

O Studio Cover é um estúdio inteiro dentro do seu celular: você sobe o vídeo do jeito que gravou e ele devolve afinado, mixado, masterizado e com cor de cinema. Em minutos, sem estúdio, sem editor, sem computador.

Arrasta pro lado e vê como funciona 👉

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(760, 760) + holo(760, 760, 900) +
      bloco(64, 170, 560, '<span class="k">● Novo app</span><h1 style="margin-top:34px;font-size:70px">Seu cover com som de <em>estúdio</em></h1><p style="margin-top:30px">E cara de cinema. Direto do seu celular.</p>') +
      phone('home', 410, 600, 210, 'rotate(6deg)') + onda(64, 1060, 26, 110, 3)),
    S(glow(540, 900) + centro('<span class="k">O problema</span><h2 style="margin-top:30px">Você canta bem. O <em>celular</em> é que te entrega.</h2>' + '<div style="margin-top:64px">' + '<p>Voz abafada, violão engolindo o canto, aquela nota que escapou no refrão e uma cor amarelada de quarto.</p><p style="margin-top:30px"><b>Aí o vídeo fica na galeria e nunca vai pro ar.</b></p>' + '</div>')),
    S(glow(300, 700) + phone('arrastar', 400, 620, 230, 'rotate(-4deg)') +
      bloco(64, 260, 540, '<span class="k">Passo 1</span><h2 style="margin-top:30px">Sobe o vídeo do jeito que gravou</h2><p style="margin-top:28px">MP4 ou MOV do celular, até 3 minutos. Voz e violão juntos, sem problema.</p>')),
    S(glow(300, 700) + phone('afinacao', 400, 620, 230, 'rotate(4deg)') +
      bloco(64, 260, 540, '<span class="k">Passo 2</span><h2 style="margin-top:30px">A IA <em>afina</em> sua voz</h2><p style="margin-top:28px">No tom da música, mantendo o seu vibrato e o seu jeito de cantar.</p>')),
    S(glow(300, 700) + phone('mix', 400, 620, 230, 'rotate(-4deg)') +
      bloco(64, 260, 540, '<span class="k">Passo 3 e 4</span><h2 style="margin-top:30px">Mixa, masteriza e dá <em>cor de cinema</em></h2><p style="margin-top:28px">Voz na frente, violão no lugar, reverb na medida e imagem com cara de clipe.</p>')),
    S(glow(540, 680, 1300) + centro('<span class="k">Passo 5</span><h1 style="margin-top:36px">Baixa pronto em <em>1080p</em> e posta.</h1><p style="margin-top:36px">Teste grátis com 1 vídeo, por nossa conta.</p><div style="margin-top:60px"><span class="btn">Link na bio →</span></div>', 'text-align:left') +
      onda(64, 1120, 40, 80, 9), True),
])

# 2 — dor (único)
post('Dor: o vídeo que nunca vai pro ar', 'post',
     '''Quantos covers seus estão parados na galeria agora? 📱

Você gravou, ouviu de volta e pensou: “não, assim não posto”. Não é a sua voz. É o áudio do celular, que chega abafado, sem brilho, com o violão por cima e sem nenhum tratamento.

O Studio Cover resolve isso no próprio celular: afina, mixa, masteriza e coloca cor de cinema. Você só escolhe e baixa.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(540, 520, 1200) + centro('<span class="k">Seja sincero</span><h1 style="margin-top:36px;font-size:84px">Quantos covers seus estão <em>parados</em> na galeria?</h1>' + '<div style="margin-top:64px">' + '<p>Não é falta de talento. É o áudio do celular que chega sem tratamento nenhum.</p><p style="margin-top:28px"><b>O Studio Cover trata pra você.</b></p>' + '</div>') + onda(64, 1120, 40, 80, 4)),
])

# 3 — 5 sinais (carrossel)
post('5 sinais de que o áudio te entrega', 'carrossel',
     '''5 sinais de que o áudio do seu cover está te entregando 👇

1. A voz sai abafada, “mastigada”
2. Uma nota escapa justo no refrão
3. O violão engole a sua voz
4. Começa com silêncio e termina cortado
5. A imagem fica amarelada, com cara de quarto

Se você se viu em 2 ou mais, salva esse post. O Studio Cover corrige os 5 automaticamente, no celular.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(540, 600, 1300) + centro('<span class="k">Salva esse post</span><h1 style="margin-top:36px;font-size:92px"><em>5 sinais</em> de que o áudio do seu cover te entrega</h1>') + onda(64, 1120, 40, 80, 5), True),
    S(glow(540, 700) + centro('<span class="k">Sinal 01</span><h2 style="margin-top:30px">A voz sai <em>abafada</em></h2><p style="margin-top:30px">O microfone do celular grava tudo plano, sem graves e sem brilho. Parece que você cantou dentro de uma caixa.</p>' + '<div style="margin-top:64px">' + '<div class="card"><p style="font-size:32px"><b>No app:</b> equalizador, compressor e master deixam a voz cheia e na frente.</p></div>' + '</div>')),
    S(glow(540, 700) + centro('<span class="k">Sinal 02</span><h2 style="margin-top:30px">A nota escapa no <em>refrão</em></h2><p style="margin-top:30px">Justo na parte mais alta, a que todo mundo espera. E dá vontade de apagar o vídeo inteiro.</p>' + '<div style="margin-top:64px">' + '<div class="card"><p style="font-size:32px"><b>No app:</b> afinação automática no tom da música, sem voz robótica.</p></div>' + '</div>')),
    S(glow(540, 700) + centro('<span class="k">Sinal 03</span><h2 style="margin-top:30px">O violão <em>engole</em> a voz</h2><p style="margin-top:30px">Celular perto do violão, longe da boca. A voz fica lá atrás e ninguém entende a letra.</p>' + '<div style="margin-top:64px">' + '<div class="card"><p style="font-size:32px"><b>No app:</b> a IA separa voz e instrumental e você ajusta o volume de cada um.</p></div>' + '</div>')),
    S(glow(540, 700) + centro('<span class="k">Sinal 04</span><h2 style="margin-top:30px">Silêncio no começo, <em>corte seco</em> no fim</h2><p style="margin-top:30px">Aqueles segundos ajeitando o celular e o final que termina do nada.</p>' + '<div style="margin-top:64px">' + '<div class="card"><p style="font-size:32px"><b>No app:</b> corta o silêncio do começo e do fim, com fade-in e fade-out suaves.</p></div>' + '</div>')),
    S(glow(540, 700) + centro('<span class="k">Sinal 05</span><h2 style="margin-top:30px">Imagem com <em>cara de quarto</em></h2><p style="margin-top:30px">Luz amarela, pele apagada, cor lavada. O som pode estar ótimo e o vídeo ainda parece amador.</p>' + '<div style="margin-top:64px">' + '<div class="card"><p style="font-size:32px"><b>No app:</b> colorista automático e filtros de cinema. É só tocar e comparar.</p></div>' + '</div>')),
    S(glow(540, 620, 1300) + centro('<span class="k">Se viu em 2 ou mais?</span><h1 style="margin-top:36px">O Studio Cover corrige <em>os 5</em> no celular.</h1><p style="margin-top:36px">Teste grátis com 1 vídeo.</p><div style="margin-top:56px"><span class="btn">Link na bio →</span></div>'), True),
])

# 4 — afinação (único)
post('Função: afinação automática', 'post',
     '''Afinação automática que não deixa sua voz com cara de robô 🎯

O Studio Cover encontra o tom da música e coloca cada nota da sua voz no lugar, mantendo o vibrato e o seu jeito de cantar. Depois você compara ANTES e DEPOIS com um toque e, se quiser, desfaz.

Quer mexer nota por nota? Tem o painel de notas também.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(720, 700) + holo(720, 700, 820) + bloco(64, 200, 540, '<span class="k">Afinação</span><h1 style="margin-top:34px;font-size:68px">Afinado. <em>Sem voz de robô.</em></h1><p style="margin-top:30px">A IA acha o tom da música e coloca cada nota no lugar, mantendo o seu vibrato.</p>') +
      phone('afinacao', 420, 600, 200, 'rotate(5deg)') + onda(64, 1080, 24, 100, 7)),
])

# 5 — quanto custa (carrossel)
post('Quanto custa um cover profissional', 'carrossel',
     '''Quanto custa fazer um cover com qualidade profissional? 💸

Estúdio para gravar a voz separada, alguém para mixar e masterizar, alguém para sincronizar o áudio com o vídeo e tratar a cor. Por cover. Toda vez.

No Studio Cover é R$ 297 por um ano inteiro (ou 10x de R$ 35,69), quantos vídeos você quiser. E você testa grátis antes com 1 vídeo.

Os valores de estúdio variam por cidade; é uma média do que a gente vê no mercado.

🔗 Link na bio.''', [
    S(glow(540, 620, 1300) + centro('<span class="k">Faz a conta</span><h1 style="margin-top:36px;font-size:88px">Quanto custa <em>um</em> cover profissional?</h1>') + onda(64, 1120, 40, 80, 11), False),
    S(glow(540, 700) + centro('<span class="k">Do jeito tradicional</span><h2 style="margin-top:30px;font-size:54px">A conta de cada vídeo</h2>' + '<div style="height:56px"></div>' + lista([('Estúdio para gravar a voz', 'Hora de estúdio, deslocamento, agenda.'),
                                 ('Mixagem e master', 'Alguém para tratar e equilibrar a voz.'),
                                 ('Sincronizar e editar', 'Juntar o áudio de estúdio com o vídeo.'),
                                 ('Cor do vídeo', 'Mais um tempo de edição.')]))),
    S(glow(540, 700) + centro('<span class="k">Resultado</span><h2 style="margin-top:30px">Facilmente passa de <em>R$ 300</em> por cover.</h2><p style="margin-top:34px">E leva dias. Quem posta toda semana não consegue manter isso.</p><p style="margin-top:26px;font-size:26px;opacity:.6">Valores variam por cidade e profissional.</p>')),
    S(glow(540, 700, 1300) + phone('pronto', 360, 640, 300, 'rotate(5deg)') +
      bloco(64, 240, 560, '<span class="k">Com o Studio Cover</span><div class="preco" style="margin-top:40px;font-size:100px">R$ 297</div><p style="margin-top:14px"><b>por 1 ano inteiro</b>, quantos covers quiser.</p><p style="margin-top:30px">Ou <em>10x de R$ 35,69</em>.</p>')),
    S(glow(540, 620, 1300) + centro('<span class="k">Antes de pagar</span><h1 style="margin-top:36px">Testa <em>grátis</em> com 1 vídeo.</h1><p style="margin-top:36px">Garantia de 7 dias depois da compra.</p><div style="margin-top:56px"><span class="btn">Link na bio →</span></div>'), True),
])

# 6 — separação de voz (único, amarelo)
post('Função: IA separa voz e violão', 'post',
     '''Gravou voz e violão juntos? Sem problema. 🎸🎙️

A IA do Studio Cover separa a sua voz do instrumental dentro do próprio celular. Assim ela afina só a voz e deixa o violão do jeito que você tocou. Depois mixa os dois de volta, equilibrados.

E o seu vídeo não é enviado pra ninguém: o processamento roda no seu aparelho.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(540, 900) + bloco(64, 180, 952, '<span class="k">IA no seu celular</span><h1 style="margin-top:34px;font-size:72px">Separa sua <em>voz</em> do violão.</h1>') +
      phone('separando', 360, 360, 520, '') + bloco(64, 1150, 260, '<p style="font-size:28px"><b>Afina só a voz.</b></p>') + bloco(760, 1150, 260, '<p style="font-size:28px;text-align:right"><b>Violão intacto.</b></p>'), True),
])

# 7 — passo a passo (carrossel)
post('Tutorial: do vídeo cru ao cover pronto', 'carrossel',
     '''Do vídeo cru ao cover pronto, em 5 passos 🎬

1. Escolhe o vídeo (MP4 ou MOV do celular)
2. Afinação automática, com ANTES e DEPOIS
3. Mix e master: volume, equalizador, reverb, fades
4. Cor de cinema: colorista automático e filtros
5. Exporta em 1080x1920 e posta

Prefere não mexer em nada? Toca em “Deixar tudo pronto” e o app faz os 5 sozinho.

Salva pra usar no próximo cover 📌
🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(540, 600, 1300) + centro('<span class="k">Tutorial</span><h1 style="margin-top:36px;font-size:84px">Do vídeo cru ao cover <em>pronto</em></h1><p style="margin-top:34px">5 passos. Alguns minutos. Só o celular.</p>') + onda(64, 1120, 40, 80, 13), True),
    S(glow(300, 700) + phone('home', 400, 620, 230, 'rotate(-4deg)') + bloco(64, 280, 540, '<span class="k">01 · Vídeo</span><h2 style="margin-top:30px">Escolhe o vídeo</h2><p style="margin-top:28px">Do jeito que gravou. Tem playback ou violão? Marca a opção e a IA separa a voz.</p>')),
    S(glow(300, 700) + phone('afinacao', 400, 620, 230, 'rotate(4deg)') + bloco(64, 280, 540, '<span class="k">02 · Afinação</span><h2 style="margin-top:30px">Afina no tom</h2><p style="margin-top:28px">Toca em ANTES e DEPOIS pra comparar. Não gostou? Desfaz.</p>')),
    S(glow(300, 700) + phone('mix', 400, 620, 230, 'rotate(-4deg)') + bloco(64, 280, 540, '<span class="k">03 · Mix e master</span><h2 style="margin-top:30px">Equilibra tudo</h2><p style="margin-top:28px">Volume da voz e da base, equalizador, reverb, fade-in e fade-out.</p>')),
    S(glow(300, 700) + phone('cor', 400, 620, 230, 'rotate(4deg)') + bloco(64, 280, 540, '<span class="k">04 · Cor</span><h2 style="margin-top:30px">Cor de cinema</h2><p style="margin-top:28px">Colorista automático ou filtros prontos. Prévia na hora.</p>')),
    S(glow(300, 700) + phone('pronto', 400, 620, 230, 'rotate(-4deg)') + bloco(64, 280, 540, '<span class="k">05 · Exportar</span><h2 style="margin-top:30px">Baixa e posta</h2><p style="margin-top:28px">1080 x 1920, pronto pro Reels, TikTok e Shorts.</p>')),
    S(glow(540, 620, 1300) + centro('<span class="k">Atalho</span><h1 style="margin-top:36px;font-size:72px">Ou toca em <em>“Deixar tudo pronto”</em></h1><p style="margin-top:34px">E o app faz os 5 passos sozinho.</p><div style="margin-top:56px"><span class="btn">Testar grátis →</span></div>'), True),
])

# 8 — antes / depois (único)
post('Antes e depois da cor', 'post',
     '''Mesmo vídeo. Mesmo celular. Mesma luz de quarto. 🎨

A diferença é o tratamento de cor do Studio Cover: o colorista automático corrige a luz e a pele, e os filtros de cinema dão cara de clipe. Você vê a prévia antes de baixar.

Qual você postaria? Comenta ANTES ou DEPOIS 👇

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(540, 760, 1300) + bloco(64, 160, 952, '<span class="k">Mesmo vídeo</span><h2 style="margin-top:28px;font-size:58px">Antes e depois da <em>cor de cinema</em></h2>') +
      f'<div class="foto" style="left:64px;top:470px;width:460px;height:780px"><img src="{LP}antes.webp"><span class="tag">ANTES</span></div>' +
      f'<div class="foto dep" style="left:556px;top:470px;width:460px;height:780px"><img src="{LP}depois.webp"><span class="tag">DEPOIS</span></div>'),
])

# 9 — painel de notas (carrossel)
post('Função: painel de notas', 'carrossel',
     '''Pra quem gosta de ter controle: o painel de notas 🎹

A afinação automática resolve quase tudo. Mas se você quiser, abre o painel, toca numa nota e arrasta pra cima ou pra baixo. A faixa verde mostra o que está no tom da música.

Tem também “Subir”, “Descer”, “Original” e “Desfazer” pra cada trecho.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(720, 700) + phone('painel', 420, 600, 200, 'rotate(-5deg)') + bloco(64, 240, 540, '<span class="k">Modo detalhista</span><h1 style="margin-top:34px;font-size:66px">Você no <em>controle</em> de cada nota</h1>') + onda(64, 1000, 24, 100, 17)),
    S(glow(540, 700) + centro('<span class="k">Como usa</span><h2 style="margin-top:30px">Toca e <em>arrasta</em></h2>' + '<div style="height:56px"></div>' + lista([('Toca na nota', 'Ela acende no painel.'), ('Arrasta', 'Pra cima ou pra baixo. A mudança já vale.'), ('Faixa verde', 'Mostra as notas do tom da música.'), ('Desfazer', 'Voltou atrás? Um toque.')]))),
    S(glow(300, 700) + phone('arrastar', 400, 620, 230, 'rotate(4deg)') + bloco(64, 300, 540, '<span class="k">Atalhos</span><h2 style="margin-top:30px">Subir, descer, auto</h2><p style="margin-top:28px">Botões prontos pra ajustar um trecho inteiro de uma vez.</p>')),
    S(glow(540, 620, 1300) + centro('<span class="k">Ou não mexe em nada</span><h1 style="margin-top:36px">O automático já <em>resolve</em>.</h1><div style="margin-top:56px"><span class="btn">Testar grátis →</span></div>'), True),
])

# 10 — frase (único)
post('Frase: estúdio é caro', 'post',
     '''Estúdio é caro. Postar desafinado custa mais caro ainda. 🎯

Cada vídeo que vai pro ar é o seu cartão de visita. Quem te descobre por um cover decide em segundos se você é bom.

Grava no celular e deixa o Studio Cover cuidar do resto.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(540, 640, 1300) + holo(540, 640, 1000) + centro('<h1 style="font-size:84px;text-align:center">Estúdio é caro.<br><br>Postar <em>desafinado</em> custa mais caro ainda.</h1>') + onda(250, 1050, 36, 90, 21)),
])

# 11 — mix e master explicado (carrossel)
post('Mix e master sem complicação', 'carrossel',
     '''Mix e master sem precisar entender de áudio 🎚️

No passo 3 do Studio Cover você tem:
• Volume da voz e da base
• Equalizador (grave, médio, agudo)
• Reverb, na medida que você quiser
• Fade-in e fade-out
• Cortar o silêncio do começo e do fim

Tudo já vem ajustado. Mexe só se quiser. E compara ORIGINAL, AFINADA e MIXADA com um toque.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(720, 700) + phone('mix', 420, 600, 200, 'rotate(5deg)') + bloco(64, 240, 540, '<span class="k">Passo 3</span><h1 style="margin-top:34px;font-size:60px">Mix e master <em>sem</em> complica­ção</h1>') + onda(64, 1000, 24, 100, 23)),
    S(glow(540, 700) + centro('<span class="k">O que tem</span><h2 style="margin-top:30px">Tudo que um estúdio faz</h2>' + '<div style="height:56px"></div>' + lista([('Volume', 'Voz na frente, base no lugar.'), ('Equalizador', 'Grave, médio e agudo.'), ('Reverb', 'Do seco ao de igreja.'), ('Fade-in e fade-out', 'Entrada e saída suaves.')]))),
    S(glow(540, 700) + centro('<span class="k">Detalhe que faz diferença</span><h2 style="margin-top:30px">Corta o <em>silêncio</em> do começo e do fim</h2><p style="margin-top:34px">Aqueles segundos ajeitando o celular somem. O vídeo já começa na música.</p>')),
    S(glow(540, 700) + centro('<span class="k">Compara</span><h2 style="margin-top:30px">Original. Afinada. <em>Mixada.</em></h2><p style="margin-top:34px">Três botões, um toque cada. Você ouve a diferença na hora.</p>')),
    S(glow(540, 620, 1300) + centro('<span class="k">Já vem ajustado</span><h1 style="margin-top:36px">Mexe só <em>se quiser</em>.</h1><div style="margin-top:56px"><span class="btn">Testar grátis →</span></div>'), True),
])

# 12 — filtros de cinema (único)
post('Função: filtros de cinema', 'post',
     '''Cor de cinema com um toque 🎬

O colorista automático corrige a luz amarela do quarto e a cor da pele. Quer um clima diferente? Escolhe um dos filtros de cinema e vê a prévia antes de baixar.

Qual é o seu estilo: quente, frio ou preto e branco? 👇

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(720, 700) + holo(720, 700, 820) + bloco(64, 220, 540, '<span class="k">Passo 4</span><h1 style="margin-top:34px;font-size:68px">Cor de <em>cinema</em> com um toque</h1><p style="margin-top:30px">Colorista automático e filtros com prévia antes de baixar.</p>') +
      phone('cor', 420, 600, 200, 'rotate(-5deg)') + onda(64, 1080, 24, 100, 29)),
])

# 13 — dicas de gravação (carrossel)
post('Dicas para gravar no celular', 'carrossel',
     '''6 dicas pra gravar seu cover no celular 📱

1. Luz de frente (janela na sua frente, não atrás)
2. Celular em pé, na altura dos olhos
3. Microfone do celular virado pra sua boca
4. Cômodo com cortina, tapete ou roupa (menos eco)
5. Sem ventilador ou ar-condicionado ligado
6. Grava o cover inteiro, sem cortes

O resto o Studio Cover faz: afina, mixa, masteriza e dá cor.

Salva pra lembrar na próxima gravação 📌''', [
    S(glow(540, 600, 1300) + centro('<span class="k">Salva esse post</span><h1 style="margin-top:36px;font-size:86px"><em>6 dicas</em> pra gravar seu cover no celular</h1>') + onda(64, 1120, 40, 80, 31), True),
    S(glow(540, 700) + centro('<span class="k">Imagem</span><h2 style="margin-top:30px">Antes de apertar o REC</h2>' + '<div style="height:56px"></div>' + lista([('Luz de frente', 'Janela na sua frente, nunca atrás.'), ('Celular em pé', 'Na altura dos olhos, apoiado em algo firme.'), ('Fundo limpo', 'Menos bagunça, mais atenção em você.')]))),
    S(glow(540, 700) + centro('<span class="k">Som</span><h2 style="margin-top:30px">O que o app não adivinha</h2>' + '<div style="height:56px"></div>' + lista([('Mic na direção da boca', 'O microfone fica embaixo do celular.'), ('Menos eco', 'Cortina, tapete, cama, roupa no armário.'), ('Silêncio em volta', 'Ventilador e ar desligados.')], 4))),
    S(glow(540, 700) + centro('<span class="k">Dica de ouro</span><h2 style="margin-top:30px">Grava o cover <em>inteiro</em>, sem cortes</h2><p style="margin-top:34px">Erros pequenos de afinação o app corrige. Emoção de verdade, só você coloca.</p>')),
    S(glow(300, 700) + phone('rapido', 400, 620, 230, 'rotate(4deg)') + bloco(64, 300, 540, '<span class="k">Depois</span><h2 style="margin-top:30px">Sobe no app e escolhe</h2><p style="margin-top:28px">“Deixar tudo pronto” ou passo a passo. Você decide.</p>')),
    S(glow(540, 620, 1300) + centro('<span class="k">O resto é com a gente</span><h1 style="margin-top:36px">Afina, mixa, masteriza e dá <em>cor</em>.</h1><div style="margin-top:56px"><span class="btn">Testar grátis →</span></div>'), True),
])

# 14 — um toque (único, amarelo)
post('Função: deixar tudo pronto', 'post',
     '''Um toque e o seu cover sai pronto ⚡

Depois que a IA separa a voz, o Studio Cover pergunta: “Deixar tudo pronto” ou “Fazer passo a passo”?

No primeiro, ele afina, mixa, masteriza e coloca cor de cinema sozinho. Você só assiste a prévia e baixa. E pode voltar e mudar qualquer etapa.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(540, 900) + bloco(64, 180, 952, '<span class="k">Modo rápido</span><h1 style="margin-top:34px;font-size:76px">Um toque. <em>Cover pronto.</em></h1>') +
      phone('rapido', 360, 360, 520, '') + bloco(64, 1100, 270, '<p style="font-size:28px"><b>Afina e mixa</b></p>') + bloco(750, 1100, 270, '<p style="font-size:28px;text-align:right"><b>Master e cor</b></p>'), True),
])

# 15 — mitos (carrossel)
post('Mitos e verdades', 'carrossel',
     '''Mito ou verdade? 🤔

❌ “Afinação deixa a voz robótica” → mantém o vibrato e o seu jeito de cantar
❌ “Precisa de computador” → roda no celular (iPhone 13 ou mais novo, Android com 4 GB)
❌ “Meu vídeo vai pra internet” → a IA roda no seu aparelho
❌ “Precisa entender de áudio” → um toque em “Deixar tudo pronto”

Ficou alguma dúvida? Manda nos comentários 👇''', [
    S(glow(540, 600, 1300) + centro('<span class="k">Mito ou verdade?</span><h1 style="margin-top:36px;font-size:88px">4 mitos sobre <em>afinar</em> a voz no celular</h1>') + onda(64, 1120, 40, 80, 37)),
    S(glow(540, 700) + centro('<span class="k">Mito 01</span><h2 style="margin-top:30px"><span class="risco">“Afinação deixa a voz robótica”</span></h2><p style="margin-top:40px"><b>Não aqui.</b> O app afina mantendo o seu vibrato e o seu jeito de cantar. E você compara ANTES e DEPOIS.</p>')),
    S(glow(540, 700) + centro('<span class="k">Mito 02</span><h2 style="margin-top:30px"><span class="risco">“Precisa de computador”</span></h2><p style="margin-top:40px"><b>Roda no celular.</b> iPhone 13 ou mais novo, ou Android com 4 GB de memória. Abre no navegador e instala na tela de início.</p>')),
    S(glow(540, 700) + centro('<span class="k">Mito 03</span><h2 style="margin-top:30px"><span class="risco">“Meu vídeo vai pra internet”</span></h2><p style="margin-top:40px"><b>A IA roda no seu aparelho.</b> Seu vídeo não é enviado pra ninguém enquanto é tratado.</p>')),
    S(glow(540, 700) + centro('<span class="k">Mito 04</span><h2 style="margin-top:30px"><span class="risco">“Precisa entender de áudio”</span></h2><p style="margin-top:40px"><b>Um toque.</b> “Deixar tudo pronto” faz afinação, mix, master e cor sozinho.</p><div style="margin-top:56px"><span class="btn">Testar grátis →</span></div>')),
])

# 16 — compatível (único)
post('Funciona no seu celular', 'post',
     '''Funciona no celular que você já tem 📱

✅ iPhone 13 ou mais novo
✅ Android com 4 GB de memória ou mais
✅ Também no computador

Não precisa baixar da loja: abre no navegador e instala na tela de início. A IA roda no seu aparelho.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(540, 820, 1300) + bloco(64, 180, 952, '<span class="k">Compatível</span><h1 style="margin-top:34px;font-size:72px">Funciona no celular que você <em>já tem</em></h1>') +
      phone('home', 310, 190, 500, 'rotate(-8deg)', z=4) + phone('pronto', 310, 580, 480, 'rotate(7deg)', z=6) +
      bloco(64, 1190, 952, '<p style="font-size:30px;text-align:center"><b>iPhone 13+</b> · <b>Android 4 GB+</b> · <b>Computador</b></p>')),
])

# 17 — música original (carrossel)
post('Função: subir a música original', 'carrossel',
     '''Sabia que dá pra afinar pela melodia do cantor original? 🎤

No Studio Cover tem a opção “Subir a música original”. Você manda a música e o app pega a melodia do cantor, no SEU tom, e usa como guia pra afinar a sua voz.

É opcional. Sem ela, a afinação automática já funciona pelo tom da música.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(540, 600, 1300) + centro('<span class="k">Função secreta</span><h1 style="margin-top:36px;font-size:80px">Afina pela melodia do <em>cantor original</em></h1>') + onda(64, 1120, 40, 80, 41), True),
    S(glow(300, 700) + phone('home', 400, 620, 230, 'rotate(-4deg)') + bloco(64, 300, 540, '<span class="k">Como</span><h2 style="margin-top:30px">Sobe a música original</h2><p style="margin-top:28px">MP3, M4A ou WAV. É opcional.</p>')),
    S(glow(300, 700) + phone('afinacao', 400, 620, 230, 'rotate(4deg)') + bloco(64, 300, 540, '<span class="k">O que acontece</span><h2 style="margin-top:30px">Vira guia no <em>seu</em> tom</h2><p style="margin-top:28px">O app pega a melodia do cantor e afina você por ela.</p>')),
    S(glow(540, 620, 1300) + centro('<span class="k">Sem a música?</span><h1 style="margin-top:36px">O automático já afina pelo <em>tom</em>.</h1><div style="margin-top:56px"><span class="btn">Testar grátis →</span></div>')),
])

# 18 — 1080p (único)
post('Pronto pra postar em 1080p', 'post',
     '''Seu cover pronto em 1080 x 1920 ✅

No final é só tocar em “Baixar meu vídeo pronto”. O vídeo sai no formato vertical certinho pro Reels, TikTok e Shorts, com o som e a cor que você escolheu.

🎁 Teste grátis com 1 vídeo: link na bio.''', [
    S(glow(720, 700) + holo(720, 700, 820) + bloco(64, 220, 540, '<span class="k">Passo 5</span><div class="preco" style="margin-top:40px;font-size:96px">1080p</div><h2 style="margin-top:24px;font-size:52px">Pronto pra <em>postar</em></h2><p style="margin-top:30px">Vertical, 1080 x 1920, com som e cor do jeito que você escolheu.</p>') +
      phone('pronto', 420, 600, 200, 'rotate(5deg)')),
])

# 19 — oferta / FAQ (carrossel)
post('Como assinar e testar grátis', 'carrossel',
     '''Tudo sobre o Studio Cover em 1 carrossel 👇

🎁 Teste grátis: 1 vídeo, sem cartão
💳 R$ 297 por 1 ano (ou 10x de R$ 35,69)
♾️ Quantos covers você quiser no ano
🛡️ Garantia de 7 dias
📱 iPhone 13+, Android 4 GB+ e computador
✉️ Suporte: contato@studiocover.com.br

🔗 studiocover.com.br (link na bio)''', [
    S(glow(540, 600, 1300) + centro('<span class="k">Guia rápido</span><h1 style="margin-top:36px;font-size:84px">Tudo sobre o Studio Cover em <em>1 post</em></h1>') + onda(64, 1120, 40, 80, 43)),
    S(glow(540, 700) + centro('<span class="k">01 · Testa primeiro</span><h2 style="margin-top:30px"><em>1 vídeo</em> grátis</h2><p style="margin-top:34px">Cria a conta, sobe o vídeo e baixa pronto. Só assina se gostar.</p>')),
    S(glow(540, 700) + centro('<span class="k">02 · Preço</span><div class="preco" style="margin-top:40px">R$ 297</div><p style="margin-top:20px"><b>por 1 ano</b>, quantos covers quiser.</p><p style="margin-top:30px">Ou <em>10x de R$ 35,69</em> no cartão.</p>')),
    S(glow(540, 700) + centro('<span class="k">03 · Segurança</span><h2 style="margin-top:30px">Garantia de <em>7 dias</em></h2><p style="margin-top:34px">Não gostou? Pede o reembolso dentro de 7 dias. Pagamento seguro pela Eduzz.</p>')),
    S(glow(540, 700) + centro('<span class="k">04 · Onde funciona</span><h2 style="margin-top:30px">No celular e no <em>computador</em></h2><p style="margin-top:34px">iPhone 13 ou mais novo, Android com 4 GB, e qualquer computador recente.</p>')),
    S(glow(540, 620, 1300) + centro('<span class="k">Começa agora</span><h1 style="margin-top:36px;font-size:66px">studiocover<em>.com.br</em></h1><div style="margin-top:56px"><span class="btn">Link na bio →</span></div><p style="margin-top:50px;font-size:28px">Suporte: contato@studiocover.com.br</p>'), True),
])

# 20 — CTA final (único)
post('Teste grátis: 1 vídeo', 'post',
     '''Seu próximo cover pode sair com som de estúdio. 🎙️✨

Testa o Studio Cover de graça com 1 vídeo: sobe do jeito que gravou e baixa afinado, mixado e com cor de cinema.

👉 Link na bio: studiocover.com.br''', [
    S(glow(720, 700) + holo(720, 700, 820) + bloco(64, 220, 560, '<span class="k">🎁 Presente</span><h1 style="margin-top:34px;font-size:74px">Teste <em>grátis</em> com 1 vídeo</h1><p style="margin-top:30px">Sobe do jeito que gravou. Baixa com som de estúdio.</p><div style="margin-top:50px"><span class="btn">Link na bio →</span></div>') +
      phone('rapido', 400, 620, 230, 'rotate(5deg)')),
])

# ---------------------------------------------------------------- html


def montar():
    css = open(os.path.join(AQUI, 'estilo.css')).read()
    partes = []
    for pi, p in enumerate(POSTS, 1):
        n = len(p['slides'])
        for si, s in enumerate(p['slides'], 1):
            cont = f'{si:02d}/{n:02d}' if n > 1 else ''
            seta = '<span class="seta">Arrasta →</span>' if (n > 1 and si == 1) else ('<span class="seta">→</span>' if si < n else '')
            partes.append(
                f'<section class="s{" am" if s["am"] else ""}" id="p{pi:02d}-{si:02d}">'
                f'<div class="top"><span class="marca">{LOGO_P}STUDIO COVER</span><span class="cont">{cont}</span></div>'
                f'{s["inner"]}'
                f'<div class="rod"><span>studiocover.com.br</span>{seta}</div></section>')
    html = f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>{"".join(partes)}</body></html>'
    return html


if __name__ == '__main__':
    saida = sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, 'saida')
    os.makedirs(saida, exist_ok=True)
    open(os.path.join(saida, 'artes.html'), 'w').write(montar())
    json.dump([{k: v for k, v in p.items() if k != 'slides'} | {'n': len(p['slides'])} for p in POSTS],
              open(os.path.join(saida, 'posts.json'), 'w'), ensure_ascii=False, indent=1)
    print(len(POSTS), 'posts,', sum(len(p['slides']) for p in POSTS), 'artes')
