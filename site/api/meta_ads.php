<?php
// Gasto real dos anúncios do Gerenciador do Meta, puxado sozinho pela API de Marketing (só leitura, permissão ads_read).
// Cada sócio conecta a conta de anúncios dele (ID act_... + token de usuário do sistema). O gasto de cada anúncio vai para
// a conta cuja UTM está no anúncio: utm_campaign=leo-ads -> Leo, utm_campaign=reinaldo-ads -> Reinaldo. Anúncio sem UTM
// nossa não entra (não é do Studio Cover). Impulsionamento do Instagram continua lançado à mão.
declare(strict_types=1);

const META_VER = 'v23.0';

function meta_db(): PDO {
  static $ok = false; $db = db();
  if ($ok) return $db;
  $db->exec('CREATE TABLE IF NOT EXISTS meta_contas (id INTEGER PRIMARY KEY AUTOINCREMENT, dono TEXT NOT NULL, act TEXT NOT NULL UNIQUE, token TEXT NOT NULL, nome TEXT NOT NULL DEFAULT \'\', ultimo TEXT, erro TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta_gasto (conta TEXT NOT NULL, act TEXT NOT NULL, ad_id TEXT NOT NULL, dia TEXT NOT NULL, valor REAL NOT NULL, PRIMARY KEY (act, ad_id, dia));
    CREATE INDEX IF NOT EXISTS meta_gasto_dia ON meta_gasto(dia, conta)');
  $ok = true; return $db;
}

function meta_get(string $url): array {
  $ctx = stream_context_create(['http' => ['timeout' => 25, 'ignore_errors' => true, 'header' => "User-Agent: StudioCover\r\n"]]);
  $raw = @file_get_contents($url, false, $ctx);
  if ($raw === false) throw new RuntimeException('sem resposta do Meta');
  $j = json_decode($raw, true);
  if (!is_array($j)) throw new RuntimeException('resposta inválida do Meta');
  if (isset($j['error'])) throw new RuntimeException((string)($j['error']['message'] ?? 'erro do Meta'));
  return $j;
}

function meta_url(string $path, array $q, string $token): string {
  $q['access_token'] = $token;
  return 'https://graph.facebook.com/' . META_VER . '/' . ltrim($path, '/') . '?' . http_build_query($q);
}

// conta (leo, reinaldo...) pela UTM que está no anúncio (parâmetros de URL ou no próprio link)
function meta_conta_do_anuncio(array $creative): string {
  $t = strtolower(urldecode(json_encode($creative, JSON_UNESCAPED_SLASHES) ?: ''));
  return preg_match('/utm_campaign=([a-z0-9]+)-ads/', $t, $m) ? $m[1] : '';
}

// confere a conta e devolve o nome dela (usado ao conectar)
function meta_testa(string $act, string $token): string {
  $j = meta_get(meta_url($act, ['fields' => 'name,account_status,currency'], $token));
  return (string)($j['name'] ?? $act);
}

function meta_sync(bool $forcar = false, int $dias = 40): array {
  $db = meta_db(); $out = [];
  foreach ($db->query('SELECT * FROM meta_contas')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    if (!$forcar && $c['ultimo'] && strtotime((string)$c['ultimo']) > time() - 900) { $out[$c['act']] = 'recente'; continue; }
    try {
      $ini = date('Y-m-d', time() - $dias * 86400); $fim = date('Y-m-d');
      $url = meta_url($c['act'] . '/insights', ['level' => 'ad', 'fields' => 'ad_id,spend', 'time_increment' => 1, 'limit' => 500,
        'time_range' => json_encode(['since' => $ini, 'until' => $fim])], (string)$c['token']);
      $linhas = []; $pag = 0;
      while ($url && $pag++ < 40) { $j = meta_get($url); foreach ($j['data'] ?? [] as $l) $linhas[] = $l; $url = (string)($j['paging']['next'] ?? ''); }
      // de qual conta (UTM) é cada anúncio
      $ids = array_values(array_unique(array_map(fn($l) => (string)$l['ad_id'], $linhas))); $dono = [];
      foreach (array_chunk($ids, 50) as $lote) {
        $j = meta_get(meta_url('', ['ids' => implode(',', $lote), 'fields' => 'creative{url_tags,object_story_spec,asset_feed_spec,link_url}'], (string)$c['token']));
        foreach ($lote as $id) $dono[$id] = meta_conta_do_anuncio((array)($j[$id]['creative'] ?? []));
      }
      $db->beginTransaction();
      $db->prepare('DELETE FROM meta_gasto WHERE act = ? AND dia >= ?')->execute([$c['act'], $ini]);
      $ins = $db->prepare('INSERT OR REPLACE INTO meta_gasto (conta, act, ad_id, dia, valor) VALUES (?, ?, ?, ?, ?)');
      $n = 0;
      foreach ($linhas as $l) { $dc = $dono[(string)$l['ad_id']] ?? ''; if ($dc === '' || (float)$l['spend'] <= 0) continue; $ins->execute([$dc, $c['act'], (string)$l['ad_id'], (string)$l['date_start'], (float)$l['spend']]); $n++; }
      $db->commit();
      $db->prepare("UPDATE meta_contas SET ultimo = ?, erro = '' WHERE id = ?")->execute([now(), $c['id']]);
      $out[$c['act']] = "ok ($n linhas)";
    } catch (Throwable $e) {
      if ($db->inTransaction()) $db->rollBack();
      $db->prepare('UPDATE meta_contas SET ultimo = ?, erro = ? WHERE id = ?')->execute([now(), mb_substr($e->getMessage(), 0, 300), $c['id']]);
      $out[$c['act']] = 'erro: ' . $e->getMessage();
    }
  }
  return $out;
}

function meta_contas_lista(): array {
  return array_map(fn($c) => ['id' => (int)$c['id'], 'dono' => $c['dono'], 'act' => $c['act'], 'nome' => $c['nome'], 'ultimo' => $c['ultimo'], 'erro' => $c['erro']],
    meta_db()->query('SELECT id, dono, act, nome, ultimo, erro FROM meta_contas ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
}
