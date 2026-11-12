<?php
// Funil de quem fez o teste grátis e ainda não comprou: e-mail + aviso dentro do app.
// Roda de hora em hora (tarefa agendada do Plesk: php api/cron.php).
declare(strict_types=1);

// dia = dias depois do cadastro. {nome} = primeiro nome. {app} = link do app. {checkout} = link de compra.
function funnel_steps(): array {
  // {acao} = app (se ainda tem teste) ou checkout (se já usou). Copy na dor do cantor; nada de algoritmo/viralizar.
  return [
    1 => ['dia' => 1, 'assunto' => '{nome}, aquele cover vai ficar na galeria de novo?', 'titulo' => 'Você grava, ouve e apaga',
      'texto' => '<p>Você conhece a cena: grava o cover, ouve de volta e aquela nota escapa. A voz fica embolada na base. Você apaga, ou pior, guarda e nunca posta.</p><p>Não é falta de talento. É falta de acabamento. Foi isso que você viu no Studio Cover: a sua voz afinada, mixada e com som de estúdio, saindo do próprio celular.</p>',
      'botao' => 'Quero o meu próximo cover afinado', 'link' => '{acao}', 'aviso' => 'Aquele cover não precisa ficar parado na galeria.'],
    2 => ['dia' => 2, 'assunto' => 'Você ouviu a diferença. Vai voltar para o áudio cru?', 'titulo' => 'Depois que você ouve, não tem volta',
      'texto' => '<p>Depois que você escuta a sua voz no tom, com a base no lugar e o som cheio, o áudio cru do celular fica difícil de engolir.</p><p>Amanhã você vai postar mais um cover desafinado, ou vai postar com som de estúdio? A escolha é sua, e ela custa menos do que uma mixagem.</p>',
      'botao' => 'Liberar meu acesso', 'link' => '{acao}', 'aviso' => 'Amanhã você posta desafinado ou com som de estúdio?'],
    3 => ['dia' => 3, 'assunto' => '"Desafinou aqui" dói, né?', 'titulo' => 'O comentário que ninguém quer ler',
      'texto' => '<p>Você posta com o coração e aparece aquele comentário: "desafinou aqui", "o som tá ruim". Uma nota tira a atenção do vídeo inteiro.</p><p>O Studio Cover lê o tom da música e afina cada nota mantendo o seu vibrato. Sem voz de robô. Ninguém percebe que passou por um app, só que ficou bom.</p>',
      'botao' => 'Afinar os meus covers', 'link' => '{acao}', 'aviso' => 'Uma nota fora tira a atenção do vídeo inteiro.'],
    4 => ['dia' => 5, 'assunto' => 'Estúdio cobra R$ 150 por música. Faz as contas.', 'titulo' => 'Seu estúdio no bolso',
      'texto' => '<p>Uma mixagem simples num estúdio sai por R$ 100 a R$ 300 por música, e você ainda espera dias para receber.</p><p>No Studio Cover você faz quantos covers quiser, na hora, sem sair de casa. Dois covers já pagam o ano inteiro.</p>',
      'botao' => 'Quero o meu estúdio no bolso', 'link' => '{acao}', 'aviso' => 'Estúdio cobra por música. Aqui é ilimitado.'],
    5 => ['dia' => 7, 'assunto' => '{nome}, uma semana. Quantos covers ficaram parados?', 'titulo' => 'A galeria cheia e o perfil parado',
      'texto' => '<p>Faz uma semana que você testou o Studio Cover. Pensa em quantos vídeos você gravou e não postou porque "não ficou bom".</p><p>Cada cover parado é um momento que você não mostrou para ninguém. Com o acesso completo, você afina, mixa e posta tudo, direto do celular.</p>',
      'botao' => 'Postar os meus covers', 'link' => '{acao}', 'aviso' => 'Quantos covers ficaram parados esta semana?'],
    6 => ['dia' => 10, 'assunto' => 'Você não é desafinado. Falta acabamento.', 'titulo' => 'Talento você já tem',
      'texto' => '<p>Os cantores que você admira não gravam perfeito de primeira. Eles têm um estúdio que afina, equaliza e mixa antes de qualquer pessoa ouvir.</p><p>Agora você tem o mesmo acabamento no seu celular. A diferença entre o seu vídeo e o deles não é a voz, é o tratamento.</p>',
      'botao' => 'Dar acabamento na minha voz', 'link' => '{acao}', 'aviso' => 'A diferença não é a voz. É o acabamento.'],
    7 => ['dia' => 14, 'assunto' => 'Quem cresce na música posta toda semana', 'titulo' => 'Constância com qualidade',
      'texto' => '<p>Quem está crescendo na música não é quem canta melhor. É quem aparece toda semana com um som bom.</p><p>Sem estúdio isso era impossível. Com o Studio Cover é um app: grava, afina, mixa e posta no mesmo dia.</p>',
      'botao' => 'Começar a postar toda semana', 'link' => '{acao}', 'aviso' => 'Grava, afina, mixa e posta no mesmo dia.'],
    8 => ['dia' => 21, 'assunto' => 'Posso te ajudar a decidir?', 'titulo' => 'Ficou alguma dúvida?',
      'texto' => '<p>Se alguma coisa te travou, me responde este e-mail. Leio todas as respostas.</p><p>E se já decidiu, o seu acesso está a um toque daqui.</p>',
      'botao' => 'Liberar meu acesso', 'link' => '{acao}', 'aviso' => 'Ficou alguma dúvida? Estamos aqui para ajudar.'],
    9 => ['dia' => 30, 'assunto' => 'Último lembrete sobre o seu Studio Cover', 'titulo' => 'Seu próximo cover pode ser o que muda tudo',
      'texto' => '<p>Este é o último lembrete. Não vou mais encher a sua caixa.</p><p>Se a música é séria para você, dê ao seu talento o acabamento que ele merece. Chega de postar desafinado.</p>',
      'botao' => 'Quero o Studio Cover', 'link' => '{acao}', 'aviso' => 'Chega de postar desafinado.'],
  ];
}

function funnel_fill(string $s, array $u): string {
  $first = trim(explode(' ', trim($u['name'] ?: ''))[0] ?? '') ?: 'artista';
  return strtr($s, ['{nome}' => $first, '{app}' => site_url() . '/app/', '{checkout}' => checkout_url($u) ?: site_url() . '/#comprar',
    '{acao}' => ($u['status'] === 'trial' && (int)$u['trial_left'] > 0) ? site_url() . '/app/' : (checkout_url($u) ?: site_url() . '/#comprar')]);
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
    'texto' => '<p>Você ouviu como a sua voz fica afinada e mixada. Sem o Studio Cover, o próximo vídeo volta a ser o áudio cru do celular: a nota que escapa, a voz embolada na base.</p><p><b>Amanhã você vai postar mais um cover desafinado, ou vai postar com som de estúdio?</b></p><p>Libere o acesso completo e faça quantos covers quiser.</p>',
    'botao' => 'Liberar meu acesso completo', 'link' => '{checkout}', 'aviso' => 'Seu próximo cover está travado. Libere o acesso completo.']);
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
