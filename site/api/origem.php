<?php
// Origem das vendas: de qual página (home com teste grátis, /vsl de compra direta) e de qual canal/campanha (utm) veio cada visita, cadastro e venda.
// A página grava o cookie sc_or = "pagina|fonte|campanha" (30 dias) e manda a visita; o botão de compra leva trk=o.pagina.fonte.campanha para a Eduzz,
// que devolve no aviso da venda (edz_trk_1). Quem compra de dentro do app/funil leva trk=teste e a venda herda a origem do cadastro do teste.
declare(strict_types=1);
require_once __DIR__ . '/meta_ads.php';

function or_limpa(string $s, int $max = 40): string {
  $s = mb_strtolower(trim($s));
  $s = preg_replace('/[^a-z0-9_-]+/', '-', $s) ?? '';
  return substr(trim($s, '-'), 0, $max);
}

function origem_db(): PDO {
  static $ok = false; $db = db();
  if ($ok) return $db;
  $db->exec('CREATE TABLE IF NOT EXISTS visitas (id INTEGER PRIMARY KEY AUTOINCREMENT, pagina TEXT NOT NULL, fonte TEXT NOT NULL, campanha TEXT NOT NULL DEFAULT \'\', ip TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS visitas_dia ON visitas(created_at)');
  $cu = array_column($db->query('PRAGMA table_info(users)')->fetchAll(), 'name');
  if (!in_array('origem', $cu, true)) $db->exec("ALTER TABLE users ADD COLUMN origem TEXT NOT NULL DEFAULT ''");
  $cs = array_column($db->query('PRAGMA table_info(sales)')->fetchAll(), 'name');
  foreach (['or_pagina', 'or_fonte', 'or_campanha', 'or_caminho'] as $c) if (!in_array($c, $cs, true)) $db->exec("ALTER TABLE sales ADD COLUMN $c TEXT NOT NULL DEFAULT ''");
  $ok = true; return $db;
}

// "pagina|fonte|campanha" -> [pagina, fonte, campanha]
function or_partes(string $o): array {
  $p = array_pad(explode('|', $o, 3), 3, '');
  return [or_limpa($p[0], 20), or_limpa($p[1], 40), or_limpa($p[2], 60)];
}

function or_visitante(): string {
  [$p, $f, $c] = or_partes((string)($_COOKIE['sc_or'] ?? ''));
  return $p !== '' ? "$p|$f|$c" : '';
}

function or_registra_visita(string $pagina, string $fonte, string $campanha): void {
  $pagina = or_limpa($pagina, 20); $fonte = or_limpa($fonte) ?: 'direto'; $campanha = or_limpa($campanha, 60);
  if ($pagina === '') return;
  $db = origem_db();
  $ip = substr(hash('sha256', client_ip() . '|sc'), 0, 16); // não guarda o IP
  $q = $db->prepare('SELECT 1 FROM visitas WHERE ip = ? AND pagina = ? AND created_at >= ?'); $q->execute([$ip, $pagina, date('Y-m-d H:i:s', time() - 1800)]);
  if ($q->fetch()) return; // a mesma pessoa recarregando a página não conta de novo
  $db->prepare('INSERT INTO visitas (pagina, fonte, campanha, ip, created_at) VALUES (?, ?, ?, ?, ?)')->execute([$pagina, $fonte, $campanha, $ip, now()]);
}

// origem de uma venda: [pagina, fonte, campanha, caminho]
function or_da_venda(array $data, ?array $u, ?int $afId): array {
  $trk = (string)($data['edz_trk_1'] ?? $data['trk'] ?? '');
  $doCadastro = function () use ($u) { [$p, $f, $c] = or_partes((string)($u['origem'] ?? '')); return [$p ?: 'sem-rastreio', $f, $c]; };
  if (preg_match('/^o\.([^.]*)\.([^.]*)\.?(.*)$/', $trk, $m)) return [or_limpa($m[1], 20), or_limpa($m[2]), or_limpa($m[3], 60), $afId ? 'afiliado' : 'compra direta'];
  if (preg_match('/^(vsl|home)-?(.*)$/', $trk, $m)) return [$m[1], '', or_limpa($m[2], 60), $afId ? 'afiliado' : 'compra direta']; // formato antigo (13/11 manhã)
  if (preg_match('/^af-(.+)$/i', $trk, $m)) { [$p, $f, $c] = $doCadastro(); return [$p === 'sem-rastreio' ? 'link-afiliado' : $p, 'afiliado', or_limpa($m[1], 60), 'afiliado']; }
  if ($trk === 'teste' || ($u && ($u['source'] ?? '') === 'trial')) { [$p, $f, $c] = $doCadastro(); return [$p, $f, $c, $afId ? 'afiliado' : 'teste grátis']; }
  return ['sem-rastreio', '', '', $afId ? 'afiliado' : 'compra direta'];
}

