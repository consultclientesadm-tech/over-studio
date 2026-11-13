<?php
// Escudo do Studio Cover: defesa contra invasão (nunca ataca ninguém, só se protege).
// - registra tentativas suspeitas (senha errada em série, chave errada, armadilhas que só robô de invasão abre,
//   tentativa de injeção de código) e bloqueia o IP por algumas horas quando passa do limite;
// - checagem recorrente (junto da vistoria de 10 em 10 min): arquivos do site iguais aos publicados (se alguém mexer,
//   volta sozinho), arquivo PHP estranho no site vai para a quarentena, permissões, arquivos secretos inacessíveis
//   pela internet, cabeçalhos de segurança, administrador novo;
// - avisa os administradores por e-mail e no celular.
declare(strict_types=1);

// tipo => [quantas vezes na janela, janela (s), bloqueio (s), descrição]
const ESCUDO_REGRAS = [
  'armadilha'   => [3, 3600, 6 * 3600, 'Abriu endereço que só robô de invasão procura'],
  'injecao'     => [2, 3600, 24 * 3600, 'Tentou injetar código no site'],
  'login_admin' => [10, 900, 2 * 3600, 'Errou a senha do painel várias vezes'],
  'login'       => [30, 900, 3600, 'Errou a senha da área do aluno várias vezes'],
  'chave'       => [8, 3600, 24 * 3600, 'Tentou chaves secretas erradas (webhook, tarefas, instalação)'],
  'limite'      => [25, 900, 3600, 'Bateu no limite de tentativas várias vezes'],
];
const ESCUDO_INFO = ['admin_login' => 'Entrou no painel', 'admin_novo' => 'Administrador criado', 'admin_senha' => 'Senha de administrador trocada',
  'bloqueio' => 'IP bloqueado', 'desbloqueio' => 'IP desbloqueado', 'restaurado' => 'Arquivo alterado no servidor e restaurado',
  'quarentena' => 'Arquivo estranho no site foi para a quarentena', 'senha_obrigado' => 'Senha criada na página de obrigado sem código da fatura'];

function escudo_db(): PDO {
  static $ok = false; $db = db();
  if (!$ok) {
    $db->exec('CREATE TABLE IF NOT EXISTS seg_eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, tipo TEXT NOT NULL, detalhe TEXT, ua TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS seg_eventos_ip ON seg_eventos(ip, tipo, created_at);
      CREATE INDEX IF NOT EXISTS seg_eventos_dia ON seg_eventos(created_at);
      CREATE TABLE IF NOT EXISTS seg_bloqueios (ip TEXT PRIMARY KEY, motivo TEXT NOT NULL, ate TEXT NOT NULL, created_at TEXT NOT NULL, vezes INTEGER NOT NULL DEFAULT 1);');
    $ok = true;
  }
  return $db;
}
// IPv6 muda o final o tempo todo: bloqueia a faixa /64 inteira
function escudo_ip(?string $ip = null): string {
  $ip = $ip ?? client_ip();
  if (str_contains($ip, ':')) { $p = explode(':', $ip); return implode(':', array_slice(array_pad($p, 4, '0'), 0, 4)) . '::/64'; }
  return $ip;
}
function escudo_bloqueado(?string $ip = null): ?array {
  try { $q = escudo_db()->prepare('SELECT * FROM seg_bloqueios WHERE ip = ? AND ate > ?'); $q->execute([escudo_ip($ip), now()]); return $q->fetch() ?: null; }
  catch (Throwable $e) { return null; }
}

// registra um evento; se passou do limite, bloqueia o IP e avisa
function escudo_evento(string $tipo, string $detalhe = ''): void {
  if (PHP_SAPI === 'cli') return;
  try {
    $db = escudo_db(); $ip = escudo_ip();
    $db->prepare('INSERT INTO seg_eventos (ip, tipo, detalhe, ua, created_at) VALUES (?, ?, ?, ?, ?)')
      ->execute([$ip, $tipo, mb_substr($detalhe, 0, 300), mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200), now()]);
    if (!isset(ESCUDO_REGRAS[$tipo])) return;
    [$max, $janela, $dur, $desc] = ESCUDO_REGRAS[$tipo];
    $q = $db->prepare('SELECT COUNT(*) FROM seg_eventos WHERE ip = ? AND tipo = ? AND created_at >= ?'); $q->execute([$ip, $tipo, date('Y-m-d H:i:s', time() - $janela)]);
    if ((int)$q->fetchColumn() >= $max && !escudo_bloqueado()) escudo_bloquear($ip, $desc, $dur, $detalhe);
  } catch (Throwable $e) {}
}
function escudo_bloquear(string $ip, string $motivo, int $dur, string $detalhe = ''): void {
  $db = escudo_db();
  $db->prepare('INSERT INTO seg_bloqueios (ip, motivo, ate, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(ip) DO UPDATE SET motivo = excluded.motivo, ate = excluded.ate, vezes = vezes + 1')
    ->execute([$ip, $motivo, date('Y-m-d H:i:s', time() + $dur), now()]);
  $db->prepare('INSERT INTO seg_eventos (ip, tipo, detalhe, created_at) VALUES (?, ?, ?, ?)')->execute([$ip, 'bloqueio', $motivo . ' · ' . round($dur / 3600) . ' h', now()]);
  escudo_avisar('bloqueio', '🛡️ Studio Cover: ataque barrado e IP bloqueado',
    '<p>O escudo bloqueou o IP <b>' . h($ip) . '</b> por ' . round($dur / 3600) . ' h.</p><p>Motivo: <b>' . h($motivo) . '</b>' . ($detalhe ? '<br><small>Último sinal: ' . h(mb_substr($detalhe, 0, 160)) . '</small>' : '') . '</p><p>Nada foi invadido: a tentativa foi barrada. Se foi engano (por exemplo, você mesmo errando a senha), desbloqueie na aba Vistoria do painel.</p>',
    "IP $ip bloqueado: $motivo", 1800);
}

