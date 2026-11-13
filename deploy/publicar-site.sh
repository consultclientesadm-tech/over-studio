#!/bin/sh
# Studio Cover (studiocover.com.br): publica a versão mais nova do GitHub. Roda pela tarefa agendada do Plesk a cada 5 minutos.
# Nunca mexe no banco (fica fora do httpdocs) nem no httpdocs/api/config.php.
set -e
R="$HOME/sc-repo"; W="$HOME/httpdocs"; MARK="$HOME/.sc_publicado"
[ -d "$R/.git" ] || git clone -q https://github.com/consultclientesadm-tech/over-studio.git "$R"
cd "$R"
git fetch -q origin main
NEW=$(git rev-parse origin/main); OLD=$(cat "$MARK" 2>/dev/null || echo nada)
# vistoria de erros e do sistema (a tarefa roda a cada 5 min; o vigia só trabalha de ~10 em 10). Nunca trava a publicação.
PHPB=$(ls /opt/plesk/php/8.*/bin/php 2>/dev/null | sort -V | tail -1); [ -n "$PHPB" ] || PHPB=$(command -v php 2>/dev/null || true)
if [ -n "$PHPB" ] && [ -f "$W/api/vigia.php" ]; then mkdir -p "$HOME/logs"; "$PHPB" "$W/api/vigia.php" >> "$HOME/logs/sc-vigia.log" 2>&1 || true; [ "$(wc -c < "$HOME/logs/sc-vigia.log")" -gt 1000000 ] && tail -n 2000 "$HOME/logs/sc-vigia.log" > "$HOME/logs/sc-vigia.tmp" && mv "$HOME/logs/sc-vigia.tmp" "$HOME/logs/sc-vigia.log" || true; fi
[ "$NEW" = "$OLD" ] && [ "$1" != "--forcar" ] && exit 0
git reset -q --hard origin/main
sh tools/montar-site.sh >/dev/null
mkdir -p "$W"
tar -C site --exclude=./api/config.php -cf - . | tar -C "$W" -xf -
if [ ! -f "$W/api/config.php" ]; then
  K=$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n'); C=$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')
  printf "<?php\nreturn [\n  'site_url' => 'https://studiocover.com.br',\n  'data_dir' => '%s/studio-cover-dados',\n  'setup_key' => '%s',\n  'cron_key' => '%s',\n];\n" "$HOME" "$K" "$C" > "$W/api/config.php"
  chmod 600 "$W/api/config.php"
  echo "$K" > "$HOME/chave-instalacao.txt"; chmod 600 "$HOME/chave-instalacao.txt"
fi
mkdir -p "$HOME/studio-cover-dados" && chmod 700 "$HOME/studio-cover-dados"
echo "$NEW" > "$MARK"
# erros corrigidos pelo Claude: commits com "corrige-erro: <código>" marcam o erro como resolvido no painel
if [ -n "$PHPB" ] && [ "$OLD" != "nada" ] && git cat-file -e "$OLD" 2>/dev/null; then
  SIGS=$(git log --format=%B "$OLD..$NEW" | grep -oiE 'corrige-erro:? *[0-9a-f]{16}' | grep -oE '[0-9a-f]{16}$' | sort -u | tr '\n' ' ')
  [ -n "$SIGS" ] && "$PHPB" "$W/api/vigia.php" --corrigido $SIGS --commit "$(git log -1 --format='%h %s' | cut -c1-150)" >> "$HOME/logs/sc-vigia.log" 2>&1 || true
fi
mkdir -p "$HOME/logs"; echo "$(date '+%d/%m/%Y %H:%M') publicado $(git log -1 --format='%h %s')" >> "$HOME/logs/sc-publicacoes.log"
echo "publicado $NEW"
