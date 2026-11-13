<?php
// Depoimentos (prova social): quem comprou ou baixou o vídeo no teste manda o antes e depois + autorização de uso.
// Página pública: /depoimento/?t=TOKEN (link pessoal que vai no e-mail e no WhatsApp).
declare(strict_types=1);

const DEPO_TIPOS = ['depois' => 'Depois (vídeo que o app entregou)', 'antes' => 'Antes (vídeo original)', 'falando' => 'Você falando do resultado'];
const DEPO_MAX_ARQ = 450 * 1024 * 1024; // por arquivo
const DEPO_EXT = ['mp4', 'mov', 'm4v', 'webm', '3gp', 'hevc', 'jpg', 'jpeg', 'png', 'heic', 'm4a', 'mp3', 'wav', 'aac'];
const DEPO_ACEITE = 'Autorizo o Studio Cover a usar os vídeos que enviei, a minha voz, a minha imagem e este depoimento em posts, reels, stories e anúncios (Instagram, TikTok, Facebook, YouTube) e no site, sem pagamento e por tempo indeterminado. Posso pedir para retirar quando quiser pelo contato@studiocover.com.br.';

function depo_db(): PDO {
  static $ok = false; $db = db(); if ($ok) return $db;
  $db->exec("CREATE TABLE IF NOT EXISTS depoimentos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, email TEXT NOT NULL DEFAULT '',
    nome TEXT NOT NULL DEFAULT '', instagram TEXT NOT NULL DEFAULT '', cidade TEXT NOT NULL DEFAULT '', texto TEXT NOT NULL DEFAULT '', nota INTEGER NOT NULL DEFAULT 0,
    aut_imagem INTEGER NOT NULL DEFAULT 0, aut_nome INTEGER NOT NULL DEFAULT 0, aceite_txt TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
    arquivos TEXT NOT NULL DEFAULT '[]', chave TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'enviando', bonus INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, done_at TEXT);
    CREATE TABLE IF NOT EXISTS depo_pedidos (user_id INTEGER PRIMARY KEY, canal TEXT NOT NULL, created_at TEXT NOT NULL);");
  $ok = true; return $db;
}
function depo_dir(int $id = 0): string {
  $base = cfg('data_dir'); if (!is_dir($base) || !is_writable($base)) $base = __DIR__ . '/dados';
  $d = $base . '/depoimentos' . ($id ? '/' . $id : '');
  if (!is_dir($d)) @mkdir($d, 0700, true);
  return $d;
}
function depo_token(array $u): string { return $u['id'] . '.' . substr(hash_hmac('sha256', 'depo|' . $u['id'] . '|' . strtolower($u['email']), email_secret()), 0, 18); }
function depo_user_by_token(string $t): ?array {
  if (!preg_match('/^(\d+)\.([a-f0-9]{18})$/', $t, $m)) return null;
  $q = db()->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([(int)$m[1]]); $u = $q->fetch();
  return $u && hash_equals(depo_token($u), $t) ? $u : null;
}
function depo_link(array $u, string $canal): string {
  return site_url() . '/depoimento/?t=' . depo_token($u) . '&utm_source=' . $canal . '&utm_campaign=depoimento';
}
function depo_primeiro_nome(array $u): string { return trim(explode(' ', trim($u['name'] ?: ''))[0] ?? '') ?: 'artista'; }

