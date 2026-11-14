<?php
// Gasto real dos anúncios do Gerenciador do Meta, puxado sozinho pela API de Marketing (só leitura, permissão ads_read).
// Cada sócio conecta a conta de anúncios dele (ID act_... + token de usuário do sistema). O gasto de cada anúncio vai para
// a conta cuja UTM está no anúncio: utm_campaign=leo-ads -> Leo, utm_campaign=reinaldo-ads -> Reinaldo. Anúncio sem UTM
// nossa não entra (não é do Studio Cover). Impulsionamento do Instagram continua lançado à mão.
declare(strict_types=1);

const META_VER = 'v26.0';

function meta_db(): PDO {
  static $ok = false; $db = db();
  if ($ok) return $db;
  $db->exec('CREATE TABLE IF NOT EXISTS meta_contas (id INTEGER PRIMARY KEY AUTOINCREMENT, dono TEXT NOT NULL, act TEXT NOT NULL UNIQUE, token TEXT NOT NULL, nome TEXT NOT NULL DEFAULT \'\', ultimo TEXT, erro TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta_gasto (conta TEXT NOT NULL, act TEXT NOT NULL, ad_id TEXT NOT NULL, dia TEXT NOT NULL, valor REAL NOT NULL, PRIMARY KEY (act, ad_id, dia));
    CREATE INDEX IF NOT EXISTS meta_gasto_dia ON meta_gasto(dia, conta);
    CREATE TABLE IF NOT EXISTS meta_campanhas (campanha TEXT PRIMARY KEY, conta TEXT NOT NULL, visto TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta_anuncios (ad_id TEXT PRIMARY KEY, act TEXT NOT NULL, conta TEXT NOT NULL DEFAULT \'\', nome TEXT NOT NULL DEFAULT \'\', campanha TEXT NOT NULL DEFAULT \'\', visto TEXT NOT NULL)');
  $c = array_column($db->query('PRAGMA table_info(meta_gasto)')->fetchAll(), 'name');
  if (!in_array('compras', $c, true)) $db->exec('ALTER TABLE meta_gasto ADD COLUMN compras REAL NOT NULL DEFAULT 0'); // compras que o próprio Meta atribui ao anúncio (pixel)
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

// anúncio sem link (post "comenta que eu te mando o link no direct"): não tem UTM nenhuma. Se o nome do anúncio ou da campanha
// tem "Studio Cover", é do Studio Cover e o gasto vai para o dono da conta de anúncios conectada (Meu Gestor Pro -> leo).
function meta_conta_pelo_nome(array $ad, string $dono): string {
  $t = mb_strtolower((string)($ad['name'] ?? '') . ' ' . (string)($ad['campaign']['name'] ?? ''));
  return $dono !== '' && preg_match('/studio\s*cover/u', $t) ? $dono : '';
}

// todas as utm_campaign que aparecem no anúncio (no link e nos parâmetros): a venda chega com a do link,
// então guardamos que aquela campanha é da conta (leo/reinaldo) para somar a venda no ROI certo
function meta_campanhas_do_anuncio(array $creative): array {
  $t = strtolower(urldecode(json_encode($creative, JSON_UNESCAPED_SLASHES) ?: ''));
  preg_match_all('/utm_campaign=([^&"\s#\\\\]+)/', $t, $m);
  return array_values(array_unique(array_filter(array_map(fn($c) => or_limpa($c, 60), $m[1] ?? []))));
}

// confere a conta e devolve o nome dela (usado ao conectar)
function meta_testa(string $act, string $token): string {
  $j = meta_get(meta_url($act, ['fields' => 'name,account_status,currency'], $token));
  return (string)($j['name'] ?? $act);
}

function meta_sync(bool $forcar = false, int $dias = 40): array {
  $db = meta_db(); $out = [];
  foreach ($db->query('SELECT * FROM meta_contas')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    if (!$forcar && $c['erro'] === '' && $c['ultimo'] && strtotime((string)$c['ultimo']) > time() - 900) { $out[$c['act']] = 'recente'; continue; }
    try {
      $ini = date('Y-m-d', time() - $dias * 86400); $fim = date('Y-m-d');
      $url = meta_url($c['act'] . '/insights', ['level' => 'ad', 'fields' => 'ad_id,spend,actions', 'time_increment' => 1, 'limit' => 500, 'use_unified_attribution_setting' => 'true', // mesma contagem do Gerenciador
        'time_range' => json_encode(['since' => $ini, 'until' => $fim])], (string)$c['token']);
      $linhas = []; $pag = 0;
      while ($url && $pag++ < 40) { $j = meta_get($url); foreach ($j['data'] ?? [] as $l) $linhas[] = $l; $url = (string)($j['paging']['next'] ?? ''); }
      // de qual conta (UTM) é cada anúncio
      $ids = array_values(array_unique(array_map(fn($l) => (string)$l['ad_id'], $linhas))); $dono = [];
      // lista os anúncios da conta (inclusive pausados, arquivados e apagados) com o criativo; o parâmetro "ids" não existe mais na API v26+
      $campos = 'id,name,campaign{name},creative{url_tags,object_story_spec,asset_feed_spec,link_url,effective_object_story_id}';
      $url2 = meta_url($c['act'] . '/ads', ['fields' => $campos, 'limit' => 200,
        'filtering' => json_encode([['field' => 'effective_status', 'operator' => 'IN', 'value' => ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'DISAPPROVED', 'PENDING_REVIEW', 'PREAPPROVED', 'PENDING_BILLING_INFO']]])], (string)$c['token']);
      $pag = 0;
      $posts = []; // anúncio feito de post existente: o link (com a utm_campaign que a venda traz) está no post, não no criativo
      while ($url2 && $pag++ < 40) { $j = meta_get($url2); foreach ($j['data'] ?? [] as $ad) { $cr = (array)($ad['creative'] ?? []); $dono[(string)$ad['id']] = $dc = meta_conta_do_anuncio($cr) ?: meta_conta_pelo_nome($ad, (string)$c['dono']);
        $db->prepare('INSERT OR REPLACE INTO meta_anuncios (ad_id, act, conta, nome, campanha, visto) VALUES (?, ?, ?, ?, ?, ?)')->execute([(string)$ad['id'], $c['act'], $dc, mb_substr((string)($ad['name'] ?? ''), 0, 120), mb_substr((string)($ad['campaign']['name'] ?? ''), 0, 160), now()]);
        if ($dc !== '') { foreach (meta_campanhas_do_anuncio($cr) as $cp) $db->prepare('INSERT OR REPLACE INTO meta_campanhas (campanha, conta, visto) VALUES (?, ?, ?)')->execute([$cp, $dc, now()]);
          $sid = (string)($cr['effective_object_story_id'] ?? ''); if ($sid !== '' && in_array((string)$ad['id'], $ids, true)) $posts[$sid] = $dc; } } $url2 = (string)($j['paging']['next'] ?? ''); }
      foreach (array_slice($posts, 0, 30, true) as $sid => $dc) {
        try { $p = meta_get(meta_url($sid, ['fields' => 'call_to_action,attachments{url,unshimmed_url,target}'], (string)$c['token']));
          foreach (meta_campanhas_do_anuncio($p) as $cp) $db->prepare('INSERT OR REPLACE INTO meta_campanhas (campanha, conta, visto) VALUES (?, ?, ?)')->execute([$cp, $dc, now()]);
        } catch (Throwable $e) { $out[$c['act'] . ':post'] = mb_substr($e->getMessage(), 0, 120); }
      }
      foreach (array_slice(array_diff($ids, array_keys($dono)), 0, 100) as $id) { // algum que não veio na lista: busca um por um
        try { $j = meta_get(meta_url($id, ['fields' => 'name,campaign{name},creative{url_tags,object_story_spec,asset_feed_spec,link_url}'], (string)$c['token'])); $dono[$id] = meta_conta_do_anuncio((array)($j['creative'] ?? [])) ?: meta_conta_pelo_nome($j, (string)$c['dono']); } catch (Throwable $e) { $dono[$id] = ''; }
      }
      $db->beginTransaction();
      $db->prepare('DELETE FROM meta_gasto WHERE act = ? AND dia >= ?')->execute([$c['act'], $ini]);
      $ins = $db->prepare('INSERT OR REPLACE INTO meta_gasto (conta, act, ad_id, dia, valor, compras) VALUES (?, ?, ?, ?, ?, ?)');
      $n = 0;
      foreach ($linhas as $l) { $dc = $dono[(string)$l['ad_id']] ?? ''; if ($dc === '' || (float)$l['spend'] <= 0) continue; $cp = 0.0; foreach ((array)($l['actions'] ?? []) as $ac) if (in_array($ac['action_type'] ?? '', ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'], true)) $cp = max($cp, (float)$ac['value']);
        $ins->execute([$dc, $c['act'], (string)$l['ad_id'], (string)$l['date_start'], (float)$l['spend'], $cp]); $n++; }
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

// vendas e gasto de CADA anúncio no período, do jeito que o Gerenciador mostra (mesma atribuição): para o ROI anúncio por anúncio
function meta_por_anuncio(string $de, string $ate): array {
  $q = meta_db()->prepare("SELECT g.conta, g.ad_id, COALESCE(a.nome, '') nome, COALESCE(a.campanha, '') campanha, SUM(g.valor) gasto, SUM(g.compras) compras
    FROM meta_gasto g LEFT JOIN meta_anuncios a ON a.ad_id = g.ad_id WHERE g.dia >= ? AND g.dia <= ? GROUP BY g.conta, g.ad_id ORDER BY g.conta, gasto DESC");
  $q->execute([substr($de, 0, 10), substr($ate, 0, 10)]);
  return array_map(fn($r) => ['conta' => $r['conta'], 'ad_id' => $r['ad_id'], 'nome' => $r['nome'], 'campanha' => $r['campanha'], 'gasto' => round((float)$r['gasto'], 2), 'compras' => (int)round((float)$r['compras'])], $q->fetchAll(PDO::FETCH_ASSOC));
}
