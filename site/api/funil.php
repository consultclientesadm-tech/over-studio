<?php
// Funil de quem fez o teste grátis e ainda não comprou: e-mail + aviso dentro do app.
// Roda de hora em hora (tarefa agendada do Plesk: php api/cron.php).
declare(strict_types=1);

// dia = dias depois do cadastro. {nome} = primeiro nome. {app} = link do app. {checkout} = link de compra.
function funnel_steps(): array {
  return [
    1 => ['dia' => 1, 'assunto' => '{nome}, seu primeiro cover já está pronto?', 'titulo' => 'Seu teste está te esperando',
      'texto' => '<p>Ontem você entrou no Studio Cover. Se ainda não subiu o seu vídeo, faz agora: escolhe aquele cover que você gravou no celular e deixa o app separar a voz, afinar e mixar.</p><p>Leva poucos minutos e você ouve o antes e depois na hora.</p>',
      'botao' => 'Afinar meu cover agora', 'link' => '{app}', 'aviso' => 'Suba o seu primeiro cover e ouça o antes e depois.'],
    2 => ['dia' => 3, 'assunto' => 'O segredo dos covers que viralizam (não é a voz perfeita)', 'titulo' => 'Os 2 primeiros segundos decidem tudo',
      'texto' => '<p>Quem rola o feed decide em 2 segundos se fica ou se passa. Uma nota desafinada ou um som embolado no comecinho e o vídeo morre, por melhor que você cante.</p><p>Não é falta de talento. É acabamento. É isso que o Studio Cover faz por você: afinação natural, voz na frente da base, volume das redes e cor de cinema.</p>',
      'botao' => 'Testar no meu vídeo', 'link' => '{app}', 'aviso' => 'Os 2 primeiros segundos decidem se o seu cover viraliza.'],
    3 => ['dia' => 7, 'assunto' => '{nome}, uma semana depois: o que ficou parado?', 'titulo' => 'Quantos covers ficaram na galeria esta semana?',
      'texto' => '<p>Faz uma semana que você testou o Studio Cover. Pensa em quantos vídeos você gravou e não postou porque "não ficou bom".</p><p>Cada vídeo parado é alcance que foi para outro artista. Com o acesso completo você afina, mixa e exporta quantos covers quiser, direto do celular.</p>',
      'botao' => 'Liberar meu acesso completo', 'link' => '{checkout}', 'aviso' => 'Libere o acesso completo e poste todos os seus covers.'],
    4 => ['dia' => 9, 'assunto' => 'Estúdio cobra R$ 150 por música. Faz as contas.', 'titulo' => 'Seu estúdio no bolso',
      'texto' => '<p>Uma mixagem simples num estúdio sai por R$ 100 a R$ 300 por música, e você ainda espera dias.</p><p>No Studio Cover você faz quantas quiser, na hora, sem sair de casa. Um cover a mais por semana já paga o app.</p>',
      'botao' => 'Quero o meu estúdio no bolso', 'link' => '{checkout}', 'aviso' => 'Um estúdio cobra por música. Aqui é ilimitado.'],
    5 => ['dia' => 12, 'assunto' => 'Você arrasta a nota e ela fica no tom', 'titulo' => 'Afinação que respeita o seu jeito de cantar',
      'texto' => '<p>O Studio Cover não deixa voz de robô. Ele lê o tom e os acordes da base e afina cada nota mantendo o seu vibrato.</p><p>E se quiser mexer, é só arrastar a nota: as linhas verdes são as notas da escala, a amarela é a tônica.</p>',
      'botao' => 'Liberar o Studio Cover', 'link' => '{checkout}', 'aviso' => 'Arraste a nota para a linha verde e pronto: no tom.'],
    6 => ['dia' => 15, 'assunto' => 'O algoritmo não espera, {nome}', 'titulo' => 'Constância vence talento escondido',
      'texto' => '<p>Quem cresce no Instagram e no TikTok posta com frequência e com qualidade. Sem estúdio, isso era impossível. Agora é um app.</p><p>Libere o acesso e transforme a sua galeria em uma semana de posts prontos.</p>',
      'botao' => 'Começar a postar com qualidade', 'link' => '{checkout}', 'aviso' => 'Transforme a galeria em uma semana de posts prontos.'],
    7 => ['dia' => 21, 'assunto' => 'Posso te ajudar a decidir?', 'titulo' => 'Ficou alguma dúvida?',
      'texto' => '<p>Se alguma coisa te travou no teste, me responde este e-mail. Leio todas as respostas.</p><p>E se já decidiu, o seu acesso está a um toque daqui.</p>',
      'botao' => 'Liberar meu acesso', 'link' => '{checkout}', 'aviso' => 'Ficou alguma dúvida? Estamos aqui para ajudar.'],
    8 => ['dia' => 30, 'assunto' => 'Último lembrete sobre o seu Studio Cover', 'titulo' => 'Seu próximo cover pode ser o que muda tudo',
      'texto' => '<p>Este é o último lembrete. Não vou mais encher a sua caixa.</p><p>Se a música é séria para você, dê ao seu talento o acabamento que ele merece.</p>',
      'botao' => 'Quero o Studio Cover', 'link' => '{checkout}', 'aviso' => 'Dê ao seu talento o acabamento que ele merece.'],
  ];
}

