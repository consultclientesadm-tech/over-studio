<?php
// API do painel administrativo.
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';
header('X-Robots-Tag: noindex');
$a = (string)($_GET['a'] ?? '');
$db = db();

// ---------- sem login ----------
if ($a === 'estado') {
  $n = (int)$db->query('SELECT COUNT(*) FROM admins')->fetchColumn();
  $me = current_admin();
  json_out(['ok' => true, 'precisa_criar' => $n === 0, 'admin' => $me]);
}
if ($a === 'primeiro') { // cria o primeiro administrador (precisa da chave do config.php)
  require_post();
  throttle('adm1:' . client_ip(), 10, 3600);
  if ((int)$db->query('SELECT COUNT(*) FROM admins')->fetchColumn() > 0) fail('Já existe administrador.');
  $key = (string)cfg('setup_key');
  if ($key === '' || !hash_equals($key, (string)arg('chave'))) fail('Chave de instalação errada.', 403);
  admin_create((string)arg('email'), (string)arg('nome'), (string)arg('senha'), null);
  $q = $db->prepare('SELECT * FROM admins WHERE email = ?'); $q->execute([clean_email((string)arg('email'))]);
  admin_login($q->fetch());
  json_out(['ok' => true]);
}
if ($a === 'login') {
  require_post();
  $email = clean_email((string)arg('email'));
  throttle('alog:' . client_ip(), 10, 900); throttle('alog:' . $email, 5, 900);
  $q = $db->prepare('SELECT * FROM admins WHERE email = ?'); $q->execute([$email]);
  $ad = $q->fetch();
  if (!$ad || !password_verify((string)arg('senha'), $ad['pass_hash'])) { usleep(400000); fail('E-mail ou senha não conferem.'); }
  admin_login($ad);
  json_out(['ok' => true]);
}
if ($a === 'sair') { require_post(); session(); unset($_SESSION['aid'], $_SESSION['aver'], $_SESSION['aat']); json_out(['ok' => true]); }

// ---------- daqui para baixo, só administrador ----------
$me = require_admin();
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') require_post();

