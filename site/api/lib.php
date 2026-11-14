<?php
// Studio Cover — base do sistema: banco (SQLite), sessão, segurança, e-mail.
declare(strict_types=1);
mb_internal_encoding('UTF-8');
date_default_timezone_set('America/Sao_Paulo');

$CFG = is_file(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : [];
$CFG += [
  // pasta do banco: por padrão FORA da pasta pública do site (um nível acima do httpdocs)
  'data_dir' => dirname(__DIR__, 2) . '/studio-cover-dados',
  'site_url' => '',            // ex.: https://studiocover.com.br (vazio = descobre sozinho)
  'setup_key' => '',           // chave para criar o primeiro administrador
  'cron_key' => '',            // chave para rodar o funil por URL (se o Plesk não rodar PHP pela linha de comando)
];

function cfg(string $k) { global $CFG; return $CFG[$k] ?? null; }

function site_url(): string {
  $u = rtrim((string)cfg('site_url'), '/');
  if ($u) return $u;
  if (PHP_SAPI === 'cli') return '';
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
  return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

// ---------- banco ----------
function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $dir = cfg('data_dir');
  if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
    // sem permissão fora do site: usa api/dados (bloqueada pelo .htaccess)
    $dir = __DIR__ . '/dados';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
  }
  if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
  $pdo = new PDO('sqlite:' . $dir . '/studio-cover.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
  $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate($pdo);
  return $pdo;
}

function migrate(PDO $db): void {
  $db->exec(<<<SQL
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  pass_hash TEXT,
  status TEXT NOT NULL DEFAULT 'trial',          -- trial | active | blocked | refunded
  source TEXT NOT NULL DEFAULT 'trial',          -- trial | eduzz | admin
  trial_left INTEGER NOT NULL DEFAULT 0,
  videos_used INTEGER NOT NULL DEFAULT 0,
  paid_value REAL NOT NULL DEFAULT 0,
  paid_at TEXT, expires_at TEXT,
  token TEXT, token_exp TEXT,
  unsub_token TEXT, unsub INTEGER NOT NULL DEFAULT 0,
  funnel_step INTEGER NOT NULL DEFAULT 0, funnel_at TEXT,
  created_at TEXT NOT NULL, last_login TEXT, last_seen TEXT
);
CREATE INDEX IF NOT EXISTS users_status ON users(status);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, created_by INTEGER, last_login TEXT
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, email TEXT, trans TEXT, product TEXT,
  value REAL NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_day ON sales(created_at);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, kind TEXT NOT NULL, mb REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_day ON usage(created_at);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, read_at TEXT
);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, read_at);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, email TEXT, kind TEXT NOT NULL, subject TEXT NOT NULL, ok INTEGER NOT NULL, error TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL, ip TEXT, body TEXT, result TEXT
);
CREATE TABLE IF NOT EXISTS attempts (key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS attempts_key ON attempts(key, at);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
SQL);
  // LGPD: quando e em qual versão dos termos/política a pessoa deu o aceite
  $cols = array_column($db->query('PRAGMA table_info(users)')->fetchAll(), 'name');
  if (!in_array('aceite_at', $cols, true)) $db->exec('ALTER TABLE users ADD COLUMN aceite_at TEXT');
  if (!in_array('aceite_ver', $cols, true)) $db->exec("ALTER TABLE users ADD COLUMN aceite_ver TEXT NOT NULL DEFAULT ''");
  // teste grátis só é gasto quando o vídeo abre no estúdio (2026-11-13): marca o vídeo "em andamento" aqui
  // aparelho de cada aluno (2026-11-14, pedido do Leo): o primeiro (cadastro/compra) e o último que abriu o app
  if (!in_array('aparelho', $cols, true)) $db->exec("ALTER TABLE users ADD COLUMN aparelho TEXT NOT NULL DEFAULT ''");
  if (!in_array('aparelho_1', $cols, true)) $db->exec("ALTER TABLE users ADD COLUMN aparelho_1 TEXT NOT NULL DEFAULT ''");
  if (!in_array('trial_hold', $cols, true)) $db->exec('ALTER TABLE users ADD COLUMN trial_hold INTEGER NOT NULL DEFAULT 0');
  // no teste a pessoa vê e ouve o antes e depois, mas só baixa quem comprou (2026-11-13). Exceção: download liberado de presente (depoimento)
  if (!in_array('baixar_livre', $cols, true)) {
    $db->exec('ALTER TABLE users ADD COLUMN baixar_livre INTEGER NOT NULL DEFAULT 0');
    // quem já ganhou o vídeo de presente pelo depoimento (antes desta regra) também ganha o download liberado
    try { $db->exec("UPDATE users SET baixar_livre = 1 WHERE status = 'trial' AND id IN (SELECT user_id FROM depoimentos WHERE bonus = 1)"); } catch (Throwable $e) {}
  }  // clientes de fora do Brasil (2026-11-14): língua, país e região de cada pessoa e de cada venda
  try { i18n_migra($db); } catch (Throwable $e) {}
}

