<?php
// Vigia de erros do app (roda a cada 10 minutos). Lê os erros novos que o app mandou para o diário (app_events),
// agrupa por tipo (mesma etapa + mesma mensagem), e avisa os administradores quando:
//   - aparece um tipo de erro que nunca tinha aparecido (NOVO),
//   - um tipo conhecido dispara (AUMENTOU: 3+ na última hora e 3x mais que o normal das últimas 24h),
//   - um tipo marcado como resolvido no painel volta a acontecer (VOLTOU).
// O aviso vai por e-mail, para o celular (se o admin tem o app com avisos ligados) e fica no topo do painel.
declare(strict_types=1);

const VIGIA_ERROS_INTERVALO = 8 * 60; // a tarefa chama a cada 5 min; roda de fato a cada ~10 min

function erros_db(): PDO {
  static $ok = false; $db = app_events_db();
  if (!$ok) {
    $db->exec('CREATE TABLE IF NOT EXISTS erro_grupos (sig TEXT PRIMARY KEY, tipo TEXT, etapa TEXT, msg TEXT, exemplo TEXT,
      primeiro TEXT, ultimo TEXT, total INTEGER DEFAULT 0, status TEXT DEFAULT \'aberto\', resolvido_em TEXT, avisado_em TEXT, avisado_n INTEGER DEFAULT 0)');
    $ok = true;
  }
  return $db;
}

// mesma etapa + mesma mensagem (sem números, endereços e nomes de arquivo) = mesmo tipo de erro
function erro_sig(string $kind, array $d): array {
  $etapa = mb_substr(trim((string)($d['etapa'] ?? '')), 0, 40);
  $msg = $kind === 'fechou' ? 'O celular fechou o app no meio do processamento' : trim((string)($d['msg'] ?? ''));
  $n = mb_strtolower($msg);
  $n = preg_replace('~(https?|blob|data):\S+~', '<url>', $n);
  $n = preg_replace('~[\w\-]+\.(js|mjs|wasm|mp4|mov|m4a|wav|onnx)\b~', '<arq>', $n);
  $n = preg_replace('~\d+([.,]\d+)?~', '#', $n);
  $n = mb_substr(trim(preg_replace('~\s+~', ' ', $n)), 0, 90);
  return ['sig' => substr(sha1($kind . '|' . mb_strtolower($etapa) . '|' . $n), 0, 16), 'etapa' => $etapa, 'msg' => mb_substr($msg, 0, 160)];
}

function erro_aparelho(array $e, array $d): string {
  $ap = ua_short((string)$e['ua']);
  if (!empty($d['modelo'])) $ap = preg_replace('/^[^·]+/', mb_substr((string)$d['modelo'], 0, 40) . ' ', $ap, 1);
  return $ap;
}

