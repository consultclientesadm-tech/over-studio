<?php
// API do painel administrativo.
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';
require_once __DIR__ . '/vigia_erros.php';
require_once __DIR__ . '/depo_lib.php';
require_once __DIR__ . '/origem.php';
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
  if ($key === '' || !hash_equals($key, (string)arg('chave'))) { escudo_evento('chave', 'instalação'); fail('Chave de instalação errada.', 403); }
  admin_create((string)arg('email'), (string)arg('nome'), (string)arg('senha'), null);
  $q = $db->prepare('SELECT * FROM admins WHERE email = ?'); $q->execute([clean_email((string)arg('email'))]);
  admin_login($q->fetch());
  json_out(['ok' => true]);
}
if ($a === 'login') {
  require_post();
  $email = clean_email((string)arg('email'));
  throttle('alog:' . client_ip(), 10, 900); throttle('alog:' . $email, 5, 900);
  if (defined('ESCUDO_BLOQUEADO')) throttle('alogb:' . client_ip(), 3, 3600); // IP bloqueado pelo escudo: só 3 tentativas por hora
  $q = $db->prepare('SELECT * FROM admins WHERE email = ?'); $q->execute([$email]);
  $ad = $q->fetch();
  if (!$ad || !password_verify((string)arg('senha'), $ad['pass_hash'])) { escudo_evento('login_admin', $email); usleep(400000); fail('E-mail ou senha não conferem.'); }
  admin_login($ad); escudo_evento('admin_login', $email);
  json_out(['ok' => true]);
}
if ($a === 'sair') { require_post(); session(); unset($_SESSION['aid'], $_SESSION['aver'], $_SESSION['aat']); json_out(['ok' => true]); }

