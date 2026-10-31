#!/bin/sh
# Root-only, idempotent runtime setup. Existing workflows are preserved.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Administrator rights required'; exit 1; }
command -v systemctl >/dev/null || { echo 'systemd is required'; exit 1; }
command -v tar >/dev/null || { echo 'tar is required'; exit 1; }
command -v sha256sum >/dev/null || { echo 'sha256sum is required'; exit 1; }
BASE=/opt/ervisio-browser-robots
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -d -m 0755 "$BASE" "$BASE/browsers"
id ervisio-browser >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/ervisio-browser-robots --shell /usr/sbin/nologin ervisio-browser
install -d -m 0700 -o ervisio-browser -g ervisio-browser /var/lib/ervisio-browser-robots
fetch() {
  if command -v curl >/dev/null; then curl --fail --location --silent --show-error --retry 3 "$1" -o "$2";
  elif command -v wget >/dev/null; then wget --quiet --tries=3 -O "$2" "$1";
  else echo 'curl or wget required for browser downloads' >&2; exit 1; fi
}
node_ok() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
    [ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -ge 20 ]
}
if ! node_ok; then
  echo '[1/5] Installing isolated Node.js runtime'
  case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo 'Unsupported architecture' >&2; exit 1 ;; esac
  VERSION=v22.16.0
  FILE=node-$VERSION-linux-$ARCH.tar.xz
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT HUP INT TERM
  fetch "https://nodejs.org/dist/$VERSION/SHASUMS256.txt" "$TMP/checksums"
  fetch "https://nodejs.org/dist/$VERSION/$FILE" "$TMP/$FILE"
  grep "  $FILE\$" "$TMP/checksums" | (cd "$TMP" && sha256sum -c -)
  install -d -m 0755 "$BASE/node"
  tar -xJf "$TMP/$FILE" --strip-components=1 -C "$BASE/node"
  rm -rf "$TMP"
  trap - EXIT HUP INT TERM
fi
PATH="$BASE/node/bin:$PATH"; export PATH
node_ok || { echo 'Node.js 20+ and npm required'; exit 1; }
echo '[2/5] Installing Playwright packages'
install -m 0644 "$SOURCE/package.json" "$BASE/package.json"
install -m 0644 "$SOURCE/server.cjs" "$BASE/server.cjs"
(cd "$BASE" && npm install --omit=dev --no-audit --no-fund --no-progress)
echo '[3/5] Installing Chromium and OS dependencies'
if command -v apt-get >/dev/null 2>&1; then
  (cd "$BASE" && PLAYWRIGHT_BROWSERS_PATH="$BASE/browsers" ./node_modules/.bin/playwright install --with-deps chromium)
else
  (cd "$BASE" && PLAYWRIGHT_BROWSERS_PATH="$BASE/browsers" ./node_modules/.bin/playwright install chromium)
fi
chown -R ervisio-browser:ervisio-browser "$BASE"
cat > /etc/systemd/system/ervisio-browser-robots.service <<'UNIT'
[Unit]
Description=Ervisio Browser Robots runtime
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=ervisio-browser
Group=ervisio-browser
WorkingDirectory=/opt/ervisio-browser-robots
ExecStart=/usr/bin/env node /opt/ervisio-browser-robots/server.cjs
Restart=on-failure
RestartSec=3
RuntimeDirectory=ervisio-browser-robots
RuntimeDirectoryMode=0700
StateDirectory=ervisio-browser-robots
Environment=PATH=/opt/ervisio-browser-robots/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=PLAYWRIGHT_BROWSERS_PATH=/opt/ervisio-browser-robots/browsers
Environment=HOME=/var/lib/ervisio-browser-robots
NoNewPrivileges=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/run/ervisio-browser-robots /var/lib/ervisio-browser-robots
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
UNIT
echo '[4/5] Enabling runtime service'
systemctl daemon-reload
systemctl enable ervisio-browser-robots.service
systemctl restart ervisio-browser-robots.service
echo '[5/5] Checking socket'
i=0
while [ "$i" -lt 25 ]; do
  if [ -S /run/ervisio-browser-robots/control.sock ]; then echo 'Browser Robots ready'; exit 0; fi
  i=$((i+1)); sleep 1
done
echo 'Runtime did not create socket: see service logs in plugin' >&2
systemctl status ervisio-browser-robots.service --no-pager -l || :
exit 1
