"""Black-box smoke test for a local or deployed MXG diagnostics bridge."""

from __future__ import annotations

import argparse
import asyncio
import json
from urllib.parse import quote, urlparse, urlunparse
from urllib.request import urlopen

import websockets


def get_json(url: str) -> dict:
    with urlopen(url, timeout=5) as response:  # noqa: S310 - caller selects the test target
        if response.status != 200:
            raise RuntimeError(f"GET {url} returned {response.status}")
        return json.load(response)


def with_token(url: str, token: str | None) -> str:
    return f"{url}{'&' if '?' in url else '?'}token={quote(token)}" if token else url


async def check_websocket(base_url: str, token: str | None) -> None:
    parsed = urlparse(base_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    socket_url = urlunparse((scheme, parsed.netloc, "/ws/xr", "", "", ""))
    socket_url = with_token(socket_url, token)
    async with websockets.connect(socket_url, open_timeout=5, close_timeout=2) as socket:
        hello = json.loads(await asyncio.wait_for(socket.recv(), timeout=5))
        if hello.get("type") != "bridge.hello" or hello.get("frameProtocol") != "MXGS/1":
            raise RuntimeError(f"Unexpected WebSocket hello: {hello}")
        await socket.send(json.dumps({"type": "ping"}))
        for _ in range(5):
            message = await asyncio.wait_for(socket.recv(), timeout=5)
            if isinstance(message, str) and json.loads(message).get("type") == "pong":
                return
        raise RuntimeError("WebSocket did not return pong")


async def check_scanner_relay(base_url: str, token: str | None) -> None:
    parsed = urlparse(base_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    consumer_url = with_token(urlunparse((scheme, parsed.netloc, "/ws/xr", "", "", "")), token)
    producer_url = with_token(urlunparse((scheme, parsed.netloc, "/ws/ingest", "", "", "")), token)
    async with websockets.connect(consumer_url, open_timeout=5, close_timeout=2) as consumer:
        await consumer.recv()
        async with websockets.connect(producer_url, open_timeout=5, close_timeout=2) as producer:
            await producer.recv()
            await producer.send(json.dumps({
                "type": "node.announce",
                "nodeId": "smoke-scanner",
                "nodeType": "scanner-source",
                "capabilities": ["scan-observed-1"],
            }))
            await producer.send(json.dumps({
                "type": "scan.raw",
                "value": "P/N: SMOKE-42",
                "deviceId": "smoke-scanner",
                "transport": "simulated",
            }))
            for _ in range(12):
                message = await asyncio.wait_for(consumer.recv(), timeout=5)
                if not isinstance(message, str):
                    continue
                event = json.loads(message)
                if event.get("type") != "scan.observed":
                    continue
                if event.get("normalized", {}).get("partNumber") != "SMOKE-42":
                    raise RuntimeError(f"Scanner normalization mismatch: {event}")
                if event.get("normalized", {}).get("verified") is not False or len(event.get("rawSha256", "")) != 64:
                    raise RuntimeError(f"Scanner evidence fields are invalid: {event}")
                return
            raise RuntimeError("Scanner observation was not relayed")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8844")
    parser.add_argument("--token")
    parser.add_argument("--health-only", action="store_true")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    health = get_json(f"{base_url}/api/v1/health")
    if health.get("status") != "ok" or health.get("service") != "mxg-xr-diagnostics":
        raise RuntimeError(f"Bridge health failed: {health}")
    print(f"PASS health version={health.get('version')} ready={health.get('ready')}")

    if args.health_only:
        return

    schema = get_json(f"{base_url}/api/v1/schema")
    if "$schema" not in schema:
        raise RuntimeError("Diagnostics schema is not a JSON Schema document")
    print("PASS schema")
    scan_schema = get_json(f"{base_url}/api/v1/schemas/scan-observation")
    if scan_schema.get("properties", {}).get("type", {}).get("const") != "scan.observed":
        raise RuntimeError("Scan observation schema is not the canonical contract")
    print("PASS scan schema")
    companion_schema = get_json(f"{base_url}/api/v1/schemas/sensor-companion")
    if companion_schema.get("$defs", {}).get("announce", {}).get("properties", {}).get("nodeType", {}).get("const") != "quest-companion":
        raise RuntimeError("Sensor companion schema is not the canonical contract")
    print("PASS sensor companion schema")
    integration_schema = get_json(f"{base_url}/api/v1/schemas/integration-fixtures")
    if integration_schema.get("properties", {}).get("type", {}).get("const") != "integration.fixtures":
        raise RuntimeError("Integration fixture schema is not the canonical contract")
    integrations = get_json(f"{base_url}/api/v1/integrations/simulated")
    providers = {row.get("provider") for row in integrations.get("integrations", [])}
    if providers != {"aviationweather", "partsbase", "honeywell-forge"}:
        raise RuntimeError(f"Integration fixture registry mismatch: {providers}")
    print("PASS integration fixture schema + registry")

    state = get_json(with_token(f"{base_url}/api/v1/state", args.token))
    if not state.get("type"):
        raise RuntimeError(f"Normalized state has no message type: {state}")
    print(f"PASS state type={state['type']}")

    await check_websocket(base_url, args.token)
    print("PASS websocket MXGS/1 + ping/pong")
    await check_scanner_relay(base_url, args.token)
    print("PASS scanner normalization + relay")


if __name__ == "__main__":
    asyncio.run(main())
