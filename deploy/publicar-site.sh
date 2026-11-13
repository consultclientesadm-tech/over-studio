#!/bin/sh
# Studio Cover (studiocover.com.br): publica a versão mais nova do GitHub. Roda pela tarefa agendada do Plesk a cada 5 minutos.
# Nunca mexe no banco (fica fora do httpdocs) nem no httpdocs/api/config.php.
# Publica o ramo "publicado" (montado no GitHub com o JavaScript embaralhado). Se ele não ficar pronto em 15 min,
# publica o main sem embaralhar, para o site nunca travar. Repositório privado: a chave de leitura do GitHub fica em
# ~/studio-cover-dados/github-token (colada pelo painel, aba Vistoria).
set -e
R="$HOME/sc-repo"; W="$HOME/httpdocs"; MARK="$HOME/.sc_publicado"; P="$HOME/sc-publicado"; URL=https://github.com/consultclientesadm-tech/over-studio.git
TOKF="$HOME/studio-cover-dados/github-token"; ERR="$HOME/logs/sc-publicacoes-erro.log"; mkdir -p "$HOME/logs"
g() {
  TOK=$(tr -d ' \r\n' < "$TOKF" 2>/dev/null || true)
  if [ -n "$TOK" ]; then git -c http.https://github.com/.extraheader="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOK" | base64 | tr -d '\n')" "$@"; else git "$@"; fi
}
# vistoria de erros, do sistema e escudo de segurança (a tarefa roda a cada 5 min). Nunca trava a publicação.
PHPB=$(ls /opt/plesk/php/8.*/bin/php 2>/dev/null | sort -V | tail -1); [ -n "$PHPB" ] || PHPB=$(command -v php 2>/dev/null || true)
if [ -n "$PHPB" ] && [ -f "$W/api/vigia.php" ]; then "$PHPB" "$W/api/vigia.php" >> "$HOME/logs/sc-vigia.log" 2>&1 || true; [ "$(wc -c < "$HOME/logs/sc-vigia.log")" -gt 1000000 ] && tail -n 2000 "$HOME/logs/sc-vigia.log" > "$HOME/logs/sc-vigia.tmp" && mv "$HOME/logs/sc-vigia.tmp" "$HOME/logs/sc-vigia.log" || true; fi
if [ ! -d "$R/.git" ]; then g clone -q "$URL" "$R" 2>>"$ERR" || { echo "$(date '+%d/%m %H:%M') não consegui clonar (chave do GitHub?)" >> "$ERR"; exit 1; }; fi
cd "$R"
git remote set-url origin "$URL"
if ! g fetch -q origin main 2>/dev/null; then echo "$(date '+%d/%m %H:%M') não consegui buscar o main no GitHub (repositório privado sem chave, ou chave vencida)" >> "$ERR"; exit 1; fi
rm -f "$ERR"
g fetch -q origin "+refs/heads/publicado:refs/remotes/origin/publicado" 2>/dev/null || true
NEW=$(git rev-parse origin/main); OLD=$(cat "$MARK" 2>/dev/null || echo nada); OLDSHA=${OLD%% *}
PUB=$(git rev-parse -q --verify refs/remotes/origin/publicado 2>/dev/null || true)
FONTE=$([ -n "$PUB" ] && git show "$PUB:.fonte" 2>/dev/null | tr -d ' \n' || true)
if [ "$FONTE" = "$NEW" ]; then MODO=protegido
else
  IDADE=$(( $(date +%s) - $(git log -1 --format=%ct "$NEW") ))
  if [ "$IDADE" -lt 900 ] && [ "$1" != "--forcar" ]; then exit 0; fi # o GitHub ainda está montando a versão protegida
  MODO=simples
fi
[ "$OLD" = "$NEW $MODO" ] && [ "$1" != "--forcar" ] && exit 0
git reset -q --hard origin/main
rm -rf "$P.novo"; mkdir -p "$P.novo"
if [ "$MODO" = protegido ]; then git archive "$PUB" | tar -x -C "$P.novo"; else sh tools/montar-site.sh >/dev/null && cp -a site/. "$P.novo/"; fi
rm -f "$P.novo/api/config.php" "$P.novo/.fonte"
touch "$HOME/.sc_publicando" # o escudo não confere os arquivos enquanto a troca acontece
rm -rf "$P.velho"; [ -d "$P" ] && mv "$P" "$P.velho"; mv "$P.novo" "$P"; rm -rf "$P.velho"
mkdir -p "$W"
tar -C "$P" --exclude=./api/config.php -cf - . | tar -C "$W" -xf -
rm -f "$HOME/.sc_publicando"
if [ ! -f "$W/api/config.php" ]; then
  K=$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n'); C=$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')
  printf "<?php\nreturn [\n  'site_url' => 'https://studiocover.com.br',\n  'data_dir' => '%s/studio-cover-dados',\n  'setup_key' => '%s',\n  'cron_key' => '%s',\n];\n" "$HOME" "$K" "$C" > "$W/api/config.php"
  chmod 600 "$W/api/config.php"
  echo "$K" > "$HOME/chave-instalacao.txt"; chmod 600 "$HOME/chave-instalacao.txt"
fi
mkdir -p "$HOME/studio-cover-dados" && chmod 700 "$HOME/studio-cover-dados"
echo "$NEW $MODO" > "$MARK"
# erros corrigidos pelo Claude: commits com "corrige-erro: <código>" marcam o erro como resolvido no painel
if [ -n "$PHPB" ] && [ "$OLDSHA" != "nada" ] && [ "$OLDSHA" != "$NEW" ] && git cat-file -e "$OLDSHA" 2>/dev/null; then
  SIGS=$(git log --format=%B "$OLDSHA..$NEW" | grep -oiE 'corrige-erro:? *[0-9a-f]{16}' | grep -oE '[0-9a-f]{16}$' | sort -u | tr '\n' ' ')
  [ -n "$SIGS" ] && "$PHPB" "$W/api/vigia.php" --corrigido $SIGS --commit "$(git log -1 --format='%h %s' | cut -c1-150)" >> "$HOME/logs/sc-vigia.log" 2>&1 || true
fi
echo "$(date '+%d/%m/%Y %H:%M') publicado ($MODO) $(git log -1 --format='%h %s')" >> "$HOME/logs/sc-publicacoes.log"
echo "publicado $NEW ($MODO)"
