"""Normalize local Pi readings into the stable live XR diagnostics contract."""

from __future__ import annotations

import copy
import time
from typing import Any


SCHEMA_VERSION = "1.0.0"


def normalize_snapshot(snapshot: dict[str, Any], *, node_id: str, session_id: str | None, sequence: int) -> dict[str, Any]:
    transports: dict[str, Any] = {}
    for item in snapshot.get("network", []):
        key = f"network:{item.get('name', 'unknown')}"
        transports[key] = {
            "kind": "network",
            "label": item.get("name", "Network"),
            "status": "online" if item.get("state") == "up" else item.get("state", "unknown"),
            "rxBytes": item.get("rxBytes", 0),
            "txBytes": item.get("txBytes", 0),
        }
    for item in snapshot.get("usb", []):
        key = f"usb:{item.get('path', 'unknown')}"
        transports[key] = {
            "kind": "usb",
            "label": item.get("product", "USB device"),
            "status": "online",
            "vendorId": item.get("vendorId", ""),
            "productId": item.get("productId", ""),
            "manufacturer": item.get("manufacturer", ""),
        }
    for path in snapshot.get("serialPorts", []):
        transports[f"serial:{path}"] = {"kind": "serial", "label": path, "status": "online", "path": path}
    findings: dict[str, Any] = {}
    for item in snapshot.get("portProbes", []):
        key = f"probe:{item.get('label', item.get('port', 'unknown'))}"
        status = "online" if item.get("status") == "open" else "offline"
        transports[key] = {
            "kind": "tcp",
            "label": item.get("label", key),
            "status": status,
            "address": item.get("host"),
            "port": item.get("port"),
            "latencyMs": item.get("latencyMs"),
        }
        if status != "online":
            findings[f"{key}:unreachable"] = {
                "code": "PORT_UNREACHABLE",
                "severity": "warning",
                "title": f"{item.get('label', 'Configured port')} is unreachable",
                "transportId": key,
                "active": True,
            }

    cpu = snapshot.get("cpu", {})
    memory = snapshot.get("memory", {})
    storage = snapshot.get("storage", {})
    return {
        "type": "diagnostics.state",
        "schema": "mxg.edge.diagnostics",
        "schemaVersion": SCHEMA_VERSION,
        "nodeId": node_id,
        "sessionId": session_id,
        "sequence": sequence,
        "observedAtMs": snapshot.get("timestampMs", int(time.time() * 1000)),
        "posture": snapshot.get("status", "unknown"),
        "system": {
            "platform": snapshot.get("host", {}).get("platform", ""),
            "machine": snapshot.get("host", {}).get("machine", ""),
            "uptimeSeconds": snapshot.get("host", {}).get("uptimeSeconds", 0),
        },
        "metrics": {
            "cpu.utilization": {"value": cpu.get("usedPercent"), "unit": "percent", "quality": "measured"},
            "cpu.temperature": {"value": cpu.get("temperatureC"), "unit": "celsius", "quality": "measured" if cpu.get("temperatureC") is not None else "unavailable"},
            "memory.utilization": {"value": memory.get("usedPercent"), "unit": "percent", "quality": "measured"},
            "storage.utilization": {"value": storage.get("usedPercent"), "unit": "percent", "quality": "measured"},
            "system.load.1m": {"value": (cpu.get("loadAverage") or [None])[0], "unit": "ratio", "quality": "measured"},
        },
        "transports": transports,
        "findings": findings,
    }


def _escape(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _flatten(value: Any, path: str = "") -> dict[str, Any]:
    if isinstance(value, dict):
        flattened: dict[str, Any] = {}
        for key, child in value.items():
            flattened.update(_flatten(child, f"{path}/{_escape(str(key))}"))
        return flattened
    return {path or "/": value}


class StateDeltaEncoder:
    def __init__(self, node_id: str) -> None:
        self.node_id = node_id
        self.sequence = 0
        self.state: dict[str, Any] | None = None

    def reset(self) -> None:
        self.state = None

    def update(self, snapshot: dict[str, Any], session_id: str | None) -> dict[str, Any]:
        self.sequence += 1
        state = normalize_snapshot(snapshot, node_id=self.node_id, session_id=session_id, sequence=self.sequence)
        if self.state is None:
            self.state = copy.deepcopy(state)
            return state
        previous = _flatten(self.state)
        current = _flatten(state)
        ignored = {"/sequence", "/observedAtMs"}
        operations = []
        for path in sorted(previous.keys() - current.keys()):
            if path not in ignored:
                operations.append({"op": "remove", "path": path})
        for path in sorted(current):
            if path in ignored:
                continue
            if path not in previous:
                operations.append({"op": "add", "path": path, "value": current[path]})
            elif previous[path] != current[path]:
                operations.append({"op": "replace", "path": path, "value": current[path]})
        base_sequence = self.state["sequence"]
        self.state = copy.deepcopy(state)
        return {
            "type": "diagnostics.delta",
            "schema": "mxg.edge.diagnostics",
            "schemaVersion": SCHEMA_VERSION,
            "nodeId": self.node_id,
            "sessionId": session_id,
            "baseSequence": base_sequence,
            "sequence": self.sequence,
            "observedAtMs": state["observedAtMs"],
            "operations": operations,
        }
