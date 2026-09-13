#!/usr/bin/env bash
set -u

APP_URL="${MXG_KIOSK_URL:-http://127.0.0.1:8844/}"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/mxgenius"
LOG_FILE="$LOG_DIR/kiosk-launch.log"
mkdir -p "$LOG_DIR"

while true; do
  if curl --fail --silent --show-error --max-time 2 "$APP_URL" >/dev/null 2>&1; then
    chromium \
      --kiosk \
      --noerrdialogs \
      --disable-infobars \
      --disable-session-crashed-bubble \
      --no-first-run \
      --no-default-browser-check \
      --password-store=basic \
      --app="$APP_URL" >>"$LOG_FILE" 2>&1
  else
    printf '%s Waiting for %s\n' "$(date -u +%FT%TZ)" "$APP_URL" >>"$LOG_FILE"
    sleep 2
  fi
  sleep 2
done