// ---------- configurações editáveis no painel ----------
const SETTINGS_DEFAULT = [
  'product_name' => 'Studio Cover',
  'checkout_url' => '',          // link do checkout da Eduzz; pode ter {email} e {nome}
  'price' => '297,00',                 // ex.: 97,00 (só para mostrar)
  'installments' => '10',              // parcelas mostradas na página (0 ou 1 = só o preço à vista)
  'installment_value' => '35,69',      // valor de cada parcela com os juros da Eduzz (copiar do checkout)
  'trial_enabled' => '1',        // teste grátis ligado
  'trial_videos' => '1',         // quantos vídeos no teste
  'access_days' => '365',        // dias de acesso depois de pagar (0 = vitalício)
  'eduzz_product' => '',         // código do produto na Eduzz (vazio = aceita qualquer um)
  'eduzz_secret' => '',          // segredo de assinatura do webhook (se a Eduzz mandar)
  'webhook_token' => '',         // gerado sozinho
  'funnel_enabled' => '1',
  'mail_from' => '',             // ex.: contato@studiocover.com.br
  'mail_name' => 'Studio Cover',
  'smtp_host' => '', 'smtp_port' => '587', 'smtp_user' => '', 'smtp_pass' => '', 'smtp_secure' => 'tls',
  'support_whatsapp' => '',
  'meta_pixel' => '1595086872316004,1631589557846072', // Pixels da Meta na página de vendas, separados por vírgula (vazio = sem pixel)
  'eduzz_pixel' => '1595086872316004', // pixel já cadastrado no checkout da Eduzz (a página de obrigado não repete a Compra dele)
  'eduzz_taxa' => '17,04',           // taxa que a Eduzz desconta de cada venda (R$). Os juros do parcelamento quem paga é o comprador
  'socio_pct' => '50',               // parte do sócio (Reinaldo) no líquido, em %
  'af_comissao_pct' => '50',         // comissão do afiliado na Eduzz (% do valor já sem a taxa)
  'meta_vendas_dia' => '3',         // meta de vendas por dia (para o medidor de saúde do painel)
  'af_tutorial_url' => '',           // vídeo do passo a passo no painel do afiliado (https)
  'empresa_nome' => '',              // LGPD: razão social ou nome de quem vende (aparece na Política de privacidade e nos Termos)
  'empresa_doc' => '',               // CNPJ ou CPF de quem vende
  'depo_bonus' => '1',               // quem está no teste ganha +1 vídeo ao mandar o antes e depois (1 vez)
  'dpo_email' => 'contato@studiocover.com.br', // e-mail do encarregado de dados (LGPD): pedidos de acesso, correção e exclusão
  // fora do Brasil (2026-11-14): preço e checkout da Stripe por região. Vazio = região sem venda ainda (cai no teste grátis)
  'price_us' => '97', 'price_eu' => '89',          // preço anual em dólar (EUA e Canadá) e em euro (Europa)
  'checkout_us' => 'https://buy.stripe.com/28EeVe3CZ8y24sGdjLafS00', 'checkout_eu' => 'https://buy.stripe.com/aFa3cw6Pb6pU7ES0wZafS01', // link de pagamento da Stripe de cada região (US$ 97 e 89 €)
  'stripe_whsec' => '',                             // segredo do webhook da Stripe (whsec_...)
  'stripe_sk' => '',                                // chave restrita da Stripe (rk_live_...), só para fazer o repasse do sócio
  'stripe_socio_acct' => '', 'stripe_socio_pct' => '50', // conta Stripe do sócio (acct_...) e a parte dele em cada venda
  'stripe_taxa_pct' => '6',                         // taxa estimada da Stripe em cada venda de fora (% do valor), para o líquido do painel
];
function setting(string $k): string {
  static $cache = null;
  if ($cache === null) { $cache = []; foreach (db()->query('SELECT k, v FROM settings') as $r) $cache[$r['k']] = $r['v']; }
  if ($k === 'webhook_token' && empty($cache[$k])) { $cache[$k] = bin2hex(random_bytes(16)); set_setting($k, $cache[$k]); }
  if (($k === 'checkout_us' || $k === 'checkout_eu') && ($cache[$k] ?? '') === '') return SETTINGS_DEFAULT[$k];
  return $cache[$k] ?? (SETTINGS_DEFAULT[$k] ?? '');
}
function set_setting(string $k, string $v): void {
  db()->prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')->execute([$k, $v]);
}