switch ($a) {
  case 'resumo': {
    $days = max(7, min(365, (int)($_GET['dias'] ?? 30)));
    $since = date('Y-m-d', time() - ($days - 1) * 86400);
    $one = fn($sql, $p = []) => (function () use ($db, $sql, $p) { $q = $db->prepare($sql); $q->execute($p); return $q->fetchColumn(); })();
    $tot = [
      'alunos_pagos' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?)", [now()]),
      'em_teste' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'trial'"),
      'teste_acabou' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'trial' AND trial_left = 0"),
      'reembolsos' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'refunded'"),
      'bloqueados' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'blocked'"),
      'total_contas' => (int)$one('SELECT COUNT(*) FROM users'),
      'faturamento_total' => (float)$one('SELECT COALESCE(SUM(value), 0) FROM sales'),
      'faturamento_periodo' => (float)$one('SELECT COALESCE(SUM(value), 0) FROM sales WHERE created_at >= ?', [$since]),
      'vendas_periodo' => (int)$one("SELECT COUNT(*) FROM sales WHERE status = 'pago' AND created_at >= ?", [$since]),
      'faturamento_hoje' => (float)$one('SELECT COALESCE(SUM(value), 0) FROM sales WHERE created_at >= ?', [date('Y-m-d')]),
      'faturamento_mes' => (float)$one('SELECT COALESCE(SUM(value), 0) FROM sales WHERE created_at >= ?', [date('Y-m-01')]),
      'videos_periodo' => (int)$one('SELECT COUNT(*) FROM usage WHERE created_at >= ?', [$since]),
      'ativos_7d' => (int)$one('SELECT COUNT(*) FROM users WHERE last_seen >= ?', [date('Y-m-d H:i:s', time() - 7 * 86400)]),
      'testes_periodo' => (int)$one("SELECT COUNT(*) FROM users WHERE source = 'trial' AND created_at >= ?", [$since]),
      'testes_convertidos' => (int)$one("SELECT COUNT(*) FROM users WHERE source = 'trial' AND paid_at IS NOT NULL"),
      'testes_total' => (int)$one("SELECT COUNT(*) FROM users WHERE source = 'trial'"),
    ];
    $tot['ticket_medio'] = $tot['vendas_periodo'] ? $tot['faturamento_periodo'] / $tot['vendas_periodo'] : 0;
    $tot['conversao_teste'] = $tot['testes_total'] ? $tot['testes_convertidos'] / $tot['testes_total'] : 0;
    $series = function (string $sql) use ($db, $since, $days) {
      $q = $db->prepare($sql); $q->execute([$since]); $m = [];
      foreach ($q as $r) $m[$r['d']] = (float)$r['v'];
      $out = [];
      for ($i = $days - 1; $i >= 0; $i--) { $d = date('Y-m-d', time() - $i * 86400); $out[] = ['d' => $d, 'v' => $m[$d] ?? 0]; }
      return $out;
    };
    json_out(['ok' => true, 'dias' => $days, 'tot' => $tot,
      'faturamento' => $series('SELECT substr(created_at, 1, 10) d, SUM(value) v FROM sales WHERE created_at >= ? GROUP BY d'),
      'vendas' => $series("SELECT substr(created_at, 1, 10) d, COUNT(*) v FROM sales WHERE status = 'pago' AND created_at >= ? GROUP BY d"),
      'cadastros' => $series('SELECT substr(created_at, 1, 10) d, COUNT(*) v FROM users WHERE created_at >= ? GROUP BY d'),
      'videos' => $series('SELECT substr(created_at, 1, 10) d, COUNT(*) v FROM usage WHERE created_at >= ? GROUP BY d'),
      'funil' => funnel_counts(),
      'ultimas_vendas' => $db->query('SELECT s.created_at, s.email, s.value, s.status, u.name FROM sales s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 8')->fetchAll(),
    ]);
  }

  case 'alunos': {
    $busca = trim((string)($_GET['busca'] ?? '')); $st = (string)($_GET['status'] ?? '');
    $pag = max(1, (int)($_GET['pag'] ?? 1)); $per = 50;
    $w = []; $p = [];
    if ($busca !== '') { $w[] = '(email LIKE ? OR name LIKE ? OR phone LIKE ?)'; array_push($p, "%$busca%", "%$busca%", "%$busca%"); }
    if (in_array($st, ['trial', 'active', 'blocked', 'refunded'], true)) { $w[] = 'status = ?'; $p[] = $st; }
    $where = $w ? 'WHERE ' . implode(' AND ', $w) : '';
    $q = $db->prepare("SELECT COUNT(*) FROM users $where"); $q->execute($p); $total = (int)$q->fetchColumn();
    $q = $db->prepare("SELECT id, email, name, phone, status, source, trial_left, videos_used, paid_value, paid_at, expires_at, created_at, last_seen, funnel_step, unsub, (pass_hash IS NOT NULL) AS tem_senha FROM users $where ORDER BY id DESC LIMIT $per OFFSET " . (($pag - 1) * $per));
    $q->execute($p);
    json_out(['ok' => true, 'total' => $total, 'pag' => $pag, 'por_pag' => $per, 'items' => $q->fetchAll()]);
  }

  case 'aluno-salvar': { // muda status, teste, validade
    $id = (int)arg('id');
    $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([$id]); $u = $q->fetch();
    if (!$u) fail('Aluno não encontrado.');
    $status = (string)arg('status', $u['status']);
    if (!in_array($status, ['trial', 'active', 'blocked', 'refunded'], true)) fail('Status inválido.');
    $exp = trim((string)arg('expires_at', (string)$u['expires_at']));
    if ($status === 'active' && $u['status'] !== 'active' && $exp === '') { $d = (int)setting('access_days'); $exp = $d > 0 ? date('Y-m-d H:i:s', time() + $d * 86400) : ''; }
    $db->prepare('UPDATE users SET name = ?, status = ?, trial_left = ?, expires_at = ? WHERE id = ?')
      ->execute([trim((string)arg('name', $u['name'])), $status, max(0, (int)arg('trial_left', $u['trial_left'])), $exp === '' ? null : $exp, $id]);
    if ($status === 'active' && $u['status'] !== 'active') notify($id, 'Acesso completo liberado', 'Seu acesso ao Studio Cover foi liberado.', site_url() . '/app/');
    json_out(['ok' => true]);
  }

  case 'aluno-criar': { // libera acesso na mão (cortesia, parceiro, suporte)
    $email = clean_email((string)arg('email'));
    if (!valid_email($email)) fail('E-mail inválido.');
    $tipo = arg('tipo') === 'trial' ? 'trial' : 'active';
    $u = upsert_user($email, trim((string)arg('nome')), ['status' => $tipo, 'source' => 'admin', 'trial_left' => (int)setting('trial_videos')]);
    if ($tipo === 'active') { $d = (int)setting('access_days'); $db->prepare("UPDATE users SET status = 'active', expires_at = ? WHERE id = ?")->execute([$d > 0 ? date('Y-m-d H:i:s', time() + $d * 86400) : null, $u['id']]); }
    else $db->prepare("UPDATE users SET status = 'trial', trial_left = MAX(trial_left, ?) WHERE id = ?")->execute([(int)setting('trial_videos'), $u['id']]);
    $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([$u['id']]); $u = $q->fetch();
    $link = set_password_link($u, 30);
    $sent = arg('enviar', true) ? send_mail($u, $u['email'], 'senha', 'Seu acesso ao Studio Cover chegou! Crie a sua senha', 'Seu acesso está liberado 🎉',
      '<p>Você recebeu acesso ao Studio Cover. Crie a sua senha para entrar.</p>', 'Criar minha senha', $link) : false;
    json_out(['ok' => true, 'link' => $link, 'email_enviado' => $sent]);
  }

  case 'aluno-link': { // gera um link novo de criar senha (para mandar no WhatsApp, por exemplo)
    $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([(int)arg('id')]); $u = $q->fetch();
    if (!$u) fail('Aluno não encontrado.');
    $link = set_password_link($u, 7);
    $sent = arg('enviar') ? send_mail($u, $u['email'], 'senha', 'Crie a sua senha do Studio Cover', 'Crie a sua senha', '<p>Toque no botão para criar a sua senha e entrar no Studio Cover.</p>', 'Criar minha senha', $link) : null;
    json_out(['ok' => true, 'link' => $link, 'email_enviado' => $sent]);
  }

  case 'aluno-apagar': {
    $id = (int)arg('id');
    foreach (['notifications', 'usage'] as $t) $db->prepare("DELETE FROM $t WHERE user_id = ?")->execute([$id]);
    $db->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    json_out(['ok' => true]);
  }

  case 'avisar': { // aviso no app para um aluno ou para um grupo
    $title = trim((string)arg('titulo')); $body = trim((string)arg('texto')); $url = trim((string)arg('link'));
    if ($title === '' || $body === '') fail('Escreva o título e o texto.');
    $grupo = (string)arg('grupo');
    $ids = [];
    if ($grupo === 'um') $ids = [(int)arg('id')];
    else {
      $sql = ['todos' => 'SELECT id FROM users', 'pagos' => "SELECT id FROM users WHERE status = 'active'", 'teste' => "SELECT id FROM users WHERE status = 'trial'"][$grupo] ?? null;
      if (!$sql) fail('Grupo inválido.');
      $ids = array_column($db->query($sql)->fetchAll(), 'id');
    }
    $db->beginTransaction(); foreach ($ids as $id) notify((int)$id, $title, $body, $url); $db->commit();
    json_out(['ok' => true, 'enviados' => count($ids)]);
  }

  case 'admins': json_out(['ok' => true, 'items' => $db->query('SELECT id, email, name, created_at, last_login FROM admins ORDER BY id')->fetchAll(), 'eu' => (int)$me['id']]);
  case 'admin-criar': { admin_create((string)arg('email'), (string)arg('nome'), (string)arg('senha'), (int)$me['id']); json_out(['ok' => true]); }
  case 'admin-apagar': {
    $id = (int)arg('id');
    if ($id === (int)$me['id']) fail('Você não pode apagar o seu próprio acesso.');
    if ((int)$db->query('SELECT COUNT(*) FROM admins')->fetchColumn() <= 1) fail('Precisa sobrar pelo menos um administrador.');
    $db->prepare('DELETE FROM admins WHERE id = ?')->execute([$id]);
    json_out(['ok' => true]);
  }
  case 'minha-senha': {
    $q = $db->prepare('SELECT pass_hash FROM admins WHERE id = ?'); $q->execute([$me['id']]);
    if (!password_verify((string)arg('atual'), (string)$q->fetchColumn())) fail('Senha atual errada.');
    if ($e = strong_password((string)arg('nova'))) fail($e);
    $h = password_hash((string)arg('nova'), PASSWORD_DEFAULT);
    $db->prepare('UPDATE admins SET pass_hash = ? WHERE id = ?')->execute([$h, $me['id']]);
    $_SESSION['aver'] = substr($h, -12);
    json_out(['ok' => true]);
  }

  case 'config': {
    $out = [];
    foreach (SETTINGS_DEFAULT as $k => $_) $out[$k] = $k === 'smtp_pass' ? (setting($k) !== '' ? '••••••••' : '') : setting($k);
    $out['webhook_url'] = site_url() . '/api/webhook.php?token=' . setting('webhook_token');
    $out['cron_last'] = setting('cron_last');
    json_out(['ok' => true, 'config' => $out]);
  }
  case 'config-salvar': {
    $in = input();
    foreach (SETTINGS_DEFAULT as $k => $_) {
      if (!array_key_exists($k, $in) || $k === 'webhook_token') continue;
      $v = trim((string)$in[$k]);
      if ($k === 'smtp_pass' && $v === '••••••••') continue;
      if (in_array($k, ['trial_videos', 'access_days', 'smtp_port'], true)) $v = (string)max(0, (int)$v);
      if ($k === 'meta_pixel') $v = preg_replace('/\D/', '', $v);
      if ($k === 'checkout_url' && $v !== '' && !preg_match('#^https://#', $v)) fail('O link do checkout precisa começar com https://');
      set_setting($k, $v);
    }
    json_out(['ok' => true]);
  }
  case 'webhook-novo-token': { set_setting('webhook_token', bin2hex(random_bytes(16))); json_out(['ok' => true]); }
  case 'webhooks': json_out(['ok' => true, 'items' => $db->query('SELECT id, created_at, ip, result, body FROM webhooks ORDER BY id DESC LIMIT 50')->fetchAll()]);
  case 'emails': json_out(['ok' => true, 'items' => $db->query('SELECT created_at, email, kind, subject, ok, error FROM emails ORDER BY id DESC LIMIT 100')->fetchAll()]);
  case 'email-teste': {
    $ok = send_mail(null, $me['email'], 'teste', 'Teste de e-mail do Studio Cover', 'O e-mail está funcionando ✅', '<p>Se você recebeu esta mensagem, os e-mails dos alunos e do funil vão chegar.</p>');
    $q = $db->query('SELECT error FROM emails ORDER BY id DESC LIMIT 1');
    json_out(['ok' => $ok, 'error' => $ok ? null : $q->fetchColumn()]);
  }
  case 'funil': {
    $steps = []; foreach (funnel_steps() as $i => $s) $steps[] = ['passo' => $i, 'dia' => $s['dia'], 'assunto' => $s['assunto'], 'aviso' => $s['aviso']];
    json_out(['ok' => true, 'passos' => $steps, 'contagem' => funnel_counts(), 'cron_last' => setting('cron_last')]);
  }
  case 'funil-rodar': json_out(['ok' => true] + run_funnel(true));
}
fail('Ação desconhecida.', 404);

function admin_create(string $email, string $name, string $pass, ?int $by): void {
  $email = clean_email($email);
  if (!valid_email($email)) fail('E-mail inválido.');
  if ($e = strong_password($pass)) fail($e);
  $q = db()->prepare('SELECT 1 FROM admins WHERE email = ?'); $q->execute([$email]);
  if ($q->fetch()) fail('Este e-mail já é administrador.');
  db()->prepare('INSERT INTO admins (email, name, pass_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?)')->execute([$email, trim($name), password_hash($pass, PASSWORD_DEFAULT), now(), $by]);
}
function admin_login(array $ad): void {
  session(); session_regenerate_id(true);
  $_SESSION['aid'] = (int)$ad['id']; $_SESSION['aver'] = substr($ad['pass_hash'], -12); $_SESSION['aat'] = time();
  db()->prepare('UPDATE admins SET last_login = ? WHERE id = ?')->execute([now(), $ad['id']]);
}
function funnel_counts(): array {
  $r = []; foreach (db()->query("SELECT funnel_step s, COUNT(*) n FROM users WHERE status = 'trial' GROUP BY funnel_step") as $x) $r[(int)$x['s']] = (int)$x['n'];
  return $r;
}
