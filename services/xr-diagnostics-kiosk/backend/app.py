"""MXG standalone diagnostics kiosk and XR sensor relay."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import secrets
import socket
import struct
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from bluetooth_stream import BluetoothDiagnosticsServer
from control import ControlUnavailable, request_control
from diagnostics import DiagnosticsCollector
from edge_schema import StateDeltaEncoder
from integration_fixtures import simulated_integrations
from scanner import normalize_scan_observation


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
VERSION_FILE = ROOT / "VERSION"
SERVICE_VERSION = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else "0.0.0-dev"
STARTED_AT = time.monotonic()
FRAME_MAGIC = b"MXGS"
FRAME_HEADER_SIZE = 24
MAX_FRAME_BYTES = int(os.getenv("MXG_MAX_FRAME_BYTES", str(8 * 1024 * 1024)))
BRIDGE_TOKEN = os.getenv("MXG_BRIDGE_TOKEN", "").strip()
SESSION_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
CONTROL_NONCE = secrets.token_urlsafe(32)
LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost", "testclient"}


class Bridge:
    def __init__(self) -> None:
        self.consumers: set[WebSocket] = set()
        self.detailed_consumers: set[WebSocket] = set()
        self.producers: set[WebSocket] = set()
        self.collector = DiagnosticsCollector()
        self.latest: dict[str, Any] = {}
        self.edge_state: dict[str, Any] = {}
        self.edge_encoder = StateDeltaEncoder(os.getenv("MXG_NODE_ID", socket.gethostname() or "mxg-pi"))
        self.frame_count = 0
        self.scan_count = 0
        self.latest_scans: list[dict[str, Any]] = []
        self.source_count = 0
        self.node_count = 0
        self.nodes: dict[str, dict[str, Any]] = {}
        self.session_id: str | None = None
        self._task: asyncio.Task[None] | None = None
        self.bluetooth = BluetoothDiagnosticsServer(
            provider=self.bluetooth_payload,
            channel=int(os.getenv("MXG_BLUETOOTH_CHANNEL", "8")),
        )

    async def start(self) -> None:
        self._task = asyncio.create_task(self._diagnostic_loop())
        if os.getenv("MXG_BLUETOOTH_ENABLED", "0") == "1":
            self.bluetooth.start()

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
        self.bluetooth.stop()

    async def _diagnostic_loop(self) -> None:
        while True:
            self.latest = await self.collector.collect()
            self.latest["bridge"] = self.summary()
            live_message = self.edge_encoder.update(self.latest, self.session_id)
            self.edge_state = self.edge_encoder.state or {}
            await self._send_json(self.detailed_consumers, self.latest)
            await self.broadcast_json(live_message)
            await asyncio.sleep(1)

    def bluetooth_payload(self) -> dict[str, Any]:
        return self.edge_state or self.compact_summary()

    def compact_summary(self) -> dict[str, Any]:
        snapshot = self.latest or {}
        probes = snapshot.get("portProbes", [])
        closed = [item.get("label", "unnamed port") for item in probes if item.get("status") != "open"]
        canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return {
            "type": "diagnostics.summary",
            "version": 1,
            "timestampMs": snapshot.get("timestampMs"),
            "status": snapshot.get("status", "starting"),
            "node": snapshot.get("host", {}).get("name", "mxg-pi"),
            "metrics": {
                "cpuPercent": snapshot.get("cpu", {}).get("usedPercent"),
                "temperatureC": snapshot.get("cpu", {}).get("temperatureC"),
                "memoryPercent": snapshot.get("memory", {}).get("usedPercent"),
                "storagePercent": snapshot.get("storage", {}).get("usedPercent"),
            },
            "findings": ([{"severity": "warning", "code": "PORT_UNREACHABLE", "targets": closed}] if closed else []),
            "hardware": {"usbDevices": len(snapshot.get("usb", [])), "serialPorts": len(snapshot.get("serialPorts", []))},
            "evidenceId": hashlib.sha256(canonical).hexdigest()[:24] if snapshot else None,
            "bridge": self.summary(),
        }

    def summary(self) -> dict[str, Any]:
        return {
            "consumers": len(self.consumers),
            "sources": len(self.producers),
            "thermalFrames": self.frame_count,
            "scans": self.scan_count,
            "maxFrameBytes": MAX_FRAME_BYTES,
            "nodes": len(self.nodes),
            "sessionId": self.session_id,
            "bluetooth": self.bluetooth.summary(),
        }

    def announce(self, payload: dict[str, Any], role: str) -> dict[str, Any]:
        node_id = str(payload.get("nodeId") or f"{role}-{self.node_count + 1}")
        if node_id not in self.nodes:
            self.node_count += 1
        node = {
            "nodeId": node_id,
            "nodeType": str(payload.get("nodeType") or role),
            "nodeName": str(payload.get("nodeName") or node_id),
            "capabilities": [str(value) for value in payload.get("capabilities", [])],
            "surface": str(payload.get("surface") or ""),
            "lastSeenMs": int(time.time() * 1000),
        }
        self.nodes[node_id] = node
        return node

    def remove_node(self, node_id: str | None) -> None:
        if node_id:
            self.nodes.pop(node_id, None)

    async def _send_json(self, clients: set[WebSocket], payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        text = json.dumps(payload, separators=(",", ":"))
        for client in tuple(clients):
            try:
                await client.send_text(text)
            except Exception:
                stale.append(client)
        for client in stale:
            clients.discard(client)

    async def broadcast_json(self, payload: dict[str, Any]) -> None:
        await self._send_json(self.consumers, payload)

    async def command_sources(self, payload: dict[str, Any]) -> None:
        await self._send_json(self.producers, payload)

    async def broadcast_frame(self, payload: bytes) -> None:
        stale: list[WebSocket] = []
        for client in tuple(self.consumers):
            try:
                await client.send_bytes(payload)
            except Exception:
                stale.append(client)
        for client in stale:
            self.consumers.discard(client)


bridge = Bridge()


def _is_authorized(websocket: WebSocket, token: str | None) -> bool:
    host = websocket.client.host if websocket.client else ""
    if host in {"127.0.0.1", "::1", "localhost"}:
        return True
    return not BRIDGE_TOKEN or token == BRIDGE_TOKEN


def _require_local_control(request: Request) -> None:
    host = request.client.host if request.client else ""
    if host not in LOCAL_CLIENTS:
        raise HTTPException(status_code=403, detail="appliance controls are local-only")
    if request.headers.get("x-mxg-control-token") != CONTROL_NONCE:
        raise HTTPException(status_code=403, detail="local control token required")


async def _control(action: str, **parameters: Any) -> dict[str, Any]:
    try:
        response = await request_control(action, **parameters)
    except ControlUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    if not response.get("ok"):
        raise HTTPException(status_code=409, detail=str(response.get("error") or "control operation failed"))
    return response


def _validate_frame(frame: bytes) -> dict[str, int]:
    if len(frame) < FRAME_HEADER_SIZE or len(frame) > MAX_FRAME_BYTES:
        raise ValueError("frame size outside bridge limits")
    if frame[:4] != FRAME_MAGIC:
        raise ValueError("invalid frame magic")
    version, frame_type, pixel_format, flags, width, height, timestamp_ns, metadata_length = struct.unpack_from("<BBBBHHQI", frame, 4)
    if version != 1 or frame_type not in {1, 2} or pixel_format not in {1, 2, 3}:
        raise ValueError("unsupported frame header")
    if width < 1 or height < 1 or metadata_length > len(frame) - FRAME_HEADER_SIZE:
        raise ValueError("invalid frame dimensions or metadata")
    return {
        "version": version,
        "type": frame_type,
        "format": pixel_format,
        "flags": flags,
        "width": width,
        "height": height,
        "timestampNs": timestamp_ns,
        "metadataLength": metadata_length,
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    await bridge.start()
    yield
    await bridge.stop()


app = FastAPI(title="MXG XR Diagnostics Bridge", version=SERVICE_VERSION, lifespan=lifespan)


@app.get("/api/v1/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "ready": bool(bridge.latest),
        "service": "mxg-xr-diagnostics",
        "version": SERVICE_VERSION,
        "uptimeMs": int((time.monotonic() - STARTED_AT) * 1000),
        "bridge": bridge.summary(),
    }


@app.get("/api/v1/control/session")
async def control_session(request: Request) -> dict[str, Any]:
    host = request.client.host if request.client else ""
    if host not in LOCAL_CLIENTS:
        raise HTTPException(status_code=403, detail="appliance controls are local-only")
    status = await _control("status")
    return {"token": CONTROL_NONCE, "scope": "local-appliance", "version": 1, "capabilities": status.get("capabilities", [])}


@app.post("/api/v1/control/wifi/scan")
async def control_wifi_scan(request: Request) -> dict[str, Any]:
    _require_local_control(request)
    return await _control("wifi.scan")


@app.post("/api/v1/control/wifi/connect")
async def control_wifi_connect(request: Request) -> dict[str, Any]:
    _require_local_control(request)
    payload = await request.json()
    return await _control(
        "wifi.connect",
        ssid=str(payload.get("ssid") or ""),
        password=str(payload.get("password") or ""),
        hidden=payload.get("hidden") is True,
    )


@app.post("/api/v1/control/bluetooth/scan")
async def control_bluetooth_scan(request: Request) -> dict[str, Any]:
    _require_local_control(request)
    return await _control("bluetooth.scan")


@app.post("/api/v1/control/bluetooth/action")
async def control_bluetooth_action(request: Request) -> dict[str, Any]:
    _require_local_control(request)
    payload = await request.json()
    return await _control(
        "bluetooth.action",
        address=str(payload.get("address") or ""),
        operation=str(payload.get("operation") or ""),
    )


@app.post("/api/v1/control/poweroff")
async def control_poweroff(request: Request) -> dict[str, Any]:
    _require_local_control(request)
    return await _control("poweroff")


@app.get("/api/v1/diagnostics")
async def diagnostics(token: str | None = Query(default=None)) -> dict[str, Any]:
    if BRIDGE_TOKEN and token != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="bridge token required")
    if not bridge.latest:
        bridge.latest = await bridge.collector.collect()
    return bridge.latest


@app.get("/api/v1/state")
async def normalized_state(token: str | None = Query(default=None)) -> dict[str, Any]:
    if BRIDGE_TOKEN and token != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="bridge token required")
    return bridge.edge_state or bridge.compact_summary()


@app.get("/api/v1/schema")
async def diagnostics_schema() -> FileResponse:
    return FileResponse(ROOT / "contracts" / "diagnostics-state.schema.json", media_type="application/schema+json")


@app.get("/api/v1/schemas/scan-observation")
async def scan_observation_schema() -> FileResponse:
    return FileResponse(ROOT / "contracts" / "scan-observation.schema.json", media_type="application/schema+json")


@app.get("/api/v1/schemas/sensor-companion")
async def sensor_companion_schema() -> FileResponse:
    return FileResponse(ROOT / "contracts" / "sensor-companion.schema.json", media_type="application/schema+json")


@app.get("/api/v1/integrations/simulated")
async def integration_simulations() -> dict[str, Any]:
    return simulated_integrations()


@app.get("/api/v1/schemas/integration-fixtures")
async def integration_fixture_schema() -> FileResponse:
    return FileResponse(ROOT / "contracts" / "integration-fixtures.schema.json", media_type="application/schema+json")


@app.websocket("/ws/xr")
async def xr_socket(websocket: WebSocket, token: str | None = Query(default=None)) -> None:
    if not _is_authorized(websocket, token):
        await websocket.close(code=4401, reason="bridge token required")
        return
    await websocket.accept()
    bridge.consumers.add(websocket)
    is_local = websocket.client is not None and websocket.client.host in {"127.0.0.1", "::1", "localhost", "testclient"}
    if is_local:
        bridge.detailed_consumers.add(websocket)
    await websocket.send_json({
        "type": "bridge.hello",
        "version": 1,
        "role": "consumer",
        "frameProtocol": "MXGS/1",
        "bridge": bridge.summary(),
    })
    if bridge.latest:
        await websocket.send_json(bridge.latest if is_local else (bridge.edge_state or bridge.compact_summary()))
    node_id: str | None = None
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("text"):
                payload = json.loads(message["text"])
                if payload.get("type") == "node.announce":
                    node = bridge.announce(payload, "xr-client")
                    node_id = node["nodeId"]
                    await bridge.broadcast_json({"type": "node.status", "status": "connected", "node": node, "bridge": bridge.summary()})
                elif payload.get("type") == "bridge.session":
                    requested_session = str(payload.get("sessionId") or "")
                    if not SESSION_ID.fullmatch(requested_session):
                        await websocket.send_json({
                            "type": "bridge.error",
                            "code": "INVALID_SESSION_ID",
                            "detail": "sessionId must match the XR session gateway contract",
                        })
                        continue
                    bridge.session_id = requested_session
                    bridge.edge_encoder.reset()
                    await bridge.command_sources({"type": "bridge.session", "sessionId": bridge.session_id})
                elif payload.get("type") in {"thermal.control", "source.command"}:
                    await bridge.command_sources(payload)
                elif payload.get("type") == "diagnostics.resync" and bridge.edge_state:
                    await websocket.send_json(bridge.edge_state)
                elif payload.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
    except (WebSocketDisconnect, json.JSONDecodeError):
        pass
    finally:
        bridge.consumers.discard(websocket)
        bridge.detailed_consumers.discard(websocket)
        bridge.remove_node(node_id)


@app.websocket("/ws/ingest")
async def ingest_socket(websocket: WebSocket, token: str | None = Query(default=None)) -> None:
    if not _is_authorized(websocket, token):
        await websocket.close(code=4401, reason="bridge token required")
        return
    await websocket.accept()
    bridge.producers.add(websocket)
    bridge.source_count += 1
    source_id = f"source-{bridge.source_count}"
    await websocket.send_json({"type": "bridge.hello", "version": 1, "role": "producer", "sourceId": source_id})
    await bridge.broadcast_json({"type": "source.status", "sourceId": source_id, "status": "connected", "bridge": bridge.summary()})
    node_id: str | None = None
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("bytes") is not None:
                frame = message["bytes"]
                header = _validate_frame(frame)
                bridge.frame_count += 1
                await bridge.broadcast_frame(frame)
                if bridge.frame_count % 30 == 0:
                    await bridge.broadcast_json({"type": "thermal.status", "sourceId": source_id, "frame": header, "bridge": bridge.summary()})
            elif message.get("text"):
                payload = json.loads(message["text"])
                payload.setdefault("sourceId", source_id)
                if payload.get("type") == "node.announce":
                    node = bridge.announce(payload, "sensor-source")
                    node_id = node["nodeId"]
                    await bridge.broadcast_json({"type": "node.status", "status": "connected", "node": node, "bridge": bridge.summary()})
                elif payload.get("type") in {"scan.raw", "scan.observed"}:
                    bridge.scan_count += 1
                    event = normalize_scan_observation(
                        payload,
                        node_id=node_id or source_id,
                        session_id=bridge.session_id,
                        sequence=bridge.scan_count,
                    )
                    bridge.latest_scans = ([event] + bridge.latest_scans)[:20]
                    await bridge.broadcast_json(event)
                else:
                    await bridge.broadcast_json(payload)
    except (WebSocketDisconnect, ValueError, json.JSONDecodeError) as error:
        await bridge.broadcast_json({"type": "source.status", "sourceId": source_id, "status": "error", "detail": str(error)})
    finally:
        bridge.producers.discard(websocket)
        disconnected_node = bridge.nodes.get(node_id) if node_id else None
        bridge.remove_node(node_id)
        if disconnected_node:
            await bridge.broadcast_json({
                "type": "node.status",
                "status": "disconnected",
                "node": disconnected_node,
                "bridge": bridge.summary(),
            })
        await bridge.broadcast_json({"type": "source.status", "sourceId": source_id, "status": "disconnected", "bridge": bridge.summary()})


@app.get("/")
async def kiosk() -> FileResponse:
    return FileResponse(FRONTEND / "index.html")


app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")