// ---------- utilidades ----------
function now(): string { return date('Y-m-d H:i:s'); }
function token(int $n = 24): string { return rtrim(strtr(base64_encode(random_bytes($n)), '+/', '-_'), '='); }
function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? 'cli'; }
function clean_email(string $e): string { return mb_strtolower(trim($e)); }
function valid_email(string $e): bool { return (bool)filter_var($e, FILTER_VALIDATE_EMAIL); }
function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

function json_out($data, int $code = 200): never {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  if (!preg_grep('/^Cache-Control:/i', headers_list())) header('Cache-Control: no-store'); // a oferta pública pode ficar em cache
  header('X-Content-Type-Options: nosniff');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function fail(string $msg, int $code = 400): never { json_out(['ok' => false, 'error' => $msg], $code); }

function input(): array {
  static $in = null;
  if ($in !== null) return $in;
  $raw = file_get_contents('php://input') ?: '';
  $in = json_decode($raw, true);
  if (!is_array($in)) $in = $_POST;
  return $in;
}
function arg(string $k, $def = '') { $in = input(); return $in[$k] ?? ($_GET[$k] ?? $def); }

// Chamadas que mudam algo só aceitam POST com o cabeçalho X-SC (um site de fora não consegue mandar
// esse cabeçalho sem permissão; isso barra ataques de outro site usando o login da pessoa).
function require_post(): void {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_SERVER['HTTP_X_SC'] ?? '') !== '1') fail('Requisição inválida.', 405);
}

// limite de tentativas (login, esqueci a senha, cadastro)
function throttle(string $key, int $max, int $seconds): void {
  $db = db(); $t = time();
  $db->prepare('DELETE FROM attempts WHERE at < ?')->execute([$t - 86400]);
  $q = $db->prepare('SELECT COUNT(*) FROM attempts WHERE key = ? AND at > ?'); $q->execute([$key, $t - $seconds]);
  if ((int)$q->fetchColumn() >= $max) { if (function_exists('escudo_evento')) escudo_evento('limite', strtok($key, ':')); fail('Muitas tentativas. Espere alguns minutos e tente de novo.', 429); }
  $db->prepare('INSERT INTO attempts (key, at) VALUES (?, ?)')->execute([$key, $t]);
}

// ---------- sessão ----------
function session(): void {
  if (session_status() === PHP_SESSION_ACTIVE) return;
  $https = str_starts_with(site_url(), 'https');
  session_name('sc_sess');
  session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 60, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
  ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 60));
  ini_set('session.use_strict_mode', '1');
  $dir = cfg('data_dir') . '/sessoes';
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  if (is_dir($dir) && is_writable($dir)) session_save_path($dir);
  session_start();
}

function current_user(): ?array {
  session();
  if (empty($_SESSION['uid'])) return null;
  $q = db()->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([$_SESSION['uid']]);
  $u = $q->fetch() ?: null;
  if (!$u || ($_SESSION['uver'] ?? '') !== substr((string)$u['pass_hash'], -12)) { unset($_SESSION['uid']); return null; } // trocou a senha: derruba sessões antigas
  return $u;
}
function login_user(array $u): void { session(); session_regenerate_id(true); $_SESSION['uid'] = (int)$u['id']; $_SESSION['uver'] = substr((string)$u['pass_hash'], -12); marca_aparelho($u); }

function current_admin(): ?array {
  session();
  if (empty($_SESSION['aid'])) return null;
  if (time() - ($_SESSION['aat'] ?? 0) > 60 * 60 * 12) { unset($_SESSION['aid']); return null; } // admin: 12 h
  $q = db()->prepare('SELECT id, email, name, created_at, last_login, pass_hash FROM admins WHERE id = ?'); $q->execute([$_SESSION['aid']]);
  $a = $q->fetch() ?: null;
  if (!$a || ($_SESSION['aver'] ?? '') !== substr($a['pass_hash'], -12)) { unset($_SESSION['aid']); return null; }
  unset($a['pass_hash']);
  return $a;
}
function require_admin(): array { $a = current_admin(); if (!$a) fail('Faça login de administrador.', 401); return $a; }

function strong_password(string $p): ?string {
  if (mb_strlen($p) < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!preg_match('/[A-Za-z]/', $p) || !preg_match('/\d/', $p)) return 'Use letras e números na senha.';
  return null;
}

