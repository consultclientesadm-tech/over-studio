<?php
// Webhook da Stripe (vendas em dólar e euro, 2026-11-14). URL para cadastrar na Stripe: https://studiocover.com.br/api/stripe.php
// Eventos: checkout.session.completed (compra), invoice.paid (renovação anual), charge.refunded e charge.dispute.created (estorno).
// A Stripe assina cada aviso; o segredo (whsec_...) fica no painel, Configurações. Sem segredo, nada é aceito.
declare(strict_types=1);
define('ESCUDO_LIVRE', true); // a Stripe nunca é barrada pelo bloqueio de IP (a assinatura protege)
require __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';

$raw = file_get_contents('php://input') ?: '';
$log = function (string $r) use ($raw) { db()->prepare('INSERT INTO webhooks (created_at, ip, body, result) VALUES (?, ?, ?, ?)')->execute([now(), client_ip(), mb_substr($raw, 0, 20000), 'stripe: ' . $r]); };

// assinatura: cabeçalho Stripe-Signature "t=...,v1=..." = HMAC-SHA256 de "t.corpo" com o segredo
$sec = setting('stripe_whsec');
$sig = (string)($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '');
$t = ''; $v1 = [];
foreach (explode(',', $sig) as $p) { [$k, $v] = array_pad(explode('=', trim($p), 2), 2, ''); if ($k === 't') $t = $v; if ($k === 'v1') $v1[] = $v; }
$calc = $sec !== '' && $t !== '' ? hash_hmac('sha256', $t . '.' . $raw, $sec) : '';
$ok = false; foreach ($v1 as $v) if ($calc !== '' && hash_equals($calc, $v)) $ok = true;
if (!$ok || abs(time() - (int)$t) > 600) { $log('recusado: assinatura'); escudo_evento('chave', 'stripe'); fail('assinatura inválida', 400); }

$ev = json_decode($raw, true); if (!is_array($ev)) fail('json', 400);
$type = (string)($ev['type'] ?? ''); $o = $ev['data']['object'] ?? [];
$db = db();

// quanto fica de taxa: a Stripe não manda a taxa no aviso; estimativa ajustável no painel (% do valor)
function stripe_venda(PDO $db, array $u, float $valor, string $moeda, string $trans, string $pais): int {
  $reg = $moeda === 'EUR' ? 'eu' : ($moeda === 'BRL' ? 'br' : 'us');
  $taxa = round($valor * (float)(setting('stripe_taxa_pct') ?: '6') / 100, 2);
  sales_fill_net();
  $db->prepare('INSERT INTO sales (user_id, email, trans, product, value, status, created_at, bruto, taxa, comissao, liquido, moeda, regiao, pais) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)')
    ->execute([$u['id'], $u['email'], $trans, 'stripe', $valor, 'pago', now(), $valor, $taxa, round($valor - $taxa, 2), $moeda, $reg, $pais]);
  return (int)$db->lastInsertId();
}

