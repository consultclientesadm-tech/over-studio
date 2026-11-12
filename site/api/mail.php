<?php
// E-mail: SMTP (configurado no painel) ou o mail() do servidor. Modelo de e-mail com a cara do Studio Cover.
declare(strict_types=1);

function smtp_send(string $to, string $subject, string $html, string $text, array $o = []): ?string {
  $host = $o['host'] ?? setting('smtp_host'); $port = (int)($o['port'] ?? setting('smtp_port')); $sec = $o['secure'] ?? setting('smtp_secure');
  $user = $o['user'] ?? setting('smtp_user');
  $from = $o['from'] ?? setting('mail_from'); $fromName = setting('mail_name');
  $remote = ($sec === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
  $s = @stream_socket_client($remote, $errno, $err, 15);
  if (!$s) return "Não conectou no SMTP: $err";
  stream_set_timeout($s, 20);
  $read = function () use ($s) { $r = ''; while (($l = fgets($s, 1024)) !== false) { $r .= $l; if (isset($l[3]) && $l[3] === ' ') break; } return $r; };
  $cmd = function (string $c, array $ok) use ($s, $read) { if ($c !== '') fwrite($s, $c . "\r\n"); $r = $read(); if (!in_array((int)substr($r, 0, 3), $ok, true)) throw new RuntimeException(trim($c ? explode(' ', $c)[0] . ': ' . $r : $r)); return $r; };
  try {
    $cmd('', [220]);
    $me = parse_url(site_url(), PHP_URL_HOST) ?: 'localhost';
    $cmd("EHLO $me", [250]);
    if ($sec === 'tls') { $cmd('STARTTLS', [220]); if (!stream_socket_enable_crypto($s, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('TLS falhou'); $cmd("EHLO $me", [250]); }
    if ($user !== '') { $cmd('AUTH LOGIN', [334]); $cmd(base64_encode($user), [334]); $cmd(base64_encode(setting('smtp_pass')), [235]); }
    $cmd("MAIL FROM:<$from>", [250]);
    $cmd("RCPT TO:<$to>", [250, 251]);
    $cmd('DATA', [354]);
    $msg = build_mime($to, $subject, $html, $text, $from, $fromName);
    $msg = preg_replace('/^\./m', '..', $msg);
    $cmd($msg . "\r\n.", [250]);
    $cmd('QUIT', [221]);
  } catch (Throwable $e) { fclose($s); return $e->getMessage(); }
  fclose($s);
  return null;
}

function build_mime(string $to, string $subject, string $html, string $text, string $from, string $fromName, bool $headersOnly = false): string {
  $b = 'sc' . bin2hex(random_bytes(8));
  $enc = fn($s) => '=?UTF-8?B?' . base64_encode($s) . '?=';
  $h = ['Date: ' . date('r'), 'From: ' . $enc($fromName) . " <$from>", "To: <$to>", 'Subject: ' . $enc($subject), 'MIME-Version: 1.0',
    'Message-ID: <' . bin2hex(random_bytes(10)) . '@' . (explode('@', $from)[1] ?? 'localhost') . '>',
    "Content-Type: multipart/alternative; boundary=\"$b\""];
  $body = "--$b\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text)) .
    "--$b\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$b--";
  return implode("\r\n", $h) . "\r\n\r\n" . $body;
}

// Manda e registra. $kind: senha | esqueci | funil-N | teste-acabou | boas-vindas | teste
function send_mail(?array $u, string $to, string $kind, string $subject, string $title, string $bodyHtml, string $btnText = '', string $btnUrl = ''): bool {
  $from = setting('mail_from');
  if (!$from) { $host = preg_replace('/^www\./', '', (string)parse_url(site_url(), PHP_URL_HOST)); if ($host && str_contains($host, '.') && !preg_match('/^[\d.]+$/', $host)) $from = 'contato@' . $host; }
  $unsub = $u && !empty($u['unsub_token']) ? site_url() . '/api/conta.php?a=sair-lista&t=' . $u['unsub_token'] : '';
  $html = mail_template($title, $bodyHtml, $btnText, $btnUrl, $unsub);
  $text = trim(html_entity_decode(strip_tags(str_replace(['<br>', '</p>'], ["\n", "\n\n"], $bodyHtml)))) . ($btnUrl ? "\n\n$btnText: $btnUrl" : '') . ($unsub ? "\n\nNão quer mais receber? $unsub" : '');
  $err = null;
  if (!$from) $err = 'Configure o e-mail de envio no painel (Configurações).';
  elseif (setting('smtp_host') !== '') $err = smtp_send($to, $subject, $html, $text, ['from' => $from]);
  else {
    $mime = build_mime($to, $subject, $html, $text, $from, setting('mail_name'));
    [$head, $body] = explode("\r\n\r\n", $mime, 2);
    $head = implode("\r\n", array_filter(explode("\r\n", $head), fn($l) => !preg_match('/^(To|Subject):/', $l)));
    $ok = @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $head, '-f' . $from);
    // mail() do Plesk às vezes recusa: tenta o servidor de e-mail local (porta 25, sem senha)
    if (!$ok) { $e0 = error_get_last()['message'] ?? ''; $ok = @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $head); } // sem -f
    if (!$ok) { $e2 = smtp_send($to, $subject, $html, $text, ['host' => '127.0.0.1', 'port' => 25, 'secure' => '', 'user' => '', 'from' => $from]); if ($e2) $err = 'O servidor recusou o envio' . ($e0 ? " ($e0)" : '') . ': ' . $e2; }
  }
  db()->prepare('INSERT INTO emails (user_id, email, kind, subject, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    ->execute([$u['id'] ?? null, $to, $kind, $subject, $err ? 0 : 1, $err, now()]);
  return $err === null;
}

function mail_template(string $title, string $body, string $btnText, string $btnUrl, string $unsub): string {
  $site = h(site_url()); $name = h(setting('product_name'));
  $btn = $btnUrl ? '<p style="margin:28px 0 8px"><a href="' . h($btnUrl) . '" style="display:inline-block;background:#ffd400;color:#000;font-weight:800;text-decoration:none;padding:16px 28px;border-radius:40px;font-size:16px">' . h($btnText) . '</a></p>' : '';
  $u = $unsub ? '<p style="margin:24px 0 0;font-size:11px;color:#777">Não quer mais receber estes e-mails? <a href="' . h($unsub) . '" style="color:#999">Sair da lista</a></p>' : '';
  return <<<HTML
<!doctype html><html lang="pt-BR"><body style="margin:0;background:#050506;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#0e0e12;border:1px solid #2a2a30;border-radius:20px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 0"><div style="font-weight:900;letter-spacing:3px;color:#fff;font-size:15px"><span style="display:inline-block;width:14px;height:14px;border:3px solid #ffd400;transform:rotate(45deg);margin-right:10px;vertical-align:-2px"></span>STUDIO <span style="color:#ffd400">COVER</span></div></td></tr>
<tr><td style="padding:22px 28px 30px;color:#d8d8de;font-size:15px;line-height:1.6">
<h1 style="color:#fff;font-size:22px;line-height:1.3;margin:0 0 14px">$title</h1>
$body
$btn
$u
</td></tr></table>
<p style="color:#555;font-size:11px;margin:14px 0 0">$name · <a href="$site" style="color:#777">$site</a></p>
</td></tr></table></body></html>
HTML;
}
