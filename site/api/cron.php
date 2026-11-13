<?php
// Tarefa agendada do funil. No Plesk: Tarefas agendadas → a cada hora → php /caminho/api/cron.php
// Ou por URL: https://SEU-DOMINIO/api/cron.php?chave=CRON_KEY (chave do config.php)
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';
require_once __DIR__ . '/saude.php';
require_once __DIR__ . '/vigia_erros.php';
if (PHP_SAPI !== 'cli') {
  $k = (string)cfg('cron_key');
  if ($k === '' || !hash_equals($k, (string)($_GET['chave'] ?? ''))) { escudo_evento('chave', basename(__FILE__)); http_response_code(403); exit('sem permissão'); }
}
$r = run_funnel(in_array('--agora', $argv ?? [], true));
try { $r['convite_afiliado'] = run_af_convite(in_array('--agora', $argv ?? [], true))['enviados']; } catch (Throwable $e) { $r['convite_afiliado'] = 'erro: ' . $e->getMessage(); }
set_setting('cron_last', now());
// LGPD: não guarda dado além do necessário (prazos na Política de privacidade)
try {
  app_events_db()->prepare('DELETE FROM app_events WHERE created_at < ?')->execute([date('Y-m-d H:i:s', time() - 180 * 86400)]);
  db()->prepare('DELETE FROM webhooks WHERE created_at < ?')->execute([date('Y-m-d H:i:s', time() - 365 * 86400)]);
  db()->prepare('DELETE FROM attempts WHERE at < ?')->execute([time() - 2 * 86400]);
} catch (Throwable $e) {}
$r['vigia'] = health_run();
try { $r['escudo'] = escudo_checagem(); } catch (Throwable $e) { $r['escudo'] = 'erro: ' . $e->getMessage(); }
try { $r['vigia_erros'] = erros_vigia(); } catch (Throwable $e) { $r['vigia_erros'] = 'erro: ' . $e->getMessage(); }
echo json_encode($r, JSON_UNESCAPED_UNICODE), "\n";
