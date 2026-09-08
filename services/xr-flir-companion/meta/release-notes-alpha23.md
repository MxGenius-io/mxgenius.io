## MxGenius Sensor Bridge 0.1.0-alpha.23

- Repairs customer-to-technician audio routing for Remote Witness sessions on Quest.
- Uses an explicit, temporary voice-communication route and audio focus, then restores the prior device state when the peer closes.
- Surfaces native audio initialization, start, runtime, focus, and route failures to the wearer.
- Marks customer audio live only after inbound RTP packets and native speaker playout are both confirmed.
- Keeps the Quest receive-only: no wearer microphone permission or capture was added.
