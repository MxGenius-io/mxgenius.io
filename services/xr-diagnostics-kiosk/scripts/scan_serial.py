"""Bridge a newline-delimited USB CDC, serial, or Bluetooth SPP scanner into MXG."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

import serial
import websockets


async def run(args: argparse.Namespace) -> None:
    transport = "bluetooth-spp" if args.port.startswith("/dev/rfcomm") else "usb-cdc"
    while True:
        try:
            with serial.Serial(args.port, args.baud, timeout=1) as source:
                async with websockets.connect(args.url) as socket:
                    await socket.recv()
                    await socket.send(json.dumps({
                        "type": "node.announce",
                        "nodeId": args.device_id,
                        "nodeType": "scanner-source",
                        "nodeName": args.device_name,
                        "capabilities": ["scan-line", "scan-observed-1"],
                    }))
                    while True:
                        line = await asyncio.to_thread(source.readline)
                        if not line:
                            continue
                        value = line.decode(args.encoding, errors="replace").strip("\r\n\x00 ")
                        if not value:
                            continue
                        await socket.send(json.dumps({
                            "type": "scan.raw",
                            "value": value,
                            "deviceId": args.device_id,
                            "deviceName": args.device_name,
                            "profile": args.profile,
                            "transport": transport,
                            "symbology": "unknown",
                        }))
        except asyncio.CancelledError:
            raise
        except Exception as error:
            print(f"scanner bridge disconnected: {error}; retrying", file=sys.stderr)
            await asyncio.sleep(args.retry_seconds)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, help="For example /dev/ttyACM0 or /dev/rfcomm0")
    parser.add_argument("--url", default="ws://127.0.0.1:8844/ws/ingest")
    parser.add_argument("--baud", type=int, default=9600)
    parser.add_argument("--encoding", default="utf-8")
    parser.add_argument("--device-id", default="line-scanner-1")
    parser.add_argument("--device-name", default="MXG line scanner")
    parser.add_argument("--profile", default="generic-line-scanner")
    parser.add_argument("--retry-seconds", type=float, default=2.0)
    asyncio.run(run(parser.parse_args()))
