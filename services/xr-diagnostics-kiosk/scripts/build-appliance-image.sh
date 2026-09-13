#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: build-appliance-image.sh --base IMAGE.xz --release RELEASE_DIR \
  --output OUTPUT.img.xz --hardware-id mxg-pi-<32 hex> --ssh-public-key KEY.pub \
  [--hostname HOSTNAME] [--network-config FILE]
EOF
}

BASE=""
RELEASE=""
OUTPUT=""
HARDWARE_ID=""
SSH_PUBLIC_KEY=""
HOSTNAME=mxgenius-pi-01
NETWORK_CONFIG=""
EXPECTED_SHA256=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --hardware-id) HARDWARE_ID="$2"; shift 2 ;;
    --ssh-public-key) SSH_PUBLIC_KEY="$2"; shift 2 ;;
    --hostname) HOSTNAME="$2"; shift 2 ;;
    --network-config) NETWORK_CONFIG="$2"; shift 2 ;;
    --expected-sha256) EXPECTED_SHA256="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run the image builder as root inside WSL." >&2
  exit 1
fi
for required in BASE RELEASE OUTPUT HARDWARE_ID SSH_PUBLIC_KEY EXPECTED_SHA256; do
  if [ -z "${!required}" ]; then echo "Missing --$(tr '_' '-' <<<"$required" | tr '[:upper:]' '[:lower:]')" >&2; exit 2; fi
done
if [ ! -f "$BASE" ] || [ ! -d "$RELEASE" ] || [ ! -f "$SSH_PUBLIC_KEY" ]; then
  echo "The base image, release directory, or SSH public key is missing." >&2
  exit 2
fi
if [[ ! "$HARDWARE_ID" =~ ^mxg-pi-[0-9a-f]{32}$ ]]; then
  echo "Hardware ID must match mxg-pi-<32 lowercase hexadecimal characters>." >&2
  exit 2
fi
if [[ ! "$HOSTNAME" =~ ^[a-z][a-z0-9-]{0,62}$ ]]; then
  echo "Hostname is invalid." >&2
  exit 2
fi
if [ -n "$NETWORK_CONFIG" ] && [ ! -f "$NETWORK_CONFIG" ]; then
  echo "Network configuration file is missing: $NETWORK_CONFIG" >&2
  exit 2
fi
if [ ! -f "$RELEASE/VERSION" ] || [ ! -x "$RELEASE/install.sh" ]; then
  echo "Release directory is not an executable MXG release payload." >&2
  exit 2
fi
if ! head -c 256 "$SSH_PUBLIC_KEY" | grep -Eq '^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+'; then
  echo "SSH public key is invalid." >&2
  exit 2
fi

actual_sha256="$(sha256sum "$BASE" | cut -d' ' -f1)"
if [ "$actual_sha256" != "$EXPECTED_SHA256" ]; then
  echo "Base image checksum mismatch: expected $EXPECTED_SHA256, got $actual_sha256" >&2
  exit 1
fi

VERSION="$(tr -d '\r\n' <"$RELEASE/VERSION")"
WORK_DIR="$(mktemp -d /var/tmp/mxg-image-build.XXXXXX)"
RAW_IMAGE="$WORK_DIR/mxgenius.img"
ROOT_MOUNT="$WORK_DIR/root"
LOOP_DEVICE=""
MOUNTS=()

