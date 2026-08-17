#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
INSTALL_DIR="/opt/mxg-diagnostics-kiosk"
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
if ! command -v convert >/dev/null 2>&1 && ! command -v magick >/dev/null 2>&1; then
  MISSING_PACKAGES+=(imagemagick)
fi
if ! command -v configure-splash >/dev/null 2>&1; then
  MISSING_PACKAGES+=(rpi-splash-screen-support)
fi
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

OLD_REQUIREMENTS="$(sha256sum "$INSTALL_DIR/requirements.txt" 2>/dev/null | cut -d' ' -f1 || true)"
NEW_REQUIREMENTS="$(sha256sum "$SOURCE_DIR/requirements.txt" | cut -d' ' -f1)"

systemctl stop mxg-diagnostics-kiosk.service mxg-edge-control.service 2>/dev/null || true
for component in backend contracts frontend scripts systemd; do
  rm -rf "$INSTALL_DIR/$component"
  cp -a "$SOURCE_DIR/$component" "$INSTALL_DIR/$component"
done
install -m 0644 "$SOURCE_DIR/requirements.txt" "$INSTALL_DIR/requirements.txt"
if [ -f "$SOURCE_DIR/VERSION" ]; then
  install -m 0644 "$SOURCE_DIR/VERSION" "$INSTALL_DIR/VERSION"
fi

if [ "$OLD_REQUIREMENTS" != "$NEW_REQUIREMENTS" ]; then
  "$INSTALL_DIR/venv/bin/pip" install --disable-pip-version-check --no-cache-dir -r "$INSTALL_DIR/requirements.txt"
fi

chown -R root:root "$INSTALL_DIR"
install -m 0644 "$INSTALL_DIR/systemd/mxg-diagnostics-kiosk.service" /etc/systemd/system/mxg-diagnostics-kiosk.service
install -m 0644 "$INSTALL_DIR/systemd/mxg-edge-control.service" /etc/systemd/system/mxg-edge-control.service
install -m 0644 "$INSTALL_DIR/systemd/mxg-bluetooth-sdp.service" /etc/systemd/system/mxg-bluetooth-sdp.service
install -d -m 0755 /etc/systemd/system/bluetooth.service.d
install -m 0644 "$INSTALL_DIR/systemd/mxg-bluetooth-compat.conf" /etc/systemd/system/bluetooth.service.d/mxg-compat.conf
if [ -n "$KIOSK_USER" ] && [ -d "/home/$KIOSK_USER" ]; then
  install -d -m 0755 "/home/$KIOSK_USER/.config/autostart"
  install -m 0644 "$INSTALL_DIR/systemd/mxg-diagnostics-kiosk.desktop" "/home/$KIOSK_USER/.config/autostart/mxg-diagnostics-kiosk.desktop"
  chown -R "$KIOSK_USER:$KIOSK_USER" "/home/$KIOSK_USER/.config"
fi
chmod +x "$INSTALL_DIR/scripts/configure-appliance.sh"
"$INSTALL_DIR/scripts/configure-appliance.sh" "$INSTALL_DIR" "$KIOSK_USER"

systemctl daemon-reload
systemctl enable bluetooth.service
systemctl restart bluetooth.service
systemctl enable mxg-edge-control.service mxg-bluetooth-sdp.service mxg-diagnostics-kiosk.service
systemctl restart mxg-edge-control.service
systemctl restart mxg-bluetooth-sdp.service
systemctl restart mxg-diagnostics-kiosk.service

echo "MXG diagnostics kiosk updated to $(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo unknown)"