// ---------- regras de acesso ----------
function access(array $u): array {
  $active = $u['status'] === 'active' && (!$u['expires_at'] || $u['expires_at'] > now());
  $trial = $u['status'] === 'trial' && setting('trial_enabled') === '1';
  return [
    'paid' => $active,
    'trial' => !$active && $u['status'] === 'trial',
    'trial_left' => $trial ? max(0, (int)$u['trial_left']) : 0,
    'can_use' => $active || ($trial && (int)$u['trial_left'] > 0),
    'expired' => $u['status'] === 'active' && !$active,
    'blocked' => in_array($u['status'], ['blocked', 'refunded'], true),
  ];
}
function checkout_url(?array $u = null): string {
  $reg = $u ? user_regiao($u) : req_regiao();
  if ($u && $reg === 'br' && ($u['regiao'] ?? '') === '' && req_regiao() !== 'br') $reg = req_regiao();
  $reg = reg_venda($reg);
  if ($reg !== 'br') { // Stripe (dólar ou euro): o link leva o e-mail e o código da pessoa para a compra cair na conta certa
    $url = setting('checkout_' . $reg); if ($url === '') return '';
    $lang = $u ? user_lang($u) : req_lang(); if ($lang === 'pt') $lang = 'en';
    $q = ['client_reference_id' => 'sc_' . ($u ? (int)$u['id'] : 0) . '_' . str_replace('-', '', $lang)];
    if ($u && !empty($u['email'])) $q['prefilled_email'] = $u['email'];
    return $url . (strpos($url, '?') === false ? '?' : '&') . http_build_query($q);
  }
  $url = setting('checkout_url');
  // lead de afiliado (ou visitante que veio pelo link dele): compra pelo link de afiliado da Eduzz
  $af = $u ? af_by_id(isset($u['afiliado_id']) ? (int)$u['afiliado_id'] : null) : af_visitante();
  if ($af && $af['ativo']) $url = af_checkout($af, $url);
  if (!$url) return '';
  $url = strtr($url, ['{email}' => rawurlencode($u['email'] ?? ''), '{nome}' => rawurlencode($u['name'] ?? '')]);
  // quem compra de dentro do app ou do funil (já fez o teste grátis): marca a origem "teste" na venda (edz_trk_1)
  if ($u && !preg_match('/[?&]trk=/', $url)) $url .= (strpos($url, '?') === false ? '?' : '&') . 'trk=teste';
  return $url;
}
// preço mostrado na página e no app: em reais com parcelas (Brasil) ou anual em dólar/euro (fora)
// região que vende em dólar/euro só depois que o link da Stripe dela estiver no painel; antes disso, todo mundo compra em reais
function reg_venda(string $reg): string { return ($reg === 'us' || $reg === 'eu') && setting('checkout_' . $reg) !== '' ? $reg : 'br'; }
function oferta_preco(string $reg): array {
  $reg = reg_venda($reg);
  if ($reg === 'us' || $reg === 'eu') { $p = setting('price_' . $reg); return ['price' => $p, 'installments' => 0, 'installment_value' => '', 'moeda' => $reg === 'us' ? 'USD' : 'EUR', 'preco_fmt' => ($reg === 'us' ? '$' : '€') . $p, 'regiao' => $reg]; }
  return ['price' => setting('price'), 'installments' => (int)setting('installments'), 'installment_value' => setting('installment_value'), 'moeda' => 'BRL', 'regiao' => 'br'];
}
function public_user(array $u): array {
  return ['id' => (int)$u['id'], 'email' => $u['email'], 'name' => $u['name'], 'status' => $u['status'], 'expires_at' => $u['expires_at'],
    'videos_used' => (int)$u['videos_used'], 'baixar_livre' => (int)($u['baixar_livre'] ?? 0), 'afiliado' => af_e_afiliado((string)$u['email'])] + access($u) + ['checkout_url' => checkout_url($u)] + oferta_preco(user_regiao($u) === 'br' && ($u['regiao'] ?? '') === '' ? req_regiao() : user_regiao($u));
}

