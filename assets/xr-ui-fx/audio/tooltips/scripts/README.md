# Tooltip script workflow

`manifest.json` is both the narration inventory and runtime manifest. Each item
must have a stable ID, title, approved narration, media paths, and status.

`voiceover-master.txt` contains the same narration in manifest order with no
headings or production notes. Blank lines are intentional split points for a
single recording or text-to-speech pass. Keep it synchronized with every
non-retired manifest `script` value.

Entries are expected to be reachable through a contextual trigger or onboarding.
Use `"activation": "planned"` only when the corresponding frontend state is not
implemented yet.

Statuses:

- `scripted` — narration is ready, media should not be requested.
- `recording` — voiceover exists and may autoplay; video and captions are still in production.
- `ready` — video/voiceover/captions exist and may autoplay.
- `retired` — retained for history but not mounted.
