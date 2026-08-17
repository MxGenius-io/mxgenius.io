"""Client for the local, privileged edge-control socket."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any


CONTROL_SOCKET = os.getenv("MXG_CONTROL_SOCKET", "/run/mxg-edge-control/control.sock")
MAX_RESPONSE_BYTES = 256 * 1024


class ControlUnavailable(RuntimeError):
    """Raised when the local control agent is not installed or responding."""


async def request_control(action: str, **parameters: Any) -> dict[str, Any]:
    payload = json.dumps({"action": action, **parameters}, separators=(",", ":")).encode("utf-8") + b"\n"
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_unix_connection(CONTROL_SOCKET), timeout=2)
    except (OSError, asyncio.TimeoutError) as error:
        raise ControlUnavailable("edge control service is unavailable") from error

    try:
        writer.write(payload)
        await writer.drain()
        response = await asyncio.wait_for(reader.readline(), timeout=45)
        if not response or len(response) > MAX_RESPONSE_BYTES:
            raise ControlUnavailable("edge control service returned an invalid response")
        decoded = json.loads(response)
        if not isinstance(decoded, dict):
            raise ControlUnavailable("edge control service returned an invalid response")
        return decoded
    except (OSError, asyncio.TimeoutError, json.JSONDecodeError) as error:
        raise ControlUnavailable("edge control request failed") from error
    finally:
        writer.close()
        await writer.wait_closed()
