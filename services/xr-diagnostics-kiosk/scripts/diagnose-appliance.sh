#!/usr/bin/env bash
set -u

failure=0
warn() { printf 'WARN  %s\n' "$1"; }
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failure=1; }

printf 'MXGenius Pi appliance diagnostic\n'
printf 'Version: %s\n' "$(cat /opt/mxg-diagnostics-kiosk/VERSION 2>/dev/null || printf 'not installed')"
printf 'Model: %s\n' "$(tr -d '\0' </proc/device-tree/model 2>/dev/null || uname -m)"

cmdline_path=/boot/firmware/cmdline.txt
[ -f "$cmdline_path" ] || cmdline_path=/boot/cmdline.txt
if [ -f "$cmdline_path" ]; then
  cmdline="$(cat "$cmdline_path")"
  if [[ "$cmdline" == *systemd.run=* || "$cmdline" == *systemd.unit=kernel-command-line.target* ]]; then
    fail 'obsolete one-shot boot arguments are still present'
  else
    pass 'normal Raspberry Pi OS boot target'
  fi
else
  warn 'boot command line was not readable'
fi

for service in NetworkManager.service avahi-daemon.service ssh.service mxg-edge-control.service mxg-bluetooth-sdp.service mxg-diagnostics-kiosk.service mxg-boot-status.service; do
  if systemctl is-active --quiet "$service"; then
    pass "$service active"
  else
    fail "$service inactive"
  fi
done

if [ -f /etc/NetworkManager/conf.d/90-mxgenius-wired-recovery.conf ] &&
   grep -q '^ipv4.link-local=enabled$' /etc/NetworkManager/conf.d/90-mxgenius-wired-recovery.conf; then
  pass 'wired DHCP plus link-local recovery configured'
else
  fail 'wired link-local recovery configuration missing'
fi
if command -v nmcli >/dev/null 2>&1; then
  printf 'INFO  Wi-Fi radio=%s\n' "$(nmcli radio wifi 2>/dev/null || printf unavailable)"
  nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null |
    awk -F: '$2 == "wifi" || $2 == "ethernet" { printf "INFO  network device=%s type=%s state=%s\n", $1, $2, $3 }'
else
  fail 'NetworkManager CLI missing'
fi

identity=/boot/firmware/mxg-device-identity.json
[ -f "$identity" ] || identity=/boot/mxg-device-identity.json
if [ -s "$identity" ]; then
  if /usr/bin/python3 - "$identity" <<'PY'
import json, re, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    value = json.load(handle)
assert value.get("schemaVersion") == 1
assert re.fullmatch(r"mxg-pi-[0-9a-f]{32}", str(value.get("hardwareId") or ""))
PY
  then pass 'baked hardware identity valid'; else fail 'baked hardware identity invalid'; fi
else
  fail 'baked hardware identity missing'
fi

if /usr/bin/python3 <<'PY'
import json, urllib.request
health = json.load(urllib.request.urlopen("http://127.0.0.1:8844/api/v1/health", timeout=3))
assert health.get("status") == "ok"
print("PASS  local HTTP health version=" + str(health.get("version") or "unknown"))
pack = json.load(urllib.request.urlopen("http://127.0.0.1:8844/api/v1/equipment-pack/status", timeout=3))
print("INFO  equipment-pack phase=" + str(pack.get("phase") or "unknown")
      + " enrolled=" + str(bool(pack.get("enrolled"))).lower()
      + " generation=" + str(pack.get("activeGeneration") or 0))
PY
then :; else fail 'local HTTP health unavailable'; fi

if grep -q '^dtoverlay=dwc2,dr_mode=peripheral$' /boot/firmware/config.txt /boot/config.txt 2>/dev/null; then
  pass 'Pi 5 USB peripheral overlay configured'
else
  warn 'USB peripheral overlay not found'
fi
if [ -d /sys/kernel/config/usb_gadget ]; then pass 'ConfigFS gadget surface mounted'; else fail 'ConfigFS gadget surface missing'; fi
if compgen -G '/sys/class/udc/*' >/dev/null; then
  printf 'PASS  USB device controller: %s\n' "$(basename "$(find /sys/class/udc -mindepth 1 -maxdepth 1 -print -quit)")"
else
  warn 'USB device controller not exposed; reboot after enabling the overlay'
fi

if [ -r /sys/kernel/config/usb_gadget/mxgenius/UDC ]; then
  bound="$(cat /sys/kernel/config/usb_gadget/mxgenius/UDC)"
  if [ -n "$bound" ]; then pass "Equipment Pack gadget bound to $bound"; else warn 'Equipment Pack gadget is not bound'; fi
else
  warn 'no Equipment Pack has been activated yet'
fi

exit "$failure"
