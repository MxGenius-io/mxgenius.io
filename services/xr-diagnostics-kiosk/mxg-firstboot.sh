#!/usr/bin/env bash
set -euo pipefail

LOG=/var/log/mxg-diagnostics-firstboot.log
exec > >(tee -a "$LOG") 2>&1

BOOT_DIR=/boot/firmware
[ -d "$BOOT_DIR/mxg-diagnostics-kiosk" ] || BOOT_DIR=/boot
PAYLOAD="$BOOT_DIR/mxg-diagnostics-kiosk"
STATUS_FILE="$BOOT_DIR/mxg-firstboot.status"

write_status() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" > "$STATUS_FILE"
}
trap 'write_status failed' ERR
write_status starting

if [ ! -x "$PAYLOAD/install.sh" ]; then
  chmod +x "$PAYLOAD/install.sh"
fi

for attempt in $(seq 1 60); do
  if getent passwd 1000 >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! getent passwd 1000 >/dev/null 2>&1; then
  echo "No provisioned desktop user with UID 1000 appeared during first boot." >&2
  exit 1
fi

for attempt in $(seq 1 30); do
  if getent hosts pypi.org >/dev/null 2>&1; then break; fi
  sleep 2
done

write_status installing
"$PAYLOAD/install.sh" "$PAYLOAD"

sed -i 's| systemd.run=/boot/firmware/mxg-firstboot.sh||g; s| systemd.run=/boot/mxg-firstboot.sh||g; s| systemd.run_success_action=reboot||g' "$BOOT_DIR/cmdline.txt"
rm -f "$BOOT_DIR/mxg-firstboot.sh"
trap - ERR
write_status installed
sync
reboot