cleanup() {
  set +e
  for ((i=${#MOUNTS[@]}-1; i>=0; i--)); do mountpoint -q "${MOUNTS[$i]}" && umount --recursive --lazy "${MOUNTS[$i]}"; done
  [ -n "$LOOP_DEVICE" ] && losetup "$LOOP_DEVICE" >/dev/null 2>&1 && losetup -d "$LOOP_DEVICE"
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

echo "[1/8] Expanding pinned Raspberry Pi OS image..."
xz --decompress --stdout "$BASE" >"$RAW_IMAGE"

echo "[2/8] Attaching image partitions..."
LOOP_DEVICE="$(losetup --find --show --partscan "$RAW_IMAGE")"
for attempt in $(seq 1 50); do
  [ -b "${LOOP_DEVICE}p1" ] && [ -b "${LOOP_DEVICE}p2" ] && break
  sleep 0.1
done
[ -b "${LOOP_DEVICE}p1" ] && [ -b "${LOOP_DEVICE}p2" ] || { echo "Image partitions were not discovered." >&2; exit 1; }

mkdir -p "$ROOT_MOUNT"
mount "${LOOP_DEVICE}p2" "$ROOT_MOUNT"
MOUNTS+=("$ROOT_MOUNT")
mkdir -p "$ROOT_MOUNT/boot/firmware"
mount "${LOOP_DEVICE}p1" "$ROOT_MOUNT/boot/firmware"
MOUNTS+=("$ROOT_MOUNT/boot/firmware")

echo "[3/8] Installing device identity and operator access..."
printf '%s\n' "$HOSTNAME" >"$ROOT_MOUNT/etc/hostname"
if grep -q '^127\.0\.1\.1' "$ROOT_MOUNT/etc/hosts"; then
  sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$HOSTNAME/" "$ROOT_MOUNT/etc/hosts"
else
  printf '127.0.1.1\t%s\n' "$HOSTNAME" >>"$ROOT_MOUNT/etc/hosts"
fi
cat >"$ROOT_MOUNT/boot/firmware/mxg-device-identity.json" <<EOF
{
  "schemaVersion": 1,
  "hardwareId": "$HARDWARE_ID",
  "displayName": "MXG Pi 01",
  "issuedAtUtc": "$(date -u +%FT%TZ)",
  "source": "local-golden-image"
}
EOF
if [ -n "$NETWORK_CONFIG" ]; then
  install -m 0600 "$NETWORK_CONFIG" "$ROOT_MOUNT/boot/firmware/network-config"
fi
touch "$ROOT_MOUNT/boot/firmware/ssh"

for path in dev proc sys run; do mkdir -p "$ROOT_MOUNT/$path"; done
mount --rbind /dev "$ROOT_MOUNT/dev"; mount --make-rslave "$ROOT_MOUNT/dev"; MOUNTS+=("$ROOT_MOUNT/dev")
mount -t proc proc "$ROOT_MOUNT/proc"; MOUNTS+=("$ROOT_MOUNT/proc")
mount --rbind /sys "$ROOT_MOUNT/sys"; mount --make-rslave "$ROOT_MOUNT/sys"; MOUNTS+=("$ROOT_MOUNT/sys")
mount --rbind /run "$ROOT_MOUNT/run"; mount --make-rslave "$ROOT_MOUNT/run"; MOUNTS+=("$ROOT_MOUNT/run")
RESOLV_LINK=""
if [ -L "$ROOT_MOUNT/etc/resolv.conf" ]; then
  RESOLV_LINK="$(readlink "$ROOT_MOUNT/etc/resolv.conf")"
  rm -f "$ROOT_MOUNT/etc/resolv.conf"
else
  cp -a "$ROOT_MOUNT/etc/resolv.conf" "$ROOT_MOUNT/etc/resolv.conf.mxg-original" 2>/dev/null || true
fi
cp -L /etc/resolv.conf "$ROOT_MOUNT/etc/resolv.conf"

install -d -m 0755 "$ROOT_MOUNT/tmp/mxg-release"
rsync -a --delete "$RELEASE/" "$ROOT_MOUNT/tmp/mxg-release/"
cat >"$ROOT_MOUNT/usr/sbin/policy-rc.d" <<'EOF'
#!/bin/sh
exit 101
EOF
chmod 0755 "$ROOT_MOUNT/usr/sbin/policy-rc.d"

echo "[4/8] Creating the locked local operator account..."
chroot "$ROOT_MOUNT" /bin/bash -euxo pipefail <<'CHROOT'
existing_user="$(getent passwd 1000 | cut -d: -f1)"
if id mxgenius >/dev/null 2>&1; then
  [ "$(id -u mxgenius)" = 1000 ] || { echo "mxgenius exists with an unexpected UID" >&2; exit 1; }
elif [ -n "$existing_user" ]; then
  existing_group="$(id -gn "$existing_user")"
  usermod --login mxgenius --home /home/mxgenius --move-home --shell /bin/bash "$existing_user"
  if [ "$existing_group" = "$existing_user" ] && ! getent group mxgenius >/dev/null 2>&1; then
    groupmod --new-name mxgenius "$existing_group"
    usermod --gid mxgenius mxgenius
  fi
else
  useradd --create-home --shell /bin/bash --uid 1000 --user-group mxgenius
fi
for group in adm sudo audio video render plugdev input netdev dialout bluetooth; do
  getent group "$group" >/dev/null 2>&1 && usermod -a -G "$group" mxgenius
done
passwd --lock mxgenius
install -d -m 0755 /etc/sudoers.d
printf 'mxgenius ALL=(ALL) NOPASSWD: ALL\n' >/etc/sudoers.d/90-mxgenius-local-admin
chmod 0440 /etc/sudoers.d/90-mxgenius-local-admin
CHROOT
install -d -m 0700 "$ROOT_MOUNT/home/mxgenius/.ssh"
install -m 0600 "$SSH_PUBLIC_KEY" "$ROOT_MOUNT/home/mxgenius/.ssh/authorized_keys"
chown -R 1000:1000 "$ROOT_MOUNT/home/mxgenius/.ssh"

echo "[5/8] Installing the complete MXG runtime into the image..."
chroot "$ROOT_MOUNT" /usr/bin/env \
  DEBIAN_FRONTEND=noninteractive \
  MXG_IMAGE_BUILD=1 \
  MXG_APPLIANCE_MODEL='Raspberry Pi 5' \
  MXG_KIOSK_USER=mxgenius \
  /tmp/mxg-release/install.sh /tmp/mxg-release

echo "[6/8] Hardening and sealing first boot..."
cat >"$ROOT_MOUNT/etc/ssh/sshd_config.d/20-mxgenius-appliance.conf" <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
EOF
chroot "$ROOT_MOUNT" systemctl enable ssh.service avahi-daemon.service NetworkManager.service
rm -f "$ROOT_MOUNT/usr/sbin/policy-rc.d" "$ROOT_MOUNT/etc/resolv.conf"
if [ -n "$RESOLV_LINK" ]; then
  ln -s "$RESOLV_LINK" "$ROOT_MOUNT/etc/resolv.conf"
elif [ -f "$ROOT_MOUNT/etc/resolv.conf.mxg-original" ]; then
  mv "$ROOT_MOUNT/etc/resolv.conf.mxg-original" "$ROOT_MOUNT/etc/resolv.conf"
fi
rm -rf "$ROOT_MOUNT/tmp/mxg-release" "$ROOT_MOUNT/var/lib/apt/lists"/* "$ROOT_MOUNT/var/cache/apt/archives"/*.deb
printf '%s\n' "$VERSION" >"$ROOT_MOUNT/boot/firmware/mxg-image-version.txt"
sync

echo "[7/8] Checking both filesystems..."
for ((i=${#MOUNTS[@]}-1; i>=0; i--)); do
  mountpoint -q "${MOUNTS[$i]}" && umount --recursive "${MOUNTS[$i]}"
done
MOUNTS=()
losetup -d "$LOOP_DEVICE"
LOOP_DEVICE=""
sync
sleep 1
LOOP_DEVICE="$(losetup --find --show --partscan "$RAW_IMAGE")"
for attempt in $(seq 1 50); do
  [ -b "${LOOP_DEVICE}p1" ] && [ -b "${LOOP_DEVICE}p2" ] && break
  sleep 0.1
done
repair_exit=0
e2fsck -pf "${LOOP_DEVICE}p2" || repair_exit=$?
[ "$repair_exit" -le 1 ] || exit "$repair_exit"
repair_exit=0
fsck.vfat -a "${LOOP_DEVICE}p1" || repair_exit=$?
[ "$repair_exit" -le 1 ] || exit "$repair_exit"
losetup -d "$LOOP_DEVICE"
LOOP_DEVICE=""
sync
sleep 1
LOOP_DEVICE="$(losetup --find --show --partscan --read-only "$RAW_IMAGE")"
for attempt in $(seq 1 50); do
  [ -b "${LOOP_DEVICE}p1" ] && [ -b "${LOOP_DEVICE}p2" ] && break
  sleep 0.1
done
e2fsck -fn "${LOOP_DEVICE}p2"
fsck.vfat -n "${LOOP_DEVICE}p1"
losetup -d "$LOOP_DEVICE"
LOOP_DEVICE=""

echo "[8/8] Compressing and checksumming final appliance image..."
mkdir -p "$(dirname "$OUTPUT")"
OUTPUT_NEXT="$OUTPUT.next"
xz -T0 -6 --check=crc64 --stdout "$RAW_IMAGE" >"$OUTPUT_NEXT"
mv -f "$OUTPUT_NEXT" "$OUTPUT"
OUTPUT_SHA256="$(sha256sum "$OUTPUT" | cut -d' ' -f1)"
cat >"$OUTPUT.sha256" <<EOF
$OUTPUT_SHA256  $(basename "$OUTPUT")
EOF
cat >"$OUTPUT.json" <<EOF
{
  "schemaVersion": 1,
  "version": "$VERSION",
  "hardwareId": "$HARDWARE_ID",
  "hostname": "$HOSTNAME",
  "baseImageSha256": "$EXPECTED_SHA256",
  "imageSha256": "$OUTPUT_SHA256",
  "builtAtUtc": "$(date -u +%FT%TZ)"
}
EOF
echo "Built $OUTPUT"
echo "SHA-256 $OUTPUT_SHA256"