// e-mail + celular dos administradores (no máximo 1 aviso do mesmo tipo a cada $intervalo segundos)
function escudo_avisar(string $chave, string $assunto, string $html, string $curto, int $intervalo = 3600): void {
  try {
    $last = setting('escudo_aviso_' . $chave);
    if ($last && strtotime($last) > time() - $intervalo) return;
    set_setting('escudo_aviso_' . $chave, now());
    foreach (db()->query('SELECT email FROM admins')->fetchAll(PDO::FETCH_COLUMN) as $to) {
      try { send_mail(null, $to, 'alerta', $assunto, 'Escudo do Studio Cover', $html, 'Abrir o painel', site_url() . '/admin/#vistoria'); } catch (Throwable $e) {}
      try { $q = db()->prepare('SELECT id FROM users WHERE email = ?'); $q->execute([$to]); $uid = (int)$q->fetchColumn(); if ($uid) push_user($uid, '🛡️ Escudo do Studio Cover', $curto, site_url() . '/admin/#vistoria'); } catch (Throwable $e) {}
    }
  } catch (Throwable $e) {}
}

// portão: roda em toda chamada da API (lib.php). IP bloqueado não passa (administrador logado passa, para poder desbloquear).
function escudo_portao(): void {
  if (PHP_SAPI === 'cli' || defined('ESCUDO_LIVRE')) return;
  // injeção: só olha o endereço e corpos pequenos de texto (nunca os pedaços de vídeo do depoimento)
  $alvo = rawurldecode((string)($_SERVER['QUERY_STRING'] ?? ''));
  $ct = (string)($_SERVER['CONTENT_TYPE'] ?? '');
  if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) < 20000 && preg_match('#json|form-urlencoded#i', $ct)) $alvo .= ' ' . (string)file_get_contents('php://input');
  if ($alvo !== '' && preg_match('#union[\s/*+]+(all[\s/*+]+)?select|/etc/passwd|\.\./\.\./|\$\{jndi:|php://(filter|input)|<script[\s>]|javascript:[^"\']{0,40}\(|\bsleep\s*\(\s*\d|benchmark\s*\(|information_schema|\'\s*or\s+\'?1\'?\s*=\s*\'?1|load_file\s*\(|into\s+outfile#i', $alvo, $m)) {
    escudo_evento('injecao', $m[0] . ' · ' . mb_substr((string)($_SERVER['REQUEST_URI'] ?? ''), 0, 160));
    fail('Requisição bloqueada pelo escudo de segurança.', 403);
  }
  $b = escudo_bloqueado();
  // o login do painel continua aberto (bem mais limitado), para um administrador num IP bloqueado por engano conseguir entrar e desbloquear
  if ($b && basename((string)($_SERVER['SCRIPT_NAME'] ?? '')) === 'admin.php' && in_array($_GET['a'] ?? '', ['estado', 'login'], true)) { define('ESCUDO_BLOQUEADO', true); return; }
  if ($b && !current_admin()) fail('Acesso bloqueado por segurança por algumas horas. Se for engano, fale com ' . (setting('dpo_email') ?: 'o suporte') . '.', 403);
}

