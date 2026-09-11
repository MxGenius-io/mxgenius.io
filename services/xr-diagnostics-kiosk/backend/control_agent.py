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
from pathlib import Path
from typing import Any


SOCKET_PATH = Path(os.getenv("MXG_CONTROL_SOCKET", "/run/mxg-edge-control/control.sock"))
MAC_ADDRESS = re.compile(r"^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")
MAX_REQUEST_BYTES = 16 * 1024
CONFIGFS_GADGET_ROOT = Path("/sys/kernel/config/usb_gadget")
UDC_ROOT = Path("/sys/class/udc")


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


def wifi_scan() -> dict[str, Any]:
    result = _run([
        "nmcli", "--terse", "--escape", "yes", "--fields", "IN-USE,SSID,SIGNAL,SECURITY",
        "device", "wifi", "list", "--rescan", "yes",
    ])
    if result.returncode:
        return {"ok": False, "error": result.stderr.strip() or "Wi-Fi scan failed"}
    networks: dict[str, dict[str, Any]] = {}
    for line in result.stdout.splitlines():
        fields = _split_escaped(line)
        if len(fields) < 4 or not fields[1]:
            continue
        active, ssid, signal, security = fields[:4]
        candidate = {
            "ssid": ssid,
            "signal": int(signal or 0),
            "security": security or "Open",
            "active": active == "*",
        }
        previous = networks.get(ssid)
        if previous is None or candidate["signal"] > previous["signal"]:
            networks[ssid] = candidate
    return {"ok": True, "networks": sorted(networks.values(), key=lambda item: (not item["active"], -item["signal"], item["ssid"].lower()))}


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
    tools = {
        "mkfs.vfat": shutil.which("mkfs.vfat") is not None,
        "mount": shutil.which("mount") is not None,
        "umount": shutil.which("umount") is not None,
    }
    return {
        "ok": True,
        "supported": bool(udcs) and gadget_root.is_dir(),
        "configfs": gadget_root.is_dir(),
        "udcs": udcs,
        "gadgets": gadgets,
        "tools": tools,
        "activationReady": bool(udcs) and gadget_root.is_dir() and all(tools.values()),
    }


def handle_action(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if action == "status":
        return {"ok": True, "capabilities": ["wifi", "bluetooth", "poweroff", "usb-gadget-status"]}
    if action == "wifi.scan":
        return wifi_scan()
    if action == "wifi.connect":
        return wifi_connect(payload)
    if action == "bluetooth.scan":
        return bluetooth_scan()
    if action == "bluetooth.action":
        return bluetooth_action(payload)
    if action == "usb.gadget.status":
        return usb_gadget_status()
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
            except Exception:
                response = {"ok": False, "error": "Control operation failed"}
        self.wfile.write(json.dumps(response, separators=(",", ":")).encode("utf-8") + b"\n")


def main() -> None:
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SOCKET_PATH.exists():
        SOCKET_PATH.unlink()
    with socketserver.ThreadingUnixStreamServer(str(SOCKET_PATH), ControlHandler) as server:
        os.chmod(SOCKET_PATH, 0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()
