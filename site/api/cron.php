<?php
// Tarefa agendada do funil. No Plesk: Tarefas agendadas → a cada hora → php /caminho/api/cron.php
// Ou por URL: https://SEU-DOMINIO/api/cron.php?chave=CRON_KEY (chave do config.php)
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';
if (PHP_SAPI !== 'cli') {
  $k = (string)cfg('cron_key');
  if ($k === '' || !hash_equals($k, (string)($_GET['chave'] ?? ''))) { http_response_code(403); exit('sem permissão'); }
}
$r = run_funnel(in_array('--agora', $argv ?? [], true));
set_setting('cron_last', now());
echo json_encode($r, JSON_UNESCAPED_UNICODE), "\n";
