# Tooltip script workflow

`manifest.json` is both the narration inventory and runtime manifest. Each item
must have a stable ID, title, approved narration, media paths, and status.

Statuses:

- `scripted` — narration is ready, media should not be requested.
- `recording` — production is in progress, media should not be requested.
- `ready` — video/voiceover/captions exist and may autoplay.
- `retired` — retained for history but not mounted.
