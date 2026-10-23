#!/usr/bin/env python3
"""Relay the physical push-to-talk button into the local kiosk event stream."""

from __future__ import annotations

import json
import os
import signal
import sys
import time
import urllib.error
import urllib.request

from gpiozero import Button


ENDPOINT = os.getenv("MXG_LOCAL_BUTTON_ENDPOINT", "http://127.0.0.1:8844/api/v1/hardware/button")
TALK_GPIO = int(os.getenv("MXG_TALK_GPIO", "17"))


def publish(pressed: bool) -> None:
    body = json.dumps({"button": "talk", "pressed": pressed}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt < 2:
                time.sleep(0.2 * (attempt + 1))
    print("physical talk-button event could not reach the local kiosk", file=sys.stderr, flush=True)


def main() -> int:
    button = Button(TALK_GPIO, pull_up=True, bounce_time=0.03)
    button.when_pressed = lambda: publish(True)
    button.when_released = lambda: publish(False)
    publish(button.is_pressed)
    signal.pause()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