// ---------- daqui para baixo, só administrador ----------
$me = require_admin();
// tudo que muda alguma coisa só por POST com o cabeçalho X-SC: um link ou página de fora não consegue apagar/alterar nada
if (!in_array($a, ['resumo', 'visao', 'hoje', 'serie', 'testes-perdidos', 'app-saude', 'origens', 'push-chave', 'vigia-erros', 'afiliados', 'alunos', 'admins', 'config', 'webhooks', 'emails', 'funil', 'depo', 'depo-arquivo', 'depo-previa', 'escudo'], true) || ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') require_post();

// país do painel (2026-11-14): Brasil, EUA/Canadá ou Europa (e um país da Europa). Só nas telas de leitura.
// As tabelas users, sales, usage e app_events viram "janelas" filtradas só neste pedido (TEMP VIEW: no SQLite ela passa
// na frente da tabela de verdade), então todas as contas do painel saem só da região escolhida, sem mudar nada no banco.
$REG = in_array($_GET['reg'] ?? '', ['br', 'us', 'eu'], true) ? (string)$_GET['reg'] : '';
$PAIS = preg_match('/^[A-Z]{2}$/', (string)($_GET['pais'] ?? '')) ? (string)$_GET['pais'] : '';
if ($REG !== '' && ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' && in_array($a, ['resumo', 'visao', 'hoje', 'serie', 'alunos', 'funil', 'origens', 'app-saude'], true)) {
  i18n_migra($db); origem_db(); af_db(); app_events_db(); sales_fill_net(); ad_gastos_conta($db); // o que cria/acerta coluna roda antes das janelas
  if ($a === 'visao' || $a === 'origens') { try { meta_sync(false); } catch (Throwable $e) {} }
  $rq = $db->quote($REG); $pq = $db->quote($PAIS);
  $uw = "COALESCE(NULLIF(regiao, ''), 'br') = $rq" . ($PAIS !== '' ? " AND pais = $pq" : '');
  $db->exec("CREATE TEMP VIEW users AS SELECT * FROM main.users WHERE $uw");
  $db->exec("CREATE TEMP VIEW sales AS SELECT * FROM main.sales WHERE COALESCE(NULLIF(regiao, ''), 'br') = $rq" . ($PAIS !== '' ? " AND (pais = $pq OR user_id IN (SELECT id FROM main.users WHERE $uw))" : ''));
  $db->exec("CREATE TEMP VIEW usage AS SELECT * FROM main.usage WHERE user_id IN (SELECT id FROM main.users WHERE $uw)");
  $db->exec("CREATE TEMP VIEW app_events AS SELECT * FROM main.app_events WHERE " . ($REG === 'br' && $PAIS === '' ? 'user_id IS NULL OR ' : '') . "user_id IN (SELECT id FROM main.users WHERE $uw)");
}

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
    // anúncios: o Leo lança quanto gastou, o painel calcula custo por venda e retorno
    $db->exec('CREATE TABLE IF NOT EXISTS ad_gastos (id INTEGER PRIMARY KEY AUTOINCREMENT, dia TEXT NOT NULL, valor REAL NOT NULL, nota TEXT, created_at TEXT NOT NULL)');
    $tot['anuncios_periodo'] = (float)$one('SELECT COALESCE(SUM(valor), 0) FROM ad_gastos WHERE dia >= ?', [$since]);
    $tot['anuncios_total'] = (float)$one('SELECT COALESCE(SUM(valor), 0) FROM ad_gastos');
    ad_gastos_conta($db); $qa = $db->prepare('SELECT id, dia, valor, nota, conta FROM ad_gastos ORDER BY dia DESC, id DESC LIMIT 60'); $qa->execute(); $tot['anuncios_lista'] = $qa->fetchAll(PDO::FETCH_ASSOC);
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

  case 'serie': { // gráfico ao vivo do painel: vendas dia a dia (ou semana a semana no 1 ano) no período escolhido + período anterior
    sales_fill_net(); af_db();
    $days = max(1, min(366, (int)($_GET['dias'] ?? 30)));
    $ini = date('Y-m-d', time() - ($days - 1) * 86400); $antIni = date('Y-m-d', strtotime($ini) - $days * 86400);
    $q = $db->prepare("SELECT substr(created_at, 1, 10) d, SUM(liquido) l, SUM(CASE WHEN status = 'pago' AND value > 0 THEN 1 ELSE 0 END) n, SUM(CASE WHEN afiliado_id IS NOT NULL THEN liquido ELSE 0 END) af FROM sales WHERE created_at >= ? AND (status = 'pago' OR value < 0) GROUP BY d");
    $q->execute([$ini]); $m = []; foreach ($q as $r) $m[$r['d']] = $r;
    $semana = $days > 120; $out = [];
    for ($i = $days - 1; $i >= 0; $i--) {
      $d = date('Y-m-d', time() - $i * 86400); $r = $m[$d] ?? null;
      $k = $semana ? date('Y-m-d', strtotime($d) - ((int)date('N', strtotime($d)) - 1) * 86400) : $d;
      if (!isset($out[$k])) $out[$k] = ['d' => $k, 'l' => 0.0, 'n' => 0, 'af' => 0.0, 'fim' => $d];
      $out[$k]['fim'] = $d;
      if ($r) { $out[$k]['l'] += (float)$r['l']; $out[$k]['n'] += (int)$r['n']; $out[$k]['af'] += (float)$r['af']; }
    }
    $qa = $db->prepare("SELECT COALESCE(SUM(liquido), 0) FROM sales WHERE created_at >= ? AND created_at < ? AND (status = 'pago' OR value < 0)"); $qa->execute([$antIni, $ini]);
    json_out(['ok' => true, 'dias' => $days, 'semana' => $semana, 'hoje' => date('Y-m-d'), 'agora' => date('H:i'), 'pontos' => array_values($out), 'anterior' => (float)$qa->fetchColumn()]);
  }

  case 'testes-perdidos': { // quem perdeu o teste por erro do app; POST com devolver=1 devolve 1 vídeo para cada um
    $dev = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && (int)arg('devolver') === 1;
    $r = testes_perdidos($dev, $dev && (int)arg('avisar') === 1);
    json_out(['ok' => true, 'devolvidos' => $dev ? count($r) : 0, 'total' => count($r), 'items' => array_map(fn($x) => ['nome' => $x['name'], 'email' => $x['email'], 'desde' => $x['created_at']], $r)]);
  }

  case 'alunos': {
    $busca = trim((string)($_GET['busca'] ?? '')); $st = (string)($_GET['status'] ?? '');
    $pag = max(1, (int)($_GET['pag'] ?? 1)); $per = 50;
    $w = []; $p = [];
    if ($busca !== '') { $w[] = '(email LIKE ? OR name LIKE ? OR phone LIKE ? OR aparelho LIKE ? OR aparelho_1 LIKE ?)'; array_push($p, "%$busca%", "%$busca%", "%$busca%", "%$busca%", "%$busca%"); }
    if (in_array($st, ['trial', 'active', 'blocked', 'refunded'], true)) { $w[] = 'status = ?'; $p[] = $st; }
    if ($st === 'pago') $w[] = "status = 'active' AND paid_value > 0";
    if ($st === 'cortesia') $w[] = "status = 'active' AND paid_value <= 0";
    $where = $w ? 'WHERE ' . implode(' AND ', $w) : '';
    $q = $db->prepare("SELECT COUNT(*) FROM users $where"); $q->execute($p); $total = (int)$q->fetchColumn();
    $q = $db->prepare("SELECT id, email, name, phone, status, source, trial_left, videos_used, paid_value, paid_at, expires_at, created_at, last_seen, funnel_step, unsub, aparelho, aparelho_1, (pass_hash IS NOT NULL) AS tem_senha FROM users $where ORDER BY id DESC LIMIT $per OFFSET " . (($pag - 1) * $per));
    $q->execute($p); $items = $q->fetchAll();
    // quem já usou o app antes desta coluna existir: descobre o aparelho pelo diário do app (primeiro e último registro) e guarda
    $edb = app_events_db(); $up = $db->prepare("UPDATE main.users SET aparelho = ?, aparelho_1 = CASE WHEN aparelho_1 = '' THEN ? ELSE aparelho_1 END WHERE id = ?");
    $evq = $edb->prepare("SELECT ua, data FROM main.app_events WHERE user_id = ? AND ua <> '' ORDER BY id DESC LIMIT 200");
    foreach ($items as &$it) {
      if ($it['aparelho'] !== '') continue;
      try {
        $evq->execute([$it['id']]); $ev = $evq->fetchAll(); if (!$ev) continue;
        $nm = function ($e) { $d = json_decode((string)$e['data'], true) ?: []; return aparelho_nome((string)$e['ua'], (string)($d['modelo'] ?? '')); };
        $ult = ''; foreach ($ev as $e) { $n = $nm($e); if ($n !== '' && ($ult === '' || !preg_match('/^(Android|iPhone) · /', $n))) { $ult = $n; if (!preg_match('/^(Android|iPhone) · /', $n)) break; } } // prefere o registro que traz o modelo
        $pri = $nm(end($ev)) ?: $ult;
        if (preg_match('/^(Android|iPhone) · /', $pri, $g) && !str_starts_with($ult, 'Computador') && ($g[1] === 'iPhone') === str_starts_with($ult, 'iPhone')) $pri = $ult; // mesmo celular, só faltava o modelo
        if ($ult === '') continue;
        $up->execute([$ult, $pri, $it['id']]); $it['aparelho'] = $ult; if ($it['aparelho_1'] === '') $it['aparelho_1'] = $pri;
      } catch (Throwable $e) {}
    }
    unset($it);
    json_out(['ok' => true, 'total' => $total, 'pag' => $pag, 'por_pag' => $per, 'items' => $items]);
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
  case 'admin-criar': { admin_create((string)arg('email'), (string)arg('nome'), (string)arg('senha'), (int)$me['id']); escudo_evento('admin_novo', clean_email((string)arg('email')) . ' · por ' . $me['email']); json_out(['ok' => true]); }
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
    escudo_evento('admin_senha', $me['email']);
    escudo_avisar('admin_senha', '🛡️ Studio Cover: senha do painel trocada', '<p>A senha de administrador de <b>' . h($me['email']) . '</b> foi trocada agora.</p><p>Se não foi você, entre em contato com o Claude/Leonardo na hora.</p>', 'Senha do painel trocada: ' . $me['email'], 60);
    json_out(['ok' => true]);
  }

  case 'config': {
    $out = [];
    foreach (SETTINGS_DEFAULT as $k => $_) $out[$k] = in_array($k, ['smtp_pass', 'stripe_whsec', 'stripe_sk'], true) ? (setting($k) !== '' ? '••••••••' : '') : setting($k);
    $out['webhook_url'] = site_url() . '/api/webhook.php?token=' . setting('webhook_token');
    $out['cron_last'] = setting('cron_last');
    json_out(['ok' => true, 'config' => $out]);
  }
  case 'config-salvar': {
    $in = input();
    foreach (SETTINGS_DEFAULT as $k => $_) {
      if (!array_key_exists($k, $in) || $k === 'webhook_token') continue;
      $v = trim((string)$in[$k]);
      if (in_array($k, ['smtp_pass', 'stripe_whsec', 'stripe_sk'], true) && $v === '••••••••') continue;
      if (in_array($k, ['trial_videos', 'access_days', 'smtp_port'], true)) $v = (string)max(0, (int)$v);
      if ($k === 'meta_pixel' || $k === 'eduzz_pixel') $v = implode(',', array_filter(preg_split('/\D+/', $v)));
      if ($k === 'installments') $v = (string)max(0, min(12, (int)$v));
      if ($k === 'checkout_url' && $v !== '' && !preg_match('#^https://#', $v)) fail('O link do checkout precisa começar com https://');
      if (in_array($k, ['checkout_us', 'checkout_eu'], true) && $v !== '' && !preg_match('#^https://[^\s"<>]+$#', $v)) fail('O link de pagamento da Stripe precisa começar com https://');
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
    $cnt = ['inicio' => 0, 'abriu' => 0, 'pronto' => 0, 'exportou' => 0, 'erro' => 0, 'fechou' => 0, 'saiu' => 0, 'quisbaixar' => 0, 'liberou' => 0]; $seg = []; $disp = []; $prob = []; $pessoas = [];
    $nav = []; $saidas = []; // CPI dos erros: resultado por sistema + navegador e em que etapa as pessoas saem no meio
    foreach ($ev as $e) {
      $k = $e['kind']; $cnt[$k] = ($cnt[$k] ?? 0) + 1; $d = json_decode((string)$e['data'], true) ?: [];
      $ap = ua_short((string)$e['ua']);
      if (!empty($d['modelo'])) $ap = preg_replace('/^[^·]+/', mb_substr((string)$d['modelo'], 0, 40) . ' ', $ap, 1); // o Chrome esconde o modelo no user agent ("K"); o app manda o modelo de verdade
      $disp[$ap] ??= ['aparelho' => $ap, 'inicio' => 0, 'abriu' => 0, 'pronto' => 0, 'exportou' => 0, 'erro' => 0, 'fechou' => 0, 'saiu' => 0, 'forca' => 0, 'compat' => ''];
      $nv = ua_nav((string)$e['ua']);
      $nav[$nv] ??= ['nav' => $nv, 'inicio' => 0, 'abriu' => 0, 'pronto' => 0, 'exportou' => 0, 'erro' => 0, 'fechou' => 0, 'saiu' => 0, 'externo' => 0];
      if ($k === 'erro' && ($d['etapa'] ?? '') === 'externo') $nav[$nv]['externo']++; elseif (isset($nav[$nv][$k])) $nav[$nv][$k]++;
      if ($k === 'saiu') { $sk = (string)($d['etapa'] ?? '?'); $saidas[$sk] = ($saidas[$sk] ?? 0) + 1; }
      if (!empty($d['forca'])) { $disp[$ap]['forca'] = max($disp[$ap]['forca'], (int)$d['forca']); $disp[$ap]['compat'] = (string)($d['compat'] ?? ''); }
      if (isset($disp[$ap][$k])) $disp[$ap][$k]++;
      if ($k === 'abriu' && !empty($d['seg'])) $seg[] = (int)$d['seg'];
      if ($k === 'inicio') $pessoas[$e['user_id']] = 1;
      if (($k === 'erro' || $k === 'fechou') && count($prob) < 30) $prob[] = ['quando' => $e['created_at'], 'tipo' => $k, 'nome' => $e['name'], 'email' => $e['email'], 'aparelho' => $ap, 'etapa' => $d['etapa'] ?? '', 'msg' => $d['msg'] ?? '', 'mb' => $d['mb'] ?? '', 'mem' => $d['mem'] ?? '', 'forca' => $d['forca'] ?? '', 'compat' => $d['compat'] ?? ''];
    }
    sort($seg); $med = $seg ? $seg[intdiv(count($seg), 2)] : 0;
    usort($disp, fn($a, $b) => $b['inicio'] <=> $a['inicio']);
    $nav = array_values($nav); usort($nav, fn($a, $b) => $b['inicio'] <=> $a['inicio']); arsort($saidas);
    $q = $db->prepare('SELECT COUNT(*) FROM usage WHERE created_at >= ?'); $q->execute([$since]); $usos = (int)$q->fetchColumn();
    $q = $edb->query('SELECT MIN(created_at) FROM app_events'); $desde = $q->fetchColumn();
    json_out(['ok' => true, 'dias' => $days, 'cont' => $cnt, 'pessoas' => count($pessoas), 'tempo_mediano' => $med, 'tempo_max' => $seg ? max($seg) : 0,
      'usos' => $usos, 'desde' => $desde, 'aparelhos' => array_slice(array_values($disp), 0, 12), 'problemas' => $prob, 'navegadores' => $nav, 'saidas' => array_slice($saidas, 0, 8, true)]);
  }
  case 'push-chave': json_out(['ok' => true, 'chave' => vapid_public()]);
  case 'push-salvar': { // celular do administrador: recebe o aviso de cada venda (guardado com user_id negativo = -id do admin)
    push_save(-(int)$me['id'], (array)arg('sub', []), (string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    json_out(['ok' => true]);
  }
  case 'push-teste': { $nm = trim(explode(' ', trim((string)($me['name'] ?? '')))[0] ?? ''); $n = push_user(-(int)$me['id'], '💰 Parabéns' . ($nm !== '' ? " $nm" : '') . ', mais uma venda do Studio Cover!', "Venda de R$ 297,00 · líquido R$ 279,96\nTeste do aviso: é assim que cada venda vai chegar. 🙏", '/admin/'); json_out(['ok' => true, 'enviados' => $n]); }
  // Visão geral (tudo numa tela): período de/até (AAAA-MM-DD), vendas e cadastros com horário, anúncios por sócio e o período anterior para comparar
  case 'visao': {
    sales_fill_net(); try { meta_sync(false); } catch (Throwable $e) {}
    $ok = fn($d) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$d) ? (string)$d : date('Y-m-d');
    $de = $ok($_GET['de'] ?? ''); $ate = $ok($_GET['ate'] ?? ''); if ($ate < $de) [$de, $ate] = [$ate, $de];
    $ini = "$de 00:00:00"; $fim = "$ate 23:59:59";
    $n = (int)round((strtotime($ate) - strtotime($de)) / 86400) + 1;
    $pIni = date('Y-m-d', strtotime($de) - $n * 86400) . ' 00:00:00'; $pFim = date('Y-m-d', strtotime($de) - 86400) . ' 23:59:59';
    $q = $db->prepare("SELECT created_at, liquido, bruto, afiliado_id, or_fonte, or_campanha FROM sales WHERE status = 'pago' AND created_at >= ? AND created_at <= ? ORDER BY created_at"); $q->execute([$ini, $fim]);
    $vendas = array_map(fn($v) => ['t' => $v['created_at'], 'l' => round((float)$v['liquido'], 2), 'af' => (bool)$v['afiliado_id'], 'ad' => in_array($v['or_fonte'], ['anuncio-meta', 'meta-sem-utm', 'meta', 'fb', 'facebook-ads', 'meta-ads', 'instagram-ads'], true)], $q->fetchAll(PDO::FETCH_ASSOC));
    // estorno/reembolso/chargeback entra como venda negativa (igual à Eduzz): desconta do faturamento do período em que aconteceu
    $q = $db->prepare("SELECT created_at, liquido FROM sales WHERE value < 0 AND created_at >= ? AND created_at <= ? ORDER BY created_at"); $q->execute([$ini, $fim]);
    $estornos = array_map(fn($v) => ['t' => $v['created_at'], 'l' => round((float)$v['liquido'], 2)], $q->fetchAll(PDO::FETCH_ASSOC));
    $q = $db->prepare("SELECT created_at FROM users WHERE source = 'trial' AND created_at >= ? AND created_at <= ? ORDER BY created_at"); $q->execute([$ini, $fim]);
    $cads = array_column($q->fetchAll(PDO::FETCH_ASSOC), 'created_at');
    $q = $db->prepare("SELECT COALESCE(SUM(status = 'pago'), 0), COALESCE(SUM(liquido), 0) FROM sales WHERE (status = 'pago' OR value < 0) AND created_at >= ? AND created_at <= ?"); $q->execute([$pIni, $pFim]); [$pv, $pl] = $q->fetch(PDO::FETCH_NUM);
    $q = $db->prepare("SELECT COUNT(*) FROM users WHERE source = 'trial' AND created_at >= ? AND created_at <= ?"); $q->execute([$pIni, $pFim]); $pc = (int)$q->fetchColumn();
    json_out(['ok' => true, 'de' => $de, 'ate' => $ate, 'dias' => $n, 'agora' => date('Y-m-d H:i:s'), 'vendas' => $vendas, 'estornos' => $estornos, 'cadastros' => $cads,
      'anterior' => ['vendas' => (int)$pv, 'liquido' => round((float)$pl, 2), 'cadastros' => $pc],
      'anuncios' => or_anuncios($db, $ini, $fim), 'socio_pct' => max(0, min(100, brnum(setting('socio_pct'))))]);
  }
  case 'origens': try { meta_sync(false); } catch (Throwable $e) {} json_out(or_relatorio(max(1, min(365, (int)($_GET['dias'] ?? 30))), (string)($_GET['dia'] ?? ''))); // de qual página e canal vêm visitas, testes e vendas
  case 'vigia-erros': { // vistoria de 10 em 10 min: tipos de erro do app, alertas e quando rodou
    json_out(['ok' => true, 'vigia' => json_decode(setting('vigia_erros') ?: 'null', true), 'grupos' => erros_lista()]);
  }
  // conta de anúncios do Meta: puxa o gasto real sozinho (só leitura). O token nunca volta para a tela.
  case 'meta-conectar': {
    $dono = preg_replace('/[^a-z0-9]/', '', strtolower((string)arg('dono', ''))) ?? '';
    $act = preg_replace('/\D/', '', (string)arg('act', '')) ?? ''; $tok = trim((string)arg('token', ''));
    if ($dono === '' || $act === '' || strlen($tok) < 50) json_out(['ok' => false, 'error' => 'Preencha de quem é, o ID da conta de anúncios e o token.']);
    $act = 'act_' . $act;
    try { $nome = meta_testa($act, $tok); } catch (Throwable $e) { json_out(['ok' => false, 'error' => 'O Meta não aceitou: ' . $e->getMessage()]); }
    meta_db()->prepare('INSERT INTO meta_contas (dono, act, token, nome, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(act) DO UPDATE SET dono = excluded.dono, token = excluded.token, nome = excluded.nome, erro = \'\', ultimo = NULL')
      ->execute([substr($dono, 0, 20), $act, $tok, mb_substr($nome, 0, 80), now()]);
    $s = meta_sync(true);
    json_out(['ok' => true, 'nome' => $nome, 'sync' => $s[$act] ?? '']);
  }
  case 'meta-remover': { meta_db()->prepare('DELETE FROM meta_contas WHERE id = ?')->execute([(int)arg('id', 0)]); json_out(['ok' => true]); }
  case 'meta-sync': json_out(['ok' => true, 'sync' => meta_sync(true)]);
  case 'meta-campanha': { // liga uma campanha (utm_campaign do link do anúncio) à conta do sócio
    $cp = or_limpa((string)arg('campanha', ''), 60); $ct = (string)arg('conta', '');
    if ($cp === '' || !in_array($ct, ['leo', 'reinaldo'], true)) json_out(['ok' => false, 'error' => 'Campanha ou conta inválida.']);
    meta_db()->prepare('INSERT OR REPLACE INTO meta_campanhas (campanha, conta, visto) VALUES (?, ?, ?)')->execute([$cp, $ct, now()]);
    json_out(['ok' => true]);
  }
  case 'anuncio-add': { // gasto com anúncio: dia (AAAA-MM-DD), valor, nota
    $db->exec('CREATE TABLE IF NOT EXISTS ad_gastos (id INTEGER PRIMARY KEY AUTOINCREMENT, dia TEXT NOT NULL, valor REAL NOT NULL, nota TEXT, created_at TEXT NOT NULL)');
    $dia = (string)(arg('dia', '')); if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dia)) $dia = date('Y-m-d');
    $vr = trim((string)(arg('valor', '0'))); if (preg_match('/^\d{1,3}(\.\d{3})+$/', $vr)) $vr = str_replace('.', '', $vr); // 2.000 = dois mil
    $valor = brnum($vr);
    if ($valor <= 0 || $valor > 10000000) json_out(['ok' => false, 'error' => 'Coloque um valor maior que zero.']);
    ad_gastos_conta($db);
    $conta = preg_replace('/[^a-z0-9]/', '', strtolower((string)arg('conta', ''))) ?? '';
    $db->prepare('INSERT INTO ad_gastos (dia, valor, nota, created_at, conta) VALUES (?, ?, ?, ?, ?)')->execute([$dia, $valor, mb_substr(trim((string)(arg('nota', ''))), 0, 80), now(), substr($conta, 0, 20)]);
    json_out(['ok' => true]);
  }
  case 'anuncio-del': {
    $db->exec('CREATE TABLE IF NOT EXISTS ad_gastos (id INTEGER PRIMARY KEY AUTOINCREMENT, dia TEXT NOT NULL, valor REAL NOT NULL, nota TEXT, created_at TEXT NOT NULL)');
    $db->prepare('DELETE FROM ad_gastos WHERE id = ?')->execute([(int)(arg('id', 0))]);
    json_out(['ok' => true]);
  }
  case 'escudo': json_out(escudo_resumo()); // escudo de segurança: ataques barrados, IPs bloqueados, checagem recorrente
  case 'escudo-agora': { $r = escudo_checagem(true); json_out(['ok' => true] + $r); }
  case 'escudo-desbloquear': {
    $ip = (string)arg('ip'); escudo_db()->prepare('DELETE FROM seg_bloqueios WHERE ip = ?')->execute([$ip]);
    escudo_db()->prepare('INSERT INTO seg_eventos (ip, tipo, detalhe, created_at) VALUES (?, ?, ?, ?)')->execute([$ip, 'desbloqueio', 'por ' . $me['email'], now()]);
    json_out(['ok' => true]);
  }
  case 'escudo-github': json_out(['ok' => true, 'github' => escudo_gh_salvar((string)arg('token'))]);
  case 'erro-marcar': { // resolvido (volta a avisar se acontecer de novo), ignorado (não avisa mais) ou aberto
    erro_marcar((string)arg('sig'), (string)arg('status'));
    json_out(['ok' => true]);
  }
  case 'vigia-agora': { // roda a vistoria na hora (botão do painel)
    require_once __DIR__ . '/saude.php';
    $r = erros_vigia(true); try { health_run(); } catch (Throwable $e) {}
    json_out(['ok' => true, 'r' => $r]);
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
  case 'depo': { // depoimentos recebidos + quem pode receber o pedido
    $db2 = depo_db(); $P = depo_pessoas();
    $L = array_map('depo_publico', $db2->query("SELECT d.*, u.status u_status FROM depoimentos d LEFT JOIN users u ON u.id = d.user_id ORDER BY (d.status = 'novo') DESC, d.id DESC LIMIT 200")->fetchAll());
    $c = ['compradores' => 0, 'testaram' => 0, 'pedidos' => 0, 'enviaram' => 0, 'a_pedir' => 0];
    foreach ($P as $p) { $p['comprou'] ? $c['compradores']++ : $c['testaram']++; if ($p['pedido_at']) $c['pedidos']++; if ($p['enviou']) $c['enviaram']++; if (!$p['pedido_at'] && !$p['enviou'] && !(int)$p['unsub']) $c['a_pedir']++; }
    json_out(['ok' => true, 'contagem' => $c, 'pessoas' => $P, 'items' => $L, 'tipos' => DEPO_TIPOS, 'bonus' => setting('depo_bonus') !== '0']);
  }
  case 'depo-previa': { // como o e-mail chega (comprador e quem testou)
    $ex = ['id' => 0, 'name' => 'Fulano da Silva', 'email' => 'fulano@exemplo.com', 'status' => 'trial', 'paid_value' => 0];
    $out = [];
    foreach (['comprador' => 1, 'testou' => 0] as $k => $cp) {
      $m = depo_email($ex + ['comprou' => $cp]);
      $out[$k] = ['assunto' => $m['assunto'], 'html' => mail_template(h($m['titulo']), $m['html'], $m['botao'], site_url() . '/depoimento/', ''), 'whats' => depo_whats($ex + ['comprou' => $cp])];
    }
    json_out(['ok' => true] + $out);
  }
  case 'depo-pedir': { // manda o pedido por e-mail (ids vazio = todo mundo que ainda não recebeu)
    $ids = array_values(array_map('intval', (array)arg('ids', [])));
    json_out(['ok' => true] + depo_pedir($ids));
  }
  case 'depo-marcar': { // pediu pelo WhatsApp (o botão abre o WhatsApp e marca)
    depo_db()->prepare('INSERT OR REPLACE INTO depo_pedidos (user_id, canal, created_at) VALUES (?, ?, ?)')->execute([(int)arg('id'), 'whatsapp', now()]);
    json_out(['ok' => true]);
  }
  case 'depo-status': {
    $st = (string)arg('status'); if (!in_array($st, ['novo', 'aprovado', 'usado', 'recusado'], true)) fail('Status inválido.');
    depo_db()->prepare('UPDATE depoimentos SET status = ? WHERE id = ?')->execute([$st, (int)arg('id')]);
    json_out(['ok' => true]);
  }
  case 'depo-apagar': {
    $id = (int)arg('id'); $dir = depo_dir($id);
    foreach (glob($dir . '/*') ?: [] as $f) @unlink($f); @rmdir($dir);
    depo_db()->prepare('DELETE FROM depoimentos WHERE id = ?')->execute([$id]);
    json_out(['ok' => true]);
  }
  case 'depo-arquivo': { // vê ou baixa um arquivo do depoimento (aceita Range: o vídeo toca e avança no navegador)
    $q = depo_db()->prepare('SELECT * FROM depoimentos WHERE id = ?'); $q->execute([(int)($_GET['id'] ?? 0)]); $d = $q->fetch();
    if (!$d) fail('Não encontrado.', 404);
    $f = null; foreach (json_decode($d['arquivos'], true) ?: [] as $x) if ($x['tipo'] === ($_GET['tipo'] ?? '')) $f = $x;
    $path = $f ? depo_dir((int)$d['id']) . '/' . $f['tipo'] . '.' . $f['ext'] : '';
    if (!$f || !is_file($path)) fail('Arquivo não encontrado.', 404);
    $mime = ['mov' => 'video/quicktime', 'mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'webm' => 'video/webm', '3gp' => 'video/3gpp', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'heic' => 'image/heic', 'm4a' => 'audio/mp4', 'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'aac' => 'audio/aac'][$f['ext']] ?? 'application/octet-stream';
    $size = filesize($path); $ini = 0; $fim = $size - 1;
    if (preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'] ?? '', $m)) {
      if ($m[1] !== '') { $ini = (int)$m[1]; if ($m[2] !== '') $fim = min($fim, (int)$m[2]); } elseif ($m[2] !== '') $ini = max(0, $size - (int)$m[2]);
      if ($ini > $fim) { http_response_code(416); header("Content-Range: bytes */$size"); exit; }
      http_response_code(206); header("Content-Range: bytes $ini-$fim/$size");
    }
    $nome = preg_replace('/[^a-z0-9]+/', '-', strtolower($d['nome'] ?: 'depoimento')) . '-' . $f['tipo'] . '.' . $f['ext'];
    header('Content-Type: ' . $mime); header('Accept-Ranges: bytes'); header('Content-Length: ' . ($fim - $ini + 1)); header('Cache-Control: private, max-age=3600');
    header('Content-Disposition: ' . (isset($_GET['baixar']) ? 'attachment' : 'inline') . '; filename="' . $nome . '"');
    $h = fopen($path, 'rb'); fseek($h, $ini); $rest = $fim - $ini + 1;
    while ($rest > 0 && !feof($h)) { $b = fread($h, (int)min(1048576, $rest)); echo $b; $rest -= strlen($b); flush(); }
    fclose($h); exit;
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
