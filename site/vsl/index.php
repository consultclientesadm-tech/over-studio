<?php
// Página de vendas para campanha de VENDA DIRETA: a mesma da home (mesmos pixels, mesmo checkout),
// só que sem o teste grátis. Lê ../index.html na hora, então qualquer mudança na página principal vale aqui.
$h = (string)file_get_contents(__DIR__ . '/../index.html');
$h = preg_replace('#<head>#', "<head>\n<script>window.SC_SEM_TESTE = 1;</script>", $h, 1);
$h = preg_replace('#<a class="presente[^"]*"[^>]*data-teste[^>]*>.*?</a>#s', '', $h); // cartões "Você ganhou um teste grátis"
$h = preg_replace('#<a class="btn gift"[^>]*data-teste[^>]*>.*?</a>#s', '', $h);       // botão da barra fixa
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
echo $h;
