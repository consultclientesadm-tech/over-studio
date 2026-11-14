<?php
// API do aluno: cadastro do teste grátis, login, criar senha, esqueci a senha, uso do app, avisos.
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';
require_once __DIR__ . '/origem.php';

$a = (string)($_GET['a'] ?? '');

switch ($a) {
  case 'oferta': // dados públicos para a página de vendas
    header('Cache-Control: private, max-age=120'); header('Vary: Cookie'); // o preço muda com a região (Brasil, EUA, Europa)
    json_out(['ok' => true, 'checkout_url' => checkout_url()] + oferta_preco(req_regiao()) + ['trial' => setting('trial_enabled') === '1', 'trial_videos' => (int)setting('trial_videos'), 'whatsapp' => setting('support_whatsapp'), 'pixel' => setting('meta_pixel'), 'eduzz_pixel' => setting('eduzz_pixel')]);

  case 'clique': { // visita pelo link do afiliado (?af=CODIGO): guarda 60 dias e conta o clique
    $af = af_by_codigo((string)($_GET['af'] ?? ''));
    if (!$af) json_out(['ok' => false]);
    af_marca_cookie($af['codigo']);
    $q = af_db()->prepare('SELECT 1 FROM af_cliques WHERE afiliado_id = ? AND ip = ? AND created_at >= ?'); $q->execute([$af['id'], client_ip(), date('Y-m-d H:i:s', time() - 1800)]);
    if (!$q->fetch()) af_db()->prepare('INSERT INTO af_cliques (afiliado_id, ip, created_at) VALUES (?, ?, ?)')->execute([$af['id'], client_ip(), now()]);
    json_out(['ok' => true]);
  }

  case 'visita': { // página de vendas aberta: de qual página e de qual canal/campanha (para o quadro Origens do painel)
    or_registra_visita((string)($_GET['p'] ?? ''), (string)($_GET['f'] ?? ''), (string)($_GET['c'] ?? ''));
    json_out(['ok' => true]);
  }

  case 'me': {
    $u = current_user();
    if (!$u) json_out(['ok' => true, 'user' => null, 'trial_enabled' => setting('trial_enabled') === '1', 'trial_videos' => (int)setting('trial_videos')]);
    db()->prepare('UPDATE users SET last_seen = ? WHERE id = ?')->execute([now(), $u['id']]);
    marca_aparelho($u);
    $q = db()->prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL'); $q->execute([$u['id']]);
    json_out(['ok' => true, 'user' => public_user($u), 'unread' => (int)$q->fetchColumn(), 'whatsapp' => setting('support_whatsapp')]);
  }

  case 'cadastro': { // teste grátis
    require_post();
    if (setting('trial_enabled') !== '1') fail('O teste grátis está fechado no momento.');
    throttle('cad:' . client_ip(), 30, 3600); // várias pessoas no mesmo IP (internet de celular) não podem ser barradas
    $email = clean_email((string)arg('email')); $name = trim(mb_substr((string)arg('nome'), 0, 80)); $pass = (string)arg('senha');
    if (!valid_email($email)) fail('Confira o seu e-mail.');
    if ($name === '') fail('Digite o seu nome.');
    if ($e = strong_password($pass)) fail($e);
    if (!arg('aceite')) fail('Marque que leu e aceita os Termos e a Política de privacidade.');
    $q = db()->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]);
    if ($q->fetch()) fail('Este e-mail já tem cadastro. Entre com a sua senha ou use "Esqueci a senha".');
    $u = upsert_user($email, $name, ['status' => 'trial', 'source' => 'trial', 'trial_left' => (int)setting('trial_videos')]);
    db()->prepare('UPDATE users SET pass_hash = ?, last_login = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), now(), $u['id']]);
    if ($af = af_visitante()) af_db()->prepare('UPDATE users SET afiliado_id = ? WHERE id = ?')->execute([$af['id'], $u['id']]); // lead do afiliado
    registra_aceite((int)$u['id']);
    if (req_lang() !== 'pt' || req_regiao() !== 'br') marca_regiao((int)$u['id']); // cliente de fora: língua, país e região
    if ($or = or_visitante()) origem_db()->prepare('UPDATE users SET origem = ? WHERE id = ?')->execute([$or, $u['id']]); // de qual página/canal veio o teste
    $q->execute([$email]); $u = $q->fetch();
    login_user($u);
    funnel_welcome($u);
    json_out(['ok' => true, 'user' => public_user($u)]);
  }

  case 'login': {
    require_post();
    $email = clean_email((string)arg('email')); $pass = (string)arg('senha');
    throttle('login:' . client_ip(), 60, 900); throttle('login:' . $email, 8, 900);
    $q = db()->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]);
    $u = $q->fetch();
    if (!$u || !$u['pass_hash'] || !password_verify($pass, $u['pass_hash'])) {
      escudo_evento('login', 'aluno');
      if ($u && !$u['pass_hash']) fail('Você ainda não criou a sua senha. Use o link que chegou no seu e-mail ou toque em "Esqueci a senha".');
      fail('E-mail ou senha não conferem.');
    }
    if (password_needs_rehash($u['pass_hash'], PASSWORD_DEFAULT)) db()->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
    db()->prepare('UPDATE users SET last_login = ? WHERE id = ?')->execute([now(), $u['id']]);
    if (req_lang() !== 'pt' && ($u['lang'] ?? '') === '') { marca_regiao((int)$u['id']); $q->execute([$email]); $u = $q->fetch(); }
    login_user($u);
    json_out(['ok' => true, 'user' => public_user($u)]);
  }

  case 'sair': { require_post(); session(); unset($_SESSION['uid'], $_SESSION['uver']); json_out(['ok' => true]); }

  case 'token': { // confere o link de criar senha antes de mostrar o formulário
    $u = user_by_token((string)arg('t'));
    json_out(['ok' => (bool)$u, 'email' => $u['email'] ?? '', 'name' => $u['name'] ?? '']);
  }

  case 'criar-senha': {
    require_post();
    throttle('tok:' . client_ip(), 20, 900);
    $u = user_by_token((string)arg('t'));
    if (!$u) fail('Este link venceu ou já foi usado. Peça um novo em "Esqueci a senha".');
    $pass = (string)arg('senha');
    if ($e = strong_password($pass)) fail($e);
    $hash = password_hash($pass, PASSWORD_DEFAULT);
    db()->prepare('UPDATE users SET pass_hash = ?, token = NULL, token_exp = NULL, last_login = ? WHERE id = ?')->execute([$hash, now(), $u['id']]);
    if (arg('aceite')) registra_aceite((int)$u['id']);
    if ((string)arg('trans') === '') escudo_evento('senha_obrigado', $u['email']);
    $u['pass_hash'] = $hash;
    login_user($u);
    json_out(['ok' => true, 'user' => public_user($u)]);
  }

  case 'obrigado': { // página de obrigado: confere se a compra deste e-mail já chegou da Eduzz
    require_post();
    throttle('obr:' . client_ip(), 60, 900);
    [$u, $st] = compra_recente(clean_email((string)arg('email')), (string)arg('trans'));
    json_out(['ok' => true, 'estado' => $st, 'nome' => $u ? explode(' ', (string)$u['name'])[0] : '']);
  }

  case 'obrigado-senha': { // cria a senha ali mesmo, só para compra paga nas últimas horas e ainda sem senha
    require_post();
    throttle('obrs:' . client_ip(), 10, 900);
    [$u, $st] = compra_recente(clean_email((string)arg('email')), (string)arg('trans'));
    throttle('obrse:' . clean_email((string)arg('email')), 4, 3600);
    if ($st !== 'criar') fail($st === 'tem_senha' ? 'Você já tem senha. Toque em "Entrar".' : 'Não achamos a compra deste e-mail. Use o link que chegou no seu e-mail.');
    $pass = (string)arg('senha');
    if ($e = strong_password($pass)) fail($e);
    $hash = password_hash($pass, PASSWORD_DEFAULT);
    db()->prepare('UPDATE users SET pass_hash = ?, last_login = ? WHERE id = ?')->execute([$hash, now(), $u['id']]);
    if (arg('aceite')) registra_aceite((int)$u['id']);
    $u['pass_hash'] = $hash;
    login_user($u);
    json_out(['ok' => true, 'user' => public_user($u)]);
  }

  case 'esqueci': {
    require_post();
    $email = clean_email((string)arg('email'));
    throttle('esq:' . client_ip(), 6, 3600); throttle('esq:' . $email, 3, 3600);
    $q = db()->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]);
    if ($u = $q->fetch()) {
      $link = set_password_link($u, 1);
      send_mail($u, $u['email'], 'esqueci', 'Crie uma nova senha', 'Vamos criar uma nova senha',
        '<p>Oi' . ($u['name'] ? ', ' . h(explode(' ', $u['name'])[0]) : '') . '! Toque no botão para criar a sua nova senha. O link vale por 24 horas.</p><p>Se não foi você que pediu, pode ignorar este e-mail.</p>',
        'Criar nova senha', $link);
    }
    json_out(['ok' => true]); // sempre igual: não revela quem tem cadastro
  }

  case 'usar': { // o app chama antes de processar um vídeo/áudio
    require_post();
    $u = current_user();
    if (!$u) fail('Entre na sua conta.', 401);
    $acc = access($u);
    if (!$acc['can_use']) json_out(['ok' => false, 'paywall' => true, 'user' => public_user($u)]);
    $kind = arg('tipo') === 'audio' ? 'audio' : 'video';
    $db = db();
    $db->prepare('INSERT INTO usage (user_id, kind, mb, created_at) VALUES (?, ?, ?, ?)')->execute([$u['id'], $kind, (float)arg('mb', 0), now()]);
    // o vídeo do teste só é descontado quando abre no estúdio (ação "consumir"); se der erro no meio, a pessoa não perde o teste
    $db->prepare('UPDATE users SET videos_used = videos_used + 1' . ($acc['paid'] ? '' : ', trial_hold = 1') . ', last_seen = ? WHERE id = ?')->execute([now(), $u['id']]);
    $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([$u['id']]); $u = $q->fetch();
    json_out(['ok' => true, 'user' => public_user($u), 'restam_depois' => $acc['paid'] ? null : max(0, (int)$u['trial_left'] - 1)]);
  }

  case 'consumir': { // o app chama quando o vídeo abre no estúdio (a pessoa já vê e ouve o antes e depois): aí desconta o vídeo do teste grátis
    require_post();
    $u = current_user();
    if (!$u) fail('Entre na sua conta.', 401);
    $acc = access($u);
    if (!$acc['paid'] && (int)$u['trial_hold'] === 1) {
      $db = db();
      $db->prepare('UPDATE users SET trial_left = MAX(0, trial_left - 1), trial_hold = 0 WHERE id = ?')->execute([$u['id']]);
      $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([$u['id']]); $u = $q->fetch();
      if ((int)$u['trial_left'] === 0) funnel_trial_over($u);
    }
    json_out(['ok' => true, 'user' => public_user($u)]);
  }

  case 'baixar': { // a pessoa tocou em baixar o vídeo/áudio pronto: no teste só baixa quem comprou (ou quem ganhou um download de presente)
    require_post();
    $u = current_user();
    if (!$u) fail('Entre na sua conta.', 401);
    $acc = access($u);
    if ($acc['paid']) json_out(['ok' => true, 'user' => public_user($u)]);
    if ((int)($u['baixar_livre'] ?? 0) > 0 && !$acc['blocked']) {
      db()->prepare('UPDATE users SET baixar_livre = MAX(0, baixar_livre - 1) WHERE id = ?')->execute([$u['id']]);
      $q = db()->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([$u['id']]); $u = $q->fetch();
      json_out(['ok' => true, 'presente' => true, 'user' => public_user($u)]);
    }
    json_out(['ok' => false, 'bloqueado' => true, 'user' => public_user($u)]);
  }

  case 'evento': { // diário do app: o que aconteceu com cada vídeo (sem o vídeo, só números e mensagens de erro)
    require_post();
    $u = current_user(); if (!$u) json_out(['ok' => true]);
    throttle('ev:' . $u['id'], 120, 3600);
    $k = preg_replace('/[^a-z]/', '', (string)arg('k'));
    if (!in_array($k, ['inicio', 'abriu', 'pronto', 'exportou', 'erro', 'fechou', 'saiu', 'quisbaixar', 'liberou'], true)) json_out(['ok' => true]);
    $d = arg('d', []); $d = is_array($d) ? array_slice($d, 0, 16, true) : [];
    foreach ($d as $i => $v) $d[$i] = is_scalar($v) ? mb_substr((string)$v, 0, 200) : '';
    app_events_db()->prepare('INSERT INTO app_events (user_id, kind, data, ua, created_at) VALUES (?, ?, ?, ?, ?)')
      ->execute([$u['id'], $k, json_encode($d, JSON_UNESCAPED_UNICODE), mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250), now()]);
    if ($k === 'inicio' || $k === 'abriu') marca_aparelho($u, (string)($d['modelo'] ?? ''));
    if ($k === 'erro' || $k === 'fechou') { // erro chegou: se a vistoria não rodou nos últimos minutos, roda agora (depois de responder ao app)
      require_once __DIR__ . '/vigia_erros.php';
      // qualquer cliente com erro recebe na hora um aviso acolhedor no app/celular, pela causa provável do aparelho
      // (velho / atualizar / navegador / vendo); cliente pago recebe também o e-mail. No máximo 1 a cada 24h.
      $et = (string)($d['etapa'] ?? '');
      if ($et !== 'externo' && $et !== 'rede' && empty($d['retomou'])) { $uu = $u; $causa = (string)($d['causa_ap'] ?? ''); register_shutdown_function(function () use ($uu, $causa) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try { desculpa_cliente($uu, $causa); } catch (Throwable $e) {}
      }); }
      $vl = setting('vigia_erros_last');
      if (!$vl || strtotime($vl) < time() - VIGIA_ERROS_RAPIDO) register_shutdown_function(function () {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try { erros_vigia(false, VIGIA_ERROS_RAPIDO); } catch (Throwable $e) {}
      });
    }
    json_out(['ok' => true]);
  }
  case 'push-chave': json_out(['ok' => true, 'chave' => vapid_public()]);
  case 'push-salvar': {
    require_post();
    $u = current_user(); if (!$u) fail('Entre na sua conta.', 401);
    push_save((int)$u['id'], (array)arg('sub', []), (string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    json_out(['ok' => true]);
  }
  case 'avisos': {
    $u = current_user(); if (!$u) fail('Entre na sua conta.', 401);
    $q = db()->prepare('SELECT id, title, body, url, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30'); $q->execute([$u['id']]);
    json_out(['ok' => true, 'items' => $q->fetchAll()]);
  }
  case 'lido': {
    require_post();
    $u = current_user(); if (!$u) fail('Entre na sua conta.', 401);
    db()->prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')->execute([now(), $u['id']]);
    json_out(['ok' => true]);
  }

  case 'legal': { // quem é o controlador dos dados (Política de privacidade e Termos)
    header('Cache-Control: public, max-age=300');
    json_out(['ok' => true, 'empresa' => setting('empresa_nome'), 'doc' => setting('empresa_doc'), 'email' => setting('dpo_email') ?: setting('mail_from'), 'whatsapp' => setting('support_whatsapp'), 'versao' => LGPD_VERSAO]);
  }
  case 'meus-dados': { // LGPD: baixar uma cópia dos meus dados
    $u = current_user(); if (!$u) fail('Entre na sua conta.', 401);
    throttle('dados:' . $u['id'], 10, 3600);
    header('Content-Disposition: attachment; filename="meus-dados-studio-cover.json"');
    json_out(['ok' => true] + lgpd_exportar($u));
  }
  case 'apagar-conta': { // LGPD: apagar a minha conta (pede a senha de novo)
    require_post();
    $u = current_user(); if (!$u) fail('Entre na sua conta.', 401);
    throttle('apagar:' . $u['id'], 5, 3600);
    if (!password_verify((string)arg('senha'), (string)$u['pass_hash'])) fail('Senha errada.');
    lgpd_apagar($u);
    session(); unset($_SESSION['uid'], $_SESSION['uver']);
    json_out(['ok' => true]);
  }
  case 'sair-lista': { // link de descadastro do e-mail (GET)
    $t = (string)($_GET['t'] ?? '');
    if ($t !== '') db()->prepare('UPDATE users SET unsub = 1 WHERE unsub_token = ?')->execute([$t]);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#050506;color:#fff;font-family:Arial;display:grid;place-items:center;min-height:90vh;text-align:center"><div><h2>Pronto.</h2><p style="color:#aaa">Você não vai mais receber os nossos e-mails de novidades.</p></div>';
    exit;
  }
}
fail('Ação desconhecida.', 404);

function user_by_token(string $t): ?array {
  if (strlen($t) < 20) return null;
  $q = db()->prepare('SELECT * FROM users WHERE token = ? AND token_exp > ?'); $q->execute([hash('sha256', $t), now()]);
  return $q->fetch() ?: null;
}

// compra que acabou de acontecer: devolve [pessoa, estado]
// estados: esperando (a Eduzz ainda não avisou), criar (pode criar a senha aqui), tem_senha, antiga (só pelo link do e-mail)
function compra_recente(string $email, string $trans): array {
  if (!valid_email($email)) return [null, 'esperando'];
  $q = db()->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]);
  $u = $q->fetch();
  if (!$u || !access($u)['paid']) return [null, 'esperando'];
  if ($u['pass_hash']) return [$u, 'tem_senha'];
  if (!$u['paid_at'] || strtotime($u['paid_at']) < time() - 3 * 3600) return [$u, 'antiga'];
  if ($trans === '' && strtotime($u['paid_at']) < time() - 45 * 60) return [$u, 'antiga']; // sem o código da fatura, só logo depois da compra (protege a conta de quem souber só o e-mail)
  if ($trans !== '') { // se a Eduzz mandou o código da fatura, ele tem que bater
    $q = db()->prepare("SELECT 1 FROM sales WHERE user_id = ? AND trans = ? AND status = 'pago'"); $q->execute([$u['id'], $trans]);
    if (!$q->fetch()) return [$u, 'antiga'];
  }
  return [$u, 'criar'];
}
