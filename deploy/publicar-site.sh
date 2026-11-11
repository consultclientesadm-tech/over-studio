#!/bin/sh
# Studio Cover (studiocover.com.br): publica a versão mais nova do GitHub. Roda pela tarefa agendada do Plesk a cada 5 minutos.
# Nunca mexe no banco (fica fora do httpdocs) nem no httpdocs/api/config.php.
set -e
R="$HOME/sc-repo"; W="$HOME/httpdocs"; MARK="$HOME/.sc_publicado"
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/sc_deploy -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
[ -d "$R/.git" ] || git clone -q git@github.com:consultclientesadm-tech/over-studio.git "$R"
cd "$R"
git fetch -q origin main
NEW=$(git rev-parse origin/main); OLD=$(cat "$MARK" 2>/dev/null || echo nada)
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
mkdir -p "$HOME/logs"; echo "$(date '+%d/%m/%Y %H:%M') publicado $(git log -1 --format='%h %s')" >> "$HOME/logs/sc-publicacoes.log"
echo "publicado $NEW"
