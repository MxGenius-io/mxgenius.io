"""Send a synthetic RGBA thermal stream through the real MXGS relay contract."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import struct
import time

import websockets


def frame(width: int, height: int, tick: float) -> bytes:
    pixels = bytearray(width * height * 4)
    centers = [
        (0.28 + math.sin(tick * 0.7) * 0.08, 0.5, 0.15),
        (0.7, 0.38 + math.cos(tick * 0.5) * 0.12, 0.22),
    ]
    for y in range(height):
        for x in range(width):
            nx, ny = x / width, y / height
            heat = 0.05
            for cx, cy, radius in centers:
                distance = math.hypot(nx - cx, ny - cy)
                heat += max(0.0, 1.0 - distance / radius)
            heat = max(0.0, min(1.0, heat))
            red = min(255, int(heat * 510))
            green = min(255, max(0, int((heat - 0.35) * 510)))
            blue = min(255, max(0, int((0.45 - heat) * 420)))
            offset = (y * width + x) * 4
            pixels[offset:offset + 4] = bytes((red, green, blue, 255))
    metadata = json.dumps({"simulated": True, "palette": "iron"}, separators=(",", ":")).encode()
    header = struct.pack("<4sBBBBHHQI", b"MXGS", 1, 1, 2, 0, width, height, time.monotonic_ns(), len(metadata))
    return header + metadata + pixels


async def run(url: str, seconds: float, fps: float) -> None:
    async with websockets.connect(url, max_size=8 * 1024 * 1024) as socket:
        await socket.recv()
        await socket.send(json.dumps({
            "type": "node.announce",
            "nodeId": "synthetic-thermal",
            "nodeType": "sensor-source",
            "nodeName": "Local thermal simulator",
            "capabilities": ["thermal-rgba8", "mxgs-1"],
        }))
        started = time.monotonic()
        while time.monotonic() - started < seconds:
            await socket.send(frame(160, 120, time.monotonic() - started))
            await asyncio.sleep(1 / max(1, fps))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://127.0.0.1:8844/ws/ingest")
    parser.add_argument("--seconds", type=float, default=15)
    parser.add_argument("--fps", type=float, default=10)
    args = parser.parse_args()
    asyncio.run(run(args.url, args.seconds, args.fps))
