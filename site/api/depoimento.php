<?php
// Página /depoimento/: a pessoa manda o antes e depois, uma frase e a autorização de uso.
// Envio em partes de 2 MB (vídeo de celular é grande e o servidor limita o tamanho de cada envio).
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/depo_lib.php';
header('X-Robots-Tag: noindex');
$a = (string)($_GET['a'] ?? '');

function depo_quem(): array {
  $u = depo_user_by_token((string)($_GET['t'] ?? ''));
  if (!$u) $u = current_user();
  if (!$u) fail('Link inválido. Abra pelo link que mandamos no seu e-mail ou WhatsApp.', 403);
  return $u;
}
function depo_meu(array $u): array {
  $q = depo_db()->prepare('SELECT * FROM depoimentos WHERE id = ? AND user_id = ? AND chave = ?');
  $q->execute([(int)($_GET['id'] ?? 0), $u['id'], (string)($_GET['k'] ?? '')]);
  $d = $q->fetch(); if (!$d) fail('Envio não encontrado. Recarregue a página e tente de novo.', 404);
  return $d;
}

switch ($a) {
  case 'quem': {
    $u = depo_quem();
    $q = depo_db()->prepare("SELECT COUNT(*) FROM depoimentos WHERE user_id = ? AND status <> 'enviando'"); $q->execute([$u['id']]);
    json_out(['ok' => true, 'nome' => $u['name'], 'enviou' => (int)$q->fetchColumn(), 'aceite' => DEPO_ACEITE,
      'bonus' => setting('depo_bonus') !== '0' && $u['status'] === 'trial', 'max_mb' => (int)(DEPO_MAX_ARQ / 1048576)]);
  }

  case 'enviar': { // cria o depoimento e devolve a chave para mandar os arquivos
    require_post(); $u = depo_quem();
    throttle('depo:' . $u['id'], 12, 3600);
    $txt = trim(mb_substr((string)arg('texto'), 0, 1500));
    if (mb_strlen($txt) < 3) fail('Escreva em uma frase o que você achou.');
    $arqs = [];
    foreach ((array)arg('arquivos', []) as $f) {
      $tipo = (string)($f['tipo'] ?? ''); $tam = (int)($f['tam'] ?? 0); $nome = basename((string)($f['nome'] ?? 'video'));
      $ext = strtolower(pathinfo($nome, PATHINFO_EXTENSION) ?: 'mp4');
      if (!isset(DEPO_TIPOS[$tipo]) || isset($arqs[$tipo])) continue;
      if (!in_array($ext, DEPO_EXT, true)) fail("O arquivo \"$nome\" não é um vídeo ou áudio que a gente aceita.");
      if ($tam <= 0 || $tam > DEPO_MAX_ARQ) fail("O arquivo \"$nome\" passou de " . (int)(DEPO_MAX_ARQ / 1048576) . ' MB.');
      $arqs[$tipo] = ['tipo' => $tipo, 'nome' => mb_substr($nome, 0, 120), 'ext' => $ext, 'tam' => $tam, 'recebido' => 0];
    }
    $ig = preg_replace('/[^a-z0-9._]/', '', strtolower(ltrim(trim((string)arg('instagram')), '@')));
    $aut = arg('aut_imagem') ? 1 : 0;
    $chave = token(18);
    depo_db()->prepare('INSERT INTO depoimentos (user_id, email, nome, instagram, cidade, texto, nota, aut_imagem, aut_nome, aceite_txt, ip, arquivos, chave, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      ->execute([$u['id'], $u['email'], trim(mb_substr((string)arg('nome', $u['name']), 0, 80)), mb_substr($ig, 0, 40), trim(mb_substr((string)arg('cidade'), 0, 80)), $txt,
        max(0, min(5, (int)arg('nota'))), $aut, $aut && arg('aut_nome') ? 1 : 0, $aut ? DEPO_ACEITE : '', client_ip(), json_encode(array_values($arqs), JSON_UNESCAPED_UNICODE), $chave, $arqs ? 'enviando' : 'novo', now()]);
    $id = (int)depo_db()->lastInsertId();
    if (!$arqs) depo_concluir($id, $u);
    json_out(['ok' => true, 'id' => $id, 'k' => $chave, 'arquivos' => array_values($arqs)]);
  }

  case 'parte': { // corpo = pedaço do arquivo; ?i=índice&o=posição. Devolve quanto já chegou (dá para retomar)
    require_post(); $u = depo_quem(); $d = depo_meu($u);
    if ($d['status'] !== 'enviando') fail('Este envio já terminou.');
    $L = json_decode($d['arquivos'], true) ?: []; $i = (int)($_GET['i'] ?? -1);
    if (!isset($L[$i])) fail('Arquivo inválido.');
    $path = depo_dir((int)$d['id']) . '/' . $L[$i]['tipo'] . '.' . $L[$i]['ext'];
    clearstatcache(); $tem = is_file($path) ? filesize($path) : 0;
    $o = (int)($_GET['o'] ?? 0);
    if ($o === $tem) {
      $in = fopen('php://input', 'rb'); $out = fopen($path, 'ab');
      $n = stream_copy_to_stream($in, $out, 3 * 1048576); fclose($in); fclose($out);
      $tem += (int)$n;
      if ($tem > $L[$i]['tam']) { @unlink($path); fail('O arquivo chegou maior do que o esperado. Tente de novo.'); }
    }
    $L[$i]['recebido'] = $tem;
    depo_db()->prepare('UPDATE depoimentos SET arquivos = ? WHERE id = ?')->execute([json_encode($L, JSON_UNESCAPED_UNICODE), $d['id']]);
    json_out(['ok' => true, 'recebido' => $tem]);
  }

  case 'fim': {
    require_post(); $u = depo_quem(); $d = depo_meu($u);
    $L = json_decode($d['arquivos'], true) ?: [];
    foreach ($L as $f) if ((int)$f['recebido'] < (int)$f['tam']) fail('Ainda falta terminar o envio de "' . $f['nome'] . '".');
    $bonus = $d['status'] === 'enviando' ? depo_concluir((int)$d['id'], $u) : false;
    json_out(['ok' => true, 'bonus' => $bonus]);
  }
}
fail('Ação desconhecida.', 404);

