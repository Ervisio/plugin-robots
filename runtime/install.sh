#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root'; exit 1; }
command -v systemctl >/dev/null || { echo 'systemd required'; exit 1; }
command -v node >/dev/null || { echo 'Node.js 20+ required'; exit 1; }
command -v npm >/dev/null || { echo 'npm required'; exit 1; }
id ervisio-browser >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/ervisio-browser-robots --shell /usr/sbin/nologin ervisio-browser
install -d -m 0755 /opt/ervisio-browser-robots
install -d -m 0700 -o ervisio-browser -g ervisio-browser /var/lib/ervisio-browser-robots
install -d -m 0700 /opt/ervisio-browser-robots/browsers
install -m 0755 "$(dirname "$0")/server.cjs" /opt/ervisio-browser-robots/server.cjs
install -m 0644 "$(dirname "$0")/package.json" /opt/ervisio-browser-robots/package.json
(cd /opt/ervisio-browser-robots && npm install --omit=dev --no-audit --no-fund)
(cd /opt/ervisio-browser-robots && PLAYWRIGHT_BROWSERS_PATH=/opt/ervisio-browser-robots/browsers ./node_modules/.bin/playwright install chromium)
chown -R ervisio-browser:ervisio-browser /opt/ervisio-browser-robots
cat > /etc/systemd/system/ervisio-browser-robots.service <<'EOF'
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
Environment=PLAYWRIGHT_BROWSERS_PATH=/opt/ervisio-browser-robots/browsers
Environment=HOME=/var/lib/ervisio-browser-robots
NoNewPrivileges=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/run/ervisio-browser-robots /var/lib/ervisio-browser-robots
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ervisio-browser-robots.service
echo 'Browser Robots installed. Open Ervisio > Browser Robots.'
echo 'If Chromium fails for missing OS libraries, run: npx playwright install-deps chromium (as root, from the runtime folder).'
