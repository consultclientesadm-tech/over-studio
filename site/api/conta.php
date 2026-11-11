<?php
// API do aluno: cadastro do teste grátis, login, criar senha, esqueci a senha, uso do app, avisos.
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';

$a = (string)($_GET['a'] ?? '');

switch ($a) {
  case 'oferta': // dados públicos para a página de vendas
    header('Cache-Control: public, max-age=300');
    json_out(['ok' => true, 'checkout_url' => checkout_url(), 'price' => setting('price'), 'trial' => setting('trial_enabled') === '1', 'trial_videos' => (int)setting('trial_videos'), 'whatsapp' => setting('support_whatsapp')]);

  case 'me': {
    $u = current_user();
    if (!$u) json_out(['ok' => true, 'user' => null, 'trial_enabled' => setting('trial_enabled') === '1', 'trial_videos' => (int)setting('trial_videos')]);
    db()->prepare('UPDATE users SET last_seen = ? WHERE id = ?')->execute([now(), $u['id']]);
    $q = db()->prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL'); $q->execute([$u['id']]);
    json_out(['ok' => true, 'user' => public_user($u), 'unread' => (int)$q->fetchColumn(), 'whatsapp' => setting('support_whatsapp')]);
  }

  case 'cadastro': { // teste grátis
    require_post();
    if (setting('trial_enabled') !== '1') fail('O teste grátis está fechado no momento.');
    throttle('cad:' . client_ip(), 5, 3600);
    $email = clean_email((string)arg('email')); $name = trim(mb_substr((string)arg('nome'), 0, 80)); $pass = (string)arg('senha');
    if (!valid_email($email)) fail('Confira o seu e-mail.');
    if ($name === '') fail('Digite o seu nome.');
    if ($e = strong_password($pass)) fail($e);
    $q = db()->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]);
    if ($q->fetch()) fail('Este e-mail já tem cadastro. Entre com a sua senha ou use "Esqueci a senha".');
    $u = upsert_user($email, $name, ['status' => 'trial', 'source' => 'trial', 'trial_left' => (int)setting('trial_videos')]);
    db()->prepare('UPDATE users SET pass_hash = ?, last_login = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), now(), $u['id']]);
    $q->execute([$email]); $u = $q->fetch();
    login_user($u);
    funnel_welcome($u);
    json_out(['ok' => true, 'user' => public_user($u)]);
  }

  case 'login': {
    require_post();
    $email = clean_email((string)arg('email')); $pass = (string)arg('senha');
    throttle('login:' . client_ip(), 20, 900); throttle('login:' . $email, 8, 900);
    $q = db()->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]);
    $u = $q->fetch();
    if (!$u || !$u['pass_hash'] || !password_verify($pass, $u['pass_hash'])) {
      if ($u && !$u['pass_hash']) fail('Você ainda não criou a sua senha. Use o link que chegou no seu e-mail ou toque em "Esqueci a senha".');
      fail('E-mail ou senha não conferem.');
    }
    if (password_needs_rehash($u['pass_hash'], PASSWORD_DEFAULT)) db()->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
    db()->prepare('UPDATE users SET last_login = ? WHERE id = ?')->execute([now(), $u['id']]);
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
    $db->prepare('UPDATE users SET videos_used = videos_used + 1' . ($acc['paid'] ? '' : ', trial_left = MAX(0, trial_left - 1)') . ', last_seen = ? WHERE id = ?')->execute([now(), $u['id']]);
    $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([$u['id']]); $u = $q->fetch();
    if (!$acc['paid'] && (int)$u['trial_left'] === 0) funnel_trial_over($u);
    json_out(['ok' => true, 'user' => public_user($u)]);
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
