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
// tudo que muda alguma coisa só por POST com o cabeçalho X-SC: um link ou página de fora não consegue apagar/alterar nada
if (!in_array($a, ['resumo', 'hoje', 'app-saude', 'afiliados', 'alunos', 'admins', 'config', 'webhooks', 'emails', 'funil'], true) || ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') require_post();

switch ($a) {
  case 'resumo': {
    sales_fill_net();
    $days = max(7, min(365, (int)($_GET['dias'] ?? 30)));
    $since = date('Y-m-d', time() - ($days - 1) * 86400);
    $one = fn($sql, $p = []) => (function () use ($db, $sql, $p) { $q = $db->prepare($sql); $q->execute($p); return $q->fetchColumn(); })();
    $tot = [
      'alunos_pagos' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'active' AND paid_value > 0 AND (expires_at IS NULL OR expires_at > ?)", [now()]),
      'cortesias' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'active' AND paid_value <= 0 AND (expires_at IS NULL OR expires_at > ?)", [now()]),
      'em_teste' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'trial'"),
      'teste_acabou' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'trial' AND trial_left = 0"),
      'reembolsos' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'refunded'"),
      'bloqueados' => (int)$one("SELECT COUNT(*) FROM users WHERE status = 'blocked'"),
      'total_contas' => (int)$one('SELECT COUNT(*) FROM users'),
      'faturamento_total' => (float)$one('SELECT COALESCE(SUM(liquido), 0) FROM sales'),
      'faturamento_periodo' => (float)$one('SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE created_at >= ?', [$since]),
      'vendas_periodo' => (int)$one("SELECT COUNT(*) FROM sales WHERE status = 'pago' AND created_at >= ?", [$since]),
      'faturamento_hoje' => (float)$one('SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE created_at >= ?', [date('Y-m-d')]),
      'faturamento_mes' => (float)$one('SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE created_at >= ?', [date('Y-m-01')]),
      'videos_periodo' => (int)$one('SELECT COUNT(*) FROM usage WHERE created_at >= ?', [$since]),
      'ativos_7d' => (int)$one('SELECT COUNT(*) FROM users WHERE last_seen >= ?', [date('Y-m-d H:i:s', time() - 7 * 86400)]),
      'testes_periodo' => (int)$one("SELECT COUNT(*) FROM users WHERE source = 'trial' AND created_at >= ?", [$since]),
      'testes_convertidos' => (int)$one("SELECT COUNT(*) FROM users WHERE source = 'trial' AND paid_at IS NOT NULL"),
      'testes_total' => (int)$one("SELECT COUNT(*) FROM users WHERE source = 'trial'"),
    ];
    // saúde financeira (reembolso entra como venda negativa)
    $tot['bruto_total'] = (float)$one('SELECT COALESCE(SUM(bruto), 0) FROM sales WHERE value > 0');
    $tot['taxas_total'] = (float)$one('SELECT COALESCE(SUM(taxa), 0) FROM sales WHERE value > 0');
    $tot['socio_pct'] = max(0, min(100, brnum(setting('socio_pct'))));
    $tot['reembolsado_total'] = abs((float)$one('SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE value < 0'));
    $tot['bruto_periodo'] = (float)$one('SELECT COALESCE(SUM(bruto), 0) FROM sales WHERE value > 0 AND created_at >= ?', [$since]);
    $tot['reembolsado_periodo'] = abs((float)$one('SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE value < 0 AND created_at >= ?', [$since]));
    $tot['reembolsos_periodo'] = (int)$one("SELECT COUNT(*) FROM sales WHERE value < 0 AND created_at >= ?", [$since]);
    $liqVendido = (float)$one('SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE value > 0');
    $tot['taxa_reembolso'] = $liqVendido > 0 ? $tot['reembolsado_total'] / $liqVendido : 0;
    $tot['carteira_anual'] = (float)$one("SELECT COALESCE(SUM(s.liquido), 0) FROM sales s JOIN users u ON u.id = s.user_id WHERE s.status = 'pago' AND s.created_at >= ? AND u.status = 'active' AND (u.expires_at IS NULL OR u.expires_at > ?)", [date('Y-m-d H:i:s', time() - 365 * 86400), now()]);
    $tot['mrr'] = $tot['carteira_anual'] / 12;
    $tot['renova_30d'] = (int)$one("SELECT COUNT(*) FROM users WHERE status = 'active' AND paid_value > 0 AND expires_at > ? AND expires_at <= ?", [now(), date('Y-m-d H:i:s', time() + 30 * 86400)]) * sale_net(brnum(setting('price')))['liquido'];
    $tot['fat_mes_anterior'] = (float)$one('SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE created_at >= ? AND created_at < ?', [date('Y-m-01', strtotime('first day of last month')), date('Y-m-01')]);
    $tot['emails_ok_7d'] = (int)$one('SELECT COUNT(*) FROM emails WHERE ok = 1 AND created_at >= ?', [date('Y-m-d H:i:s', time() - 7 * 86400)]);
    $tot['emails_falha_7d'] = (int)$one('SELECT COUNT(*) FROM emails WHERE ok = 0 AND created_at >= ?', [date('Y-m-d H:i:s', time() - 7 * 86400)]);
    // nossas x afiliados (o líquido de afiliado já vem sem a comissão dele)
    foreach (['direto' => 'afiliado_id IS NULL', 'afiliado' => 'afiliado_id IS NOT NULL'] as $k => $w) {
      $tot["liq_$k"] = (float)$one("SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE $w");
      $tot["liq_{$k}_mes"] = (float)$one("SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE $w AND created_at >= ?", [date('Y-m-01')]);
      $tot["vendas_$k"] = (int)$one("SELECT COUNT(*) FROM sales WHERE $w AND status = 'pago'");
      $tot["bruto_$k"] = (float)$one("SELECT COALESCE(SUM(bruto), 0) FROM sales WHERE $w AND value > 0");
    }
    $tot['comissoes_total'] = (float)$one('SELECT COALESCE(SUM(comissao), 0) FROM sales WHERE afiliado_id IS NOT NULL');
    $tot['af_comissao_pct'] = brnum(setting('af_comissao_pct'));
    // ritmo para o medidor de saúde: vendas dos últimos 7 dias contra os 7 anteriores
    $tot['vendas_7d'] = (int)$one("SELECT COUNT(*) FROM sales WHERE status = 'pago' AND value > 0 AND created_at >= ?", [date('Y-m-d', time() - 6 * 86400)]);
    $tot['vendas_7d_ant'] = (int)$one("SELECT COUNT(*) FROM sales WHERE status = 'pago' AND value > 0 AND created_at >= ? AND created_at < ?", [date('Y-m-d', time() - 13 * 86400), date('Y-m-d', time() - 6 * 86400)]);
    $tot['cadastros_7d'] = (int)$one('SELECT COUNT(*) FROM users WHERE created_at >= ?', [date('Y-m-d', time() - 6 * 86400)]);
    $tot['meta_vendas_dia'] = max(0.1, brnum(setting('meta_vendas_dia')));
    $tot['saude'] = json_decode(setting('saude') ?: 'null', true);
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
      'faturamento' => $series('SELECT substr(created_at, 1, 10) d, SUM(liquido) v FROM sales WHERE created_at >= ? GROUP BY d'),
      'vendas' => $series("SELECT substr(created_at, 1, 10) d, COUNT(*) v FROM sales WHERE status = 'pago' AND created_at >= ? GROUP BY d"),
      'cadastros' => $series('SELECT substr(created_at, 1, 10) d, COUNT(*) v FROM users WHERE created_at >= ? GROUP BY d'),
      'videos' => $series('SELECT substr(created_at, 1, 10) d, COUNT(*) v FROM usage WHERE created_at >= ? GROUP BY d'),
      'funil' => funnel_counts(),
      'ultimas_vendas' => $db->query('SELECT s.id, s.created_at, s.email, s.value, s.bruto, s.taxa, s.liquido, s.status, u.name FROM sales s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 8')->fetchAll(),
    ]);
  }

  case 'hoje': { // gráfico ao vivo do dia: vendas de hoje e de ontem (para comparar), cadastros por hora
    sales_fill_net(); af_db();
    $hoje = date('Y-m-d'); $ontem = date('Y-m-d', time() - 86400);
    $q = $db->prepare("SELECT s.id, s.created_at, s.value, s.bruto, s.liquido, s.afiliado_id, u.name FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.created_at >= ? AND s.created_at < ? AND (s.status = 'pago' OR s.value < 0) ORDER BY s.created_at");
    $dia = function (string $d) use ($q) { $q->execute([$d, date('Y-m-d', strtotime($d) + 86400 + 3600)]); return array_values(array_filter(array_map(fn($r) => [
      'id' => (int)$r['id'], 'h' => substr($r['created_at'], 11, 5), 'min' => (int)substr($r['created_at'], 11, 2) * 60 + (int)substr($r['created_at'], 14, 2), 'd' => substr($r['created_at'], 0, 10),
      'liquido' => (float)$r['liquido'], 'bruto' => (float)$r['bruto'], 'af' => $r['afiliado_id'] ? 1 : 0, 'nome' => explode(' ', trim((string)$r['name']))[0] ?? ''], $q->fetchAll()), fn($x) => $x['d'] === $d)); };
    $cad = function (string $d) use ($db) { $o = array_fill(0, 24, 0); $q = $db->prepare('SELECT CAST(substr(created_at, 12, 2) AS INTEGER) h, COUNT(*) n FROM users WHERE created_at >= ? AND created_at < ? GROUP BY h'); $q->execute([$d, date('Y-m-d', strtotime($d) + 86400)]); foreach ($q as $r) $o[(int)$r['h']] = (int)$r['n']; return $o; };
    // cadastros de hoje, um por um (hora, primeiro nome, se veio de afiliado, se já testou/comprou) para o gráfico ao vivo de cadastros
    $cadLista = function (string $d) use ($db) { $q = $db->prepare('SELECT id, created_at, name, afiliado_id, status, videos_used FROM users WHERE created_at >= ? AND created_at < ? ORDER BY created_at');
      $q->execute([$d, date('Y-m-d', strtotime($d) + 86400 + 3600)]);
      return array_values(array_filter(array_map(fn($r) => ['id' => (int)$r['id'], 'd' => substr($r['created_at'], 0, 10), 'h' => substr($r['created_at'], 11, 5), 'min' => (int)substr($r['created_at'], 11, 2) * 60 + (int)substr($r['created_at'], 14, 2),
        'nome' => explode(' ', trim((string)$r['name']))[0] ?? '', 'af' => $r['afiliado_id'] ? 1 : 0, 'testou' => (int)$r['videos_used'] > 0 ? 1 : 0, 'comprou' => $r['status'] === 'active' ? 1 : 0], $q->fetchAll()), fn($x) => $x['d'] === $d)); };
    $q7c = $db->prepare('SELECT COUNT(*) FROM users WHERE created_at >= ? AND created_at < ?'); $q7c->execute([date('Y-m-d', time() - 7 * 86400), $hoje]); $cad7 = round((int)$q7c->fetchColumn() / 7, 1);
    $q7 = $db->prepare("SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE created_at >= ? AND created_at < ?"); $q7->execute([date('Y-m-d', time() - 7 * 86400), $hoje]);
    json_out(['ok' => true, 'agora' => date('H:i'), 'agora_min' => (int)date('G') * 60 + (int)date('i'), 'hoje' => $dia($hoje), 'ontem' => $dia($ontem),
      'cad_hoje' => $cad($hoje), 'cad_ontem' => $cad($ontem), 'media_7d' => round((float)$q7->fetchColumn() / 7, 2), 'cad_lista' => $cadLista($hoje), 'cad_ontem_lista' => $cadLista($ontem), 'cad_media_7d' => $cad7]);
  }

  case 'alunos': {
    $busca = trim((string)($_GET['busca'] ?? '')); $st = (string)($_GET['status'] ?? '');
    $pag = max(1, (int)($_GET['pag'] ?? 1)); $per = 50;
    $w = []; $p = [];
    if ($busca !== '') { $w[] = '(email LIKE ? OR name LIKE ? OR phone LIKE ?)'; array_push($p, "%$busca%", "%$busca%", "%$busca%"); }
    if (in_array($st, ['trial', 'active', 'blocked', 'refunded'], true)) { $w[] = 'status = ?'; $p[] = $st; }
    if ($st === 'pago') $w[] = "status = 'active' AND paid_value > 0";
    if ($st === 'cortesia') $w[] = "status = 'active' AND paid_value <= 0";
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

  case 'venda-apagar': { // venda lançada por engano (teste da Eduzz etc.): sai do faturamento
    $q = $db->prepare('SELECT * FROM sales WHERE id = ?'); $q->execute([(int)arg('id')]); $s = $q->fetch();
    if (!$s) fail('Venda não encontrada.');
    $db->prepare('DELETE FROM sales WHERE id = ?')->execute([$s['id']]);
    if ($s['user_id']) $db->prepare("UPDATE users SET paid_value = MAX(0, COALESCE((SELECT SUM(value) FROM sales WHERE user_id = users.id), 0)) WHERE id = ?")->execute([$s['user_id']]);
    json_out(['ok' => true]);
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
    if ($url !== '' && !preg_match('#^(https://|/)#', $url)) fail('O link precisa começar com https:// ou /');
    $grupo = (string)arg('grupo');
    $ids = [];
    if ($grupo === 'um') $ids = [(int)arg('id')];
    else {
      $sql = ['todos' => 'SELECT id FROM users', 'pagos' => "SELECT id FROM users WHERE status = 'active' AND paid_value > 0", 'cortesias' => "SELECT id FROM users WHERE status = 'active' AND paid_value <= 0", 'teste' => "SELECT id FROM users WHERE status = 'trial'"][$grupo] ?? null;
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
      if ($k === 'meta_pixel' || $k === 'eduzz_pixel') $v = implode(',', array_filter(preg_split('/\D+/', $v)));
      if ($k === 'installments') $v = (string)max(0, min(12, (int)$v));
      if ($k === 'checkout_url' && $v !== '' && !preg_match('#^https://#', $v)) fail('O link do checkout precisa começar com https://');
      if ($k === 'af_tutorial_url' && $v !== '' && !preg_match('#^https://[^\s"<>]+$#', $v)) fail('O link do vídeo dos afiliados precisa começar com https://');
      set_setting($k, $v);
    }
    json_out(['ok' => true]);
  }
  case 'webhook-novo-token': { set_setting('webhook_token', bin2hex(random_bytes(16))); json_out(['ok' => true]); }
  case 'webhooks': json_out(['ok' => true, 'items' => $db->query('SELECT id, created_at, ip, result, body FROM webhooks ORDER BY id DESC LIMIT 50')->fetchAll()]);
  case 'emails': {
    email_track_db();
    $rast = (string)$db->query('SELECT MIN(created_at) FROM emails WHERE tok IS NOT NULL')->fetchColumn();
    $q = $db->query("SELECT kind, COUNT(*) enviados, SUM(opened_at IS NOT NULL) abriram, SUM(clicked_at IS NOT NULL) clicaram, MAX(subject) assunto FROM emails WHERE ok = 1 AND tok IS NOT NULL AND kind NOT IN ('alerta', 'teste') GROUP BY kind");
    $nomes = ['boas-vindas' => 'Boas-vindas (cadastro)', 'teste-acabou' => 'Seu teste terminou', 'senha' => 'Acesso liberado / criar senha', 'esqueci' => 'Esqueci a senha', 'liberado' => 'Acesso completo liberado', 'afiliado' => 'Boas-vindas do afiliado', 'afiliado-senha' => 'Senha do afiliado'];
    $steps = funnel_steps(); $ord = ['boas-vindas' => 0, 'teste-acabou' => 1];
    $por = array_map(function ($r) use ($nomes, $steps, $ord) {
      $k = $r['kind']; $n = $nomes[$k] ?? $k; $o = $ord[$k] ?? 100;
      if (preg_match('/^af-convite-(\d+)$/', $k, $m) && isset(af_convite_steps()[(int)$m[1]])) { $n = 'Cliente → afiliado, dia ' . af_convite_steps()[(int)$m[1]]['dia'] . ': ' . str_replace('{nome}', 'Fulano', af_convite_steps()[(int)$m[1]]['assunto']); $o = 50 + (int)$m[1]; }
      if (preg_match('/^funil-(\d+)$/', $k, $m) && isset($steps[(int)$m[1]])) { $n = 'Dia ' . $steps[(int)$m[1]]['dia'] . ': ' . str_replace('{nome}', 'Fulano', $steps[(int)$m[1]]['assunto']); $o = 2 + (int)$m[1]; }
      return ['kind' => $k, 'nome' => $n, 'ordem' => $o, 'funil' => $o < 100, 'enviados' => (int)$r['enviados'], 'abriram' => (int)$r['abriram'], 'clicaram' => (int)$r['clicaram']];
    }, $q->fetchAll());
    usort($por, fn($a, $b) => $a['ordem'] <=> $b['ordem'] ?: strcmp($a['nome'], $b['nome']));
    json_out(['ok' => true, 'rastreio_desde' => $rast, 'por_email' => $por,
      'items' => $db->query('SELECT e.created_at, e.email, e.kind, e.subject, e.ok, e.error, e.tok IS NOT NULL rastreado, e.opened_at, e.opens, e.clicked_at, e.clicks, u.name FROM emails e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 150')->fetchAll()]);
  }
  case 'email-teste': {
    $para = clean_email((string)arg('para', $me['email'])); if (!valid_email($para)) fail('E-mail inválido.');
    $ok = send_mail(null, $para, 'teste', 'Teste de e-mail do Studio Cover', 'O e-mail está funcionando ✅', '<p>Se você recebeu esta mensagem, os e-mails dos alunos e do funil vão chegar.</p>');
    $q = $db->query('SELECT error FROM emails ORDER BY id DESC LIMIT 1');
    json_out(['ok' => $ok, 'error' => $ok ? null : $q->fetchColumn()]);
  }
  case 'emails-reenviar': { // manda de novo os e-mails que falharam (só o que ainda faz sentido para a pessoa)
    $fails = $db->query("SELECT e.user_id, e.kind, MAX(e.id) id FROM emails e WHERE e.ok = 0 AND e.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM emails x WHERE x.user_id = e.user_id AND x.kind = e.kind AND x.ok = 1 AND x.id > e.id)
      GROUP BY e.user_id, e.kind")->fetchAll();
    $feitos = 0; $pulados = 0; $GLOBALS['sc_so_email'] = true;
    $steps = funnel_steps();
    foreach ($fails as $f) {
      $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([(int)$f['user_id']]); $u = $q->fetch();
      if (!$u || (int)$u['unsub']) { $pulados++; continue; }
      $k = $f['kind']; $ok = null;
      if ($k === 'boas-vindas' && $u['status'] === 'trial' && (int)$u['trial_left'] > 0) { funnel_welcome($u); $ok = true; }
      elseif ($k === 'teste-acabou' && $u['status'] === 'trial') { funnel_trial_over($u); $ok = true; }
      elseif ($k === 'senha' && !$u['pass_hash']) { $link = set_password_link($u, 7);
        send_mail($u, $u['email'], 'senha', 'Crie a sua senha do Studio Cover', 'Crie a sua senha', '<p>Toque no botão para criar a sua senha e entrar no Studio Cover.</p>', 'Criar minha senha', $link); $ok = true; }
      elseif (preg_match('/^funil-(\d+)$/', $k, $m) && $u['status'] === 'trial' && isset($steps[(int)$m[1]])) { funnel_send($u, $k, $steps[(int)$m[1]]); $ok = true; }
      $ok ? $feitos++ : $pulados++;
    }
    $falhas = (int)$db->query("SELECT COUNT(*) FROM emails WHERE ok = 0 AND created_at >= '" . date('Y-m-d H:i:s', time() - 120) . "'")->fetchColumn();
    json_out(['ok' => true, 'reenviados' => $feitos, 'pulados' => $pulados, 'falharam_agora' => $falhas]);
  }
  case 'funil': {
    $steps = []; foreach (funnel_steps() as $i => $s) $steps[] = ['passo' => $i, 'dia' => $s['dia'], 'assunto' => $s['assunto'], 'aviso' => $s['aviso']];
    json_out(['ok' => true, 'passos' => $steps, 'contagem' => funnel_counts(), 'cron_last' => setting('cron_last')]);
  }
  case 'app-saude': { // o app está funcionando? (diário que o app manda: começou, abriu, exportou, erro, fechou no meio)
    $days = max(1, min(90, (int)($_GET['dias'] ?? 7)));
    $since = date('Y-m-d H:i:s', time() - $days * 86400);
    $edb = app_events_db();
    $q = $edb->prepare('SELECT e.*, u.email, u.name FROM app_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.created_at >= ? ORDER BY e.id DESC'); $q->execute([$since]);
    $ev = $q->fetchAll();
    $cnt = ['inicio' => 0, 'abriu' => 0, 'pronto' => 0, 'exportou' => 0, 'erro' => 0, 'fechou' => 0]; $seg = []; $disp = []; $prob = []; $pessoas = [];
    foreach ($ev as $e) {
      $k = $e['kind']; $cnt[$k] = ($cnt[$k] ?? 0) + 1; $d = json_decode((string)$e['data'], true) ?: [];
      $ap = ua_short((string)$e['ua']);
      if (!empty($d['modelo'])) $ap = preg_replace('/^[^·]+/', mb_substr((string)$d['modelo'], 0, 40) . ' ', $ap, 1); // o Chrome esconde o modelo no user agent ("K"); o app manda o modelo de verdade
      $disp[$ap] ??= ['aparelho' => $ap, 'inicio' => 0, 'abriu' => 0, 'exportou' => 0, 'erro' => 0, 'fechou' => 0, 'forca' => 0, 'compat' => ''];
      if (!empty($d['forca'])) { $disp[$ap]['forca'] = max($disp[$ap]['forca'], (int)$d['forca']); $disp[$ap]['compat'] = (string)($d['compat'] ?? ''); }
      if (isset($disp[$ap][$k])) $disp[$ap][$k]++;
      if ($k === 'abriu' && !empty($d['seg'])) $seg[] = (int)$d['seg'];
      if ($k === 'inicio') $pessoas[$e['user_id']] = 1;
      if (($k === 'erro' || $k === 'fechou') && count($prob) < 30) $prob[] = ['quando' => $e['created_at'], 'tipo' => $k, 'nome' => $e['name'], 'email' => $e['email'], 'aparelho' => $ap, 'etapa' => $d['etapa'] ?? '', 'msg' => $d['msg'] ?? '', 'mb' => $d['mb'] ?? '', 'mem' => $d['mem'] ?? '', 'forca' => $d['forca'] ?? '', 'compat' => $d['compat'] ?? ''];
    }
    sort($seg); $med = $seg ? $seg[intdiv(count($seg), 2)] : 0;
    usort($disp, fn($a, $b) => $b['inicio'] <=> $a['inicio']);
    $q = $db->prepare('SELECT COUNT(*) FROM usage WHERE created_at >= ?'); $q->execute([$since]); $usos = (int)$q->fetchColumn();
    $q = $edb->query('SELECT MIN(created_at) FROM app_events'); $desde = $q->fetchColumn();
    json_out(['ok' => true, 'dias' => $days, 'cont' => $cnt, 'pessoas' => count($pessoas), 'tempo_mediano' => $med, 'tempo_max' => $seg ? max($seg) : 0,
      'usos' => $usos, 'desde' => $desde, 'aparelhos' => array_slice(array_values($disp), 0, 12), 'problemas' => $prob]);
  }
  case 'afiliados': {
    $db = af_db(); sales_fill_net();
    $n = af_numeros(); $n30 = af_numeros(null, date('Y-m-d', time() - 29 * 86400));
    $out = [];
    foreach ($db->query('SELECT id, nome, email, codigo, link_eduzz, eduzz_id, ativo, origem, created_at, last_login, pass_hash IS NOT NULL AS tem_senha FROM afiliados ORDER BY id DESC') as $r) {
      $i = (int)$r['id'];
      foreach (['cliques', 'cadastros', 'testaram', 'compraram', 'vendido', 'reembolsos'] as $k) { $r[$k] = $n[$k][$i] ?? 0; $r[$k . '_30d'] = $n30[$k][$i] ?? 0; }
      $r['link'] = site_url() . '/?af=' . $r['codigo'];
      $out[] = $r;
    }
    json_out(['ok' => true, 'afiliados' => $out, 'link_site' => site_url() . '/']);
  }
  case 'afiliado-criar': {
    $in = input();
    $af = af_create((string)($in['nome'] ?? ''), (string)($in['email'] ?? ''), (string)($in['codigo'] ?? ''), trim((string)($in['link_eduzz'] ?? '')), trim((string)($in['eduzz_id'] ?? '')));
    $sent = !empty($in['enviar']) ? af_boas_vindas($af) : null;
    json_out(['ok' => true, 'link' => site_url() . '/?af=' . $af['codigo'], 'senha' => $sent === null ? af_senha_link($af) : null, 'email_enviado' => $sent]);
  }
  case 'afiliado-editar': {
    $in = input(); $af = af_by_id((int)($in['id'] ?? 0)); if (!$af) fail('Afiliado não encontrado.');
    $link = trim((string)($in['link_eduzz'] ?? $af['link_eduzz']));
    if ($link !== '' && !preg_match('#^https://[a-z0-9.-]*eduzz\.com/#i', $link)) fail('O link de afiliado precisa ser um link da Eduzz.');
    af_db()->prepare('UPDATE afiliados SET nome = ?, link_eduzz = ?, eduzz_id = ?, ativo = ? WHERE id = ?')
      ->execute([trim((string)($in['nome'] ?? $af['nome'])), $link, trim((string)($in['eduzz_id'] ?? $af['eduzz_id'])), !empty($in['ativo']) ? 1 : 0, $af['id']]);
    json_out(['ok' => true]);
  }
  case 'afiliado-convite': { // link de convite: quem recebe vira afiliado sem precisar assinar (vale 30 dias, 1 uso)
    $in = input(); $nome = trim((string)($in['nome'] ?? ''));
    json_out(['ok' => true, 'link' => af_convite_criar($nome, (int)$me['id'])]);
  }
  case 'afiliado-acesso': { // novo link de senha (e-mail opcional)
    $in = input(); $af = af_by_id((int)($in['id'] ?? 0)); if (!$af) fail('Afiliado não encontrado.');
    if (!empty($in['enviar'])) json_out(['ok' => true, 'email_enviado' => af_boas_vindas($af)]);
    json_out(['ok' => true, 'link' => af_senha_link($af)]);
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
