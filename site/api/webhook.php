<?php
// Webhook da Eduzz. URL para colar na Eduzz: https://SEU-DOMINIO/api/webhook.php?token=TOKEN (o token aparece no painel).
// Aceita o webhook novo (JSON) e o postback antigo (formulário). Tudo que chega fica registrado no painel
// (Configurações → Webhooks) para conferir o formato no primeiro teste.
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';

$raw = file_get_contents('php://input') ?: '';
$data = json_decode($raw, true);
if (!is_array($data)) { parse_str($raw, $data); if (!$data) $data = $_POST; }
$log = function (string $result) use ($raw, $data) {
  db()->prepare('INSERT INTO webhooks (created_at, ip, body, result) VALUES (?, ?, ?, ?)')
    ->execute([now(), client_ip(), mb_substr($raw ?: json_encode($data, JSON_UNESCAPED_UNICODE), 0, 20000), $result]);
};

// segurança: token na URL, e a assinatura HMAC quando o segredo da Eduzz estiver configurado
if (!hash_equals(setting('webhook_token'), (string)($_GET['token'] ?? ''))) { $log('recusado: token errado'); fail('token inválido', 403); }
$secret = setting('eduzz_secret');
if ($secret !== '') {
  $sig = $_SERVER['HTTP_X_SIGNATURE'] ?? $_SERVER['HTTP_X_EDUZZ_SIGNATURE'] ?? '';
  $calc = hash_hmac('sha256', $raw, $secret);
  if ($sig === '' || !hash_equals($calc, strtolower(preg_replace('/^sha256=/', '', $sig)))) { $log('recusado: assinatura'); fail('assinatura inválida', 403); }
}

// procura um campo em qualquer nível do JSON
function pick(array $d, array $keys) {
  foreach ($keys as $k) if (isset($d[$k]) && !is_array($d[$k]) && $d[$k] !== '') return $d[$k];
  foreach ($d as $v) if (is_array($v) && ($r = pick($v, $keys)) !== null) return $r;
  return null;
}
$email = clean_email((string)pick($data, ['edz_cli_email', 'cus_email', 'email', 'buyer_email', 'client_email', 'customer_email']));
$name = trim((string)pick($data, ['edz_cli_rsocial', 'cus_name', 'name', 'buyer_name', 'client_name', 'customer_name']));
$phone = trim((string)pick($data, ['edz_cli_cel', 'cus_cel', 'cellphone', 'phone', 'cus_tel']));
$event = mb_strtolower((string)pick($data, ['event', 'event_name', 'type']));
$status = mb_strtolower((string)pick($data, ['edz_fat_status', 'trans_status', 'status', 'invoice_status', 'sale_status']));
$value = (float)str_replace(',', '.', (string)(pick($data, ['edz_valorpago', 'trans_paid', 'trans_value', 'paid_value', 'value', 'amount', 'price']) ?? 0));
if ($value > 10000) $value /= 100; // veio em centavos
$trans = (string)pick($data, ['edz_fat_cod', 'trans_cod', 'invoice_id', 'transaction_id', 'id']);
$product = (string)pick($data, ['edz_cnt_cod', 'product_cod', 'productId', 'product_id', 'content_id']);

$s = $event . ' ' . $status;
// entrega customizada da Eduzz: type = create (liberar) ou remove (tirar acesso: reembolso, atraso, cancelamento)
$tipo = mb_strtolower((string)($data['type'] ?? ''));
if ($tipo === 'create') $s = 'paid';
if ($tipo === 'remove') $s = 'cancel';
$paid = preg_match('/invoice_paid|paid|aprovad|pago|paga|approved|confirm|^\s*3$/', $s) || $status === '3';
$back = preg_match('/refund|reembols|chargeback|cancel|estorn|^\s*(4|6|7)$/', $s) || in_array($status, ['4', '6', '7'], true);

if (!valid_email($email)) { $log('ignorado: sem e-mail'); json_out(['ok' => true, 'ignorado' => 'sem e-mail']); }
$only = setting('eduzz_product');
if ($only !== '' && $product !== '' && $product !== $only) { $log("ignorado: produto $product"); json_out(['ok' => true, 'ignorado' => 'outro produto']); }

$db = db();
if ($back) {
  $q = $db->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]);
  if ($u = $q->fetch()) {
    $db->prepare("UPDATE users SET status = 'refunded' WHERE id = ?")->execute([$u['id']]);
    sales_fill_net(); $n = sale_net(-abs($value));
    $db->prepare('INSERT INTO sales (user_id, email, trans, product, value, status, created_at, bruto, taxa, liquido) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute([$u['id'], $email, $trans, $product, -abs($value), 'reembolso', now(), $n['bruto'], $n['taxa'], $n['liquido']]);
  }
  $log("reembolso/cancelamento: $email"); json_out(['ok' => true, 'acao' => 'bloqueado']);
}
if (!$paid) { $log("ignorado: status \"$s\""); json_out(['ok' => true, 'ignorado' => 'status']); }

// evita contar a mesma venda duas vezes (a Eduzz pode reenviar)
if ($trans !== '') { $q = $db->prepare("SELECT 1 FROM sales WHERE trans = ? AND status = 'pago'"); $q->execute([$trans]); if ($q->fetch()) { $log("repetido: $trans"); json_out(['ok' => true, 'repetido' => true]); } }

$q = $db->prepare('SELECT 1 FROM users WHERE email = ?'); $q->execute([$email]); $isNew = !$q->fetch();
$u = upsert_user($email, $name, ['status' => 'active', 'source' => 'eduzz']);
$days = (int)setting('access_days');
$exp = $days > 0 ? date('Y-m-d H:i:s', time() + $days * 86400) : null;
$db->prepare("UPDATE users SET status = 'active', source = CASE WHEN source = 'trial' AND ? = 0 THEN 'trial' ELSE source END, paid_value = paid_value + ?, paid_at = ?, expires_at = ?, phone = CASE WHEN phone = '' THEN ? ELSE phone END WHERE id = ?")
  ->execute([$isNew ? 1 : 0, $value, now(), $exp, $phone, $u['id']]);
sales_fill_net(); $n = sale_net($value);
$db->prepare('INSERT INTO sales (user_id, email, trans, product, value, status, created_at, bruto, taxa, liquido) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute([$u['id'], $email, $trans, $product, $value, 'pago', now(), $n['bruto'], $n['taxa'], $n['liquido']]);
$q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([$u['id']]); $u = $q->fetch();
funnel_paid($u, $isNew);
$log("pago: $email R$ $value");
json_out(['ok' => true, 'acao' => 'liberado']);