function app_events_db(): PDO {
  static $ok = false; $db = db();
  if (!$ok) { $db->exec('CREATE TABLE IF NOT EXISTS app_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, kind TEXT NOT NULL, data TEXT, ua TEXT, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS app_events_day ON app_events(created_at)'); $ok = true; }
  return $db;
}
// Quem perdeu o vídeo do teste (até 2026-11-13 o teste era descontado antes de processar): está em teste,
// tentou usar (tem "inicio" ou "erro" no diário) e nunca baixou o vídeo/áudio pronto. Ainda não foi avisado.
function testes_perdidos(bool $devolver = false, bool $avisar = false): array {
  $db = db(); app_events_db();
  $cols = array_column($db->query('PRAGMA table_info(users)')->fetchAll(), 'name');
  if (!in_array('teste_avisado_at', $cols, true)) $db->exec('ALTER TABLE users ADD COLUMN teste_avisado_at TEXT');
  $rows = $db->query("SELECT u.* FROM users u WHERE u.status = 'trial' AND u.teste_avisado_at IS NULL AND u.created_at < '2026-11-13 02:00:00'
    AND EXISTS (SELECT 1 FROM app_events e WHERE e.user_id = u.id AND e.kind IN ('inicio', 'erro'))
    AND NOT EXISTS (SELECT 1 FROM app_events e WHERE e.user_id = u.id AND e.kind = 'exportou')")->fetchAll();
  if ($devolver) {
    $q = $db->prepare('UPDATE users SET trial_left = MAX(trial_left, 1), trial_hold = 0' . ($avisar ? ', teste_avisado_at = ?' : '') . ' WHERE id = ?');
    foreach ($rows as $u) {
      $q->execute($avisar ? [now(), $u['id']] : [$u['id']]);
      if ($avisar) try { funnel_send($u, 'teste-devolvido', ['assunto' => '{nome}, desculpa! Seu teste grátis voltou', 'titulo' => 'Desculpa pelo erro. Seu teste voltou!',
        'texto' => '<p>Quando você testou o Studio Cover, o app deu um erro e o seu vídeo grátis foi descontado sem você ver o resultado. Isso foi falha nossa, e a gente pede desculpas.</p><p>Já corrigimos e <b>devolvemos o seu vídeo grátis</b>. Agora ele só é descontado quando você baixar o vídeo pronto.</p><p>Dica: abra pelo <b>Safari</b> (iPhone) ou <b>Chrome</b> (Android), não pelo navegador do Instagram, e use um vídeo de até 3 minutos.</p>',
        'botao' => 'Testar de novo', 'link' => '{app}', 'aviso' => 'Desculpa pelo erro! Seu vídeo grátis voltou. Toque para testar de novo.']); } catch (Throwable $e) {}
    }
  }
  return $rows;
}
// aparelho legível a partir do user agent
function ua_short(string $ua): string {
  if (preg_match('/iPhone OS (\d+)_/', $ua, $m)) $d = 'iPhone · iOS ' . $m[1];
  elseif (preg_match('/iPad/', $ua)) $d = 'iPad';
  elseif (preg_match('/Android (\d+)[^;]*;\s*([^;)]+)/', $ua, $m)) $d = trim($m[2]) . ' · Android ' . $m[1];
  elseif (preg_match('/Windows/', $ua)) $d = 'Windows';
  elseif (preg_match('/Mac OS X/', $ua)) $d = 'Mac';
  else $d = 'Outro';
  $b = preg_match('/Instagram/', $ua) ? 'Instagram' : (preg_match('/FBAN|FBAV/', $ua) ? 'Facebook' : (preg_match('/CriOS|Chrome/', $ua) ? 'Chrome' : (preg_match('/Safari/', $ua) ? 'Safari' : '')));
  return $d . ($b ? " · $b" : '');
}

// sistema + navegador (para a CPI dos erros): "iPhone · Safari", "Android · Chrome", "Computador · Chrome"…
function ua_nav(string $ua): string {
  $so = preg_match('/iPhone|iPad/', $ua) ? 'iPhone' : (preg_match('/Android/', $ua) ? 'Android' : (preg_match('/Windows|Mac OS X|Linux|CrOS/', $ua) ? 'Computador' : 'Outro'));
  $b = preg_match('/Instagram/', $ua) ? 'Instagram' : (preg_match('/FBAN|FBAV|FB_IAB/', $ua) ? 'Facebook' : (preg_match('/SamsungBrowser/', $ua) ? 'Samsung Internet' : (preg_match('/EdgA?|Edg\//', $ua) ? 'Edge' : (preg_match('/Firefox|FxiOS/', $ua) ? 'Firefox' : (preg_match('/CriOS|Chrome/', $ua) ? 'Chrome' : (preg_match('/Safari/', $ua) ? 'Safari' : 'outro'))))));
  return "$so · $b";
}

// ---------- aparelho de cada aluno (aba Alunos do painel) ----------
// O user agent diz o sistema; a marca/modelo do Android vem do compat.js (cookie sc_ap ou campo "modelo" do diário do app),
// porque o Chrome esconde o modelo no user agent ("Android 10; K"). iPhone não revela o modelo: vai pelo tamanho da tela.
function aparelho_marca_modelo(string $m): string {
  $m = trim(preg_replace('/[^\w .+\-()\/]/u', '', $m) ?? ''); if ($m === '' || strtoupper($m) === 'K') return '';
  $m = mb_substr(preg_replace('/^SAMSUNG[ -](?=(SM|GT)-)/i', '', $m), 0, 40);
  if (preg_match('/^(SM|GT)-([A-Z])(\d+)/i', $m, $x)) { // SM-A546E → Galaxy A54
    $l = strtoupper($x[2]); $n = $x[3];
    $nome = in_array($l, ['A', 'M', 'F', 'E'], true) ? "Galaxy $l" . substr($n, 0, 2) : ($l === 'S' || $l === 'G' ? 'Galaxy S' : ($l === 'N' ? 'Galaxy Note' : ($l === 'X' || $l === 'T' || $l === 'P' ? 'Galaxy Tab' : 'Galaxy')));
    return "Samsung $nome ($m)";
  }
  $marcas = [
    'Xiaomi' => '/^(Redmi|POCO|Mi\b|Xiaomi|M\d{4}[A-Z]|2\d{3}[0-9A-Z]{4,}|\d{5}[A-Z0-9]{3,}[A-Z]{1,2}$)/i',
    'Motorola' => '/^(moto|motorola|XT\d{4})/i', 'LG' => '/^(LM-|LG)/i', 'Asus' => '/^(ASUS|ZenFone|ROG)/i',
    'Realme' => '/^(RMX|realme)/i', 'OnePlus' => '/^(OnePlus|KB2|LE2|NE2|IN20|HD19|GM19)/i', 'Oppo' => '/^(CPH|OPPO|PD\d)/i', 'Vivo' => '/^(V2\d{3}|vivo)/i',
    'Google' => '/^Pixel/i', 'Huawei' => '/^(HUAWEI|[A-Z]{3}-(L|LX|AL|TL)\d)/i', 'Nokia' => '/^Nokia/i', 'Infinix' => '/^Infinix/i', 'Tecno' => '/^TECNO/i', 'Positivo' => '/^Positivo/i', 'Multilaser' => '/^(Multilaser|ML-)/i',
  ];
  foreach ($marcas as $marca => $re) if (preg_match($re, $m)) return stripos($m, $marca) === 0 ? $m : "$marca $m";
  return $m;
}
function aparelho_iphone(string $tela): string { // "390x844" (tela em pontos) → família do iPhone
  $t = ['320x568' => 'iPhone SE 1ª/5s', '375x667' => 'iPhone 6/7/8/SE', '414x736' => 'iPhone 6/7/8 Plus', '375x812' => 'iPhone X/XS/11 Pro/12 mini/13 mini',
    '414x896' => 'iPhone XR/11/XS Max/11 Pro Max', '390x844' => 'iPhone 12/13/14', '428x926' => 'iPhone 12/13 Pro Max/14 Plus', '393x852' => 'iPhone 14 Pro/15/16',
    '430x932' => 'iPhone 14 Pro Max/15 Plus/15 Pro Max/16 Plus', '402x874' => 'iPhone 16 Pro', '440x956' => 'iPhone 16 Pro Max'];
  return $t[$tela] ?? '';
}
function aparelho_nome(string $ua, string $modelo = ''): string {
  $ua = (string)$ua; $modelo = trim($modelo);
  if (preg_match('/iPhone|iPod/', $ua)) {
    $v = preg_match('/OS (\d+)_/', $ua, $m) ? ' · iOS ' . $m[1] : '';
    $fam = str_starts_with($modelo, 'iph:') ? aparelho_iphone(substr($modelo, 4)) : '';
    return ($fam ?: 'iPhone') . $v;
  }
  if (preg_match('/iPad/', $ua) || ($modelo !== '' && str_starts_with($modelo, 'iph:') && preg_match('/Macintosh/', $ua))) return 'iPad';
  if (preg_match('/Android/i', $ua)) {
    $v = preg_match('/Android (\d+)/', $ua, $m) && !preg_match('/Android 10; K\)/', $ua) ? ' · Android ' . $m[1] : ''; // "Android 10; K" é falso (Chrome esconde)
    $mod = str_starts_with($modelo, 'iph:') ? '' : $modelo;
    if ($mod === '' && preg_match('/Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/', $ua, $x)) $mod = $x[1]; // UA antigo ainda traz o modelo
    $nome = aparelho_marca_modelo($mod);
    if ($nome === '' && preg_match('/SamsungBrowser/', $ua)) $nome = 'Samsung';
    return ($nome ?: 'Android') . ($v ?: ($nome ? '' : ' · modelo oculto'));
  }
  if (preg_match('/Windows/', $ua)) return 'Computador · Windows';
  if (preg_match('/Mac OS X/', $ua)) return 'Computador · Mac';
  if (preg_match('/CrOS/', $ua)) return 'Computador · Chromebook';
  if (preg_match('/Linux/', $ua)) return 'Computador · Linux';
  return '';
}
// guarda o aparelho da pessoa: aparelho_1 = o primeiro (cadastro do teste ou criar senha logo após a compra), aparelho = o último que usou
function marca_aparelho(array $u, string $modelo = ''): void {
  try {
    if (empty($u['id'])) return;
    $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? ''); if ($ua === '') return;
    if ($modelo === '') $modelo = (string)($_COOKIE['sc_ap'] ?? '');
    $nome = aparelho_nome($ua, mb_substr($modelo, 0, 40)); if ($nome === '') return;
    $atual = (string)($u['aparelho'] ?? '');
    // mesmo celular sem o modelo nesta visita (ex.: Android "Android · Android 14"): não troca o nome bom que já estava guardado
    if ($atual !== '' && $atual !== $nome && preg_match('/^(Android|iPhone) · /', $nome) && (str_ends_with($nome, 'modelo oculto') ? !str_starts_with($atual, 'iPhone') && !str_starts_with($atual, 'Computador') : str_ends_with($atual, strstr($nome, ' · ')))) return;
    if ($atual === $nome && ($u['aparelho_1'] ?? '') !== '') return;
    db()->prepare("UPDATE users SET aparelho = ?, aparelho_1 = CASE WHEN aparelho_1 = '' THEN ? ELSE aparelho_1 END WHERE id = ?")->execute([$nome, $nome, (int)$u['id']]);
  } catch (Throwable $e) {}
}

