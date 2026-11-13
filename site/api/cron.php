<?php
// Tarefa agendada do funil. No Plesk: Tarefas agendadas → a cada hora → php /caminho/api/cron.php
// Ou por URL: https://SEU-DOMINIO/api/cron.php?chave=CRON_KEY (chave do config.php)
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';
require __DIR__ . '/saude.php';
if (PHP_SAPI !== 'cli') {
  $k = (string)cfg('cron_key');
  if ($k === '' || !hash_equals($k, (string)($_GET['chave'] ?? ''))) { http_response_code(403); exit('sem permissão'); }
}
$r = run_funnel(in_array('--agora', $argv ?? [], true));
try { $r['convite_afiliado'] = run_af_convite(in_array('--agora', $argv ?? [], true))['enviados']; } catch (Throwable $e) { $r['convite_afiliado'] = 'erro: ' . $e->getMessage(); }
// uma vez só (2026-11-13): devolve o vídeo do teste para quem perdeu por erro do app
try { if (!setting('testes_devolvidos_v1')) { $n = count(testes_perdidos(true)); set_setting('testes_devolvidos_v1', now() . ' · ' . $n); $r['testes_devolvidos'] = $n; } } catch (Throwable $e) { $r['testes_devolvidos'] = 'erro: ' . $e->getMessage(); }
set_setting('cron_last', now());
// LGPD: não guarda dado além do necessário (prazos na Política de privacidade)
try {
  app_events_db()->prepare('DELETE FROM app_events WHERE created_at < ?')->execute([date('Y-m-d H:i:s', time() - 180 * 86400)]);
  db()->prepare('DELETE FROM webhooks WHERE created_at < ?')->execute([date('Y-m-d H:i:s', time() - 365 * 86400)]);
  db()->prepare('DELETE FROM attempts WHERE at < ?')->execute([time() - 2 * 86400]);
} catch (Throwable $e) {}
$r['vigia'] = health_run();
echo json_encode($r, JSON_UNESCAPED_UNICODE), "\n";
