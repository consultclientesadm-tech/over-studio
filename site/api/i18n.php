<?php
// Textos que o navegador achou sem tradução (assets/i18n.js manda). Ficam guardados para traduzir depois.
declare(strict_types=1);
require __DIR__ . '/lib.php';
$j = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($j)) json_out(['ok' => false]);
$lang = sc_lang_ok((string)($j['lang'] ?? ''));
if ($lang === '' || $lang === 'pt') json_out(['ok' => true]);
throttle('i18n:' . client_ip(), 40, 3600);
$t = array_values(array_filter((array)($j['textos'] ?? []), 'is_string'));
i18n_falta(array_slice($t, 0, 60), $lang, (string)($j['pagina'] ?? ''));
json_out(['ok' => true]);
