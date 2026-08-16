"""Send deterministic scanner samples through the production ingest WebSocket."""

from __future__ import annotations

import argparse
import asyncio
import json

import websockets


SAMPLES = ["P/N: 65-52813-3", "S/N: MXG-POC-0007", "(01)00812345678905(10)LOT77(21)SER9"]


async def run(url: str, interval: float) -> None:
    async with websockets.connect(url) as socket:
        await socket.recv()
        await socket.send(json.dumps({
            "type": "node.announce",
            "nodeId": "synthetic-scanner",
            "nodeType": "scanner-source",
            "nodeName": "Local scanner simulator",
            "capabilities": ["scan-line", "scan-observed-1"],
        }))
        for value in SAMPLES:
            await socket.send(json.dumps({
                "type": "scan.raw",
                "value": value,
                "deviceId": "synthetic-scanner",
                "deviceName": "POC line scanner",
                "profile": "generic-line-scanner",
                "transport": "simulated",
            }))
            await asyncio.sleep(interval)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://127.0.0.1:8844/ws/ingest")
    parser.add_argument("--interval", type=float, default=0.75)
    args = parser.parse_args()
    asyncio.run(run(args.url, args.interval))