function or_marca_venda(int $saleId, array $o): void {
  origem_db()->prepare('UPDATE sales SET or_pagina = ?, or_fonte = ?, or_campanha = ?, or_caminho = ? WHERE id = ?')->execute([$o[0], $o[1], $o[2], $o[3], $saleId]);
}

// conta de anúncio de cada gasto lançado (leo, reinaldo...): casa com utm_campaign "leo-ads", "reinaldo-ads"
function ad_gastos_conta(PDO $db): void {
  static $ok = false; if ($ok) return;
  $db->exec('CREATE TABLE IF NOT EXISTS ad_gastos (id INTEGER PRIMARY KEY AUTOINCREMENT, dia TEXT NOT NULL, valor REAL NOT NULL, nota TEXT, created_at TEXT NOT NULL)');
  $c = array_column($db->query('PRAGMA table_info(ad_gastos)')->fetchAll(), 'name');
  if (!in_array('conta', $c, true)) $db->exec("ALTER TABLE ad_gastos ADD COLUMN conta TEXT NOT NULL DEFAULT ''");
  $ok = true;
}

// ROI por conta de anúncio no período: gasto lançado x vendas que vieram de anúncio do Meta com a campanha daquela conta
function or_anuncios(PDO $db, string $since, string $ate = '9999-12-31 23:59:59'): array {
  ad_gastos_conta($db);
  $g = $db->prepare('SELECT conta, SUM(valor) v FROM ad_gastos WHERE dia >= ? AND dia <= ? GROUP BY conta'); $g->execute([substr($since, 0, 10), substr($ate, 0, 10)]);
  $s = $db->prepare("SELECT or_pagina, or_fonte, or_campanha, liquido, created_at FROM sales WHERE status = 'pago' AND created_at >= ? AND created_at <= ? AND or_fonte IN ('anuncio-meta', 'meta-sem-utm', 'meta', 'fb', 'facebook-ads', 'meta-ads', 'instagram-ads')"); $s->execute([$since, $ate]);
  $mapa = []; try { foreach (meta_db()->query('SELECT campanha, conta FROM meta_campanhas')->fetchAll(PDO::FETCH_NUM) as [$cp, $ct]) $mapa[$cp] = $ct; } catch (Throwable $e) {}
  // de quem é a venda de anúncio: campanha começando com leo-/reinaldo- ou uma campanha que está no link de um anúncio daquela conta
  // (a Eduzz corta o rastreio em 40 letras, então vale o começo do nome)
  // contas que tiveram gasto no Gerenciador em cada dia: anúncio feito de post existente esconde o link do post da API,
  // então, se só uma conta anunciou naquele dia, a venda de anúncio com campanha desconhecida é dela
  $doDia = []; try { foreach (meta_db()->query('SELECT dia, conta FROM meta_gasto WHERE valor > 0 GROUP BY dia, conta')->fetchAll(PDO::FETCH_NUM) as [$d, $ct]) $doDia[$d][$ct] = 1; } catch (Throwable $e) {}
  $GLOBALS['or_soltas'] = [];
  $contaDa = function (string $cp, string $dia) use ($mapa, $doDia): string {
    if (preg_match('/^(leo|reinaldo)(-|$)/', $cp, $m)) return $m[1];
    if (isset($mapa[$cp])) return $mapa[$cp];
    if (strlen($cp) >= 10) foreach ($mapa as $k => $v) if (str_starts_with((string)$k, $cp)) return $v;
    if (count($doDia[$dia] ?? []) === 1) { $ct = (string)array_key_first($doDia[$dia]); // aprende: da próxima vez essa campanha já é dessa conta
      if ($cp !== '') try { meta_db()->prepare('INSERT OR IGNORE INTO meta_campanhas (campanha, conta, visto) VALUES (?, ?, ?)')->execute([$cp, $ct, now()]); } catch (Throwable $e) {}
      return $ct; }
    if ($cp === '') return '?';
    $GLOBALS['or_soltas'][$cp] = 1; // campanha sem dono: o painel pergunta de quem é
    return (string)(explode('-', $cp)[0] ?? '?');
  };
  $r = [];
  $add = function (string $c) use (&$r) { $r[$c] ??= ['conta' => $c, 'gasto' => 0.0, 'gasto_auto' => 0.0, 'gasto_manual' => 0.0, 'vendas' => 0, 'liquido' => 0.0, 'vsl' => 0, 'home' => 0]; };
  foreach ($g->fetchAll() as $x) { $c = (string)$x['conta']; $add($c); $r[$c]['gasto'] += (float)$x['v']; $r[$c]['gasto_manual'] += (float)$x['v']; } // impulsionamento lançado à mão
  try { $m = meta_db()->prepare('SELECT conta, SUM(valor) v, SUM(compras) cp FROM meta_gasto WHERE dia >= ? AND dia <= ? GROUP BY conta'); $m->execute([substr($since, 0, 10), substr($ate, 0, 10)]);
    foreach ($m->fetchAll() as $x) { $c = (string)$x['conta']; $add($c); $r[$c]['gasto'] += (float)$x['v']; $r[$c]['gasto_auto'] += (float)$x['v']; $r[$c]['compras_meta'] = (int)round((float)$x['cp']); } } catch (Throwable $e) {} // Gerenciador, automático pela UTM
  foreach ($s->fetchAll() as $x) {
    $c = $x['or_fonte'] === 'meta-sem-utm' ? '?' : $contaDa((string)$x['or_campanha'], substr((string)$x['created_at'], 0, 10));
    $add($c); $r[$c]['vendas']++; $r[$c]['liquido'] += (float)$x['liquido'];
    if ($x['or_pagina'] === 'vsl') $r[$c]['vsl']++; elseif ($x['or_pagina'] === 'home') $r[$c]['home']++;
  }
  return array_values($r);
}

