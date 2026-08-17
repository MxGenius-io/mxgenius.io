#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${1:-/opt/mxg-diagnostics-kiosk}"
KIOSK_USER="${2:-$(getent passwd 1000 | cut -d: -f1)}"
LOGO="$INSTALL_DIR/frontend/assets/mxgenius-logo.png"
STATE_DIR=/var/lib/mxg-diagnostics-kiosk
SPLASH_TGA="$STATE_DIR/mxgenius-splash.tga"
SPLASH_HASH="$STATE_DIR/splash.sha256"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run appliance configuration as root." >&2
  exit 1
fi

if [ -n "$KIOSK_USER" ] && command -v raspi-config >/dev/null 2>&1; then
  SUDO_USER="$KIOSK_USER" raspi-config nonint do_boot_behaviour B4
fi

if [ ! -f "$LOGO" ]; then
  echo "MxGenius splash logo is missing: $LOGO" >&2
  exit 1
fi

install -d -m 0755 "$STATE_DIR"
CURRENT_HASH="$(sha256sum "$LOGO" | cut -d' ' -f1)"
PREVIOUS_HASH="$(cat "$SPLASH_HASH" 2>/dev/null || true)"
if [ "$CURRENT_HASH" = "$PREVIOUS_HASH" ]; then
  exit 0
fi

if command -v convert >/dev/null 2>&1; then
  convert "$LOGO" -resize '1080x1080>' -background '#000000' -alpha remove -colors 224 -depth 8 -type TrueColor -compress none -define tga:bits-per-sample=8 "$SPLASH_TGA"
elif command -v magick >/dev/null 2>&1; then
  magick "$LOGO" -resize '1080x1080>' -background '#000000' -alpha remove -colors 224 -depth 8 -type TrueColor -compress none -define tga:bits-per-sample=8 "$SPLASH_TGA"
else
  echo "ImageMagick is unavailable; early splash was not configured." >&2
  exit 0
fi

if command -v configure-splash >/dev/null 2>&1; then
  configure-splash "$SPLASH_TGA"
  printf '%s\n' "$CURRENT_HASH" > "$SPLASH_HASH"
else
  echo "rpi-splash-screen-support is unavailable; early splash was not configured." >&2
fi
