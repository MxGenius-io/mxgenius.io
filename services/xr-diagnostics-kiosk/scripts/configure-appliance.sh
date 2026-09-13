#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${1:-/opt/mxg-diagnostics-kiosk}"
KIOSK_USER="${2:-$(getent passwd 1000 | cut -d: -f1)}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run appliance configuration as root." >&2
  exit 1
fi

if [ -n "$KIOSK_USER" ] && command -v raspi-config >/dev/null 2>&1; then
  SUDO_USER="$KIOSK_USER" raspi-config nonint do_boot_behaviour B4
fi

# The branded boot experience is owned by the local web application. An
# additional firmware/initramfs splash introduced a second display owner and
# left some HDMI sinks black after the KMS/Wayland handoff.
BOOT_CMDLINE=""
for candidate in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
  if [ -f "$candidate" ]; then BOOT_CMDLINE="$candidate"; break; fi
done
if [ -n "$BOOT_CMDLINE" ]; then
  read -r -a boot_tokens < "$BOOT_CMDLINE"
  kept_tokens=()
  for token in "${boot_tokens[@]}"; do
    case "$token" in
      splash|fullscreen_logo=*|fullscreen_logo_name=*) ;;
      *) kept_tokens+=("$token") ;;
    esac
  done
  printf '%s\n' "${kept_tokens[*]}" > "$BOOT_CMDLINE"
fi

# Keep normal DHCP on wired networks while also assigning an RFC 3927 address.
# This makes direct-cable SSH and mDNS recovery available when no DHCP server is
# present, without taking a second interface or changing the default route.
if command -v nmcli >/dev/null 2>&1; then
  install -d -m 0755 /etc/NetworkManager/conf.d
  cat > /etc/NetworkManager/conf.d/90-mxgenius-wired-recovery.conf <<'EOF'
[connection-mxgenius-wired-recovery]
match-device=type:ethernet
ipv4.link-local=enabled
ipv4.may-fail=true
EOF
  nmcli general reload >/dev/null 2>&1 || true
fi

# The Pi remains a normal Raspberry Pi OS installation. Device-mode support is
# a permanent hardware capability; package content is selected later by the
# running agent and never by changing the boot target.
MODEL="${MXG_APPLIANCE_MODEL:-$(tr -d '\0' </proc/device-tree/model 2>/dev/null || true)}"
BOOT_CONFIG=""
for candidate in /boot/firmware/config.txt /boot/config.txt; do
  if [ -f "$candidate" ]; then BOOT_CONFIG="$candidate"; break; fi
done
if [[ "$MODEL" == *"Raspberry Pi 5"* ]] && [ -n "$BOOT_CONFIG" ]; then
  if ! grep -q '^# BEGIN MXGENIUS USB GADGET$' "$BOOT_CONFIG"; then
    cat >> "$BOOT_CONFIG" <<'EOF'

# BEGIN MXGENIUS USB GADGET
[pi5]
dtoverlay=dwc2,dr_mode=peripheral
[all]
# END MXGENIUS USB GADGET
EOF
    echo "USB device mode configured; one normal reboot is required before first use."
  fi
  printf 'dwc2\nlibcomposite\n' > /etc/modules-load.d/mxgenius-usb-gadget.conf
fi
