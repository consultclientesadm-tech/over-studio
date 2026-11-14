<?php
// Línguas e regiões do lado do cliente (2026-11-14). O site é escrito em português do Brasil; para as outras línguas
// o navegador troca os textos (assets/i18n.js) e aqui o servidor troca os textos dos e-mails e avisos, com o MESMO
// dicionário (assets/i18n/<lingua>.json, chave = texto em português). Em português nada muda.
// Região: br (Brasil), us (Estados Unidos e Canadá) ou eu (Europa, com o país). Serve para o preço, o checkout e o painel.
declare(strict_types=1);

const SC_LANGS = ['pt', 'en', 'es', 'fr', 'de', 'it', 'pt-pt'];
const SC_LANGS_EU = ['es', 'fr', 'de', 'it', 'pt-pt'];
// União Europeia, Espaço Econômico Europeu, Reino Unido e Suíça
const SC_PAISES_EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH', 'MC', 'AD', 'SM'];

function sc_lang_ok(?string $l): string { $l = strtolower(trim((string)$l)); return in_array($l, SC_LANGS, true) ? $l : ''; }
// língua de quem está acessando agora (cookie gravado pelo assets/i18n.js)
function req_lang(): string { return sc_lang_ok($_COOKIE['sc_lang'] ?? '') ?: 'pt'; }
// língua de uma pessoa do banco (quem não tem é do Brasil)
function user_lang(?array $u): string { return $u ? (sc_lang_ok($u['lang'] ?? '') ?: 'pt') : req_lang(); }

function regiao_de(string $pais, string $lang): string {
  $pais = strtoupper($pais);
  if ($pais === 'BR') return 'br';
  if (in_array($pais, SC_PAISES_EU, true)) return 'eu';
  if ($pais === 'US' || $pais === 'CA') return 'us';
  if ($lang === 'pt' || $lang === '') return 'br';
  return in_array($lang, SC_LANGS_EU, true) ? 'eu' : 'us';
}
// região de quem está acessando: o navegador manda o cookie sc_reg (pelo fuso horário); se não tiver, vai pela língua
// página de anúncio de fora (/us ou /eu) fixa a região no navegador (cookie sc_reg_fix); vale acima do fuso horário
function req_reg_fix(): string { $f = (string)($_COOKIE['sc_reg_fix'] ?? ''); return in_array($f, ['us', 'eu'], true) ? $f : ''; }
function req_regiao(): string {
  if ($f = req_reg_fix()) return $f;
  $r = (string)($_COOKIE['sc_reg'] ?? '');
  if (in_array($r, ['br', 'us', 'eu'], true)) { if (req_lang() === 'pt' && $r !== 'br' && empty($_COOKIE['sc_lang_escolhida'])) return 'br'; return $r; }
  return regiao_de('', req_lang());
}
function user_regiao(?array $u): string { $r = (string)($u['regiao'] ?? ''); return in_array($r, ['br', 'us', 'eu'], true) ? $r : 'br'; }

// país pelo IP (uma vez, no cadastro). Sem internet ou sem resposta, devolve ''.
function pais_do_ip(string $ip): string {
  if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) || !function_exists('curl_init')) return '';
  foreach (['http://ip-api.com/json/' . rawurlencode($ip) . '?fields=status,countryCode', 'https://ipwho.is/' . rawurlencode($ip) . '?fields=success,country_code'] as $u) {
    $ch = curl_init($u); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3, CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_USERAGENT => 'studio-cover']);
    $j = json_decode((string)curl_exec($ch), true); curl_close($ch);
    $c = strtoupper((string)($j['countryCode'] ?? $j['country_code'] ?? ''));
    if (preg_match('/^[A-Z]{2}$/', $c)) return $c;
  }
  return '';
}
// grava língua, país e região de uma pessoa (cadastro, compra). Não troca o que já existe, a não ser que $forcar.
function marca_regiao(int $uid, string $lang = '', string $pais = '', bool $forcar = false): void {
  $db = db(); $q = $db->prepare('SELECT lang, pais, regiao FROM users WHERE id = ?'); $q->execute([$uid]); $r = $q->fetch() ?: [];
  $lang = sc_lang_ok($lang) ?: (sc_lang_ok($r['lang'] ?? '') ?: req_lang());
  $pais = strtoupper($pais ?: (string)($r['pais'] ?? ''));
  if ($pais === '' && $lang !== 'pt') $pais = pais_do_ip(client_ip());
  if (!$forcar && !empty($r['regiao']) && ($r['lang'] ?? '') !== '') { if ($pais !== '' && empty($r['pais'])) $db->prepare('UPDATE users SET pais = ? WHERE id = ?')->execute([$pais, $uid]); return; }
  $reg = regiao_de($pais, $lang); $fx = req_reg_fix(); if ($fx !== '' && $reg !== 'br') $reg = $fx; // veio pela página /us ou /eu
  $db->prepare('UPDATE users SET lang = ?, pais = ?, regiao = ? WHERE id = ?')->execute([$lang, $pais, $reg, $uid]);
}
function i18n_migra(PDO $db): void {
  $cols = array_column($db->query('PRAGMA table_info(users)')->fetchAll(), 'name');
  foreach (['lang' => "TEXT NOT NULL DEFAULT ''", 'pais' => "TEXT NOT NULL DEFAULT ''", 'regiao' => "TEXT NOT NULL DEFAULT ''"] as $c => $t) if (!in_array($c, $cols, true)) $db->exec("ALTER TABLE users ADD COLUMN $c $t");
  $cols = array_column($db->query('PRAGMA table_info(sales)')->fetchAll(), 'name');
  foreach (['moeda' => "TEXT NOT NULL DEFAULT 'BRL'", 'regiao' => "TEXT NOT NULL DEFAULT 'br'", 'pais' => "TEXT NOT NULL DEFAULT ''"] as $c => $t) if (!in_array($c, $cols, true)) $db->exec("ALTER TABLE sales ADD COLUMN $c $t");
}

