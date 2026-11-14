<?php
// Copie para config.php e preencha. NÃO suba o config.php para o GitHub.
return [
  'site_url' => 'https://SEU-DOMINIO.com.br',
  // pasta do banco de dados, FORA da pasta pública (httpdocs). Precisa ter permissão de escrita.
  'data_dir' => dirname(__DIR__, 2) . '/studio-cover-dados',
  // chave para criar o primeiro administrador (abra /admin/ e use esta chave uma vez)
  'setup_key' => 'TROQUE-ESTA-CHAVE',
  // chave para rodar o funil por URL: /api/cron.php?chave=...
  'cron_key' => 'TROQUE-ESTA-TAMBEM',
];