// ---------- valores de venda: bruto (preço), taxa da Eduzz e líquido que cai para os sócios ----------
function brnum(string $v): float { $v = preg_replace('/[^\d,.\-]/', '', $v); if (str_contains($v, ',')) $v = str_replace(['.', ','], ['', '.'], $v); return (float)$v; }
function sale_net(float $value, bool $afiliado = false): array {
  $price = brnum(setting('price')); $b = abs($value);
  // o aviso da Eduzz pode vir sem valor, com juros do parcelamento ou só com a parte de um sócio: aí vale o preço
  if ($price > 0 && ($b <= 0 || $b > $price || $b < $price * 0.6)) $b = $price;
  $taxa = min($b, brnum(setting('eduzz_taxa')));
  $sg = $value < 0 ? -1 : 1;
  $com = $afiliado ? round(($b - $taxa) * max(0, min(100, brnum(setting('af_comissao_pct')))) / 100, 2) : 0;
  // estorno: a Eduzz devolve o valor cheio ao comprador e NÃO devolve a taxa dela, então a venda estornada fica em −taxa (igual ao relatório da Eduzz)
  if ($sg < 0) return ['bruto' => -$b, 'taxa' => 0.0, 'comissao' => -$com, 'liquido' => -round($b - $com, 2)];
  return ['bruto' => $b, 'taxa' => $taxa, 'comissao' => $com, 'liquido' => round($b - $taxa - $com, 2)];
}
// colunas novas em vendas antigas + calcula o líquido das que ainda não têm
function sales_fill_net(): void {
  static $feito = false; if ($feito) return; $feito = true; // uma vez por pedido (o filtro de região do painel depende disso)
  $db = db(); $cols = array_column($db->query('PRAGMA table_info(sales)')->fetchAll(), 'name');
  foreach (['bruto', 'taxa', 'liquido', 'comissao'] as $c) if (!in_array($c, $cols, true)) $db->exec("ALTER TABLE sales ADD COLUMN $c REAL");
  af_db();
  $up = $db->prepare('UPDATE sales SET bruto = ?, taxa = ?, comissao = ?, liquido = ? WHERE id = ?');
  $db->exec('UPDATE sales SET taxa = 0, liquido = -ROUND(ABS(bruto) - ABS(COALESCE(comissao, 0)), 2) WHERE value < 0 AND bruto IS NOT NULL AND taxa <> 0'); // estornos antigos: taxa não volta
  foreach ($db->query('SELECT id, value, afiliado_id FROM sales WHERE liquido IS NULL OR (afiliado_id IS NOT NULL AND comissao IS NULL)')->fetchAll() as $r) { $n = sale_net((float)$r['value'], !empty($r['afiliado_id'])); $up->execute([$n['bruto'], $n['taxa'], $n['comissao'], $n['liquido'], $r['id']]); }
}