// ---------- tradução (mesma regra do assets/i18n.js) ----------
function i18n_dict(string $lang): array {
  static $cache = [];
  if (isset($cache[$lang])) return $cache[$lang];
  $d = []; $p = [];
  $f = dirname(__DIR__) . '/assets/i18n/' . $lang . '.json';
  $j = is_file($f) ? json_decode((string)file_get_contents($f), true) : null;
  if (is_array($j)) foreach ($j as $k => $v) {
    if (!is_string($v) || $v === '') continue;
    if (preg_match('/\{\d+\}/', (string)$k)) {
      $parts = preg_split('/\{\d+\}/', (string)$k); $hint = ''; foreach ($parts as $x) if (mb_strlen($x) > mb_strlen($hint)) $hint = $x;
      if (mb_strlen(trim(preg_replace('/\s+/u', ' ', $hint))) < 3) continue;
      $re = '/^' . preg_replace('/\\\\\{(\d+)\\\\\}/', '([\s\S]+?)', preg_quote((string)$k, '/')) . '$/u';
      $p[] = ['re' => $re, 'hint' => $hint, 'v' => $v];
    } else $d[(string)$k] = $v;
  }
  usort($p, fn($a, $b) => mb_strlen($b['hint']) <=> mb_strlen($a['hint']));
  return $cache[$lang] = ['d' => $d, 'p' => $p];
}
function i18n_nz(string $s): string { return trim(preg_replace('/\s+/u', ' ', $s)); }
function i18n_lookup(string $k, string $lang): ?string {
  if ($k === '' || !preg_match('/[A-Za-zÀ-ÿ]/u', $k)) return null;
  $D = i18n_dict($lang);
  if (array_key_exists($k, $D['d'])) return $D['d'][$k];
  foreach ($D['p'] as $p) {
    if (!str_contains($k, $p['hint'])) continue;
    if (!preg_match($p['re'], $k, $m)) continue;
    return preg_replace_callback('/\{(\d+)\}/', function ($x) use ($m, $D) { $g = $m[(int)$x[1] + 1] ?? ''; $gt = i18n_nz($g); return $D['d'][$gt] ?? $g; }, $p['v']);
  }
  return null;
}
// texto simples (assunto do e-mail, título do aviso, texto do push)
function tr(string $s, string $lang): string {
  if ($lang === 'pt' || $lang === '' || trim($s) === '') return $s;
  $r = i18n_lookup(i18n_nz($s), $lang);
  if ($r === null) { i18n_falta([$s], $lang, 'servidor'); return $s; }
  preg_match('/^\s*/u', $s, $a); preg_match('/\s*$/u', $s, $b);
  return $a[0] . $r . $b[0];
}
const I18N_INLINE = ['b', 'strong', 'i', 'em', 'u', 'small', 'mark', 'sup', 'sub', 'br', 's'];
function i18n_esc(string $s): string { return str_replace(['&', '<', '>', "\u{00a0}"], ['&amp;', '&lt;', '&gt;', '&nbsp;'], $s); }
function i18n_canon(DOMNode $el): string {
  $o = '';
  foreach ($el->childNodes as $c) {
    if ($c instanceof DOMText) $o .= i18n_esc($c->nodeValue);
    elseif ($c instanceof DOMElement) {
      $t = strtolower($c->tagName); $a = '';
      foreach ($c->attributes as $at) $a .= ' ' . $at->name . '="' . str_replace(['&', '"'], ['&amp;', '&quot;'], $at->value) . '"';
      $o .= $t === 'br' ? "<br$a>" : "<$t$a>" . i18n_canon($c) . "</$t>";
    }
  }
  return $o;
}
function i18n_richleaf(DOMElement $el, bool $top = true): bool {
  $inl = false;
  foreach ($el->childNodes as $c) if ($c instanceof DOMElement) {
    if (!in_array(strtolower($c->tagName), I18N_INLINE, true) || $c->getAttribute('id') !== '' || !i18n_richleaf($c, false)) return false;
    $inl = true;
  }
  return $top ? $inl : true;
}
function i18n_walk(DOMNode $n, string $lang, array &$falta): void {
  if ($n instanceof DOMText) {
    $v = $n->nodeValue; if (!preg_match('/[A-Za-zÀ-ÿ]/u', $v)) return;
    $r = i18n_lookup(i18n_nz($v), $lang);
    if ($r === null) { $falta[] = i18n_nz($v); return; }
    preg_match('/^\s*/u', $v, $a); preg_match('/\s*$/u', $v, $b); $n->nodeValue = $a[0] . $r . $b[0]; return;
  }
  if (!($n instanceof DOMElement) && !($n instanceof DOMDocument)) return;
  if ($n instanceof DOMElement) {
    if (in_array(strtolower($n->tagName), ['script', 'style', 'code', 'pre'], true)) return;
    foreach (['title', 'alt', 'aria-label', 'placeholder'] as $at) if ($n->hasAttribute($at)) { $r = i18n_lookup(i18n_nz($n->getAttribute($at)), $lang); if ($r !== null) $n->setAttribute($at, $r); }
    if (i18n_richleaf($n)) {
      $k = i18n_nz(i18n_canon($n));
      $r = i18n_lookup($k, $lang);
      if ($r !== null) {
        while ($n->firstChild) $n->removeChild($n->firstChild);
        $f = $n->ownerDocument->createDocumentFragment();
        $tmp = new DOMDocument(); @$tmp->loadHTML('<?xml encoding="UTF-8"><div>' . $r . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOERROR);
        $box = $tmp->getElementsByTagName('div')->item(0);
        if ($box) foreach (iterator_to_array($box->childNodes) as $c) $n->appendChild($n->ownerDocument->importNode($c, true));
        return;
      }
    }
  }
  foreach (iterator_to_array($n->childNodes) as $c) i18n_walk($c, $lang, $falta);
}
// HTML (corpo do e-mail ou página inteira)
function tr_html(string $html, string $lang): string {
  if ($lang === 'pt' || $lang === '' || trim($html) === '' || !class_exists('DOMDocument')) return $html;
  $doc = new DOMDocument(); $full = (bool)preg_match('/<html[\s>]/i', $html); $falta = [];
  if ($full) {
    @$doc->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NOERROR);
    i18n_walk($doc, $lang, $falta);
    foreach ($doc->getElementsByTagName('html') as $h) $h->setAttribute('lang', $lang === 'pt-pt' ? 'pt-PT' : $lang);
    $out = $doc->saveHTML(); $out = preg_replace('/<\?xml[^>]*\?>\s*/', '', (string)$out);
  } else {
    @$doc->loadHTML('<?xml encoding="UTF-8"><div id="__sc">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOERROR);
    $box = $doc->getElementById('__sc') ?: $doc->getElementsByTagName('div')->item(0);
    if (!$box) return $html;
    i18n_walk($box, $lang, $falta);
    $out = ''; foreach ($box->childNodes as $c) $out .= $doc->saveHTML($c);
  }
  if ($falta) i18n_falta($falta, $lang, 'e-mail');
  return $out;
}
// textos que faltam no dicionário: ficam guardados para traduzir (o painel e a correção automática leem)
function i18n_db(): PDO {
  static $ok = false; $db = db();
  if (!$ok) { $db->exec('CREATE TABLE IF NOT EXISTS i18n_faltando (lang TEXT NOT NULL, texto TEXT NOT NULL, pagina TEXT NOT NULL DEFAULT \'\', vezes INTEGER NOT NULL DEFAULT 1, primeiro TEXT NOT NULL, ultimo TEXT NOT NULL, PRIMARY KEY (lang, texto))'); $ok = true; }
  return $db;
}
function i18n_falta(array $textos, string $lang, string $pagina): void {
  try {
    $q = i18n_db()->prepare('INSERT INTO i18n_faltando (lang, texto, pagina, primeiro, ultimo) VALUES (?, ?, ?, ?, ?) ON CONFLICT(lang, texto) DO UPDATE SET vezes = vezes + 1, ultimo = excluded.ultimo');
    foreach (array_slice(array_unique($textos), 0, 60) as $t) {
      $t = i18n_nz((string)$t); if ($t === '' || mb_strlen($t) > 600) continue;
      if (!preg_match('/[ãõçáéíóúâêôà]|\b(você|não|para|com|seu|sua|vídeo|voz|que|uma|um|do|da|de|no|na|em|ao|mais|agora|toque|aqui)\b/iu', $t)) continue;
      $q->execute([$lang, $t, mb_substr($pagina, 0, 120), now(), now()]);
    }
  } catch (Throwable $e) {}
}
