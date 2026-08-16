"""Canonical scanner observations for USB CDC, serial, Bluetooth SPP, and HID bridges."""

from __future__ import annotations

import hashlib
import re
import time
from typing import Any


SCHEMA_VERSION = "1.0.0"
_GS1_FIELD = re.compile(r"\((01|10|21)\)([^()]+)")
_PREFIXED_VALUE = re.compile(
    r"^(?P<prefix>P/?N|PART(?:\s*NO)?|S/?N|SERIAL|LOT)\s*[:#-]?\s*(?P<value>.+)$",
    re.IGNORECASE,
)


def _clean(value: Any, *, maximum: int = 512) -> str:
    return str(value or "").replace("\x00", "").strip()[:maximum]


def normalize_scan_observation(
    payload: dict[str, Any],
    *,
    node_id: str,
    session_id: str | None,
    sequence: int,
) -> dict[str, Any]:
    """Normalize untrusted scanner input without asserting catalog identity."""
    raw_value = _clean(payload.get("rawValue") or payload.get("value"))
    if not raw_value:
        raise ValueError("scan value is empty")

    observed_at = int(payload.get("observedAtMs") or time.time() * 1000)
    device = payload.get("device") if isinstance(payload.get("device"), dict) else {}
    device_id = _clean(device.get("id") or payload.get("deviceId") or "unidentified-scanner", maximum=128)
    transport = _clean(device.get("transport") or payload.get("transport") or "unknown", maximum=32).lower()
    if transport not in {"usb-cdc", "usb-hid", "serial", "bluetooth-spp", "bluetooth-hid", "simulated", "unknown"}:
        transport = "unknown"

    digest = hashlib.sha256(raw_value.encode("utf-8")).hexdigest()
    candidates: dict[str, Any] = {"value": raw_value, "verified": False}
    gs1 = {code: value.strip() for code, value in _GS1_FIELD.findall(raw_value)}
    if gs1:
        candidates["gs1"] = gs1
        if "10" in gs1:
            candidates["lotNumber"] = gs1["10"]
        if "21" in gs1:
            candidates["serialNumber"] = gs1["21"]

    match = _PREFIXED_VALUE.match(raw_value)
    if match:
        prefix = match.group("prefix").upper().replace(" ", "")
        value = match.group("value").strip()
        if prefix in {"P/N", "PN", "PART", "PARTNO"}:
            candidates["partNumber"] = value
        elif prefix in {"S/N", "SN", "SERIAL"}:
            candidates["serialNumber"] = value
        elif prefix == "LOT":
            candidates["lotNumber"] = value
    elif not gs1:
        candidates["identifierCandidate"] = raw_value

    event_basis = f"{node_id}\0{device_id}\0{sequence}\0{observed_at}\0{digest}".encode("utf-8")
    return {
        "type": "scan.observed",
        "schema": "mxg.edge.scan",
        "schemaVersion": SCHEMA_VERSION,
        "eventId": hashlib.sha256(event_basis).hexdigest()[:32],
        "nodeId": node_id,
        "sessionId": session_id,
        "sequence": sequence,
        "observedAtMs": observed_at,
        "device": {
            "id": device_id,
            "name": _clean(device.get("name") or payload.get("deviceName") or device_id, maximum=128),
            "profile": _clean(device.get("profile") or payload.get("profile") or "generic-line-scanner", maximum=64),
            "transport": transport,
        },
        "symbology": _clean(payload.get("symbology") or "unknown", maximum=32).lower(),
        "rawValue": raw_value,
        "rawSha256": digest,
        "normalized": candidates,
    }
