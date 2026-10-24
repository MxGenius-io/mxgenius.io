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

from gpiozero import Button, LED, RotaryEncoder


ENDPOINT = os.getenv("MXG_LOCAL_BUTTON_ENDPOINT", "http://127.0.0.1:8844/api/v1/hardware/button")
LED_ENDPOINT = os.getenv("MXG_LOCAL_LED_ENDPOINT", "http://127.0.0.1:8844/api/v1/hardware/leds")
TALK_GPIO = int(os.getenv("MXG_TALK_GPIO", "17"))
UP_GPIO = int(os.getenv("MXG_UP_GPIO", "5"))
DOWN_GPIO = int(os.getenv("MXG_DOWN_GPIO", "6"))
LEFT_GPIO = int(os.getenv("MXG_LEFT_GPIO", "12"))
RIGHT_GPIO = int(os.getenv("MXG_RIGHT_GPIO", "13"))
OK_GPIO = int(os.getenv("MXG_OK_GPIO", "16"))
BACK_GPIO = int(os.getenv("MXG_BACK_GPIO", "19"))
VOLUME_A_GPIO = int(os.getenv("MXG_VOLUME_A_GPIO", "20"))
VOLUME_B_GPIO = int(os.getenv("MXG_VOLUME_B_GPIO", "21"))
VOLUME_MUTE_GPIO = int(os.getenv("MXG_VOLUME_MUTE_GPIO", "26"))
LOCAL_LED_GPIO = int(os.getenv("MXG_LOCAL_LED_GPIO", "22"))
CLOUD_LED_GPIO = int(os.getenv("MXG_CLOUD_LED_GPIO", "23"))
LISTENING_LED_GPIO = int(os.getenv("MXG_LISTENING_LED_GPIO", "24"))


def publish(button: str, pressed: bool) -> None:
    body = json.dumps({"button": button, "pressed": pressed}, separators=(",", ":")).encode("utf-8")
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
    print(f"physical {button} event could not reach the local kiosk", file=sys.stderr, flush=True)


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
    buttons = {
        "talk": Button(TALK_GPIO, pull_up=True, bounce_time=0.03),
        "up": Button(UP_GPIO, pull_up=True, bounce_time=0.03),
        "down": Button(DOWN_GPIO, pull_up=True, bounce_time=0.03),
        "left": Button(LEFT_GPIO, pull_up=True, bounce_time=0.03),
        "right": Button(RIGHT_GPIO, pull_up=True, bounce_time=0.03),
        "ok": Button(OK_GPIO, pull_up=True, bounce_time=0.03),
        "back": Button(BACK_GPIO, pull_up=True, bounce_time=0.03),
        "volume_mute": Button(VOLUME_MUTE_GPIO, pull_up=True, bounce_time=0.05),
    }
    volume = RotaryEncoder(VOLUME_A_GPIO, VOLUME_B_GPIO, max_steps=10_000, wrap=True)
    leds = {
        "local": LED(LOCAL_LED_GPIO, initial_value=False),
        "cloud": LED(CLOUD_LED_GPIO, initial_value=False),
        "listening": LED(LISTENING_LED_GPIO, initial_value=False),
    }
    stop = threading.Event()
    led_thread = threading.Thread(target=render_leds, args=(stop, leds), name="mxg-status-leds", daemon=True)
    for name, button in buttons.items():
        button.when_pressed = lambda name=name: publish(name, True)
        button.when_released = lambda name=name: publish(name, False)
    volume.when_rotated_clockwise = lambda: publish("volume_up", True)
    volume.when_rotated_counter_clockwise = lambda: publish("volume_down", True)
    publish("talk", buttons["talk"].is_pressed)
    led_thread.start()
    try:
        signal.pause()
    finally:
        stop.set()
        led_thread.join(timeout=2)
        for button in buttons.values():
            button.close()
        volume.close()
        for led in leds.values():
            led.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