// ---------- chave do GitHub (repositório privado): o site precisa dela para buscar a versão nova ----------
function escudo_gh_arquivo(): string { return rtrim((string)cfg('data_dir'), '/') . '/github-token'; }
function escudo_gh_testar(string $tok): array {
  $ch = curl_init('https://api.github.com/repos/consultclientesadm-tech/over-studio');
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $tok, 'User-Agent: studio-cover', 'Accept: application/vnd.github+json']]);
  $r = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  $j = json_decode((string)$r, true) ?: [];
  return ['ok' => $code === 200, 'codigo' => $code, 'privado' => (bool)($j['private'] ?? false)];
}
function escudo_gh_status(): array {
  $f = escudo_gh_arquivo(); $tem = is_file($f) && filesize($f) > 10;
  $st = json_decode(setting('escudo_gh') ?: '{}', true) ?: [];
  return ['tem' => $tem, 'testado' => $st['quando'] ?? null, 'ok' => $tem && !empty($st['ok']), 'privado' => $st['privado'] ?? null, 'final' => $tem ? substr(trim((string)file_get_contents($f)), -4) : ''];
}
function escudo_gh_salvar(string $tok): array {
  $tok = trim($tok);
  if (!preg_match('/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/', $tok)) fail('Isso não parece uma chave do GitHub. Ela começa com github_pat_ (ou ghp_).');
  $t = escudo_gh_testar($tok);
  if (!$t['ok']) fail($t['codigo'] === 401 ? 'O GitHub recusou esta chave (venceu ou foi copiada pela metade).' : ($t['codigo'] === 404 ? 'A chave funciona, mas não tem acesso ao repositório over-studio. Ao criar, escolha esse repositório.' : 'Não consegui falar com o GitHub agora (código ' . $t['codigo'] . '). Tente de novo.'));
  $f = escudo_gh_arquivo(); @file_put_contents($f, $tok . "\n"); @chmod($f, 0600);
  if (!is_file($f)) fail('Não consegui gravar a chave no servidor.');
  set_setting('escudo_gh', json_encode(['quando' => now(), 'ok' => true, 'privado' => $t['privado']]));
  return escudo_gh_status();
}

