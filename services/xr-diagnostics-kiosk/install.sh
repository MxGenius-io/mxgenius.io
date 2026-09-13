#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
INSTALL_DIR="/opt/mxg-diagnostics-kiosk"
NEXT_DIR="/opt/mxg-diagnostics-kiosk.installing"
ENV_FILE="/etc/mxg-diagnostics-kiosk.env"
KIOSK_USER="${MXG_KIOSK_USER:-$(getent passwd 1000 | cut -d: -f1)}"
IMAGE_BUILD_MODE="${MXG_IMAGE_BUILD:-0}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root." >&2
  exit 1
fi
if [ -z "$KIOSK_USER" ]; then
  echo "No desktop user with UID 1000 exists. Provision the Raspberry Pi user before installing the kiosk." >&2
  exit 1
fi

apt-get update
apt-get install -y python3 python3-venv python3-pip chromium openssl bluez network-manager dosfstools curl avahi-daemon openssh-server

if ! id mxgdiag >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin mxgdiag
fi
for group in dialout video render plugdev bluetooth; do
  getent group "$group" >/dev/null 2>&1 && usermod -a -G "$group" mxgdiag
done

install -d -m 0755 "$INSTALL_DIR"
cleanup_install() { rm -rf "$NEXT_DIR"; }
trap cleanup_install EXIT
rm -rf "$NEXT_DIR"
install -d -m 0755 "$NEXT_DIR"
cp -a "$SOURCE_DIR/backend" "$SOURCE_DIR/contracts" "$SOURCE_DIR/frontend" "$SOURCE_DIR/scripts" "$SOURCE_DIR/systemd" "$SOURCE_DIR/requirements.txt" "$NEXT_DIR/"
if [ -f "$SOURCE_DIR/VERSION" ]; then
  install -m 0644 "$SOURCE_DIR/VERSION" "$NEXT_DIR/VERSION"
fi
python3 -m venv "$NEXT_DIR/venv"
"$NEXT_DIR/venv/bin/pip" install --disable-pip-version-check --no-cache-dir -r "$NEXT_DIR/requirements.txt"
chown -R root:root "$NEXT_DIR"
rm -rf "$INSTALL_DIR"
mv "$NEXT_DIR" "$INSTALL_DIR"
trap - EXIT

umask 077
touch "$ENV_FILE"
chmod 0600 "$ENV_FILE"
ensure_env() {
  local key="$1" value="$2"
  grep -q "^${key}=" "$ENV_FILE" || printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}
ensure_env MXG_BRIDGE_TOKEN "$(openssl rand -hex 24)"
ensure_env MXG_DIAGNOSTIC_PORTS "'[{\"label\":\"MXG API\",\"host\":\"127.0.0.1\",\"port\":8844}]'"
ensure_env MXG_BLUETOOTH_ENABLED 1
ensure_env MXG_BLUETOOTH_CHANNEL 8
ensure_env MXG_EDGE_PACKS_ENABLED 1
ensure_env MXG_EDGE_CORE_URL https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io
ensure_env MXG_EDGE_STATE_DIR /var/lib/mxg-diagnostics-kiosk
ensure_env MXG_EDGE_POLL_SECONDS 60

install -d -m 0755 /etc/systemd/system/bluetooth.service.d
install -m 0644 "$INSTALL_DIR/systemd/mxg-bluetooth-compat.conf" /etc/systemd/system/bluetooth.service.d/mxg-compat.conf

install -m 0644 "$INSTALL_DIR/systemd/mxg-diagnostics-kiosk.service" /etc/systemd/system/mxg-diagnostics-kiosk.service
install -m 0644 "$INSTALL_DIR/systemd/mxg-edge-control.service" /etc/systemd/system/mxg-edge-control.service
install -m 0644 "$INSTALL_DIR/systemd/mxg-bluetooth-sdp.service" /etc/systemd/system/mxg-bluetooth-sdp.service
install -m 0644 "$INSTALL_DIR/systemd/mxg-boot-status.service" /etc/systemd/system/mxg-boot-status.service
install -d -m 0755 "/home/$KIOSK_USER/.config/autostart"
install -m 0644 "$INSTALL_DIR/systemd/mxg-diagnostics-kiosk.desktop" "/home/$KIOSK_USER/.config/autostart/mxg-diagnostics-kiosk.desktop"
chown -R "$KIOSK_USER:$KIOSK_USER" "/home/$KIOSK_USER/.config"
chmod +x "$INSTALL_DIR/scripts/configure-appliance.sh" "$INSTALL_DIR/scripts/diagnose-appliance.sh" "$INSTALL_DIR/scripts/boot-status.sh" "$INSTALL_DIR/scripts/start-kiosk.sh"
"$INSTALL_DIR/scripts/configure-appliance.sh" "$INSTALL_DIR" "$KIOSK_USER"

systemctl daemon-reload
systemctl enable bluetooth.service avahi-daemon.service ssh.service
systemctl disable NetworkManager-wait-online.service 2>/dev/null || true
systemctl enable mxg-edge-control.service mxg-bluetooth-sdp.service mxg-diagnostics-kiosk.service mxg-boot-status.service
if [ "$IMAGE_BUILD_MODE" != "1" ]; then
  systemctl restart bluetooth.service
  systemctl restart avahi-daemon.service
  systemctl restart ssh.service
  systemctl restart mxg-edge-control.service
  systemctl restart mxg-bluetooth-sdp.service
  systemctl restart mxg-diagnostics-kiosk.service
  systemctl restart mxg-boot-status.service
fi

echo "MXG diagnostics kiosk $(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo unknown) installed at http://127.0.0.1:8844/"