if ($type === 'checkout.session.completed' || $type === 'checkout.session.async_payment_succeeded') {
  if (($o['payment_status'] ?? '') !== 'paid' && ($o['payment_status'] ?? '') !== 'no_payment_required') { $log("esperando pagamento: " . ($o['id'] ?? '')); json_out(['ok' => true]); }
  $cd = $o['customer_details'] ?? [];
  $email = clean_email((string)($cd['email'] ?? $o['customer_email'] ?? ''));
  if (!valid_email($email)) { $log('ignorado: sem e-mail'); json_out(['ok' => true]); }
  $name = trim((string)($cd['name'] ?? ''));
  $pais = strtoupper((string)($cd['address']['country'] ?? ''));
  $ref = (string)($o['client_reference_id'] ?? ''); // sc_<id>_<lingua>
  $lang = ''; if (preg_match('/^sc_(\d+)_([a-z]+)$/', $ref, $m)) $lang = $m[2] === 'ptpt' ? 'pt-pt' : $m[2];
  $valor = round(((int)($o['amount_total'] ?? 0)) / 100, 2); $moeda = strtoupper((string)($o['currency'] ?? 'usd'));
  $trans = (string)($o['subscription'] ?? $o['id'] ?? '');
  $q = $db->prepare("SELECT 1 FROM sales WHERE trans = ? AND status = 'pago'"); $q->execute([$trans]); if ($trans !== '' && $q->fetch()) { $log("repetido: $trans"); json_out(['ok' => true]); }
  // a conta que fez o teste grátis (código no link) ou a do e-mail da compra
  $u = null;
  if (!empty($m[1])) { $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([(int)$m[1]]); $u = $q->fetch() ?: null; }
  if (!$u) $u = null;
  $q = $db->prepare('SELECT 1 FROM users WHERE email = ?'); $q->execute([$u['email'] ?? $email]); $isNew = !$q->fetch();
  if (!$u) $u = upsert_user($email, $name, ['status' => 'active', 'source' => 'stripe']);
  $days = (int)setting('access_days'); $exp = $days > 0 ? date('Y-m-d H:i:s', time() + $days * 86400) : null;
  $db->prepare("UPDATE users SET status = 'active', source = CASE WHEN source = 'trial' THEN 'trial' ELSE 'stripe' END, paid_value = paid_value + ?, paid_at = ?, expires_at = ? WHERE id = ?")->execute([$valor, now(), $exp, $u['id']]);
  marca_regiao((int)$u['id'], $lang ?: ($moeda === 'EUR' ? 'en' : 'en'), $pais, ($u['lang'] ?? '') === '' || ($u['lang'] ?? '') === 'pt');
  $db->prepare("UPDATE users SET regiao = ? WHERE id = ?")->execute([$moeda === 'EUR' ? 'eu' : 'us', $u['id']]); // a moeda paga manda na região
  $sid = stripe_venda($db, $u, $valor, $moeda, $trans, $pais);
  if (!empty($o['customer'])) set_setting('stripe_cus_' . $u['id'], (string)$o['customer']);
  $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([$u['id']]); $u = $q->fetch();
  funnel_paid($u, $isNew);
  try { $sym = $moeda === 'EUR' ? '€' : 'US$';
    foreach ($db->query('SELECT id, name FROM admins')->fetchAll() as $ad) { $nm = trim(explode(' ', trim((string)$ad['name']))[0] ?? '');
      push_user(-(int)$ad['id'], '💰 Parabéns' . ($nm !== '' ? " $nm" : '') . ', venda internacional do Studio Cover!', "Venda de $sym " . number_format($valor, 2, ',', '.') . ' · ' . ($pais ?: '?') . "\n" . ($name ?: $email), '/admin/'); }
  } catch (Throwable $e) {}
  $log("pago: $email $moeda $valor ($pais)"); json_out(['ok' => true, 'acao' => 'liberado', 'venda' => $sid]);
}

if ($type === 'invoice.paid' && ($o['billing_reason'] ?? '') === 'subscription_cycle') { // renovação do ano seguinte
  $email = clean_email((string)($o['customer_email'] ?? ''));
  $q = $db->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]); $u = $q->fetch();
  if (!$u) { $log("renovação sem conta: $email"); json_out(['ok' => true]); }
  $valor = round(((int)($o['amount_paid'] ?? 0)) / 100, 2); $moeda = strtoupper((string)($o['currency'] ?? 'usd'));
  $trans = (string)($o['id'] ?? '');
  $q = $db->prepare("SELECT 1 FROM sales WHERE trans = ? AND status = 'pago'"); $q->execute([$trans]); if ($q->fetch()) json_out(['ok' => true]);
  $days = (int)setting('access_days'); $base = max(time(), strtotime((string)($u['expires_at'] ?? '')) ?: 0);
  $db->prepare("UPDATE users SET status = 'active', paid_value = paid_value + ?, paid_at = ?, expires_at = ? WHERE id = ?")->execute([$valor, now(), $days > 0 ? date('Y-m-d H:i:s', $base + $days * 86400) : null, $u['id']]);
  stripe_venda($db, $u, $valor, $moeda, $trans, (string)$u['pais']);
  $log("renovou: $email $moeda $valor"); json_out(['ok' => true]);
}

if ($type === 'charge.refunded' || $type === 'charge.dispute.created') {
  $email = clean_email((string)($o['billing_details']['email'] ?? $o['receipt_email'] ?? ''));
  $q = $db->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]); $u = $q->fetch();
  if ($u) {
    $valor = round(((int)($o['amount_refunded'] ?? $o['amount'] ?? 0)) / 100, 2); $moeda = strtoupper((string)($o['currency'] ?? 'usd'));
    $db->prepare("UPDATE users SET status = 'refunded' WHERE id = ?")->execute([$u['id']]);
    $db->prepare('INSERT INTO sales (user_id, email, trans, product, value, status, created_at, bruto, taxa, comissao, liquido, moeda, regiao, pais) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)')
      ->execute([$u['id'], $email, (string)($o['id'] ?? ''), 'stripe', -$valor, 'reembolso', now(), -$valor, -$valor, $moeda, $moeda === 'EUR' ? 'eu' : 'us', (string)$u['pais']]);
  }
  $log("estorno: $email"); json_out(['ok' => true]);
}

$log("ignorado: $type"); json_out(['ok' => true, 'ignorado' => $type]);
