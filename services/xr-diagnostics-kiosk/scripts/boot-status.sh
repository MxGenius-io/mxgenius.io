#!/usr/bin/env bash
set -euo pipefail

STATE_DIR=/var/lib/mxg-diagnostics-kiosk
STATE_FILE="$STATE_DIR/boot-status.txt"
BOOT_FILE=""
for candidate in /boot/firmware /boot; do
  if [ -d "$candidate" ]; then
    BOOT_FILE="$candidate/mxg-boot-status.txt"
    break
  fi
done

install -d -m 0700 "$STATE_DIR"
last_hash=""

safe_value() {
  printf '%s' "$1" | tr -cd 'A-Za-z0-9._:/ -'
}

service_state() {
  systemctl is-active "$1" 2>/dev/null || true
}

write_status() {
  local kiosk control network health stage ipv4 hostname version boot_id wifi_radio wifi_state ethernet_state body next hash
  kiosk="$(service_state mxg-diagnostics-kiosk.service)"
  control="$(service_state mxg-edge-control.service)"
  network="$(service_state NetworkManager.service)"
  if curl --fail --silent --max-time 2 http://127.0.0.1:8844/api/v1/health >/dev/null 2>&1; then
    health=ready
  else
    health=unavailable
  fi
  if [ "$kiosk" = active ] && [ "$control" = active ] && [ "$health" = ready ]; then
    stage=ready
  elif [ "$kiosk" = failed ] || [ "$control" = failed ]; then
    stage=service-failed
  else
    stage=starting
  fi
  ipv4="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | paste -sd, - || true)"
  wifi_radio="$(nmcli radio wifi 2>/dev/null || echo unavailable)"
  wifi_state="$(nmcli -t -f TYPE,STATE device status 2>/dev/null | awk -F: '$1 == "wifi" { print $2; exit }')"
  ethernet_state="$(nmcli -t -f TYPE,STATE device status 2>/dev/null | awk -F: '$1 == "ethernet" { print $2; exit }')"
  hostname="$(hostname 2>/dev/null || echo unknown)"
  version="$(cat /opt/mxg-diagnostics-kiosk/VERSION 2>/dev/null || echo unknown)"
  boot_id="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown)"
  body="schemaVersion=1
stage=$(safe_value "$stage")
version=$(safe_value "$version")
hostname=$(safe_value "$hostname")
ipv4=$(safe_value "${ipv4:-unassigned}")
kioskService=$(safe_value "${kiosk:-unknown}")
controlService=$(safe_value "${control:-unknown}")
networkManagerService=$(safe_value "${network:-unknown}")
localHealth=$(safe_value "$health")
wifiRadio=$(safe_value "${wifi_radio:-unavailable}")
wifiState=$(safe_value "${wifi_state:-not-detected}")
ethernetState=$(safe_value "${ethernet_state:-not-detected}")
bootId=$(safe_value "$boot_id")"
  hash="$(printf '%s\n' "$body" | sha256sum | cut -d' ' -f1)"
  [ "$hash" = "$last_hash" ] && return
  next="$STATE_FILE.next"
  printf '%s\n' "$body" >"$next"
  chmod 0600 "$next"
  mv -f "$next" "$STATE_FILE"
  if [ -n "$BOOT_FILE" ] && [ -w "$(dirname "$BOOT_FILE")" ]; then
    cp "$STATE_FILE" "$BOOT_FILE.next"
    sync "$BOOT_FILE.next" || true
    mv -f "$BOOT_FILE.next" "$BOOT_FILE"
  fi
  last_hash="$hash"
}

while true; do
  write_status
  sleep 10
done
