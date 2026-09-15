#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
INSTALL_DIR="/opt/mxg-diagnostics-kiosk"
NEXT_DIR="/opt/mxg-diagnostics-kiosk.next"
PREVIOUS_DIR="/opt/mxg-diagnostics-kiosk.previous"
ENV_FILE="/etc/mxg-diagnostics-kiosk.env"
KIOSK_USER="${MXG_KIOSK_USER:-$(getent passwd 1000 | cut -d: -f1)}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this updater as root." >&2
  exit 1
fi
if [ ! -d "$INSTALL_DIR/venv" ]; then
  exec bash "$SOURCE_DIR/install.sh" "$SOURCE_DIR"
fi

MISSING_PACKAGES=()
command -v nmcli >/dev/null 2>&1 || MISSING_PACKAGES+=(network-manager)
command -v mkfs.vfat >/dev/null 2>&1 || MISSING_PACKAGES+=(dosfstools)
command -v curl >/dev/null 2>&1 || MISSING_PACKAGES+=(curl)
command -v avahi-daemon >/dev/null 2>&1 || MISSING_PACKAGES+=(avahi-daemon)
command -v sshd >/dev/null 2>&1 || MISSING_PACKAGES+=(openssh-server)
command -v bluetoothctl >/dev/null 2>&1 || MISSING_PACKAGES+=(bluez)
if [ "${#MISSING_PACKAGES[@]}" -gt 0 ]; then
  apt-get update
  for package in "${MISSING_PACKAGES[@]}"; do
    if apt-cache show "$package" >/dev/null 2>&1; then
      apt-get install -y "$package"
    else
      echo "Optional appliance package is unavailable on this Raspberry Pi OS release: $package" >&2
    fi
  done
fi

switched=0
rollback_on_error() {
  local status="$?"
  trap - EXIT
  rm -rf "$NEXT_DIR"
  if [ "$status" -ne 0 ] && [ "$switched" -eq 1 ] && [ -d "$PREVIOUS_DIR" ]; then
    echo 'Update failed; restoring the last known working appliance release.' >&2
    systemctl stop mxg-diagnostics-kiosk.service mxg-edge-control.service 2>/dev/null || true
    rm -rf "$INSTALL_DIR"
    mv "$PREVIOUS_DIR" "$INSTALL_DIR"
    install -m 0644 "$INSTALL_DIR/systemd/mxg-diagnostics-kiosk.service" /etc/systemd/system/mxg-diagnostics-kiosk.service
    install -m 0644 "$INSTALL_DIR/systemd/mxg-edge-control.service" /etc/systemd/system/mxg-edge-control.service
    install -m 0644 "$INSTALL_DIR/systemd/mxg-bluetooth-sdp.service" /etc/systemd/system/mxg-bluetooth-sdp.service
    install -m 0644 "$INSTALL_DIR/systemd/mxg-boot-status.service" /etc/systemd/system/mxg-boot-status.service
    systemctl daemon-reload
    systemctl restart mxg-edge-control.service mxg-bluetooth-sdp.service mxg-diagnostics-kiosk.service mxg-boot-status.service || true
  fi
  exit "$status"
}
trap rollback_on_error EXIT

rm -rf "$NEXT_DIR"
install -d -m 0755 "$NEXT_DIR"
for component in backend contracts frontend scripts systemd; do
  cp -a "$SOURCE_DIR/$component" "$NEXT_DIR/$component"
done
install -m 0644 "$SOURCE_DIR/requirements.txt" "$NEXT_DIR/requirements.txt"
if [ -f "$SOURCE_DIR/VERSION" ]; then
  install -m 0644 "$SOURCE_DIR/VERSION" "$NEXT_DIR/VERSION"
fi
python3 -m venv "$NEXT_DIR/venv"
"$NEXT_DIR/venv/bin/pip" install --disable-pip-version-check --no-cache-dir -r "$NEXT_DIR/requirements.txt"
chown -R root:root "$NEXT_DIR"

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

# Preserve the same deterministic first-start contract as a full install. This
# also repairs older images where the kiosk happened to create the directory
# only after the root USB emulator had already attempted to start.
install -d -o mxgdiag -g mxgdiag -m 0700 /var/lib/mxg-diagnostics-kiosk

systemctl stop mxg-diagnostics-kiosk.service mxg-edge-control.service 2>/dev/null || true
rm -rf "$PREVIOUS_DIR"
mv "$INSTALL_DIR" "$PREVIOUS_DIR"
mv "$NEXT_DIR" "$INSTALL_DIR"
switched=1

install -m 0644 "$INSTALL_DIR/systemd/mxg-diagnostics-kiosk.service" /etc/systemd/system/mxg-diagnostics-kiosk.service
install -m 0644 "$INSTALL_DIR/systemd/mxg-edge-control.service" /etc/systemd/system/mxg-edge-control.service
install -m 0644 "$INSTALL_DIR/systemd/mxg-bluetooth-sdp.service" /etc/systemd/system/mxg-bluetooth-sdp.service
install -m 0644 "$INSTALL_DIR/systemd/mxg-boot-status.service" /etc/systemd/system/mxg-boot-status.service
install -d -m 0755 /etc/systemd/system/bluetooth.service.d
install -m 0644 "$INSTALL_DIR/systemd/mxg-bluetooth-compat.conf" /etc/systemd/system/bluetooth.service.d/mxg-compat.conf
if [ -n "$KIOSK_USER" ] && [ -d "/home/$KIOSK_USER" ]; then
  install -d -m 0755 "/home/$KIOSK_USER/.config/autostart"
  install -m 0644 "$INSTALL_DIR/systemd/mxg-diagnostics-kiosk.desktop" "/home/$KIOSK_USER/.config/autostart/mxg-diagnostics-kiosk.desktop"
  chown -R "$KIOSK_USER:$KIOSK_USER" "/home/$KIOSK_USER/.config"
fi
chmod +x \
  "$INSTALL_DIR/scripts/configure-appliance.sh" \
  "$INSTALL_DIR/scripts/diagnose-appliance.sh" \
  "$INSTALL_DIR/scripts/boot-status.sh" \
  "$INSTALL_DIR/scripts/start-kiosk.sh"
"$INSTALL_DIR/scripts/configure-appliance.sh" "$INSTALL_DIR" "$KIOSK_USER"

systemctl daemon-reload
systemctl enable bluetooth.service avahi-daemon.service ssh.service
systemctl disable NetworkManager-wait-online.service 2>/dev/null || true
systemctl enable mxg-edge-control.service mxg-bluetooth-sdp.service mxg-diagnostics-kiosk.service mxg-boot-status.service
systemctl restart bluetooth.service
systemctl restart avahi-daemon.service
systemctl restart ssh.service
systemctl restart mxg-edge-control.service
systemctl restart mxg-bluetooth-sdp.service
systemctl restart mxg-diagnostics-kiosk.service
systemctl restart mxg-boot-status.service

healthy=0
for _ in $(seq 1 30); do
  if /usr/bin/python3 -c 'import json,urllib.request; data=json.load(urllib.request.urlopen("http://127.0.0.1:8844/api/v1/health",timeout=2)); assert data["status"] == "ok"' >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  echo 'The updated diagnostics service did not become healthy.' >&2
  exit 1
fi

switched=0
trap - EXIT

echo "MXG diagnostics kiosk updated to $(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo unknown)"
