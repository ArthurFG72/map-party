#!/usr/bin/env bash
set -euo pipefail
DOMAIN=18-228-44-32.sslip.io
APP_DIR=/opt/map-party
DEVICE_AUTH_SECRET=""
NAVIGATOR_ADAPTER_TOKEN=""
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"
if [ -r /etc/map-party.env ]; then
  DEVICE_AUTH_SECRET=$(sed -n 's/^DEVICE_AUTH_SECRET=//p' /etc/map-party.env | head -n 1)
  NAVIGATOR_ADAPTER_TOKEN=$(sed -n 's/^NAVIGATOR_ADAPTER_TOKEN=//p' /etc/map-party.env | head -n 1)
  GEMINI_API_KEY=$(sed -n 's/^GEMINI_API_KEY=//p' /etc/map-party.env | head -n 1)
  GEMINI_MODEL=$(sed -n 's/^GEMINI_MODEL=//p' /etc/map-party.env | head -n 1)
fi
if [ -r /etc/map-party-gemini.env ]; then
  GEMINI_API_KEY=$(sed -n 's/^GEMINI_API_KEY=//p' /etc/map-party-gemini.env | head -n 1)
fi
if [ "${#DEVICE_AUTH_SECRET}" -lt 32 ]; then
  DEVICE_AUTH_SECRET=$(openssl rand -hex 32)
fi
if [ "${#NAVIGATOR_ADAPTER_TOKEN}" -lt 32 ]; then
  NAVIGATOR_ADAPTER_TOKEN=$(openssl rand -hex 32)
fi
install -d -m 700 "$APP_DIR/keys"
if [ ! -s "$APP_DIR/keys/emergency-private.pem" ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$APP_DIR/keys/emergency-private.pem"
  openssl pkey -in "$APP_DIR/keys/emergency-private.pem" -pubout -out "$APP_DIR/keys/emergency-public.pem"
fi
chmod 600 "$APP_DIR/keys/emergency-private.pem"
chmod 644 "$APP_DIR/keys/emergency-public.pem"
chown -R ubuntu:ubuntu "$APP_DIR/keys"
PUBLIC_KEY=$(awk '{printf "%s\\\\n", $0}' "$APP_DIR/keys/emergency-public.pem")
PRIVATE_KEY=$(awk '{printf "%s\\\\n", $0}' "$APP_DIR/keys/emergency-private.pem")
cat > /etc/map-party.env <<EOF
NODE_ENV=production
PORT=3001
NODE_OPTIONS=--max-old-space-size=384
DEVICE_AUTH_SECRET=$DEVICE_AUTH_SECRET
NAVIGATOR_ADAPTER_TOKEN=$NAVIGATOR_ADAPTER_TOKEN
GEMINI_API_KEY=$GEMINI_API_KEY
GEMINI_MODEL=${GEMINI_MODEL:-gemini-2.5-flash}
MAX_ROOM_PARTICIPANTS=50
MAX_ROOMS=1000
CLIENT_ORIGIN=https://$DOMAIN
APP_ANDROID_URL=
APP_IOS_URL=
EXPO_GO_URL=
EMERGENCY_PUBLIC_KEY_PEM=$PUBLIC_KEY
EMERGENCY_PRIVATE_KEY_PEM=$PRIVATE_KEY
GEOCODER_BASE_URL=https://nominatim.openstreetmap.org
GEOCODER_USER_AGENT=MapParty/1.0
OSRM_BASE_URL=https://router.project-osrm.org
OVERPASS_BASE_URL=https://overpass-api.de/api/interpreter
OVERPASS_USER_AGENT=MapParty/1.0
EOF
chmod 600 /etc/map-party.env
cat > /etc/systemd/system/map-party.service <<'EOF'
[Unit]
Description=Map Party Node server
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/opt/map-party/server
EnvironmentFile=/etc/map-party.env
ExecStart=/snap/node/current/bin/node src/index.js
Restart=always
RestartSec=3
TimeoutStopSec=15
KillSignal=SIGINT
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/map-party

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3001
}
EOF
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now map-party.service
systemctl restart caddy
sleep 3
systemctl is-active --quiet map-party.service
systemctl is-active --quiet caddy
curl --fail --silent --show-error --max-time 10 "https://$DOMAIN/health"
printf '\nMAPS is healthy.\n'
