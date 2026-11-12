<?php
// API do painel do afiliado (studiocover.com.br/afiliado/): login próprio, separado do admin e dos alunos.
declare(strict_types=1);
require __DIR__ . '/lib.php';

$a = (string)($_GET['a'] ?? '');
function af_atual(): ?array {
  session(); if (empty($_SESSION['afid'])) return null;
  $af = af_by_id((int)$_SESSION['afid']);
  if (!$af || !$af['ativo'] || ($_SESSION['afver'] ?? '') !== substr((string)$af['pass_hash'], -12)) { unset($_SESSION['afid']); return null; }
  return $af;
}
function af_entra(array $af): void { session(); session_regenerate_id(true); $_SESSION['afid'] = (int)$af['id']; $_SESSION['afver'] = substr((string)$af['pass_hash'], -12); }
$mask = function (string $e): string { [$u, $d] = array_pad(explode('@', $e, 2), 2, ''); return mb_substr($u, 0, 2) . str_repeat('•', max(2, min(6, mb_strlen($u) - 2))) . '@' . $d; };

switch ($a) {
  case 'login': {
    require_post();
    $email = clean_email((string)arg('email')); throttle('aflog:' . client_ip(), 40, 900); throttle('aflog:' . $email, 8, 900);
    $q = af_db()->prepare('SELECT * FROM afiliados WHERE email = ? AND ativo = 1'); $q->execute([$email]); $af = $q->fetch();
    if (!$af || !$af['pass_hash'] || !password_verify((string)arg('senha'), $af['pass_hash'])) fail($af && !$af['pass_hash'] ? 'Crie a sua senha pelo link que chegou no seu e-mail (ou toque em "Esqueci a senha").' : 'E-mail ou senha não conferem.');
    af_db()->prepare('UPDATE afiliados SET last_login = ? WHERE id = ?')->execute([now(), $af['id']]);
    af_entra($af); json_out(['ok' => true]);
  }
  case 'cadastro': { // cadastro aberto: o Leo manda studiocover.com.br/afiliado/cadastro e a pessoa cria a conta sozinha
    require_post(); throttle('afcad:' . client_ip(), 10, 3600);
    if (trim((string)arg('site')) !== '') fail('Não deu certo. Tente de novo.'); // isca para robô
    $nome = trim(preg_replace('/\s+/', ' ', (string)arg('nome'))); if (mb_strlen($nome) < 3) fail('Digite o seu nome.');
    $whats = preg_replace('/\D/', '', (string)arg('whats')); if (strlen($whats) < 10 || strlen($whats) > 13) fail('Digite o seu WhatsApp com DDD.');
    if (!arg('aceito')) fail('Para criar a conta, aceite as regras de divulgação.');
    if ($e = strong_password((string)arg('senha'))) fail($e);
    $email = clean_email((string)arg('email')); if (!valid_email($email)) fail('Confira o seu e-mail.');
    $q = af_db()->prepare('SELECT 1 FROM afiliados WHERE email = ?'); $q->execute([$email]); if ($q->fetch()) fail('Este e-mail já tem conta de afiliado. Toque em "Já tenho conta" para entrar.');
    $base = af_codigo_limpo((string)arg('codigo')) ?: af_codigo_limpo(iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', explode(' ', $nome)[0]) ?: explode('@', $email)[0]);
    $base = substr($base, 0, 20); if (strlen($base) < 3) $base = 'parceiro';
    $codigo = $base; $chk = af_db()->prepare('SELECT 1 FROM afiliados WHERE codigo = ?');
    for ($i = 2; $chk->execute([$codigo]) && $chk->fetch(); $i++) { if (arg('codigo') && $i === 2) fail("O código \"$base\" já é de outro afiliado. Escolha outro."); $codigo = $base . $i; }
    $af = af_create($nome, $email, $codigo, '');
    $hash = password_hash((string)arg('senha'), PASSWORD_DEFAULT);
    af_db()->prepare("UPDATE afiliados SET pass_hash = ?, whats = ?, origem = 'cadastro', last_login = ? WHERE id = ?")->execute([$hash, $whats, now(), $af['id']]);
    $af = af_by_id((int)$af['id']); af_entra($af);
    send_mail(null, $af['email'], 'afiliado', 'Sua conta de afiliado do Studio Cover está pronta', 'Bem-vindo, parceiro! 🤝',
      '<p>Sua conta de afiliado está criada. No painel tem o passo a passo para começar: criar a conta na Eduzz, se afiliar ao Studio Cover, colar o seu link e pegar as suas páginas prontas. Tem também roteiros e ideias de conteúdo.</p><p>Seu código: <b>' . h($af['codigo']) . '</b></p>',
      'Abrir meu painel', site_url() . '/afiliado/');
    af_avisa_admins($af);
    json_out(['ok' => true]);
  }
  case 'sair': { require_post(); session(); unset($_SESSION['afid'], $_SESSION['afver']); json_out(['ok' => true]); }
  case 'token': { $af = af_by_token((string)arg('t')); json_out(['ok' => (bool)$af, 'email' => $af['email'] ?? '', 'nome' => $af['nome'] ?? '']); }
  case 'criar-senha': {
    require_post(); throttle('aftok:' . client_ip(), 20, 900);
    $af = af_by_token((string)arg('t')); if (!$af) fail('Este link venceu ou já foi usado. Peça um novo em "Esqueci a senha".');
    if ($e = strong_password((string)arg('senha'))) fail($e);
    $hash = password_hash((string)arg('senha'), PASSWORD_DEFAULT);
    af_db()->prepare('UPDATE afiliados SET pass_hash = ?, token = NULL, token_exp = NULL, last_login = ? WHERE id = ?')->execute([$hash, now(), $af['id']]);
    $af['pass_hash'] = $hash; af_entra($af); json_out(['ok' => true]);
  }
  case 'esqueci': {
    require_post(); $email = clean_email((string)arg('email'));
    throttle('afesq:' . client_ip(), 6, 3600); throttle('afesq:' . $email, 3, 3600);
    $q = af_db()->prepare('SELECT * FROM afiliados WHERE email = ? AND ativo = 1'); $q->execute([$email]);
    if ($af = $q->fetch()) send_mail(null, $af['email'], 'afiliado-senha', 'Crie uma nova senha do painel de afiliado', 'Nova senha', '<p>Toque no botão para criar a sua nova senha do painel de afiliado do Studio Cover. O link vale por 24 horas.</p>', 'Criar nova senha', af_senha_link($af, 1));
    json_out(['ok' => true]);
  }
  case 'painel': {
    $af = af_atual(); if (!$af) fail('Entre na sua conta de afiliado.', 401);
    $id = (int)$af['id']; sales_fill_net();
    $tot = af_numeros($id); $m30 = af_numeros($id, date('Y-m-d', time() - 29 * 86400)); $hoje = af_numeros($id, date('Y-m-d'));
    $pick = fn($n) => array_map(fn($v) => $v[$id] ?? 0, $n);
    $db = af_db();
    $q = $db->prepare("SELECT u.name, u.email, u.status, u.videos_used, u.created_at, (SELECT MAX(s.created_at) FROM sales s WHERE s.user_id = u.id AND s.status = 'pago') comprou FROM users u WHERE u.afiliado_id = ? ORDER BY u.id DESC LIMIT 100");
    $q->execute([$id]);
    $leads = array_map(fn($r) => ['nome' => explode(' ', trim((string)$r['name']))[0] ?: '—', 'email' => $mask((string)$r['email']), 'quando' => $r['created_at'],
      'etapa' => $r['comprou'] ? 'comprou' : ($r['status'] === 'refunded' ? 'reembolso' : ((int)$r['videos_used'] > 0 ? 'testou' : 'cadastrou'))], $q->fetchAll());
    // compras que vieram direto pelo link da Eduzz (sem passar pelo teste grátis)
    $q = $db->prepare("SELECT s.email, s.created_at FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.afiliado_id = ? AND s.status = 'pago' AND (u.afiliado_id IS NULL OR u.afiliado_id <> ?) ORDER BY s.id DESC LIMIT 50");
    $q->execute([$id, $id]);
    foreach ($q->fetchAll() as $r) $leads[] = ['nome' => '—', 'email' => $mask((string)$r['email']), 'quando' => $r['created_at'], 'etapa' => 'comprou'];
    $q = $db->prepare("SELECT substr(created_at, 1, 10) d, COUNT(*) n FROM af_cliques WHERE afiliado_id = ? AND created_at >= ? GROUP BY d"); $q->execute([$id, date('Y-m-d', time() - 29 * 86400)]);
    $cl = []; foreach ($q as $r) $cl[$r['d']] = (int)$r['n'];
    $q = $db->prepare("SELECT substr(created_at, 1, 10) d, COUNT(*) n FROM users WHERE afiliado_id = ? AND created_at >= ? GROUP BY d"); $q->execute([$id, date('Y-m-d', time() - 29 * 86400)]);
    $ca = []; foreach ($q as $r) $ca[$r['d']] = (int)$r['n'];
    $serie = []; for ($i = 29; $i >= 0; $i--) { $d = date('Y-m-d', time() - $i * 86400); $serie[] = ['d' => $d, 'cliques' => $cl[$d] ?? 0, 'cadastros' => $ca[$d] ?? 0]; }
    json_out(['ok' => true, 'afiliado' => ['nome' => $af['nome'], 'email' => $af['email'], 'codigo' => $af['codigo'], 'link_eduzz' => $af['link_eduzz'], 'desde' => $af['created_at']],
      'eduzz' => ['produto' => '3149410', 'vitrine' => 'https://my2.eduzz.com/showcase/product/details/3149410', 'comissao' => (string)setting('af_comissao_pct')], 'tutorial' => (string)setting('af_tutorial_url'),
      'links' => ['vendas' => site_url() . '/?af=' . $af['codigo'], 'teste' => site_url() . '/entrar/?teste&af=' . $af['codigo']],
      'total' => $pick($tot), 'mes' => $pick($m30), 'hoje' => $pick($hoje), 'leads' => $leads, 'serie' => $serie, 'preco' => setting('price')]);
  }
  case 'salvar-link': {
    require_post(); $af = af_atual(); if (!$af) fail('Entre na sua conta de afiliado.', 401);
    $link = trim((string)arg('link_eduzz'));
    if ($link !== '' && !preg_match('#^https://[a-z0-9.-]*eduzz\.com/#i', $link)) fail('Cole o seu link de afiliado da Eduzz (começa com https:// e tem eduzz.com).');
    af_db()->prepare('UPDATE afiliados SET link_eduzz = ? WHERE id = ?')->execute([$link, $af['id']]);
    json_out(['ok' => true]);
  }
}
fail('Ação desconhecida.', 404);
