<?php
// Armadilha do escudo: endereços que só robô de invasão procura (wp-login, phpmyadmin, .env, shell.php...).
// Ninguém de verdade chega aqui. Cada visita é anotada; quem insiste é bloqueado por algumas horas.
declare(strict_types=1);
require __DIR__ . '/lib.php';
escudo_evento('armadilha', mb_substr((string)($_SERVER['REQUEST_URI'] ?? ''), 0, 200));
http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
echo 'Não encontrado.';