function notify(int $uid, string $title, string $body, string $url = ''): void {
  if ($uid > 0) { $q = db()->prepare('SELECT lang FROM users WHERE id = ?'); $q->execute([$uid]); $l = sc_lang_ok((string)$q->fetchColumn()); if ($l !== '' && $l !== 'pt') { $title = tr($title, $l); $body = tr($body, $l); } }
  db()->prepare('INSERT INTO notifications (user_id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?)')->execute([$uid, $title, $body, $url, now()]);
  try { push_user($uid, $title, $body, $url); } catch (Throwable $e) {} // celular de quem instalou e deixou avisar
}

// cria (ou acha) a pessoa e devolve o registro
function upsert_user(string $email, string $name, array $set = []): array {
  $db = db(); $email = clean_email($email);
  $q = $db->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]);
  $u = $q->fetch();
  if (!$u) {
    $db->prepare('INSERT INTO users (email, name, status, source, trial_left, unsub_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      ->execute([$email, $name, $set['status'] ?? 'trial', $set['source'] ?? 'trial', (int)($set['trial_left'] ?? 0), token(12), now()]);
    $q->execute([$email]); $u = $q->fetch();
  } elseif ($name && !$u['name']) { $db->prepare('UPDATE users SET name = ? WHERE id = ?')->execute([$name, $u['id']]); $u['name'] = $name; }
  return $u;
}

