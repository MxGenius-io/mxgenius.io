"""Bluetooth Classic RFCOMM side channel for low-bandwidth Pi diagnostics."""

from __future__ import annotations

import json
import socket
import struct
import threading
import time
from collections.abc import Callable
from typing import Any


class BluetoothDiagnosticsServer:
    """Publish length-prefixed JSON snapshots over an OS-paired RFCOMM link."""

    def __init__(self, provider: Callable[[], dict[str, Any]], channel: int = 8) -> None:
        self.provider = provider
        self.channel = channel
        self.state = "disabled"
        self.peer = ""
        self.messages = 0
        self.detail = ""
        self._running = threading.Event()
        self._thread: threading.Thread | None = None
        self._server: socket.socket | None = None

    def summary(self) -> dict[str, Any]:
        return {"state": self.state, "peer": self.peer, "messages": self.messages, "channel": self.channel, "detail": self.detail}

    def start(self) -> None:
        if self._thread or not hasattr(socket, "AF_BLUETOOTH"):
            self.state = "unsupported"
            return
        self._running.set()
        self._thread = threading.Thread(target=self._run, name="mxg-bluetooth-diagnostics", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running.clear()
        if self._server:
            try:
                self._server.close()
            except OSError:
                pass
        if self._thread:
            self._thread.join(timeout=2)

    def _run(self) -> None:
        try:
            self._server = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)
            self._server.bind(("", self.channel))
            self._server.listen(1)
            self._server.settimeout(1)
            self.state = "listening"
            while self._running.is_set():
                try:
                    client, address = self._server.accept()
                except TimeoutError:
                    continue
                except OSError:
                    if self._running.is_set():
                        raise
                    break
                self.peer = str(address[0] if isinstance(address, tuple) else address)
                self.state = "connected"
                try:
                    with client:
                        while self._running.is_set():
                            payload = json.dumps(self.provider(), separators=(",", ":")).encode("utf-8")
                            client.sendall(struct.pack("!I", len(payload)) + payload)
                            self.messages += 1
                            time.sleep(1)
                except OSError as error:
                    self.detail = str(error)
                finally:
                    self.peer = ""
                    self.state = "listening"
        except Exception as error:
            self.state = "failed"
            self.detail = str(error)
        finally:
            if self.state != "failed":
                self.state = "stopped"
