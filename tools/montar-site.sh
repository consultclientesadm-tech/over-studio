#!/bin/sh
# Monta a pasta site/ (domínio próprio) com a versão atual do app. Uso: sh tools/montar-site.sh
set -e
cd "$(dirname "$0")/.."
A=site/app
mkdir -p $A
cp index.html coi-sw.js $A/
rm -rf $A/css $A/js $A/assets && cp -r css js assets $A/
# conta, manifest e ícones no app
sed -i 's#<title>Studio Cover</title>#<title>Studio Cover</title>\n<link rel="manifest" href="/app/manifest.webmanifest">\n<link rel="apple-touch-icon" href="/assets/icon-180.png">\n<link rel="icon" href="/assets/logo.svg">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n<meta name="apple-mobile-web-app-title" content="Studio Cover">\n<script src="/assets/compat.js?v=2" defer></script>\n<script src="/app/conta.js?v=11"></script>#' $A/index.html
echo "site/app montado."
