"""Low-dependency Raspberry Pi diagnostics collection for the MXG XR bridge."""

from __future__ import annotations

import asyncio
import json
import os
import platform
import shutil
import socket
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROC = Path("/proc")
SYS = Path("/sys")


def _read_text(path: Path, default: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return default


def _number(value: str, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _memory() -> dict[str, Any]:
    values: dict[str, int] = {}
    for line in _read_text(PROC / "meminfo").splitlines():
        key, _, raw = line.partition(":")
        if not raw:
            continue
        values[key] = int(_number(raw.strip().split()[0])) * 1024
    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", values.get("MemFree", 0))
    used = max(0, total - available)
    return {
        "totalBytes": total,
        "usedBytes": used,
        "availableBytes": available,
        "usedPercent": round((used / total) * 100, 1) if total else 0.0,
    }


def _temperature() -> float | None:
    candidates = [
        SYS / "class/thermal/thermal_zone0/temp",
        SYS / "class/hwmon/hwmon0/temp1_input",
    ]
    for path in candidates:
        raw = _read_text(path)
        if raw:
            value = _number(raw)
            return round(value / 1000 if value > 500 else value, 1)
    return None


def _uptime() -> float:
    return round(_number(_read_text(PROC / "uptime").split(" ", 1)[0]), 1)


def _storage() -> dict[str, Any]:
    usage = shutil.disk_usage("/")
    return {
        "totalBytes": usage.total,
        "usedBytes": usage.used,
        "freeBytes": usage.free,
        "usedPercent": round((usage.used / usage.total) * 100, 1) if usage.total else 0.0,
    }


def _interfaces() -> list[dict[str, Any]]:
    root = SYS / "class/net"
    result: list[dict[str, Any]] = []
    if not root.exists():
        return result
    for path in sorted(root.iterdir(), key=lambda item: item.name):
        name = path.name
        if name == "lo":
            continue
        state = _read_text(path / "operstate", "unknown")
        rx = int(_number(_read_text(path / "statistics/rx_bytes")))
        tx = int(_number(_read_text(path / "statistics/tx_bytes")))
        result.append({
            "name": name,
            "state": state,
            "mac": _read_text(path / "address"),
            "rxBytes": rx,
            "txBytes": tx,
        })
    return result


def _usb_devices() -> list[dict[str, str]]:
    root = SYS / "bus/usb/devices"
    devices: list[dict[str, str]] = []
    if not root.exists():
        return devices
    for path in sorted(root.iterdir(), key=lambda item: item.name):
        vendor = _read_text(path / "idVendor")
        product_id = _read_text(path / "idProduct")
        if not vendor or not product_id:
            continue
        devices.append({
            "path": path.name,
            "vendorId": vendor,
            "productId": product_id,
            "manufacturer": _read_text(path / "manufacturer", "Unknown"),
            "product": _read_text(path / "product", "USB device"),
            "serial": _read_text(path / "serial"),
        })
    return devices


def _serial_ports() -> list[str]:
    paths: list[str] = []
    for pattern in ("ttyACM*", "ttyUSB*", "ttyAMA*", "serial*"):
        paths.extend(str(path) for path in sorted(Path("/dev").glob(pattern)))
    return sorted(set(paths))


def _configured_probes() -> list[dict[str, Any]]:
    raw = os.getenv("MXG_DIAGNOSTIC_PORTS", "[]")
    try:
        probes = json.loads(raw)
    except json.JSONDecodeError:
        probes = []
    return [item for item in probes if isinstance(item, dict) and item.get("port")]


async def _probe(item: dict[str, Any]) -> dict[str, Any]:
    host = str(item.get("host") or "127.0.0.1")
    port = int(item["port"])
    label = str(item.get("label") or f"{host}:{port}")
    started = time.monotonic()
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=0.75)
        writer.close()
        await writer.wait_closed()
        return {"label": label, "host": host, "port": port, "status": "open", "latencyMs": round((time.monotonic() - started) * 1000, 1)}
    except (OSError, asyncio.TimeoutError):
        return {"label": label, "host": host, "port": port, "status": "closed", "latencyMs": None}


@dataclass
class _CpuSample:
    total: int
    idle: int


class DiagnosticsCollector:
    def __init__(self) -> None:
        self._previous_cpu: _CpuSample | None = None

    def _cpu_percent(self) -> float:
        lines = _read_text(PROC / "stat").splitlines()
        if not lines:
            return 0.0
        fields = lines[0].split()[1:]
        ticks = [int(_number(value)) for value in fields]
        if not ticks:
            return 0.0
        idle = ticks[3] + (ticks[4] if len(ticks) > 4 else 0)
        current = _CpuSample(total=sum(ticks), idle=idle)
        previous = self._previous_cpu
        self._previous_cpu = current
        if not previous:
            return 0.0
        total_delta = current.total - previous.total
        idle_delta = current.idle - previous.idle
        return round(max(0.0, min(100.0, (1 - idle_delta / total_delta) * 100)), 1) if total_delta else 0.0

    async def collect(self) -> dict[str, Any]:
        probes = await asyncio.gather(*(_probe(item) for item in _configured_probes()))
        temperature = _temperature()
        status = "nominal"
        if temperature is not None and temperature >= 80:
            status = "critical"
        elif temperature is not None and temperature >= 70:
            status = "warning"
        return {
            "type": "diagnostics.snapshot",
            "version": 1,
            "timestampMs": int(time.time() * 1000),
            "status": status,
            "host": {
                "name": socket.gethostname(),
                "platform": platform.platform(),
                "machine": platform.machine(),
                "uptimeSeconds": _uptime(),
            },
            "cpu": {
                "logicalCores": os.cpu_count() or 0,
                "usedPercent": self._cpu_percent(),
                "temperatureC": temperature,
                "loadAverage": [round(value, 2) for value in os.getloadavg()] if hasattr(os, "getloadavg") else [],
            },
            "memory": _memory(),
            "storage": _storage(),
            "network": _interfaces(),
            "usb": _usb_devices(),
            "serialPorts": _serial_ports(),
            "portProbes": probes,
        }