function erros_vigia(bool $forcar = false): array {
  $last = setting('vigia_erros_last');
  if (!$forcar && $last && strtotime($last) > time() - VIGIA_ERROS_INTERVALO) return ['vigia_erros' => 'cedo'];
  $lock = @fopen(rtrim((string)cfg('data_dir'), '/') . '/vigia.lock', 'c');
  if ($lock && !flock($lock, LOCK_EX | LOCK_NB)) return ['vigia_erros' => 'ocupado'];
  set_setting('vigia_erros_last', now());
  $db = erros_db();
  $cursor = (int)setting('vigia_erros_id');
  if ($cursor === 0) { // primeira vez: começa pelos erros das últimas 24h
    $q = $db->prepare('SELECT COALESCE(MIN(id), 0) - 1 FROM app_events WHERE created_at >= ?'); $q->execute([date('Y-m-d H:i:s', time() - 86400)]);
    $cursor = max(0, (int)$q->fetchColumn());
    if ($cursor === 0) { $cursor = (int)$db->query('SELECT COALESCE(MAX(id), 0) FROM app_events')->fetchColumn(); $cursor = max(0, $cursor - 1000); }
  }
  // 1) erros novos desde a última vistoria entram nos grupos
  $q = $db->prepare("SELECT id, user_id, kind, data, ua, created_at FROM app_events WHERE id > ? AND kind IN ('erro', 'fechou') ORDER BY id"); $q->execute([$cursor]);
  $novosGrupos = []; $voltaram = []; $maxId = $cursor; $lidos = 0;
  $get = $db->prepare('SELECT * FROM erro_grupos WHERE sig = ?');
  foreach ($q->fetchAll() as $e) {
    $lidos++; $maxId = max($maxId, (int)$e['id']); $d = json_decode((string)$e['data'], true) ?: [];
    $s = erro_sig($e['kind'], $d);
    $get->execute([$s['sig']]); $g = $get->fetch();
    if (!$g) {
      $db->prepare('INSERT INTO erro_grupos (sig, tipo, etapa, msg, exemplo, primeiro, ultimo, total) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
        ->execute([$s['sig'], $e['kind'], $s['etapa'], $s['msg'], erro_aparelho($e, $d), $e['created_at'], $e['created_at']]);
      $novosGrupos[$s['sig']] = 1;
    } else {
      $db->prepare('UPDATE erro_grupos SET ultimo = MAX(ultimo, ?), primeiro = MIN(primeiro, ?), total = total + 1, exemplo = ? WHERE sig = ?')->execute([$e['created_at'], $e['created_at'], erro_aparelho($e, $d), $s['sig']]);
      if ($g['status'] === 'resolvido' && $e['created_at'] > (string)$g['resolvido_em']) {
        $db->prepare("UPDATE erro_grupos SET status = 'aberto' WHERE sig = ?")->execute([$s['sig']]);
        $voltaram[$s['sig']] = 1;
      }
    }
  }
  set_setting('vigia_erros_id', (string)$maxId);

  // 2) números por grupo: última hora x normal das 23h anteriores
  $h1 = date('Y-m-d H:i:s', time() - 3600); $h24 = date('Y-m-d H:i:s', time() - 86400);
  $q = $db->prepare("SELECT e.user_id, e.kind, e.data, e.ua, e.created_at, u.email FROM app_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.created_at >= ? AND e.kind IN ('erro', 'fechou')"); $q->execute([$h24]);
  $st = [];
  foreach ($q->fetchAll() as $e) {
    $d = json_decode((string)$e['data'], true) ?: []; $s = erro_sig($e['kind'], $d); $k = $s['sig'];
    $st[$k] ??= ['h1' => 0, 'h24' => 0, 'pessoas' => [], 'pessoas_h1' => [], 'aparelhos' => [], 'emails' => []];
    $st[$k]['h24']++; $st[$k]['pessoas'][(int)$e['user_id']] = 1;
    $ap = erro_aparelho($e, $d); $st[$k]['aparelhos'][$ap] = ($st[$k]['aparelhos'][$ap] ?? 0) + 1;
    if ($e['created_at'] >= $h1) { $st[$k]['h1']++; $st[$k]['pessoas_h1'][(int)$e['user_id']] = 1; if ($e['email'] && count($st[$k]['emails']) < 5) $st[$k]['emails'][$e['email']] = 1; }
  }
  // vídeos começados x abertos na última hora (para saber se o erro está barrando gente)
  $q = $db->prepare('SELECT kind, COUNT(*) FROM app_events WHERE created_at >= ? AND kind IN (\'inicio\', \'abriu\') GROUP BY kind'); $q->execute([$h1]);
  $fluxo = ['inicio' => 0, 'abriu' => 0] + array_map('intval', $q->fetchAll(PDO::FETCH_KEY_PAIR));

  $alertas = [];
  $grupos = $db->query('SELECT * FROM erro_grupos')->fetchAll();
  foreach ($grupos as $g) {
    $k = $g['sig']; $s = $st[$k] ?? null; if (!$s) continue;
    $normal = max(0, $s['h24'] - $s['h1']) / 23; // erros por hora no normal
    $motivo = null;
    if (isset($novosGrupos[$k])) $motivo = 'novo';
    elseif (isset($voltaram[$k])) $motivo = 'voltou';
    elseif ($s['h1'] >= 3 && $s['h1'] >= 3 * max(1, $normal) && !in_array($g['status'], ['ignorado', 'resolvido'], true)) {
      $jaAvisado = $g['avisado_em'] && strtotime($g['avisado_em']) > time() - 2 * 3600;
      if (!$jaAvisado || $s['h1'] >= 2 * max(1, (int)$g['avisado_n'])) $motivo = 'aumentou';
    }
    if (!$motivo || ($motivo === 'novo' && $g['status'] === 'ignorado')) continue;
    arsort($s['aparelhos']);
    $alertas[] = ['sig' => $k, 'motivo' => $motivo, 'etapa' => $g['etapa'], 'msg' => $g['msg'], 'tipo' => $g['tipo'],
      'h1' => $s['h1'], 'h24' => $s['h24'], 'normal_h' => round($normal, 1), 'pessoas_24h' => count($s['pessoas']), 'pessoas_h1' => count($s['pessoas_h1']),
      'aparelhos' => array_slice($s['aparelhos'], 0, 4, true), 'emails' => array_keys($s['emails']), 'primeiro' => $g['primeiro'], 'total' => (int)$g['total']];
    $db->prepare('UPDATE erro_grupos SET avisado_em = ?, avisado_n = ? WHERE sig = ?')->execute([now(), $s['h1'], $k]);
  }

  // 3) estado para o painel (fica até a próxima vistoria; alertas das últimas 24h ficam visíveis)
  $ant = json_decode(setting('vigia_erros') ?: '[]', true) ?: [];
  $hist = array_values(array_filter($ant['alertas'] ?? [], fn($a) => strtotime($a['quando'] ?? '') > time() - 86400));
  foreach ($alertas as $a) { $hist = array_values(array_filter($hist, fn($x) => $x['sig'] !== $a['sig'])); array_unshift($hist, $a + ['quando' => now()]); }
  set_setting('vigia_erros', json_encode(['quando' => now(), 'lidos' => $lidos, 'erros_1h' => array_sum(array_column($st, 'h1')),
    'erros_24h' => array_sum(array_column($st, 'h24')), 'fluxo_1h' => $fluxo, 'alertas' => array_slice($hist, 0, 20)], JSON_UNESCAPED_UNICODE));

  usort($alertas, fn($a, $b) => [$b['h1'], $b['h24']] <=> [$a['h1'], $a['h24']]);
  if ($alertas) erros_avisar(array_slice($alertas, 0, 10), $fluxo);
  if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
  return ['vigia_erros' => 'ok', 'lidos' => $lidos, 'alertas' => array_map(fn($a) => $a['motivo'] . ': ' . $a['etapa'] . ' · ' . $a['msg'], $alertas)];
}

function erro_rotulo(string $m): string { return ['novo' => '🆕 ERRO NOVO', 'aumentou' => '📈 AUMENTOU', 'voltou' => '🔁 VOLTOU (estava resolvido)'][$m] ?? $m; }

function erros_avisar(array $alertas, array $fluxo): void {
  $li = '';
  foreach ($alertas as $a) {
    $aps = implode(', ', array_map(fn($ap, $n) => "$ap ($n)", array_keys($a['aparelhos']), $a['aparelhos']));
    $li .= '<li style="margin-bottom:12px"><b>' . h(erro_rotulo($a['motivo'])) . '</b> em <b>' . h($a['etapa'] ?: 'app') . '</b><br>'
      . '<code>' . h($a['msg']) . '</code><br>'
      . h("{$a['h1']} na última hora (normal: {$a['normal_h']}/h) · {$a['h24']} em 24h · {$a['pessoas_24h']} pessoa(s)") . '<br>'
      . '<small>' . h($aps) . ($a['emails'] ? ' · ex.: ' . h(implode(', ', $a['emails'])) : '') . '</small></li>';
  }
  $fx = $fluxo['inicio'] ? "<p>Na última hora: {$fluxo['inicio']} vídeo(s) começado(s), {$fluxo['abriu']} abriram no estúdio.</p>" : '';
  // texto pronto para colar no Claude e pedir a correção
  $txt = "Vigia do Studio Cover encontrou erro(s) no app (" . date('d/m H:i') . "):\n";
  foreach ($alertas as $a) $txt .= '- ' . strip_tags(erro_rotulo($a['motivo'])) . " | etapa: {$a['etapa']} | \"{$a['msg']}\" | {$a['h1']}/h, {$a['h24']} em 24h, {$a['pessoas_24h']} pessoas | " . implode(', ', array_keys($a['aparelhos'])) . "\n";
  $html = "<ul style=\"padding-left:18px\">$li</ul>$fx<p>Para pedir a correção, copie e mande para o Claude:</p><pre style=\"white-space:pre-wrap;background:#f4f4f4;padding:10px;border-radius:8px;font-size:12px\">" . h($txt) . '</pre>';
  $n = count($alertas); $top = $alertas[0];
  $assunto = '🚨 Studio Cover: ' . ($n === 1 ? strip_tags(erro_rotulo($top['motivo'])) . ' no app (' . ($top['etapa'] ?: 'app') . ')' : "$n alertas de erro no app");
  $admins = db()->query('SELECT email FROM admins')->fetchAll(PDO::FETCH_COLUMN);
  foreach ($admins as $to) {
    try { send_mail(null, $to, 'alerta', $assunto, 'O vigia encontrou erro no app', $html, 'Abrir o painel', site_url() . '/admin/#geral'); } catch (Throwable $e) {}
    // celular do admin, se ele também tem conta no app com avisos ligados
    try {
      $q = db()->prepare('SELECT id FROM users WHERE email = ?'); $q->execute([$to]); $uid = (int)$q->fetchColumn();
      if ($uid) push_user($uid, '🚨 ' . ($n === 1 ? strip_tags(erro_rotulo($top['motivo'])) : "$n alertas de erro"), ($top['etapa'] ?: 'app') . ': ' . mb_substr($top['msg'], 0, 90) . " · {$top['h1']} na última hora", site_url() . '/admin/#geral');
    } catch (Throwable $e) {}
  }
}

// lista para o painel: tipos de erro das últimas 24h (e os abertos), do mais frequente para o menos
function erros_lista(): array {
  $db = erros_db(); $h1 = date('Y-m-d H:i:s', time() - 3600); $h24 = date('Y-m-d H:i:s', time() - 86400);
  $q = $db->prepare("SELECT e.user_id, e.kind, e.data, e.ua, e.created_at FROM app_events e WHERE e.created_at >= ? AND e.kind IN ('erro', 'fechou')"); $q->execute([$h24]);
  $st = [];
  foreach ($q->fetchAll() as $e) {
    $d = json_decode((string)$e['data'], true) ?: []; $k = erro_sig($e['kind'], $d)['sig'];
    $st[$k] ??= ['h1' => 0, 'h24' => 0, 'pessoas' => [], 'aparelhos' => []];
    $st[$k]['h24']++; if ($e['created_at'] >= $h1) $st[$k]['h1']++; $st[$k]['pessoas'][(int)$e['user_id']] = 1;
    $ap = erro_aparelho($e, $d); $st[$k]['aparelhos'][$ap] = ($st[$k]['aparelhos'][$ap] ?? 0) + 1;
  }
  $out = [];
  foreach ($db->query('SELECT * FROM erro_grupos ORDER BY ultimo DESC LIMIT 200')->fetchAll() as $g) {
    $s = $st[$g['sig']] ?? null;
    if (!$s && $g['status'] !== 'aberto') continue;
    if (!$s && $g['ultimo'] < date('Y-m-d H:i:s', time() - 7 * 86400)) continue;
    $aps = $s['aparelhos'] ?? []; arsort($aps);
    $out[] = ['sig' => $g['sig'], 'tipo' => $g['tipo'], 'etapa' => $g['etapa'], 'msg' => $g['msg'], 'status' => $g['status'], 'primeiro' => $g['primeiro'], 'ultimo' => $g['ultimo'],
      'total' => (int)$g['total'], 'h1' => $s['h1'] ?? 0, 'h24' => $s['h24'] ?? 0, 'pessoas_24h' => $s ? count($s['pessoas']) : 0, 'aparelhos' => array_slice($aps, 0, 4, true),
      'novo' => $g['primeiro'] >= $h24];
  }
  usort($out, fn($a, $b) => [$b['h1'], $b['h24']] <=> [$a['h1'], $a['h24']]);
  return array_slice($out, 0, 30);
}

function erro_marcar(string $sig, string $status): void {
  if (!in_array($status, ['resolvido', 'ignorado', 'aberto'], true)) fail('Situação inválida.');
  erros_db()->prepare('UPDATE erro_grupos SET status = ?, resolvido_em = ? WHERE sig = ?')->execute([$status, $status === 'aberto' ? null : now(), $sig]);
}