// terminou: marca como novo, dá o vídeo de presente (quem está no teste e mandou vídeo, 1 vez só) e avisa os administradores
function depo_concluir(int $id, array $u): bool {
  $db = depo_db();
  $db->prepare("UPDATE depoimentos SET status = 'novo', done_at = ? WHERE id = ?")->execute([now(), $id]);
  $q = $db->prepare('SELECT * FROM depoimentos WHERE id = ?'); $q->execute([$id]); $d = $q->fetch();
  $temVideo = (bool)array_filter(json_decode($d['arquivos'], true) ?: [], fn($f) => (int)$f['recebido'] > 0);
  $q = $db->prepare('SELECT COUNT(*) FROM depoimentos WHERE user_id = ? AND bonus = 1'); $q->execute([$u['id']]);
  $bonus = setting('depo_bonus') !== '0' && $u['status'] === 'trial' && $temVideo && !(int)$q->fetchColumn();
  if ($bonus) {
    $db->prepare('UPDATE users SET trial_left = trial_left + 1 WHERE id = ?')->execute([$u['id']]);
    $db->prepare('UPDATE depoimentos SET bonus = 1 WHERE id = ?')->execute([$id]);
    notify((int)$u['id'], 'Obrigado pelo seu antes e depois! 🎁', 'Você ganhou mais 1 vídeo grátis no Studio Cover.', site_url() . '/app/');
  }
  try {
    $est = $d['nota'] ? str_repeat('★', (int)$d['nota']) : '';
    foreach ($db->query('SELECT email FROM admins')->fetchAll() as $ad)
      send_mail(null, $ad['email'], 'alerta', '💬 Novo depoimento: ' . ($d['nome'] ?: $u['email']), 'Chegou um depoimento novo',
        '<p><b>' . h($d['nome']) . '</b>' . ($d['instagram'] ? ' (@' . h($d['instagram']) . ')' : '') . " $est</p><p>“" . nl2br(h($d['texto'])) . '”</p><p>' . ($d['aut_imagem'] ? '✅ Autorizou usar nas redes.' : '🔒 Não autorizou uso público (só para nós).') . '</p>',
        'Ver no painel', site_url() . '/admin/#depoimentos');
  } catch (Throwable $e) {}
  return $bonus;
}