// ---------- checagem recorrente ----------
const ESCUDO_EXEC = '/\.(php\d?|phtml|phar|pht|phps|cgi|pl|py|sh|asp|aspx|jsp|shtml)$/i';
function escudo_arquivos(string $dir, int $max = 30000): array {
  $out = []; if (!is_dir($dir)) return $out;
  $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
  foreach ($it as $f) { if (!$f->isFile()) continue; $out[] = substr($f->getPathname(), strlen($dir) + 1); if (count($out) >= $max) break; }
  return $out;
}
function escudo_checagem(bool $forcar = false): array {
  $antes = json_decode(setting('escudo') ?: 'null', true);
  if (!$forcar && $antes && strtotime($antes['quando']) > time() - 4 * 60) return ['escudo' => 'recente'];
  $W = dirname(__DIR__); $home = dirname(__DIR__, 2);
  $ref = is_dir("$home/sc-publicado") ? "$home/sc-publicado" : (is_dir("$home/sc-repo/site") ? "$home/sc-repo/site" : '');
  $prob = []; $rest = []; $quar = []; $data = rtrim((string)cfg('data_dir'), '/');
  $publicando = is_file("$home/.sc_publicando") && filemtime("$home/.sc_publicando") > time() - 600;

  // 1) arquivos do site iguais aos publicados; se alguém mexer, volta sozinho
  if ($ref && !$publicando) {
    foreach (escudo_arquivos($ref) as $p) {
      if ($p === 'api/config.php' || $p === '.fonte' || !preg_match('/(\.(php|html?|js|htaccess|webmanifest|ini)|^\.htaccess|\/\.htaccess)$/i', $p)) continue;
      $a = "$ref/$p"; $b = "$W/$p";
      if (filesize($a) > 3 * 1048576) continue;
      if (!is_file($b) || md5_file($a) !== md5_file($b)) {
        @mkdir(dirname($b), 0755, true);
        if (@copy($a, $b)) $rest[] = $p; else $prob['restaurar'] = "Não consegui restaurar $p";
      }
    }
    // 2) arquivo executável que não veio da publicação (porta dos fundos) vai para a quarentena
    $base = json_decode(setting('escudo_base') ?: 'null', true);
    $estranhos = [];
    foreach (escudo_arquivos($W) as $p) {
      $nome = basename($p);
      if ($p === 'api/config.php' || str_starts_with($p, '.well-known/') || ($data && str_starts_with("$W/$p", $data . '/'))) continue;
      if (preg_match('#^api/dados/#', $p)) continue; // banco no plano B (bloqueado pelo .htaccess)
      $exec = preg_match(ESCUDO_EXEC, $nome) || $nome === '.user.ini' || $nome === '.htaccess' || $nome === 'php.ini';
      if ($exec && !is_file("$ref/$p")) $estranhos[] = $p;
    }
    if ($base === null) { set_setting('escudo_base', json_encode($estranhos)); if ($estranhos) $prob['base'] = 'Arquivos que não são do Studio Cover já estavam no site na 1ª checagem (não mexi): ' . implode(', ', array_slice($estranhos, 0, 8)); }
    else {
      foreach (array_diff($estranhos, $base) as $p) {
        $dq = ($data ?: "$home/studio-cover-dados") . '/quarentena'; @mkdir($dq, 0700, true);
        $dest = $dq . '/' . date('Ymd-His') . '-' . preg_replace('/[^A-Za-z0-9._-]/', '_', $p) . '.bloqueado';
        if (@rename("$W/$p", $dest)) { @chmod($dest, 0600); $quar[] = $p; } else $prob['quarentena'] = "Arquivo estranho no site e não consegui mover: $p";
      }
      $resto = array_intersect($base, $estranhos);
      if ($resto) $prob['base'] = 'Arquivos que não são do Studio Cover continuam no site (estavam lá antes do escudo): ' . implode(', ', array_slice($resto, 0, 8));
    }
  }
  // 3) permissões e lugar do banco
  $cf = "$W/api/config.php";
  if (is_file($cf) && (fileperms($cf) & 0077)) { @chmod($cf, 0600); if (fileperms($cf) & 0077) $prob['config'] = 'O arquivo de senhas do site (config.php) está com permissão aberta.'; }
  if ($data && str_starts_with(realpath($data) ?: $data, realpath($W) ?: $W)) $prob['banco'] = 'O banco de dados está dentro da pasta pública do site.';
  if (is_dir("$W/api/dados")) $prob['banco'] = 'O banco de dados está no plano B (dentro do site, bloqueado). O ideal é fora do httpdocs.';
  // 4) pela internet: segredos inacessíveis e cabeçalhos de segurança (1 vez por hora)
  $web = $antes['web'] ?? null;
  if ($forcar || !$web || strtotime($web['quando']) < time() - 3600) {
    $web = ['quando' => now(), 'expostos' => [], 'cabecalhos' => []];
    $u = site_url();
    if ($u && function_exists('curl_init')) {
      foreach (['/api/config.php', '/api/lib.php', '/api/escudo.php', '/.git/config', '/.env', '/api/dados/studio-cover.sqlite', '/app/js/app.js.map'] as $p) {
        $ch = curl_init($u . $p); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_FOLLOWLOCATION => false]);
        $body = (string)curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($code === 200 && strlen($body) > 0) $web['expostos'][] = $p;
      }
      $ch = curl_init($u . '/'); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_NOBODY => true, CURLOPT_TIMEOUT => 8]);
      $hd = strtolower((string)curl_exec($ch)); curl_close($ch);
      if ($hd !== '') foreach (['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'content-security-policy'] as $c) if (!str_contains($hd, $c . ':')) $web['cabecalhos'][] = $c;
    }
  }
  if ($web['expostos']) $prob['exposto'] = 'Arquivo secreto abrindo pela internet: ' . implode(', ', $web['expostos']);
  if ($web['cabecalhos']) $prob['cabecalhos'] = 'Faltam cabeçalhos de segurança: ' . implode(', ', $web['cabecalhos']);
  // 5) administradores: novo ou sumido
  $ads = db()->query('SELECT id, email, created_by FROM admins ORDER BY id')->fetchAll();
  $ids = array_map(fn($a) => (int)$a['id'], $ads); $ant = json_decode(setting('escudo_admins') ?: 'null', true);
  if (is_array($ant) && ($novos = array_diff($ids, $ant))) {
    $l = array_filter($ads, fn($a) => in_array((int)$a['id'], $novos, true));
    escudo_avisar('admin_novo', '🛡️ Studio Cover: novo administrador no painel', '<p>Foi criado acesso de administrador para: <b>' . h(implode(', ', array_column($l, 'email'))) . '</b>.</p><p>Se não foi você (ou o Reinaldo), troque a sua senha e apague esse acesso na aba Administradores.</p>', 'Novo administrador: ' . implode(', ', array_column($l, 'email')), 60);
  }
  set_setting('escudo_admins', json_encode($ids));
  // 6) o site consegue buscar a versão nova no GitHub?
  $pub = (string)@file_get_contents("$home/logs/sc-publicacoes-erro.log");
  if ($pub !== '' && filemtime("$home/logs/sc-publicacoes-erro.log") > time() - 1800) $prob['publicacao'] = 'O site não conseguiu buscar a versão nova no GitHub. Confira a chave do GitHub na aba Vistoria.';

  if ($rest) escudo_avisar('restaurado', '🛡️ Studio Cover: arquivo do site foi alterado e eu restaurei', '<p>Estes arquivos estavam diferentes da versão publicada e voltaram ao original:</p><ul><li>' . implode('</li><li>', array_map('h', array_slice($rest, 0, 20))) . '</li></ul><p>Se você não mexeu no servidor, alguém pode ter tentado alterar o site. Vale trocar a senha do Plesk.</p>', count($rest) . ' arquivo(s) alterado(s) e restaurado(s)', 600);
  if ($quar) escudo_avisar('quarentena', '🛡️ Studio Cover: arquivo estranho no site foi para a quarentena', '<p>Estes arquivos apareceram no site sem terem sido publicados por nós (pode ser porta dos fundos de invasor) e foram tirados do ar:</p><ul><li>' . implode('</li><li>', array_map('h', $quar)) . '</li></ul><p>Eles ficam guardados na pasta quarentena, fora do site. Troque a senha do Plesk e do FTP.</p>', count($quar) . ' arquivo(s) estranho(s) em quarentena', 600);
  $graves = array_diff_key($prob, ['cabecalhos' => 1, 'base' => 1, 'banco' => 1]);
  if ($graves) escudo_avisar('checagem', '🛡️ Studio Cover: a checagem de segurança achou problema', '<ul><li>' . implode('</li><li>', array_map('h', $graves)) . '</li></ul>', implode(' · ', $graves), 6 * 3600);
  try {
    $db = escudo_db();
    foreach ($rest as $p) $db->prepare('INSERT INTO seg_eventos (ip, tipo, detalhe, created_at) VALUES (?, ?, ?, ?)')->execute(['servidor', 'restaurado', $p, now()]);
    foreach ($quar as $p) $db->prepare('INSERT INTO seg_eventos (ip, tipo, detalhe, created_at) VALUES (?, ?, ?, ?)')->execute(['servidor', 'quarentena', $p, now()]);
    $db->prepare('DELETE FROM seg_eventos WHERE created_at < ?')->execute([date('Y-m-d H:i:s', time() - 90 * 86400)]);
    $db->prepare('DELETE FROM seg_bloqueios WHERE ate < ?')->execute([date('Y-m-d H:i:s', time() - 30 * 86400)]);
  } catch (Throwable $e) {}
  $r = ['quando' => now(), 'problemas' => $prob, 'restaurados' => $rest, 'quarentena' => $quar, 'web' => $web, 'referencia' => $ref ? basename($ref) : ''];
  set_setting('escudo', json_encode($r, JSON_UNESCAPED_UNICODE));
  return ['escudo' => $prob ? 'atencao' : 'ok', 'problemas' => array_keys($prob), 'restaurados' => count($rest), 'quarentena' => count($quar)];
}

