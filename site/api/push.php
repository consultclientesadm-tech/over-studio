<?php
// Notificação no celular (Web Push) para quem instalou o app e deixou avisar.
// Sem biblioteca: assinatura VAPID (ES256) e criptografia aes128gcm (RFC 8291) com o openssl do próprio PHP.
declare(strict_types=1);

function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

function push_db(): PDO {
  static $ok = false; $db = db();
  if (!$ok) { $db->exec('CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, created_at TEXT NOT NULL, last_ok TEXT, fails INTEGER NOT NULL DEFAULT 0)'); $ok = true; }
  return $db;
}

// chave do servidor: criada uma vez e guardada nas configurações (nunca aparece no painel)
function vapid_keys(): array {
  static $k = null; if ($k) return $k;
  $pem = setting('vapid_private');
  if ($pem === '') {
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    openssl_pkey_export($key, $pem); set_setting('vapid_private', $pem);
  }
  $priv = openssl_pkey_get_private($pem); $d = openssl_pkey_get_details($priv)['ec'];
  return $k = [$priv, "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT)];
}
function vapid_public(): string { return b64u(vapid_keys()[1]); }

function p256_pub_pem(string $raw): string {
  return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode(hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw), 64, "\n") . "-----END PUBLIC KEY-----\n";
}
function der_to_raw_sig(string $der): string {
  $o = 3; $rl = ord($der[$o]); $r = substr($der, $o + 1, $rl); $o += 1 + $rl + 1; $sl = ord($der[$o]); $s = substr($der, $o + 1, $sl);
  $f = fn($x) => str_pad(ltrim($x, "\0"), 32, "\0", STR_PAD_LEFT);
  return $f($r) . $f($s);
}
function vapid_header(string $endpoint): string {
  [$priv, $pub] = vapid_keys(); $p = parse_url($endpoint);
  $in = b64u('{"typ":"JWT","alg":"ES256"}') . '.' . b64u(json_encode(['aud' => $p['scheme'] . '://' . $p['host'], 'exp' => time() + 12 * 3600, 'sub' => 'mailto:contato@studiocover.com.br']));
  openssl_sign($in, $sig, $priv, OPENSSL_ALGO_SHA256);
  return 'vapid t=' . $in . '.' . b64u(der_to_raw_sig($sig)) . ', k=' . b64u($pub);
}

// criptografa a mensagem para um aparelho (RFC 8291)
function push_encrypt(string $payload, string $uaPub, string $auth): string {
  $eph = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
  $d = openssl_pkey_get_details($eph)['ec'];
  $asPub = "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
  $shared = openssl_pkey_derive(openssl_pkey_get_public(p256_pub_pem($uaPub)), $eph, 32);
  $salt = random_bytes(16);
  $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $uaPub . $asPub, $auth);
  $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
  $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
  $ct = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
  return $salt . pack('N', 4096) . chr(65) . $asPub . $ct . $tag;
}

function push_send_one(array $s, array $msg): int {
  $body = push_encrypt(json_encode($msg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), b64u_dec($s['p256dh']), b64u_dec($s['auth']));
  $ch = curl_init($s['endpoint']);
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 4,
    CURLOPT_HTTPHEADER => ['Authorization: ' . vapid_header($s['endpoint']), 'Content-Encoding: aes128gcm', 'Content-Type: application/octet-stream', 'TTL: 86400', 'Urgency: normal']]);
  curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
  return $code;
}

// manda para todos os aparelhos da pessoa; aparelho que saiu (404/410) é apagado
function push_user(int $uid, string $title, string $body, string $url = ''): int {
  if (!function_exists('curl_init') || !function_exists('openssl_pkey_derive')) return 0;
  $db = push_db(); $q = $db->prepare('SELECT * FROM push_subs WHERE user_id = ?'); $q->execute([$uid]); $n = 0;
  foreach ($q->fetchAll() as $s) {
    try { $code = push_send_one($s, ['title' => $title, 'body' => $body, 'url' => $url ?: '/app/']); } catch (Throwable $e) { $code = 0; }
    if ($code >= 200 && $code < 300) { $n++; $db->prepare('UPDATE push_subs SET last_ok = ?, fails = 0 WHERE id = ?')->execute([now(), $s['id']]); }
    elseif ($code === 404 || $code === 410 || $s['fails'] >= 5) $db->prepare('DELETE FROM push_subs WHERE id = ?')->execute([$s['id']]);
    else $db->prepare('UPDATE push_subs SET fails = fails + 1 WHERE id = ?')->execute([$s['id']]);
  }
  return $n;
}

function push_save(int $uid, array $sub, string $ua): void {
  $ep = (string)($sub['endpoint'] ?? ''); $k = $sub['keys'] ?? [];
  $host = (string)parse_url($ep, PHP_URL_HOST);
  if (!preg_match('/(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/', $host)) fail('Aparelho inválido.'); // só servidores de notificação conhecidos
  if (!preg_match('#^https://[^\s]+$#', $ep) || strlen($ep) > 1000 || strlen(b64u_dec((string)($k['p256dh'] ?? ''))) !== 65 || strlen(b64u_dec((string)($k['auth'] ?? ''))) !== 16) fail('Aparelho inválido.');
  push_db()->prepare('INSERT INTO push_subs (user_id, endpoint, p256dh, auth, ua, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, fails = 0')
    ->execute([$uid, $ep, $k['p256dh'], $k['auth'], mb_substr($ua, 0, 200), now()]);
}
