<?php
// Vistoria do Studio Cover a cada 10 minutos: erros do app (agrupados por tipo) + saúde do sistema (site, checkout, e-mail, Eduzz, disco).
// Chamado pela tarefa de publicação (a cada 5 min, roda de fato a cada ~10), pelo cron de hora em hora e quando o app manda um erro.
// Por URL (para um agendador de fora, se precisar): https://studiocover.com.br/api/vigia.php?chave=CRON_KEY
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/saude.php';
require_once __DIR__ . '/vigia_erros.php';
if (PHP_SAPI !== 'cli') {
  $k = (string)cfg('cron_key');
  if ($k === '' || !hash_equals($k, (string)($_GET['chave'] ?? ''))) { http_response_code(403); exit('sem permissão'); }
}
$forcar = in_array('--agora', $argv ?? [], true) || isset($_GET['agora']);
$r = erros_vigia($forcar);
if (($r['vigia_erros'] ?? '') === 'ok') {
  try { $r['sistema'] = health_run(); } catch (Throwable $e) { $r['sistema'] = 'erro: ' . $e->getMessage(); }
  echo date('d/m H:i'), ' ', json_encode($r, JSON_UNESCAPED_UNICODE), "\n";
}
