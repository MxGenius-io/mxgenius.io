#!/usr/bin/env python3
"""Relay the physical controls and render the kiosk status LEDs."""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.request

from gpiozero import Button, LED


ENDPOINT = os.getenv("MXG_LOCAL_BUTTON_ENDPOINT", "http://127.0.0.1:8844/api/v1/hardware/button")
LED_ENDPOINT = os.getenv("MXG_LOCAL_LED_ENDPOINT", "http://127.0.0.1:8844/api/v1/hardware/leds")
TALK_GPIO = int(os.getenv("MXG_TALK_GPIO", "17"))
LOCAL_LED_GPIO = int(os.getenv("MXG_LOCAL_LED_GPIO", "22"))
CLOUD_LED_GPIO = int(os.getenv("MXG_CLOUD_LED_GPIO", "23"))
LISTENING_LED_GPIO = int(os.getenv("MXG_LISTENING_LED_GPIO", "24"))


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


def fetch_led_state() -> dict[str, bool]:
    try:
        with urllib.request.urlopen(LED_ENDPOINT, timeout=2) as response:
            payload = json.load(response)
        return {
            name: payload.get(name) is True
            for name in ("local", "cloud", "listening", "thinking")
        }
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return {"local": False, "cloud": False, "listening": False, "thinking": False}


def set_leds(leds: dict[str, LED], active: str | None) -> None:
    for name, led in leds.items():
        led.value = name == active if active is not None else False


def render_leds(stop: threading.Event, leds: dict[str, LED]) -> None:
    chase_index = 0
    names = tuple(leds)
    while not stop.is_set():
        state = fetch_led_state()
        if state["thinking"]:
            set_leds(leds, names[chase_index % len(names)])
            chase_index += 1
            stop.wait(0.14)
            continue
        chase_index = 0
        for name, led in leds.items():
            led.value = state[name]
        stop.wait(0.15)
    set_leds(leds, None)


def main() -> int:
    button = Button(TALK_GPIO, pull_up=True, bounce_time=0.03)
    leds = {
        "local": LED(LOCAL_LED_GPIO, initial_value=False),
        "cloud": LED(CLOUD_LED_GPIO, initial_value=False),
        "listening": LED(LISTENING_LED_GPIO, initial_value=False),
    }
    stop = threading.Event()
    led_thread = threading.Thread(target=render_leds, args=(stop, leds), name="mxg-status-leds", daemon=True)
    button.when_pressed = lambda: publish(True)
    button.when_released = lambda: publish(False)
    publish(button.is_pressed)
    led_thread.start()
    try:
        signal.pause()
    finally:
        stop.set()
        led_thread.join(timeout=2)
        button.close()
        for led in leds.values():
            led.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