// relatório do painel
function or_relatorio(int $dias): array {
  $db = origem_db(); sales_fill_net();
  $since = date('Y-m-d H:i:s', time() - $dias * 86400);
  $vis = $db->prepare('SELECT pagina, fonte, campanha, COUNT(*) n FROM visitas WHERE created_at >= ? GROUP BY pagina, fonte, campanha'); $vis->execute([$since]);
  $cad = $db->prepare("SELECT origem, COUNT(*) n FROM users WHERE source = 'trial' AND created_at >= ? GROUP BY origem"); $cad->execute([$since]);
  $ven = $db->prepare("SELECT or_pagina, or_fonte, or_campanha, or_caminho, COUNT(*) n, COALESCE(SUM(liquido), 0) l FROM sales WHERE status = 'pago' AND created_at >= ? GROUP BY or_pagina, or_fonte, or_campanha, or_caminho"); $ven->execute([$since]);
  $rows = [];
  $add = function (string $p, string $f, string $c, string $k, $v) use (&$rows) {
    $p = $p === '' ? 'sem-rastreio' : $p;
    $key = "$p|$f|$c";
    $rows[$key] ??= ['pagina' => $p, 'fonte' => $f, 'campanha' => $c, 'visitas' => 0, 'cadastros' => 0, 'vendas' => 0, 'liquido' => 0.0, 'direta' => 0, 'teste' => 0, 'afiliado' => 0];
    if ($k === 'liquido') $rows[$key][$k] += (float)$v; else $rows[$key][$k] += (int)$v;
  };
  foreach ($vis->fetchAll() as $r) $add($r['pagina'], $r['fonte'], $r['campanha'], 'visitas', $r['n']);
  foreach ($cad->fetchAll() as $r) { [$p, $f, $c] = or_partes((string)$r['origem']); $add($p ?: 'sem-rastreio', $f, $c, 'cadastros', $r['n']); }
  foreach ($ven->fetchAll() as $r) {
    $p = (string)$r['or_pagina']; $f = (string)$r['or_fonte']; $c = (string)$r['or_campanha'];
    $add($p, $f, $c, 'vendas', $r['n']); $add($p, $f, $c, 'liquido', $r['l']);
    $cam = ['compra direta' => 'direta', 'teste grátis' => 'teste', 'afiliado' => 'afiliado'][(string)$r['or_caminho']] ?? '';
    if ($cam) $add($p, $f, $c, $cam, $r['n']);
  }
  $ult = $db->prepare("SELECT s.created_at, s.liquido, s.or_pagina, s.or_fonte, s.or_campanha, s.or_caminho, u.name FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.status = 'pago' ORDER BY s.id DESC LIMIT 15");
  $ult->execute();
  $anun = or_anuncios($db, $since);
  return ['ok' => true, 'anuncios' => $anun, 'campanhas_soltas' => array_keys($GLOBALS['or_soltas'] ?? []), 'meta_contas' => meta_contas_lista(), 'dias' => $dias, 'linhas' => array_values($rows), 'ultimas' => $ult->fetchAll(), 'desde_rastreio' => (string)$db->query('SELECT MIN(created_at) FROM visitas')->fetchColumn()];
}
