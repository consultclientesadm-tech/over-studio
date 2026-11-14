<?php
// Webhook da Stripe (vendas em dólar e euro, 2026-11-14). URL para cadastrar na Stripe: https://studiocover.com.br/api/stripe.php
// Eventos: checkout.session.completed (compra), invoice.paid (renovação anual), charge.succeeded (repasse do sócio), charge.refunded e charge.dispute.created (estorno).
// A Stripe assina cada aviso; o segredo (whsec_...) fica no painel, Configurações. Sem segredo, nada é aceito.
declare(strict_types=1);
define('ESCUDO_LIVRE', true); // a Stripe nunca é barrada pelo bloqueio de IP (a assinatura protege)
require __DIR__ . '/lib.php';
require __DIR__ . '/funil.php';
require_once __DIR__ . '/origem.php';

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

// Divisão com o sócio (2026-11-14): a cada cobrança paga, o sistema manda para a conta Stripe dele a parte combinada
// do que SOBRA depois da taxa da Stripe (líquido em reais). Ex.: sobrou R$ 97 -> R$ 48,50 para ele, R$ 48,50 fica.
// Precisa da chave restrita da Stripe (rk_live_...) no painel e da conta dele (acct_...). Sem elas, não faz nada.
function stripe_api(string $method, string $path, array $data = [], string $idem = ''): array {
  $key = setting('stripe_sk'); if ($key === '' || !function_exists('curl_init')) return ['error' => ['message' => 'sem chave']];
  $url = 'https://api.stripe.com/v1/' . $path; $body = http_build_query($data);
  if ($method === 'GET' && $body !== '') { $url .= '?' . $body; $body = ''; }
  $h = ['Authorization: Bearer ' . $key]; if ($idem !== '') $h[] = 'Idempotency-Key: ' . $idem;
  $ch = curl_init($url); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $h]);
  if ($method !== 'GET') curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
  $r = json_decode((string)curl_exec($ch), true); curl_close($ch);
  return is_array($r) ? $r : ['error' => ['message' => 'sem resposta']];
}
function stripe_repasse(string $chId): string {
  $acct = setting('stripe_socio_acct'); $pct = (float)(setting('stripe_socio_pct') ?: '0');
  if ($chId === '' || !preg_match('/^acct_\w+$/', $acct) || $pct <= 0 || setting('stripe_sk') === '') return 'sem divisão configurada';
  if (setting('stripe_tr_' . $chId) !== '') return 'já repassado';
  $c = stripe_api('GET', 'charges/' . $chId, ['expand' => ['balance_transaction']]);
  $bt = $c['balance_transaction'] ?? null;
  if (!is_array($bt) || !isset($bt['net'])) return 'ERRO: ' . ($c['error']['message'] ?? 'taxa ainda não calculada');
  $parte = (int)floor(((int)$bt['net']) * $pct / 100); // centavos, já sem a taxa da Stripe
  if ($parte <= 0) return 'nada a repassar';
  $t = stripe_api('POST', 'transfers', ['amount' => $parte, 'currency' => (string)$bt['currency'], 'destination' => $acct, 'source_transaction' => $chId,
    'description' => 'Studio Cover: parte do sócio (' . rtrim(rtrim(number_format($pct, 2, '.', ''), '0'), '.') . '% do líquido)'], 'repasse_' . $chId);
  if (empty($t['id'])) return 'ERRO: ' . ($t['error']['message'] ?? 'repasse recusado');
  set_setting('stripe_tr_' . $chId, $t['id'] . '|' . $parte);
  return 'repassado ' . strtoupper((string)$bt['currency']) . ' ' . number_format($parte / 100, 2, ',', '.') . ' de ' . number_format($bt['net'] / 100, 2, ',', '.') . " líquido ({$t['id']})";
}
// no estorno, a parte do sócio volta na mesma proporção do valor devolvido
function stripe_desfaz_repasse(array $ch): string {
  [$tr, $parte] = array_pad(explode('|', setting('stripe_tr_' . ($ch['id'] ?? ''))), 2, '');
  if ($tr === '') return '';
  $tot = max(1, (int)($ch['amount'] ?? 1)); $dev = min($tot, (int)($ch['amount_refunded'] ?? $tot));
  $volta = (int)floor((int)$parte * $dev / $tot);
  $ja = (int)setting('stripe_trv_' . $ch['id']); $volta -= $ja; if ($volta <= 0) return ' (parte do sócio já devolvida)';
  $r = stripe_api('POST', 'transfers/' . $tr . '/reversals', ['amount' => $volta], 'volta_' . $ch['id'] . '_' . $dev);
  if (empty($r['id'])) return ' (ERRO ao devolver parte do sócio: ' . ($r['error']['message'] ?? '?') . ')';
  set_setting('stripe_trv_' . $ch['id'], (string)($ja + $volta));
  return ' (parte do sócio devolvida: ' . number_format($volta / 100, 2, ',', '.') . ')';
}

if ($type === 'charge.succeeded') {
  $r = stripe_repasse((string)($o['id'] ?? ''));
  $log('repasse sócio: ' . $r);
  if (str_starts_with($r, 'ERRO')) fail($r, 500); // a Stripe tenta de novo sozinha
  json_out(['ok' => true, 'repasse' => $r]);
}

if ($type === 'checkout.session.completed' || $type === 'checkout.session.async_payment_succeeded') {
  if (($o['payment_status'] ?? '') !== 'paid' && ($o['payment_status'] ?? '') !== 'no_payment_required') { $log("esperando pagamento: " . ($o['id'] ?? '')); json_out(['ok' => true]); }
  $cd = $o['customer_details'] ?? [];
  $email = clean_email((string)($cd['email'] ?? $o['customer_email'] ?? ''));
  if (!valid_email($email)) { $log('ignorado: sem e-mail'); json_out(['ok' => true]); }
  $name = trim((string)($cd['name'] ?? ''));
  $pais = strtoupper((string)($cd['address']['country'] ?? ''));
  $ref = (string)($o['client_reference_id'] ?? ''); // sc_<id>_<lingua>
  // sc_<conta>_<lingua>[_o<origem em base64>]: a origem (pagina.fonte.campanha da UTM) volta aqui para o quadro Origens
  $lang = ''; $trk = ''; if (preg_match('/^sc_(\d+)_([a-z]+)(?:_o([A-Za-z0-9_-]+))?$/', $ref, $m)) { $lang = $m[2] === 'ptpt' ? 'pt-pt' : $m[2]; if (!empty($m[3])) $trk = (string)base64_decode(strtr($m[3], '-_', '+/')); }
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
  try { $o2 = or_da_venda(['trk' => $trk], $u, null); if ($o2[0] === 'sem-rastreio' || $o2[0] === '') $o2[0] = 'stripe-' . ($moeda === 'EUR' ? 'eu' : 'us'); or_marca_venda($sid, $o2); } catch (Throwable $e) {}
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
  $volta = $type === 'charge.refunded' ? stripe_desfaz_repasse($o) : '';
  $log("estorno: $email" . $volta); json_out(['ok' => true]);
}

$log("ignorado: $type"); json_out(['ok' => true, 'ignorado' => $type]);
