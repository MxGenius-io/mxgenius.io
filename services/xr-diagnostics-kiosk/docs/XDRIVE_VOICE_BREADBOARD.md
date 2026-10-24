# XDrive voice breadboard

This is the two-button, three-indicator circuit for the Pi 5 kiosk proof of
concept. It keeps the power control on the Pi's supported power-button input
and keeps all audio off the GPIO header.

![XDrive Raspberry Pi 5 voice breadboard schematic](xdrive-voice-breadboard.svg)

## Signal path

```text
 raw electret capsule
       │
       ▼
 electret bias / microphone preamp ──► USB audio microphone input
                                             │
                                             ▼
                                      Raspberry Pi 5
                                             │
                                             ▼
 USB audio headphone/line output ──► small audio amplifier ──► raw speaker

 momentary TALK switch:  GPIO17 (physical pin 11) ── switch ── GND (pin 9)
 momentary POWER switch: Pi 5 J2 pad ─────────────── switch ── other J2 pad

 GPIO22 (physical pin 15) ── green LOCAL AI LED ── 330 Ω ── GND rail
 GPIO23 (physical pin 16) ── blue CLOUD AI LED ─── 330 Ω ── GND rail
 GPIO24 (physical pin 18) ── amber LISTENING LED ─ 330 Ω ── GND rail
 physical pin 20 / GND ───────────────────────────────────── GND rail
```

## Wiring table

| Function | From | To | Notes |
| --- | --- | --- | --- |
| Push-to-talk | Pi header physical pin 11 / BCM GPIO17 | One side of a normally-open momentary switch | The kiosk enables an internal pull-up. Do not add 5 V or 3.3 V. |
| Push-to-talk return | Other side of the TALK switch | Pi header physical pin 9 / GND | A press pulls GPIO17 low. |
| Power | One Pi 5 J2 power-button pad | One side of a normally-open momentary switch | J2 is the two-pad power-button breakout near the RTC battery connector and board edge. |
| Power return | Other Pi 5 J2 pad | Other side of the POWER switch | Briefly close it. Do not put supply voltage on J2. |
| Local inference indicator | Pi physical pin 15 / BCM GPIO22 | Green LED anode; cathode through 330 Ω to the ground rail | Reserved for a future local inference runtime. It remains off in the cloud-only POC. |
| Cloud AI indicator | Pi physical pin 16 / BCM GPIO23 | Blue LED anode; cathode through 330 Ω to the ground rail | Steady while the Realtime cloud session is connected. |
| Listening indicator | Pi physical pin 18 / BCM GPIO24 | Amber LED anode; cathode through 330 Ω to the ground rail | Steady while the microphone is live. |
| Breadboard ground | Pi physical pin 20 / GND | Breadboard negative rail | Common return for the three LEDs and TALK switch only. |
| Microphone | Electret capsule | Electret preamp or a USB sound adapter microphone input that explicitly supplies electret bias | Capsule polarity and the adapter's bias voltage must be confirmed before soldering. |
| Audio input | Preamp / USB microphone | Pi USB-A host port | Select the device as the Chromium default capture source. |
| Audio output | Pi USB-A host port / USB sound output | Powered speaker or amplifier input | A raw speaker cannot be connected directly to a GPIO or headphone-level output. |
| Speaker | Amplifier output | Two speaker leads | Use an amplifier rated for the speaker impedance. Do not tie a bridge-amplifier output to Pi ground. |

The photographed microphone appears to be a two-lead electret capsule, and the
rectangular part appears to be a raw two-wire speaker. The photographs do not
establish capsule polarity, speaker impedance, or power rating. Confirm those
three facts from markings, a listing, or a meter before choosing the preamp and
amplifier.

## Recommended first bench configuration

Use one class-compliant USB audio adapter with a biased microphone input and a
headphone output. Feed the raw speaker from a small powered amplifier such as a
mono 5 V module; do not connect the speaker directly to the Pi. This avoids I2S
pin assignments while the push-to-talk and cloud loop are being proven.

The appliance software uses:

- BCM GPIO17, active-low, 30 ms debounce for push-to-talk;
- BCM GPIO22 / physical pin 15 for the green local-AI indicator;
- BCM GPIO23 / physical pin 16 for the blue cloud-AI indicator;
- BCM GPIO24 / physical pin 18 for the amber listening indicator;
- a three-LED chase while the Realtime response is thinking, then restoration
  of the steady connection/listening state;
- the Pi 5 J2 power header for safe shutdown and restart;
- the enrolled XDrive device credential for `/api/edge/realtime/calls`;
- the Azure-hosted `OPENAI_API_KEY` only inside `mxg-core`;
- manual Realtime turns: press enables the microphone and interrupts playback;
  release commits the input buffer and requests the response.

## Bring-up order

1. Enroll the Pi from the kiosk's Equipment Pack card and confirm the node is
   shown as enrolled.
2. Attach the USB audio adapter. Verify capture and playback devices with
   `arecord -l` and `aplay -l`.
3. Open the kiosk and select **Connect voice**. Hold the on-screen button for
   the first loop test.
4. Wire the TALK switch between physical pins 11 and 9. Confirm
   `systemctl status mxg-hardware-buttons.service` is healthy, then hold and
   release the physical switch.
5. With the Pi disconnected from power, wire the separate POWER switch across
   J2. Reconnect power and verify a brief press performs the normal Pi 5 power
   action. Avoid holding it, because a long hold is the hardware-forced shutdown
   path.

No provider API key, microphone recording, or transcript is written to the SD
image by this voice loop. The kiosk log records only state transitions and that
a transcript completed, not transcript text.
