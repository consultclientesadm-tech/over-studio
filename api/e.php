<?php
// Rastreio dos e-mails: ?o=TOKEN (abriu, devolve imagem 1x1) e ?c=TOKEN&u=...&s=... (clicou, volta para o link)
declare(strict_types=1);
require __DIR__ . '/lib.php';
$db = email_track_db(); $now = now();
$tok = preg_replace('/[^a-f0-9]/', '', (string)($_GET['o'] ?? $_GET['c'] ?? ''));
if (isset($_GET['o'])) {
  if ($tok !== '') $db->prepare('UPDATE emails SET opens = opens + 1, opened_at = COALESCE(opened_at, ?) WHERE tok = ?')->execute([$now, $tok]);
  header('Content-Type: image/gif'); header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0'); header('Pragma: no-cache');
  echo base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'); exit;
}
$b = strtr((string)($_GET['u'] ?? ''), '-_', '+/'); $url = (string)base64_decode($b . str_repeat('=', (4 - strlen($b) % 4) % 4), true);
$ok = $tok !== '' && preg_match('#^https?://#i', $url) && hash_equals(substr(hash_hmac('sha256', $tok . '|' . $url, email_secret()), 0, 16), (string)($_GET['s'] ?? ''));
if (!$ok) { header('Location: ' . site_url() . '/', true, 302); exit; }
$db->prepare('UPDATE emails SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, ?), opened_at = COALESCE(opened_at, ?), opens = MAX(opens, 1) WHERE tok = ?')->execute([$now, $now, $tok]);
header('Cache-Control: no-store'); header('Location: ' . $url, true, 302); exit;
