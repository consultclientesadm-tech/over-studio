<?php
// Afiliados do Studio Cover: link próprio (?af=CODIGO), leads marcados, checkout com o link de afiliado da Eduzz
// (assim a comissão cai para ele na Eduzz) e o funil de e-mail/avisos levando sempre para o checkout dele.
declare(strict_types=1);

function af_db(): PDO {
  static $ok = false; $db = db();
  if ($ok) return $db;
  $db->exec('CREATE TABLE IF NOT EXISTS afiliados (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL DEFAULT \'\', email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    codigo TEXT NOT NULL UNIQUE COLLATE NOCASE, link_eduzz TEXT NOT NULL DEFAULT \'\', eduzz_id TEXT NOT NULL DEFAULT \'\', pass_hash TEXT, token TEXT, token_exp TEXT,
    ativo INTEGER NOT NULL DEFAULT 1, obs TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL, last_login TEXT);
    CREATE TABLE IF NOT EXISTS af_cliques (id INTEGER PRIMARY KEY AUTOINCREMENT, afiliado_id INTEGER NOT NULL, ip TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS af_cliques_af ON af_cliques(afiliado_id, created_at);');
  $cols = array_column($db->query('PRAGMA table_info(users)')->fetchAll(), 'name');
  if (!in_array('afiliado_id', $cols, true)) $db->exec('ALTER TABLE users ADD COLUMN afiliado_id INTEGER');
  $cols = array_column($db->query('PRAGMA table_info(afiliados)')->fetchAll(), 'name');
  if (!in_array('whats', $cols, true)) $db->exec("ALTER TABLE afiliados ADD COLUMN whats TEXT NOT NULL DEFAULT ''");
  if (!in_array('origem', $cols, true)) $db->exec("ALTER TABLE afiliados ADD COLUMN origem TEXT NOT NULL DEFAULT 'admin'");
  $cols = array_column($db->query('PRAGMA table_info(sales)')->fetchAll(), 'name');
  if (!in_array('afiliado_id', $cols, true)) $db->exec('ALTER TABLE sales ADD COLUMN afiliado_id INTEGER');
  // convites: quem a gente convida vira afiliado sem precisar assinar (o cadastro aberto é só para assinantes)
  $db->exec('CREATE TABLE IF NOT EXISTS af_convites (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, nome TEXT NOT NULL DEFAULT \'\',
    criado_por INTEGER, created_at TEXT NOT NULL, exp TEXT NOT NULL, usado_em TEXT, afiliado_id INTEGER)');
  $ok = true; return $db;
}
function af_convite_criar(string $nome, ?int $adminId, int $dias = 30): string {
  $t = token();
  af_db()->prepare('INSERT INTO af_convites (token, nome, criado_por, created_at, exp) VALUES (?, ?, ?, ?, ?)')
    ->execute([hash('sha256', $t), trim($nome), $adminId, now(), date('Y-m-d H:i:s', time() + $dias * 86400)]);
  return site_url() . '/afiliado/?convite=' . $t;
}
function af_convite_valido(string $t): ?array {
  if ($t === '') return null;
  $q = af_db()->prepare('SELECT * FROM af_convites WHERE token = ? AND usado_em IS NULL AND exp > ?'); $q->execute([hash('sha256', $t), now()]); return $q->fetch() ?: null;
}
function af_codigo_limpo(string $c): string { return mb_strtolower(preg_replace('/[^a-zA-Z0-9_-]/', '', $c)); }
function af_by_codigo(string $c): ?array {
  $c = af_codigo_limpo($c); if ($c === '') return null;
  $q = af_db()->prepare('SELECT * FROM afiliados WHERE codigo = ? AND ativo = 1'); $q->execute([$c]); return $q->fetch() ?: null;
}
function af_by_id(?int $id): ?array {
  if (!$id) return null; $q = af_db()->prepare('SELECT * FROM afiliados WHERE id = ?'); $q->execute([$id]); return $q->fetch() ?: null;
}
// afiliado de quem está navegando: o link (?af=) ou o cookie de 60 dias que o link deixou
function af_visitante(): ?array {
  $c = (string)($_GET['af'] ?? $_COOKIE['sc_af'] ?? '');
  return $c !== '' ? af_by_codigo($c) : null;
}
function af_marca_cookie(string $codigo): void {
  setcookie('sc_af', $codigo, ['expires' => time() + 60 * 86400, 'path' => '/', 'secure' => str_starts_with(site_url(), 'https'), 'httponly' => false, 'samesite' => 'Lax']);
}
// link de compra do afiliado: o link de afiliado da Eduzz dele + rastreio com o código (volta no aviso de venda)
function af_checkout(array $af, string $base): string {
  $url = $af['link_eduzz'] !== '' ? $af['link_eduzz'] : $base;
  if ($url === '') return '';
  return $url . (str_contains($url, '?') ? '&' : '?') . 'trk=af-' . rawurlencode($af['codigo']);
}
function af_create(string $nome, string $email, string $codigo, string $link, string $eduzzId = ''): array {
  $email = clean_email($email);
  if (!valid_email($email)) fail('Confira o e-mail do afiliado.');
  $codigo = af_codigo_limpo($codigo ?: explode('@', $email)[0]);
  if (strlen($codigo) < 3) fail('O código precisa ter pelo menos 3 letras ou números.');
  if ($link !== '' && !preg_match('#^https://[a-z0-9.-]*eduzz\.com/#i', $link)) fail('O link de afiliado precisa ser um link da Eduzz (https://...eduzz.com/...).');
  $db = af_db();
  $q = $db->prepare('SELECT 1 FROM afiliados WHERE codigo = ?'); $q->execute([$codigo]); if ($q->fetch()) fail("O código \"$codigo\" já é de outro afiliado.");
  $q = $db->prepare('SELECT 1 FROM afiliados WHERE email = ?'); $q->execute([$email]); if ($q->fetch()) fail('Este e-mail já é afiliado.');
  $db->prepare('INSERT INTO afiliados (nome, email, codigo, link_eduzz, eduzz_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')->execute([trim($nome), $email, $codigo, $link, $eduzzId, now()]);
  return af_by_id((int)$db->lastInsertId());
}
function af_senha_link(array $af, int $days = 7): string {
  $t = token();
  af_db()->prepare('UPDATE afiliados SET token = ?, token_exp = ? WHERE id = ?')->execute([hash('sha256', $t), date('Y-m-d H:i:s', time() + $days * 86400), $af['id']]);
  return site_url() . '/afiliado/?criar=' . $t;
}
function af_by_token(string $t): ?array {
  if ($t === '') return null;
  $q = af_db()->prepare('SELECT * FROM afiliados WHERE token = ? AND token_exp > ?'); $q->execute([hash('sha256', $t), now()]); return $q->fetch() ?: null;
}
function af_boas_vindas(array $af): bool {
  $link = af_senha_link($af);
  return send_mail(null, $af['email'], 'afiliado', 'Seu painel de afiliado do Studio Cover', 'Bem-vindo, parceiro! 🤝',
    '<p>Sua conta de afiliado do Studio Cover está pronta. No painel você pega o seu link, acompanha quantas pessoas entraram, fizeram o teste grátis e compraram.</p><p>Todo mundo que entrar pelo seu link recebe o nosso funil de e-mails e avisos, e a compra vai pelo seu link de afiliado da Eduzz.</p>',
    'Criar minha senha', $link);
}
// avisa os administradores que um afiliado novo se cadastrou sozinho
function af_avisa_admins(array $af): void {
  $html = '<p><b>' . h($af['nome']) . '</b> (' . h($af['email']) . (!empty($af['whats']) ? ' · WhatsApp ' . h($af['whats']) : '') . ') acabou de criar a conta de afiliado pelo link de cadastro.</p><p>Código: <b>' . h($af['codigo']) . '</b> · link de divulgação: ' . h(site_url() . '/?af=' . $af['codigo']) . '</p><p>Ele já está vendo o passo a passo no painel. Você pode desativar a conta na aba Afiliados se precisar.</p>';
  foreach (db()->query('SELECT email FROM admins')->fetchAll(PDO::FETCH_COLUMN) as $to)
    send_mail(null, $to, 'alerta', '🤝 Novo afiliado no Studio Cover: ' . $af['nome'], 'Novo afiliado cadastrado', $html, 'Ver afiliados', site_url() . '/admin/#afiliados');
}
// números de um afiliado (ou de todos, agrupados)
function af_numeros(?int $id = null, ?string $since = null): array {
  $db = af_db(); $w = $id ? ' AND afiliado_id = ' . (int)$id : ''; $s = $since ? " AND created_at >= '" . preg_replace('/[^\d :-]/', '', $since) . "'" : '';
  $g = fn($sql) => (function () use ($db, $sql) { $o = []; foreach ($db->query($sql) as $r) $o[(int)$r['a']] = (float)$r['n']; return $o; })();
  return [
    'cliques' => $g("SELECT afiliado_id a, COUNT(*) n FROM af_cliques WHERE 1 $w $s GROUP BY a"),
    'cadastros' => $g("SELECT afiliado_id a, COUNT(*) n FROM users WHERE afiliado_id IS NOT NULL $w $s GROUP BY a"),
    'testaram' => $g("SELECT afiliado_id a, COUNT(*) n FROM users WHERE afiliado_id IS NOT NULL AND videos_used > 0 $w $s GROUP BY a"),
    'compraram' => $g("SELECT afiliado_id a, COUNT(DISTINCT COALESCE(user_id, email)) n FROM sales WHERE afiliado_id IS NOT NULL AND status = 'pago' $w $s GROUP BY a"),
    'vendido' => $g("SELECT afiliado_id a, COALESCE(SUM(bruto), 0) n FROM sales WHERE afiliado_id IS NOT NULL AND status = 'pago' $w $s GROUP BY a"),
    'reembolsos' => $g("SELECT afiliado_id a, COUNT(*) n FROM sales WHERE afiliado_id IS NOT NULL AND value < 0 $w $s GROUP BY a"),
  ];
}
// na venda: de quem é? 1) rastreio af-CODIGO no checkout, 2) id de afiliado da Eduzz, 3) quem trouxe a pessoa para o teste
function af_da_venda(array $data, ?array $u): ?int {
  $trk = (string)($data['edz_trk_1'] ?? $data['trk'] ?? '');
  if (preg_match('/^af-(.+)$/i', $trk, $m) && ($af = af_by_codigo($m[1]))) return (int)$af['id'];
  $dist = (string)($data['edz_gtr_dist'] ?? (is_array($data['affiliate'] ?? null) ? ($data['affiliate']['id'] ?? '') : ''));
  if ($dist !== '' && $dist !== '0') { $q = af_db()->prepare('SELECT id FROM afiliados WHERE eduzz_id = ?'); $q->execute([$dist]); if ($id = $q->fetchColumn()) return (int)$id; }
  return $u && !empty($u['afiliado_id']) ? (int)$u['afiliado_id'] : null;
}