// quem pode receber o pedido: comprou (pago) ou baixou o vídeo/áudio pronto no teste
function depo_pessoas(): array {
  $db = depo_db(); app_events_db();
  $rows = $db->query("SELECT u.id, u.name, u.email, u.phone, u.status, u.paid_value, u.unsub, u.created_at,
      (u.status = 'active' AND u.paid_value > 0) comprou,
      (SELECT MAX(e.created_at) FROM app_events e WHERE e.user_id = u.id AND e.kind = 'exportou') exportou_at,
      (SELECT p.created_at FROM depo_pedidos p WHERE p.user_id = u.id) pedido_at,
      (SELECT COUNT(*) FROM depoimentos d WHERE d.user_id = u.id AND d.status <> 'enviando') enviou
    FROM users u
    WHERE (u.status = 'active' AND u.paid_value > 0) OR EXISTS (SELECT 1 FROM app_events e WHERE e.user_id = u.id AND e.kind = 'exportou')
    ORDER BY comprou DESC, exportou_at DESC")->fetchAll();
  foreach ($rows as &$r) { $r['comprou'] = (int)$r['comprou']; $r['enviou'] = (int)$r['enviou']; $r['link'] = depo_link($r, 'whatsapp'); $r['whats'] = depo_whats($r); }
  return $rows;
}

// textos do pedido (Leonardo aprova antes do primeiro envio)
function depo_email(array $u): array {
  $nome = depo_primeiro_nome($u); $bonus = setting('depo_bonus') !== '0';
  if ((int)($u['comprou'] ?? 0) || ($u['status'] === 'active' && (float)$u['paid_value'] > 0)) return [
    'assunto' => "$nome, posso te pedir um favor?",
    'titulo' => 'O seu antes e depois pode inspirar outro cantor',
    'html' => '<p>Você foi uma das primeiras pessoas a assinar o Studio Cover, e isso significa muito para nós.</p>'
      . '<p>Tem muita gente achando que um app no celular não consegue deixar um cover com som de estúdio. Quem pode mostrar que consegue é você, com o seu próprio vídeo.</p>'
      . '<p>Leva 2 minutos: mande o vídeo que o app entregou, o original (se ainda estiver na galeria) e uma frase sincera sobre o que achou. Se você autorizar, ele vai para o <b>@studiocoveroficial</b> com você marcado, e mais gente conhece o seu trabalho.</p>',
    'botao' => 'Mandar meu antes e depois'];
  return [
    'assunto' => "$nome, o que você achou do seu cover?",
    'titulo' => 'Me conta como ficou o seu vídeo',
    'html' => '<p>Você testou o Studio Cover e baixou o seu vídeo pronto. Queria muito saber: o que achou do resultado?</p>'
      . '<p>Leva 2 minutos: mande o vídeo que o app entregou, o original (se ainda estiver na galeria) e uma frase sincera, gostando ou não.</p>'
      . ($bonus ? '<p>Como agradecimento, você ganha <b>mais 1 vídeo grátis, já liberado para baixar</b>, assim que enviar. ' : '<p>')
      . 'E, se você autorizar, o seu cover aparece no <b>@studiocoveroficial</b> com você marcado.</p>'
      . '<p>Alguma coisa não ficou boa? Responda este e-mail e me conte. É assim que a gente melhora.</p>',
    'botao' => 'Mandar meu antes e depois'];
}
function depo_whats(array $u): string {
  $nome = depo_primeiro_nome($u); $link = depo_link($u, 'whatsapp');
  if ((int)($u['comprou'] ?? 0)) return "Oi, $nome! Aqui é o Leonardo, do Studio Cover. Obrigado por confiar na gente logo no começo 🙏\n\nPosso te pedir um favor rápido? Manda pra gente o seu antes e depois (o vídeo original e o que o app entregou) e uma frase sincera do que achou. Se você autorizar, a gente posta no @studiocoveroficial com você marcado.\n\nÉ por aqui, leva 2 minutos: $link";
  return "Oi, $nome! Aqui é o Leonardo, do Studio Cover. Vi que você testou o app e baixou o seu cover. O que achou do resultado?\n\nSe puder, manda o seu antes e depois e uma frase sincera por este link (leva 2 minutos)" . (setting('depo_bonus') !== '0' ? ', e você ganha mais 1 vídeo grátis no app, liberado para baixar' : '') . ": $link";
}

function depo_pedir(array $ids = []): array {
  $db = depo_db(); $env = 0; $pul = 0;
  foreach (depo_pessoas() as $p) {
    if ($ids && !in_array((int)$p['id'], $ids, true)) continue;
    if ($p['pedido_at'] || $p['enviou'] || (int)$p['unsub']) { $pul++; continue; }
    $q = $db->prepare('SELECT * FROM users WHERE id = ?'); $q->execute([(int)$p['id']]); $u = $q->fetch(); if (!$u) continue;
    $u['comprou'] = $p['comprou'];
    $m = depo_email($u);
    $ok = send_mail($u, $u['email'], 'depoimento-pedido', $m['assunto'], h($m['titulo']), $m['html'], $m['botao'], depo_link($u, 'email'));
    if ($ok) { $db->prepare('INSERT OR REPLACE INTO depo_pedidos (user_id, canal, created_at) VALUES (?, ?, ?)')->execute([$u['id'], 'email', now()]); $env++; }
    else $pul++;
  }
  return ['enviados' => $env, 'pulados' => $pul];
}

function depo_publico(array $d): array {
  $d['arquivos'] = json_decode($d['arquivos'] ?: '[]', true) ?: [];
  unset($d['chave']);
  return $d;
}
