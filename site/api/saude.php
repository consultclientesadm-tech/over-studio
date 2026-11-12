<?php
// Vigia do Studio Cover: roda junto com o cron (a cada hora). Se algo quebrar, avisa os administradores por e-mail
// (no máximo 1 aviso a cada 6 horas para o mesmo problema) e mostra um alerta no topo do painel.
declare(strict_types=1);

function health_check(): array {
  $db = db(); $p = []; $h1 = date('Y-m-d H:i:s', time() - 3600); $h24 = date('Y-m-d H:i:s', time() - 86400);
  $one = function (string $sql, array $a = []) use ($db) { $q = $db->prepare($sql); $q->execute($a); return $q->fetchColumn(); };
  // e-mails
  $bad = (int)$one('SELECT COUNT(*) FROM emails WHERE ok = 0 AND created_at >= ?', [$h1]);
  $good = (int)$one('SELECT COUNT(*) FROM emails WHERE ok = 1 AND created_at >= ?', [$h1]);
  if ($bad >= 2 && $bad > $good) { $err = (string)$one('SELECT error FROM emails WHERE ok = 0 ORDER BY id DESC LIMIT 1'); $p['email'] = "$bad e-mails falharam na última hora. Último erro: $err"; }
  // webhook da Eduzz
  $rec = (int)$one("SELECT COUNT(*) FROM webhooks WHERE result LIKE 'recusado%' AND created_at >= ?", [$h24]);
  if ($rec >= 1) $p['webhook'] = "$rec aviso(s) da Eduzz recusado(s) nas últimas 24h (token ou assinatura). Venda pode não ter liberado acesso.";
  // venda paga na Eduzz sem aluno liberado
  $sem = (int)$one("SELECT COUNT(*) FROM sales s JOIN users u ON u.id = s.user_id WHERE s.status = 'pago' AND s.created_at >= ? AND u.status <> 'active' AND NOT EXISTS (SELECT 1 FROM sales r WHERE r.user_id = s.user_id AND r.value < 0)", [$h24]);
  if ($sem) $p['acesso'] = "$sem venda(s) paga(s) nas últimas 24h com aluno sem acesso liberado.";
  // app: vídeos que começam e não abrem no estúdio (o app avisa cada etapa)
  $edb = app_events_db(); $h6 = date('Y-m-d H:i:s', time() - 6 * 3600);
  $ini = (int)$one('SELECT COUNT(*) FROM app_events WHERE kind = ? AND created_at >= ?', ['inicio', $h6]);
  $abr = (int)$one('SELECT COUNT(*) FROM app_events WHERE kind = ? AND created_at >= ?', ['abriu', $h6]);
  $err = (int)$one("SELECT COUNT(*) FROM app_events WHERE kind IN ('erro', 'fechou') AND created_at >= ?", [$h6]);
  if ($ini >= 3 && $abr < $ini * 0.5) $p['app'] = "No app, só $abr de $ini vídeos começados nas últimas 6h chegaram ao estúdio ($err erros ou travamentos). Veja \"O app está funcionando?\" no painel.";
  // checkout
  if (setting('checkout_url') === '') $p['checkout'] = 'O link do checkout da Eduzz está vazio nas Configurações. Ninguém consegue comprar.';
  // disco
  $free = @disk_free_space((string)cfg('data_dir'));
  if ($free !== false && $free < 300 * 1024 * 1024) $p['disco'] = 'Pouco espaço no servidor: ' . round($free / 1048576) . ' MB livres.';
  // site no ar (página de vendas e oferta)
  foreach (['/' => 'página de vendas', '/api/conta.php?a=oferta' => 'preço da oferta', '/app/' => 'app'] as $path => $nome) {
    $ctx = stream_context_create(['http' => ['timeout' => 12, 'ignore_errors' => true, 'header' => "User-Agent: StudioCover-vigia\r\n"]]);
    $t = microtime(true); $body = @file_get_contents((site_url() ?: 'https://studiocover.com.br') . $path, false, $ctx); $ms = (int)((microtime(true) - $t) * 1000);
    $code = isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m) ? (int)$m[1] : 0;
    if ($code !== 200 || $body === false) $p['site' . $path] = "A $nome não abriu (código $code).";
    elseif ($ms > 8000) $p['lento' . $path] = "A $nome demorou {$ms} ms para abrir.";
  }
  // o próprio vigia (cron) parado
  $last = setting('cron_last');
  if ($last && strtotime($last) < time() - 3 * 3600) $p['cron'] = 'A tarefa automática (funil e vigia) não roda desde ' . $last . '.';
  return $p;
}

function health_run(): array {
  $p = health_check();
  set_setting('saude', json_encode(['quando' => now(), 'problemas' => $p], JSON_UNESCAPED_UNICODE));
  if (!$p) return ['saude' => 'ok'];
  $novos = [];
  foreach ($p as $k => $msg) { $last = setting('alerta_' . $k); if (!$last || strtotime($last) < time() - 6 * 3600) { $novos[$k] = $msg; set_setting('alerta_' . $k, now()); } }
  if ($novos && !isset($novos['email'])) { // se o problema é o próprio e-mail, o aviso fica só no painel
    $lista = '<ul>' . implode('', array_map(fn($m) => '<li>' . h($m) . '</li>', $novos)) . '</ul>';
    foreach (db()->query('SELECT email FROM admins')->fetchAll(PDO::FETCH_COLUMN) as $to)
      send_mail(null, $to, 'alerta', '⚠️ Studio Cover: algo precisa de atenção', 'O vigia encontrou um problema', $lista . '<p>Abra o painel para ver os detalhes.</p>', 'Abrir o painel', site_url() . '/admin/');
  }
  return ['saude' => 'problemas', 'problemas' => array_keys($p), 'avisados' => array_keys($novos)];
}