function funnel_fill(string $s, array $u): string {
  $first = trim(explode(' ', trim($u['name'] ?: ''))[0] ?? '') ?: 'artista';
  return strtr($s, ['{nome}' => $first, '{app}' => site_url() . '/app/', '{checkout}' => checkout_url($u) ?: site_url() . '/#comprar']);
}

function funnel_send(array $u, string $kind, array $st): void {
  $f = fn($s) => funnel_fill($s, $u);
  if (!(int)$u['unsub']) send_mail($u, $u['email'], $kind, $f($st['assunto']), h($f($st['titulo'])), $f($st['texto']), $st['botao'], $f($st['link']));
  if (empty($GLOBALS['sc_so_email'])) notify((int)$u['id'], $f($st['titulo']), $f($st['aviso']), $f($st['link'])); // reenvio de e-mail não repete o aviso no app
}

function funnel_welcome(array $u): void {
  $n = (int)setting('trial_videos');
  $vid = $n === 1 ? '1 vídeo' : "$n vídeos";
  funnel_send($u, 'boas-vindas', ['assunto' => 'Bem-vindo ao Studio Cover, {nome}!', 'titulo' => 'Seu teste grátis está liberado',
    'texto' => "<p>Você tem <b>$vid</b> para testar o Studio Cover completo: separar a voz, afinar, mixar, cor de cinema e exportar.</p><p>Dica: escolha um cover que você gravou e achou que \"não ficou bom\". É nele que a diferença aparece.</p>",
    'botao' => 'Abrir o Studio Cover', 'link' => '{app}', 'aviso' => "Você tem $vid grátis. " . ($n === 1 ? 'Suba o seu!' : 'Suba o primeiro!')]);
}

function funnel_trial_over(array $u): void {
  funnel_send($u, 'teste-acabou', ['assunto' => '{nome}, seu teste grátis terminou', 'titulo' => 'Gostou do resultado?',
    'texto' => '<p>Você usou o teste grátis. Agora é só liberar o acesso completo para afinar, mixar e exportar quantos covers quiser.</p>',
    'botao' => 'Liberar meu acesso completo', 'link' => '{checkout}', 'aviso' => 'Seu teste terminou. Libere o acesso completo.']);
}

// pagou: manda o link para criar a senha (ou avisa que liberou, se já tem senha)
function funnel_paid(array $u, bool $isNew): void {
  if (!$u['pass_hash']) {
    $link = set_password_link($u, 30);
    send_mail($u, $u['email'], 'senha', 'Seu acesso ao Studio Cover chegou! Crie a sua senha', 'Seu acesso está liberado 🎉',
      '<p>Pagamento confirmado. Agora é só criar a sua senha para entrar no Studio Cover.</p><p>Depois de entrar, toque em <b>Instalar</b> para deixar o app na tela de início do seu celular.</p>',
      'Criar minha senha', $link);
  } else {
    send_mail($u, $u['email'], 'liberado', 'Seu acesso completo ao Studio Cover foi liberado', 'Acesso completo liberado 🎉',
      '<p>Pagamento confirmado. Entre com o mesmo e-mail e senha que você já usa e aproveite: vídeos ilimitados.</p>', 'Entrar no Studio Cover', site_url() . '/entrar/');
  }
  notify((int)$u['id'], 'Acesso completo liberado', 'Obrigado pela compra! Agora é ilimitado.', site_url() . '/app/');
}

// roda o funil: só manda das 8h às 21h, um passo por vez por pessoa
function run_funnel(bool $force = false): array {
  if (setting('funnel_enabled') !== '1') return ['enviados' => 0, 'motivo' => 'funil desligado'];
  $h = (int)date('G');
  if (!$force && ($h < 8 || $h > 21)) return ['enviados' => 0, 'motivo' => 'fora do horário'];
  $steps = funnel_steps(); $sent = 0;
  $users = db()->query("SELECT * FROM users WHERE status = 'trial'")->fetchAll();
  foreach ($users as $u) {
    $days = (time() - strtotime($u['created_at'])) / 86400;
    $due = 0;
    foreach ($steps as $i => $st) if ($i > (int)$u['funnel_step'] && $days >= $st['dia']) $due = $i;
    if (!$due) continue;
    db()->prepare('UPDATE users SET funnel_step = ?, funnel_at = ? WHERE id = ?')->execute([$due, now(), $u['id']]);
    funnel_send($u, 'funil-' . $due, $steps[$due]);
    $sent++;
  }
  return ['enviados' => $sent];
}