function set_password_link(array $u, int $days = 7): string {
  $t = token();
  db()->prepare('UPDATE users SET token = ?, token_exp = ? WHERE id = ?')->execute([hash('sha256', $t), date('Y-m-d H:i:s', time() + $days * 86400), $u['id']]);
  return site_url() . '/entrar/?criar=' . $t;
}

require_once __DIR__ . '/i18n_lib.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/push.php';
require_once __DIR__ . '/afiliados.php';
require_once __DIR__ . '/escudo.php';
if (PHP_SAPI !== 'cli') { header_remove('X-Powered-By'); escudo_portao(); } // escudo: IP bloqueado e tentativa de injeção param aqui

// ---------- LGPD ----------
const LGPD_VERSAO = '2026-11-12'; // mude quando os Termos ou a Política mudarem de verdade
function registra_aceite(int $uid): void {
  db()->prepare('UPDATE users SET aceite_at = ?, aceite_ver = ? WHERE id = ?')->execute([now(), LGPD_VERSAO, $uid]);
}
// cópia dos dados da pessoa (direito de acesso e portabilidade, art. 18 da LGPD)
function lgpd_exportar(array $u): array {
  $db = db(); $id = (int)$u['id'];
  $rows = function (string $sql) use ($db, $id) { try { $q = $db->prepare($sql); $q->execute([$id]); return $q->fetchAll(); } catch (Throwable $e) { return []; } };
  $conta = array_diff_key($u, array_flip(['pass_hash', 'token', 'token_exp', 'unsub_token']));
  return ['gerado_em' => now(), 'controlador' => setting('empresa_nome') ?: 'Studio Cover', 'contato' => setting('dpo_email'),
    'conta' => $conta,
    'compras' => $rows('SELECT trans, product, value, status, created_at FROM sales WHERE user_id = ? ORDER BY id'),
    'videos_processados' => $rows('SELECT kind, mb, created_at FROM usage WHERE user_id = ? ORDER BY id'),
    'diario_do_app' => $rows('SELECT kind, data, ua, created_at FROM app_events WHERE user_id = ? ORDER BY id'),
    'avisos' => $rows('SELECT title, body, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id'),
    'emails_enviados' => $rows('SELECT kind, subject, created_at FROM emails WHERE user_id = ? ORDER BY id'),
    'aparelhos_com_notificacao' => $rows('SELECT ua, created_at FROM push_subs WHERE user_id = ?'),
    'observacao' => 'Seus vídeos e áudios nunca foram enviados para nós: todo o processamento acontece no seu aparelho.'];
}
// apaga a conta: some com nome, e-mail, senha, avisos, diário e notificações. As vendas ficam guardadas
// (obrigação legal e fiscal, art. 16 da LGPD), presas a uma conta sem nome.
function lgpd_apagar(array $u): void {
  $db = db(); $id = (int)$u['id']; $email = (string)$u['email'];
  $db->beginTransaction();
  $db->prepare("UPDATE users SET email = ?, name = 'Conta apagada (LGPD)', phone = '', pass_hash = NULL, token = NULL, token_exp = NULL, unsub_token = NULL, unsub = 1, status = 'blocked', funnel_step = 999 WHERE id = ?")
    ->execute(["apagado-$id@apagado.invalid", $id]);
  foreach (['DELETE FROM notifications WHERE user_id = ?', 'UPDATE emails SET email = NULL WHERE user_id = ?'] as $sql) $db->prepare($sql)->execute([$id]);
  foreach (['DELETE FROM app_events WHERE user_id = ?', 'DELETE FROM push_subs WHERE user_id = ?'] as $sql) { try { $db->prepare($sql)->execute([$id]); } catch (Throwable $e) {} }
  $db->prepare('DELETE FROM attempts WHERE key LIKE ?')->execute(['%:' . $email]);
  $db->commit();
}

