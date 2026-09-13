"""Allow-listed root control plane for local Pi networking and power actions."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import socketserver
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any


SOCKET_PATH = Path(os.getenv("MXG_CONTROL_SOCKET", "/run/mxg-edge-control/control.sock"))
MAC_ADDRESS = re.compile(r"^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")
MAX_REQUEST_BYTES = 16 * 1024
CONFIGFS_GADGET_ROOT = Path("/sys/kernel/config/usb_gadget")
UDC_ROOT = Path("/sys/class/udc")
STATE_ROOT = Path(os.getenv("MXG_EDGE_STATE_DIR", "/var/lib/mxg-diagnostics-kiosk"))
SLOTS_ROOT = STATE_ROOT / "slots"
USB_IMAGES_ROOT = STATE_ROOT / "usb-images"
USB_GADGET_STATE = STATE_ROOT / "usb-gadget.json"
USB_GADGET_NAME = "mxgenius"
USB_IMAGE_MIN_BYTES = 128 * 1024 * 1024
USB_IMAGE_MAX_BYTES = 3 * 1024 * 1024 * 1024


def _run(command: list[str], timeout: int = 40) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)


def _split_escaped(value: str, separator: str = ":") -> list[str]:
    fields: list[str] = []
    current: list[str] = []
    escaped = False
    for character in value:
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == separator:
            fields.append("".join(current))
            current = []
        else:
            current.append(character)
    current.append("\\" if escaped else "")
    fields.append("".join(current))
    return fields


def _wifi_devices() -> tuple[list[dict[str, str]], str]:
    result = _run([
        "nmcli", "--terse", "--escape", "yes", "--fields", "DEVICE,TYPE,STATE",
        "device", "status",
    ], timeout=10)
    if result.returncode:
        return [], result.stderr.strip() or result.stdout.strip() or "NetworkManager could not inspect Wi-Fi adapters"

    devices: list[dict[str, str]] = []
    for line in result.stdout.splitlines():
        fields = _split_escaped(line)
        if len(fields) < 3 or fields[1] not in {"wifi", "802-11-wireless"}:
            continue
        devices.append({"device": fields[0], "state": fields[2].lower()})
    return devices, ""


def wifi_scan() -> dict[str, Any]:
    radio = _run(["nmcli", "radio", "wifi"], timeout=8)
    if radio.returncode:
        return {"ok": False, "error": radio.stderr.strip() or radio.stdout.strip() or "NetworkManager could not inspect the Wi-Fi radio"}

    if radio.stdout.strip().lower() != "enabled":
        enabled = _run(["nmcli", "radio", "wifi", "on"], timeout=10)
        if enabled.returncode:
            return {"ok": False, "error": enabled.stderr.strip() or enabled.stdout.strip() or "Wi-Fi could not be enabled"}
        time.sleep(0.75)

    devices, device_error = _wifi_devices()
    if device_error:
        return {"ok": False, "error": device_error}
    if not devices:
        return {"ok": False, "error": "No Wi-Fi adapter was detected"}

    state_order = {"connected": 0, "connecting": 1, "disconnected": 2, "unavailable": 3, "unmanaged": 4}
    adapter = min(devices, key=lambda item: state_order.get(item["state"], 5))
    device = adapter["device"]
    if adapter["state"] in {"unavailable", "unmanaged"}:
        managed = _run(["nmcli", "device", "set", device, "managed", "yes"], timeout=10)
        if managed.returncode:
            return {"ok": False, "error": managed.stderr.strip() or managed.stdout.strip() or f"Wi-Fi adapter {device} could not be managed"}
        for _ in range(4):
            time.sleep(0.75)
            refreshed, refresh_error = _wifi_devices()
            if refresh_error:
                return {"ok": False, "error": refresh_error}
            observed = next((item for item in refreshed if item["device"] == device), None)
            if observed is None:
                return {"ok": False, "error": f"Wi-Fi adapter {device} disappeared while being enabled"}
            adapter = observed
            if adapter["state"] not in {"unavailable", "unmanaged"}:
                break
        if adapter["state"] in {"unavailable", "unmanaged"}:
            return {"ok": False, "error": f"Wi-Fi adapter {device} remains {adapter['state']} after being enabled"}

    rescan = _run(["nmcli", "--wait", "12", "device", "wifi", "rescan", "ifname", device], timeout=18)
    result = _run([
        "nmcli", "--terse", "--escape", "yes", "--fields", "IN-USE,SSID,SIGNAL,SECURITY",
        "device", "wifi", "list", "ifname", device, "--rescan", "no",
    ], timeout=15)
    if result.returncode:
        error = result.stderr.strip() or result.stdout.strip()
        if not error and rescan.returncode:
            error = rescan.stderr.strip() or rescan.stdout.strip()
        return {"ok": False, "error": error or f"Wi-Fi scan failed on {device}"}
    networks: dict[str, dict[str, Any]] = {}
    for line in result.stdout.splitlines():
        fields = _split_escaped(line)
        if len(fields) < 4 or not fields[1]:
            continue
        active, ssid, signal, security = fields[:4]
        try:
            signal_strength = int(signal or 0)
        except ValueError:
            signal_strength = 0
        candidate = {
            "ssid": ssid,
            "signal": signal_strength,
            "security": security or "Open",
            "active": active == "*",
        }
        previous = networks.get(ssid)
        if previous is None or candidate["signal"] > previous["signal"]:
            networks[ssid] = candidate
    if rescan.returncode and not networks:
        return {
            "ok": False,
            "error": rescan.stderr.strip() or rescan.stdout.strip() or f"Wi-Fi rescan failed on {device}",
        }
    response: dict[str, Any] = {
        "ok": True,
        "device": device,
        "adapterState": adapter["state"],
        "networks": sorted(networks.values(), key=lambda item: (not item["active"], -item["signal"], item["ssid"].lower())),
    }
    if rescan.returncode:
        response["scanWarning"] = rescan.stderr.strip() or rescan.stdout.strip() or "Fresh scan unavailable; showing cached results"
    return response


def wifi_connect(payload: dict[str, Any]) -> dict[str, Any]:
    ssid = str(payload.get("ssid") or "").strip()
    password = str(payload.get("password") or "")
    if not ssid or len(ssid.encode("utf-8")) > 32:
        return {"ok": False, "error": "A valid Wi-Fi network name is required"}
    if len(password) > 256:
        return {"ok": False, "error": "Wi-Fi credential is too long"}
    command = ["nmcli", "--wait", "35", "device", "wifi", "connect", ssid]
    if password:
        command.extend(["password", password])
    if payload.get("hidden") is True:
        command.extend(["hidden", "yes"])
    result = _run(command, timeout=45)
    error = result.stderr.strip() or result.stdout.strip() or "Wi-Fi connection failed"
    if result.returncode and password and "key-mgmt" in error.lower() and "missing" in error.lower():
        return _repair_wifi_key_management(ssid, password, payload.get("hidden") is True)
    if result.returncode:
        return {"ok": False, "error": error}
    return {"ok": True, "ssid": ssid, "message": "Wi-Fi connection activated"}


def _repair_wifi_key_management(ssid: str, password: str, hidden: bool) -> dict[str, Any]:
    profiles = _run([
        "nmcli", "--terse", "--escape", "yes", "--fields", "NAME,TYPE",
        "connection", "show",
    ], timeout=10)
    if profiles.returncode:
        return {"ok": False, "error": "NetworkManager could not inspect the saved Wi-Fi profile"}

    profile_name = ""
    for line in profiles.stdout.splitlines():
        fields = _split_escaped(line)
        if len(fields) < 2 or fields[1] not in {"wifi", "802-11-wireless"}:
            continue
        candidate = fields[0]
        observed = _run([
            "nmcli", "--get-values", "802-11-wireless.ssid", "connection", "show", candidate,
        ], timeout=8)
        if not observed.returncode and observed.stdout.strip() == ssid:
            profile_name = candidate
            break

    if not profile_name:
        profile_name = f"mxg-wifi-{hashlib.sha256(ssid.encode('utf-8')).hexdigest()[:10]}"
        created = _run([
            "nmcli", "connection", "add", "type", "wifi", "ifname", "*",
            "con-name", profile_name, "ssid", ssid,
        ], timeout=15)
        if created.returncode:
            return {"ok": False, "error": created.stderr.strip() or "Wi-Fi profile repair failed"}

    modification = [
        "nmcli", "connection", "modify", profile_name,
        "802-11-wireless-security.key-mgmt", "wpa-psk",
        "802-11-wireless-security.psk", password,
        "connection.autoconnect", "yes",
    ]
    if hidden:
        modification.extend(["802-11-wireless.hidden", "yes"])
    repaired = _run(modification, timeout=15)
    if repaired.returncode:
        return {"ok": False, "error": repaired.stderr.strip() or "Wi-Fi security profile repair failed"}

    activated = _run(["nmcli", "--wait", "35", "connection", "up", profile_name], timeout=45)
    if activated.returncode:
        return {"ok": False, "error": activated.stderr.strip() or "Wi-Fi profile could not be activated"}
    return {"ok": True, "ssid": ssid, "message": "Wi-Fi security profile repaired and activated"}


def _bluetooth_info(address: str, name: str) -> dict[str, Any]:
    result = _run(["bluetoothctl", "info", address], timeout=8)
    attributes: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if ":" in line:
            key, value = line.strip().split(":", 1)
            attributes[key] = value.strip()
    return {
        "address": address.upper(),
        "name": attributes.get("Name") or attributes.get("Alias") or name or "Unknown device",
        "paired": attributes.get("Paired") == "yes",
        "trusted": attributes.get("Trusted") == "yes",
        "connected": attributes.get("Connected") == "yes",
        "icon": attributes.get("Icon", "device"),
    }


def bluetooth_scan() -> dict[str, Any]:
    show = _run(["bluetoothctl", "show"], timeout=8)
    if show.returncode:
        return {"ok": False, "error": show.stderr.strip() or "Bluetooth adapter is unavailable"}
    if "Powered: yes" not in show.stdout:
        powered = _run(["bluetoothctl", "power", "on"], timeout=8)
        if powered.returncode:
            return {"ok": False, "error": powered.stderr.strip() or "Bluetooth could not be enabled"}
    _run(["bluetoothctl", "--timeout", "7", "scan", "on"], timeout=12)
    devices = _run(["bluetoothctl", "devices"], timeout=8)
    found: list[dict[str, Any]] = []
    for line in devices.stdout.splitlines():
        match = re.match(r"^Device\s+((?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2})(?:\s+(.*))?$", line.strip())
        if match:
            found.append(_bluetooth_info(match.group(1), match.group(2) or ""))
    found.sort(key=lambda item: (not item["connected"], not item["paired"], item["name"].lower()))
    return {"ok": True, "devices": found}


def bluetooth_action(payload: dict[str, Any]) -> dict[str, Any]:
    address = str(payload.get("address") or "").upper()
    operation = str(payload.get("operation") or "")
    if not MAC_ADDRESS.fullmatch(address):
        return {"ok": False, "error": "A valid Bluetooth address is required"}
    commands = {
        "pair": [["bluetoothctl", "pair", address], ["bluetoothctl", "trust", address], ["bluetoothctl", "connect", address]],
        "connect": [["bluetoothctl", "connect", address]],
        "disconnect": [["bluetoothctl", "disconnect", address]],
        "forget": [["bluetoothctl", "remove", address]],
    }
    if operation not in commands:
        return {"ok": False, "error": "Unsupported Bluetooth operation"}
    for command in commands[operation]:
        result = _run(command, timeout=30)
        if result.returncode:
            return {"ok": False, "error": result.stderr.strip() or result.stdout.strip() or f"Bluetooth {operation} failed"}
    return {"ok": True, "address": address, "operation": operation}


def usb_gadget_status(
    gadget_root: Path = CONFIGFS_GADGET_ROOT,
    udc_root: Path = UDC_ROOT,
) -> dict[str, Any]:
    def directory_names(root: Path) -> list[str]:
        try:
            return sorted(path.name for path in root.iterdir()) if root.is_dir() else []
        except OSError:
            return []

    udcs = directory_names(udc_root)
    gadgets = directory_names(gadget_root)
    controller_states: dict[str, str] = {}
    for controller in udcs:
        try:
            controller_states[controller] = (udc_root / controller / "state").read_text(encoding="utf-8").strip()
        except OSError:
            controller_states[controller] = "unknown"
    tools = {
        "truncate": shutil.which("truncate") is not None,
        "mkfs.vfat": shutil.which("mkfs.vfat") is not None,
        "mount": shutil.which("mount") is not None,
        "mountpoint": shutil.which("mountpoint") is not None,
        "umount": shutil.which("umount") is not None,
        "cp": shutil.which("cp") is not None,
        "sync": shutil.which("sync") is not None,
        "fsck.vfat": shutil.which("fsck.vfat") is not None,
    }
    return {
        "ok": True,
        "supported": bool(udcs) and gadget_root.is_dir(),
        "configfs": gadget_root.is_dir(),
        "udcs": udcs,
        "controllerStates": controller_states,
        "gadgets": gadgets,
        "tools": tools,
        "activationReady": bool(udcs) and gadget_root.is_dir() and all(tools.values()),
    }


def _validated_slot(value: Any) -> str:
    slot = str(value or "").upper()
    if slot not in {"A", "B"}:
        raise ValueError("The Equipment Pack slot must be A or B")
    return slot


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _read_usb_gadget_state(path: Path | None = None) -> dict[str, Any]:
    path = path or USB_GADGET_STATE
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) and payload.get("schemaVersion") == 1 else {}


def _slot_content_size(slot_root: Path) -> int:
    if not slot_root.is_dir():
        raise ValueError("The staged Equipment Pack slot is missing")
    total = 0
    for path in slot_root.rglob("*"):
        if path.is_symlink():
            raise ValueError("The staged Equipment Pack contains a link")
        if path.is_file():
            total += path.stat().st_size
            if total > USB_IMAGE_MAX_BYTES:
                raise ValueError("The staged Equipment Pack is too large for the USB image")
    if total <= 0:
        raise ValueError("The staged Equipment Pack is empty")
    return total


def _run_required(command: list[str], message: str, timeout: int = 300) -> None:
    result = _run(command, timeout=timeout)
    if result.returncode:
        raise RuntimeError(message)


def _build_usb_image(slot: str) -> Path:
    slot_root = SLOTS_ROOT / slot
    content_bytes = _slot_content_size(slot_root)
    overhead = max(32 * 1024 * 1024, content_bytes // 10)
    image_bytes = max(USB_IMAGE_MIN_BYTES, ((content_bytes + overhead + 1048575) // 1048576) * 1048576)
    if image_bytes > USB_IMAGE_MAX_BYTES:
        raise ValueError("The staged Equipment Pack is too large for the USB image")

    USB_IMAGES_ROOT.mkdir(parents=True, exist_ok=True)
    mount_root = STATE_ROOT / "usb-mount"
    mount_root.mkdir(parents=True, exist_ok=True)
    temporary = USB_IMAGES_ROOT / f"slot-{slot}.img.part"
    destination = USB_IMAGES_ROOT / f"slot-{slot}.img"
    temporary.unlink(missing_ok=True)
    mounted = False
    try:
        if _run(["mountpoint", "-q", str(mount_root)], timeout=10).returncode == 0:
            _run_required(["umount", str(mount_root)], "Could not clear the prior USB image mount", timeout=120)
        _run_required(["truncate", "-s", str(image_bytes), str(temporary)], "Could not allocate the USB image")
        _run_required(["mkfs.vfat", "-F", "32", "-n", "MXGENIUS", str(temporary)], "Could not format the USB image")
        _run_required(["mount", "-o", "loop,rw", str(temporary), str(mount_root)], "Could not mount the USB image")
        mounted = True
        _run_required(
            ["cp", "-r", "--no-preserve=mode,ownership,timestamps", f"{slot_root}/.", str(mount_root)],
            "Could not populate the USB image",
            timeout=600,
        )
        _run_required(["sync"], "Could not flush the USB image", timeout=120)
        _run_required(["umount", str(mount_root)], "Could not unmount the USB image", timeout=120)
        mounted = False
        _run_required(["fsck.vfat", "-n", str(temporary)], "The USB image failed verification", timeout=120)
        os.replace(temporary, destination)
        return destination
    finally:
        if mounted:
            _run(["umount", str(mount_root)], timeout=120)
        temporary.unlink(missing_ok=True)


def _write_config_value(path: Path, value: str) -> None:
    path.write_text(value, encoding="utf-8")


def _usb_serial() -> str:
    try:
        value = Path("/etc/machine-id").read_text(encoding="utf-8").strip()
        if value:
            return value[:32]
    except OSError:
        pass
    try:
        identity = json.loads(Path("/boot/firmware/mxg-device-identity.json").read_text(encoding="utf-8"))
        value = str(identity.get("hardwareId") or "").removeprefix("mxg-pi-")
        if re.fullmatch(r"[0-9a-f]{32}", value):
            return value
    except (OSError, json.JSONDecodeError, AttributeError):
        pass
    return "mxgenius"


def _unbind_usb_gadget(gadget_root: Path) -> None:
    udc = gadget_root / "UDC"
    if udc.is_file():
        _write_config_value(udc, "")


def _bind_usb_image(
    image: Path,
    gadget_root: Path = CONFIGFS_GADGET_ROOT / USB_GADGET_NAME,
    udc_root: Path = UDC_ROOT,
) -> str:
    controllers = sorted(path.name for path in udc_root.iterdir()) if udc_root.is_dir() else []
    if not controllers or not gadget_root.parent.is_dir():
        raise RuntimeError("This Pi does not expose a USB device controller")
    if not image.is_file():
        raise RuntimeError("The prepared USB image is missing")

    gadget_root.mkdir(parents=True, exist_ok=True)
    _unbind_usb_gadget(gadget_root)
    _write_config_value(gadget_root / "idVendor", "0x1d6b")
    _write_config_value(gadget_root / "idProduct", "0x0104")
    _write_config_value(gadget_root / "bcdDevice", "0x0100")
    _write_config_value(gadget_root / "bcdUSB", "0x0200")

    strings = gadget_root / "strings" / "0x409"
    strings.mkdir(parents=True, exist_ok=True)
    _write_config_value(strings / "serialnumber", _usb_serial())
    _write_config_value(strings / "manufacturer", "MXGenius")
    _write_config_value(strings / "product", "MXGenius Equipment Pack")

    config = gadget_root / "configs" / "c.1"
    (config / "strings" / "0x409").mkdir(parents=True, exist_ok=True)
    _write_config_value(config / "MaxPower", "250")
    _write_config_value(config / "strings" / "0x409" / "configuration", "Equipment Pack")

    function = gadget_root / "functions" / "mass_storage.0"
    function.mkdir(parents=True, exist_ok=True)
    _write_config_value(function / "stall", "1")
    _write_config_value(function / "lun.0" / "removable", "1")
    _write_config_value(function / "lun.0" / "ro", "1")
    _write_config_value(function / "lun.0" / "file", str(image.resolve()))
    link = config / "mass_storage.0"
    if not link.exists():
        link.symlink_to(function)
    _write_config_value(gadget_root / "UDC", controllers[0])
    if (gadget_root / "UDC").read_text(encoding="utf-8").strip() != controllers[0]:
        raise RuntimeError("The USB gadget did not bind to its device controller")
    observed_image = Path((function / "lun.0" / "file").read_text(encoding="utf-8").strip())
    if observed_image.resolve() != image.resolve():
        raise RuntimeError("The USB gadget did not retain the prepared image")
    return controllers[0]


def _restore_usb_gadget() -> None:
    state = _read_usb_gadget_state()
    image_value = state.get("activeImage")
    if not isinstance(image_value, str):
        return
    image = Path(image_value)
    if image.is_file():
        _bind_usb_image(image)


def usb_gadget_activate(payload: dict[str, Any]) -> dict[str, Any]:
    slot = _validated_slot(payload.get("slot"))
    try:
        generation = int(payload.get("generation"))
        version_id = str(uuid.UUID(str(payload.get("versionId"))))
    except (TypeError, ValueError) as error:
        raise ValueError("The Equipment Pack activation identity is invalid") from error
    if generation < 1:
        raise ValueError("The Equipment Pack generation is invalid")

    previous = _read_usb_gadget_state()
    previous_image = Path(str(previous.get("activeImage") or ""))
    image = _build_usb_image(slot)
    try:
        controller = _bind_usb_image(image)
        state = {
            "schemaVersion": 1,
            "activeSlot": slot,
            "activeImage": str(image),
            "generation": generation,
            "versionId": version_id,
            "controller": controller,
            "activatedAt": int(time.time()),
            "previousSlot": previous.get("activeSlot"),
            "previousImage": previous.get("activeImage"),
            "previousGeneration": previous.get("generation"),
            "previousVersionId": previous.get("versionId"),
        }
        _atomic_json(USB_GADGET_STATE, state)
        return {"ok": True, "activeSlot": slot, "generation": generation, "controller": controller}
    except Exception:
        try:
            _unbind_usb_gadget(CONFIGFS_GADGET_ROOT / USB_GADGET_NAME)
            if previous_image.is_file():
                _bind_usb_image(previous_image)
        except Exception:
            pass
        raise


def handle_action(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if action == "status":
        return {
            "ok": True,
            "capabilities": [
                "wifi", "bluetooth", "poweroff", "usb-gadget-status",
                "usb-gadget-activate",
            ],
        }
    if action == "wifi.scan":
        return wifi_scan()
    if action == "wifi.connect":
        return wifi_connect(payload)
    if action == "bluetooth.scan":
        return bluetooth_scan()
    if action == "bluetooth.action":
        return bluetooth_action(payload)
    if action == "usb.gadget.status":
        state = _read_usb_gadget_state()
        status = usb_gadget_status()
        controller = str(state.get("controller") or "")
        try:
            bound_controller = (CONFIGFS_GADGET_ROOT / USB_GADGET_NAME / "UDC").read_text(encoding="utf-8").strip()
        except OSError:
            bound_controller = ""
        return {
            **status,
            "state": state,
            "bound": bool(controller and controller == bound_controller and controller in status["udcs"]),
            "hostState": status["controllerStates"].get(controller, "unknown"),
        }
    if action == "usb.gadget.activate":
        return usb_gadget_activate(payload)
    if action == "poweroff":
        threading.Timer(1.0, lambda: subprocess.Popen(["systemctl", "poweroff"])).start()
        return {"ok": True, "message": "Power off requested"}
    return {"ok": False, "error": "Unsupported control action"}


class ControlHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        request = self.rfile.readline(MAX_REQUEST_BYTES + 1)
        if not request or len(request) > MAX_REQUEST_BYTES:
            response = {"ok": False, "error": "Invalid request"}
        else:
            try:
                payload = json.loads(request)
                response = handle_action(payload) if isinstance(payload, dict) else {"ok": False, "error": "Invalid request"}
            except (json.JSONDecodeError, UnicodeDecodeError):
                response = {"ok": False, "error": "Invalid JSON request"}
            except subprocess.TimeoutExpired:
                response = {"ok": False, "error": "Control operation timed out"}
            except (ValueError, RuntimeError) as error:
                response = {"ok": False, "error": str(error)[:500]}
            except Exception:
                response = {"ok": False, "error": "Control operation failed"}
        self.wfile.write(json.dumps(response, separators=(",", ":")).encode("utf-8") + b"\n")


def main() -> None:
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SOCKET_PATH.exists():
        SOCKET_PATH.unlink()
    try:
        _restore_usb_gadget()
    except Exception:
        # A failed restore must never take down Wi-Fi, Bluetooth, or safe power
        # controls. The diagnostics service will expose the failed capability.
        pass
    with socketserver.ThreadingUnixStreamServer(str(SOCKET_PATH), ControlHandler) as server:
        os.chmod(SOCKET_PATH, 0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()
