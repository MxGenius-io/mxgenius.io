#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
INSTALL_DIR="/opt/mxg-diagnostics-kiosk"
ENV_FILE="/etc/mxg-diagnostics-kiosk.env"
KIOSK_USER="${MXG_KIOSK_USER:-$(getent passwd 1000 | cut -d: -f1)}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root." >&2
  exit 1
fi
if [ -z "$KIOSK_USER" ]; then
  echo "No desktop user with UID 1000 exists. Provision the Raspberry Pi user before installing the kiosk." >&2
  exit 1
fi

apt-get update
apt-get install -y python3 python3-venv python3-pip chromium openssl bluez

if ! id mxgdiag >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin mxgdiag
fi
for group in dialout video render plugdev bluetooth; do
  getent group "$group" >/dev/null 2>&1 && usermod -a -G "$group" mxgdiag
done

install -d -m 0755 "$INSTALL_DIR"
cp -a "$SOURCE_DIR/backend" "$SOURCE_DIR/contracts" "$SOURCE_DIR/frontend" "$SOURCE_DIR/systemd" "$SOURCE_DIR/requirements.txt" "$INSTALL_DIR/"
if [ -f "$SOURCE_DIR/VERSION" ]; then
  install -m 0644 "$SOURCE_DIR/VERSION" "$INSTALL_DIR/VERSION"
fi
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --disable-pip-version-check --no-cache-dir -r "$INSTALL_DIR/requirements.txt"
chown -R root:root "$INSTALL_DIR"

if [ ! -s "$ENV_FILE" ]; then
  umask 077
  TOKEN="$(openssl rand -hex 24)"
  cat > "$ENV_FILE" <<EOF
MXG_BRIDGE_TOKEN=$TOKEN
MXG_DIAGNOSTIC_PORTS='[{"label":"MXG API","host":"127.0.0.1","port":8844}]'
MXG_BLUETOOTH_ENABLED=1
MXG_BLUETOOTH_CHANNEL=8
EOF
fi

systemctl enable --now bluetooth.service
command -v sdptool >/dev/null 2>&1 && sdptool add --channel=8 SP || true

install -m 0644 "$INSTALL_DIR/systemd/mxg-diagnostics-kiosk.service" /etc/systemd/system/mxg-diagnostics-kiosk.service
install -m 0644 "$INSTALL_DIR/systemd/mxg-bluetooth-sdp.service" /etc/systemd/system/mxg-bluetooth-sdp.service
install -d -m 0755 "/home/$KIOSK_USER/.config/autostart"
install -m 0644 "$INSTALL_DIR/systemd/mxg-diagnostics-kiosk.desktop" "/home/$KIOSK_USER/.config/autostart/mxg-diagnostics-kiosk.desktop"
chown -R "$KIOSK_USER:$KIOSK_USER" "/home/$KIOSK_USER/.config"

systemctl daemon-reload
systemctl enable mxg-bluetooth-sdp.service mxg-diagnostics-kiosk.service
systemctl restart mxg-bluetooth-sdp.service
systemctl restart mxg-diagnostics-kiosk.service

echo "MXG diagnostics kiosk $(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo unknown) installed at http://127.0.0.1:8844/"
