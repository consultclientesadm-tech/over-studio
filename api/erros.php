<?php
// Lista pública (sem nome, e-mail ou id de aluno) dos tipos de erro do app, para o Claude acompanhar e corrigir sozinho.
// https://studiocover.com.br/api/erros.php
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/vigia_erros.php';
header('Cache-Control: no-store');
$v = json_decode(setting('vigia_erros') ?: 'null', true);
$es = json_decode(setting('escudo') ?: 'null', true); // escudo: só se está rodando e quantos problemas (sem detalhe nenhum)
json_out(['ok' => true, 'agora' => now(), 'ultima_vistoria' => $v['quando'] ?? null, 'erros_1h' => $v['erros_1h'] ?? 0, 'erros_24h' => $v['erros_24h'] ?? 0, 'escudo' => ['ultima_checagem' => $es['quando'] ?? null, 'problemas' => count($es['problemas'] ?? [])],
  'grupos' => array_map(fn($g) => array_diff_key($g, ['nota' => 1]) + ['corrigido_em_commit' => $g['nota']], erros_lista())]);
