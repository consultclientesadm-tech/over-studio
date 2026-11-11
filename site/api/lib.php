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
}

// ---------- configurações editáveis no painel ----------
const SETTINGS_DEFAULT = [
  'product_name' => 'Studio Cover',
  'checkout_url' => '',          // link do checkout da Eduzz; pode ter {email} e {nome}
  'price' => '297,00',                 // ex.: 97,00 (só para mostrar)
  'trial_enabled' => '1',        // teste grátis ligado
  'trial_videos' => '2',         // quantos vídeos no teste
  'access_days' => '365',        // dias de acesso depois de pagar (0 = vitalício)
  'eduzz_product' => '',         // código do produto na Eduzz (vazio = aceita qualquer um)
  'eduzz_secret' => '',          // segredo de assinatura do webhook (se a Eduzz mandar)
  'webhook_token' => '',         // gerado sozinho
  'funnel_enabled' => '1',
  'mail_from' => '',             // ex.: contato@studiocover.com.br
  'mail_name' => 'Studio Cover',
  'smtp_host' => '', 'smtp_port' => '587', 'smtp_user' => '', 'smtp_pass' => '', 'smtp_secure' => 'tls',
  'support_whatsapp' => '',
  'meta_pixel' => '1595086872316004', // Pixel da Meta na página de vendas (o mesmo do Viral Music Pro; vazio = sem pixel)
];
function setting(string $k): string {
  static $cache = null;
  if ($cache === null) { $cache = []; foreach (db()->query('SELECT k, v FROM settings') as $r) $cache[$r['k']] = $r['v']; }
  if ($k === 'webhook_token' && empty($cache[$k])) { $cache[$k] = bin2hex(random_bytes(16)); set_setting($k, $cache[$k]); }
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
  header('Cache-Control: no-store');
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
  if ((int)$q->fetchColumn() >= $max) fail('Muitas tentativas. Espere alguns minutos e tente de novo.', 429);
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
function login_user(array $u): void { session(); session_regenerate_id(true); $_SESSION['uid'] = (int)$u['id']; $_SESSION['uver'] = substr((string)$u['pass_hash'], -12); }

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
  $url = setting('checkout_url');
  if (!$url) return '';
  return strtr($url, ['{email}' => rawurlencode($u['email'] ?? ''), '{nome}' => rawurlencode($u['name'] ?? '')]);
}
function public_user(array $u): array {
  return ['id' => (int)$u['id'], 'email' => $u['email'], 'name' => $u['name'], 'status' => $u['status'], 'expires_at' => $u['expires_at'],
    'videos_used' => (int)$u['videos_used']] + access($u) + ['checkout_url' => checkout_url($u), 'price' => setting('price')];
}

function notify(int $uid, string $title, string $body, string $url = ''): void {
  db()->prepare('INSERT INTO notifications (user_id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?)')->execute([$uid, $title, $body, $url, now()]);
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

require_once __DIR__ . '/mail.php';
