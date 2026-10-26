#!/bin/bash
set -euo pipefail
umask 077
PACKAGE=/root/villas-beer-deploy
APP=/opt/villas-beer/app
STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP=/root/villas-beer-backups/$STAMP

test "$(id -u)" = 0
test -f "$PACKAGE/app/server/app.cjs"
if systemctl is-active --quiet villas-beer.service; then
  echo "Villas Beer ja instalado. Use publicacao com backup do banco; instalador inicial interrompido."
  exit 1
fi
test ! -e /var/lib/villas-beer/villas.sqlite
test ! -e /etc/nginx/sites-enabled/villas-beer
test ! -e /etc/systemd/system/villas-beer.service
test ! -e /etc/villas-beer.env
systemctl is-active --quiet vigilant.service
VIGILANT_PID=$(systemctl show vigilant.service -p MainPID --value)
VIGILANT_CONFIG_HASH=$(sha256sum /etc/nginx/sites-available/vigilant | cut -d' ' -f1)
nginx -t
mkdir -p "$BACKUP"
cp -a /etc/nginx/sites-available/vigilant "$BACKUP/vigilant.nginx.unchanged"
printf '%s\n' "$VIGILANT_PID" > "$BACKUP/vigilant.pid.before"

getent passwd villas-beer >/dev/null || useradd --system --home-dir /var/lib/villas-beer --shell /usr/sbin/nologin villas-beer
install -d -m 0755 /opt/villas-beer "$APP"
install -d -m 0700 -o villas-beer -g villas-beer /var/lib/villas-beer

if ! test -x /opt/villas-beer/node/bin/node; then
  install -d -m 0700 "$PACKAGE/node-download"
  cd "$PACKAGE/node-download"
  curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt --output SHASUMS256.txt
  ARCHIVE=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64.tar.xz$/ { print $2 }' SHASUMS256.txt)
  test "$(printf '%s\n' "$ARCHIVE" | wc -l)" = 1
  test -n "$ARCHIVE"
  curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v24.x/$ARCHIVE" --output "$ARCHIVE"
  grep "  $ARCHIVE$" SHASUMS256.txt | sha256sum --check -
  install -d -m 0755 /opt/villas-beer/node
  tar -xJf "$ARCHIVE" --strip-components=1 -C /opt/villas-beer/node
fi
/opt/villas-beer/node/bin/node --version
cp -a "$PACKAGE/app/." "$APP/"
chown -R root:root /opt/villas-beer
chmod -R go-w /opt/villas-beer
cat > /etc/villas-beer.env <<'ENV'
NODE_ENV=production
PUBLIC_ORIGIN=https://vigilant.selfip.com:8444
PORT=8770
DATABASE_FILE=/var/lib/villas-beer/villas.sqlite
SETUP_FILE=/var/lib/villas-beer/setup-token
ENV
chmod 0600 /etc/villas-beer.env
install -m 0644 "$PACKAGE/app/deploy/villas-beer.service" /etc/systemd/system/villas-beer.service
systemctl daemon-reload
systemctl enable --now villas-beer.service
READY=0
for i in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:8770/api/health >/dev/null; then READY=1; break; fi
  sleep 1
done
if test "$READY" != 1; then
  echo "Falha de saude Villas Beer. Proxy nao instalado. Verifique journalctl -u villas-beer."
  systemctl stop villas-beer.service
  exit 1
fi
install -m 0644 "$PACKAGE/app/deploy/villas-beer.nginx" /etc/nginx/sites-available/villas-beer
ln -s /etc/nginx/sites-available/villas-beer /etc/nginx/sites-enabled/villas-beer
if ! nginx -t; then
  unlink /etc/nginx/sites-enabled/villas-beer
  systemctl stop villas-beer.service
  echo "Proxy novo desabilitado; configuracao VIGILANT preservada."
  exit 1
fi
if ! systemctl reload nginx; then
  unlink /etc/nginx/sites-enabled/villas-beer
  nginx -t && systemctl reload nginx
  systemctl stop villas-beer.service
  exit 1
fi
test "$VIGILANT_CONFIG_HASH" = "$(sha256sum /etc/nginx/sites-available/vigilant | cut -d' ' -f1)"
test "$VIGILANT_PID" = "$(systemctl show vigilant.service -p MainPID --value)"
systemctl is-active --quiet vigilant.service
curl --fail --silent https://vigilant.selfip.com:8444/api/health
printf '\nInstalado: Villas Beer independente; VIGILANT preservado.\n'