// resumo para o painel
function escudo_resumo(): array {
  $db = escudo_db(); $h24 = date('Y-m-d H:i:s', time() - 86400);
  $q = $db->prepare("SELECT tipo, COUNT(*) n, COUNT(DISTINCT ip) ips FROM seg_eventos WHERE created_at >= ? GROUP BY tipo"); $q->execute([$h24]);
  $cont = []; foreach ($q as $r) $cont[$r['tipo']] = ['n' => (int)$r['n'], 'ips' => (int)$r['ips']];
  $q = $db->prepare('SELECT * FROM seg_bloqueios WHERE ate > ? ORDER BY created_at DESC LIMIT 100'); $q->execute([now()]);
  return ['ok' => true, 'checagem' => json_decode(setting('escudo') ?: 'null', true), 'contagem' => $cont,
    'bloqueados' => $q->fetchAll(), 'eventos' => $db->query('SELECT ip, tipo, detalhe, ua, created_at FROM seg_eventos ORDER BY id DESC LIMIT 60')->fetchAll(),
    'regras' => array_map(fn($r) => $r[3], ESCUDO_REGRAS), 'nomes' => ESCUDO_INFO + array_map(fn($r) => $r[3], ESCUDO_REGRAS),
    'github' => escudo_gh_status(), 'meu_ip' => escudo_ip()];
}
