# MXGenius XR UI and FX Intake

This folder is the intake point for production UI audio, spatial audio, motion
references, and renderer effects used by the MXGenius spatial workbench.

The governing rule is **continuous presence**: an interface object does not
blink into or out of reality. It enters, changes confidence, relocates, loses
tracking, cancels, and exits through an explicit transition.

## Drop locations

- `audio/ui/` — non-spatial controls and workflow acknowledgements
- `audio/spatial/` — sounds associated with a world-space referent
- `audio/system/` — connection, degraded-mode, and safety state
- `motion/` — motion references, Lottie/Rive sources, or rendered previews
- `visual/` — textures, sprites, masks, particles, and shader references

Use the filenames in `sound-cues.csv` and `motion-fx.csv`. Source masters may
be WAV/FLAC; runtime derivatives should be OGG or another platform-approved
compressed format. Never overwrite a source master with a runtime conversion.

## Interaction principles

1. The aircraft remains the dominant visual object.
2. Routine success is quiet. Sound confirms an action; it does not celebrate it.
3. Only safety-critical conditions interrupt speech or use the red alert family.
4. Candidate, confirmed, and invalidated states must sound and move differently.
5. World-locked audio is used only when direction helps the technician.
6. Tracking loss is shown as `relocalizing`; content holds, softens, and rebinds.
7. Cancellation is first-class. Every persistent visual action can retract cleanly.
8. Reduced-motion mode replaces travel, sweep, and spring motion with short fades.
9. Audio, haptics, and visual animation share the same action ID and event time.
10. Effects are deterministic so recorded event sessions can be replayed exactly.

## Motion timing floor

| Family | Normal timing | Reduced motion | Notes |
| --- | ---: | ---: | --- |
| Button response | 90–140 ms | 0–80 ms | Immediate depression; no bounce loop |
| Tooltip/label | 160–240 ms | 100–160 ms | Fade and 1–2 cm settle |
| Panel enter/change | 280–420 ms | 140–220 ms | Morph from source control when possible |
| Spatial acquisition | 500–800 ms | 180–260 ms | Brackets resolve onto the target |
| Confidence change | 400–700 ms | 180–260 ms | Morph line style and color; never replace |
| Relocalization | 800–1600 ms | 300–500 ms | Hold pose, soften, then rebind smoothly |
| Cancellation/clear | 220–360 ms | 120–180 ms | Retract toward referent or originating control |
| Critical alert | 250–400 ms | 150–250 ms | One decisive arrival; no perpetual blinking |

## Continuity behavior

- Hold the last trustworthy world pose for 350 ms after tracking loss.
- Over the next 1.2 seconds, reduce opacity to 55%, desaturate, and display a
  restrained `RELOCALIZING` tether.
- When tracking returns, interpolate to the corrected pose; never teleport.
- If tracking does not return, dock the item into a screen-relative recovery
  tray with its identity and reason intact.
- New evidence changes an existing annotation through a state morph. It does
  not destroy one card and spawn another.
- Occlusion changes visibility continuously and never triggers entry audio.

## Audio delivery targets

- Source masters: 48 kHz, 24-bit WAV, mono unless stereo width is intentional.
- UI cues: generally 80–450 ms and peak-normalized consistently as a family.
- Spatial cues: mono, dry, minimal reverb; the runtime owns positioning.
- Loops: seamless and subtle; only listening, searching, and relocalizing may loop.
- Leave at least 3 dB of headroom and avoid strong energy below 100 Hz.
- Supply clean tails so cancellation can use a 40–80 ms release without clicks.

## Conversation-derived additions

The uploaded architecture conversation adds these UX requirements without
adding permanent HUD clutter:

- capability negotiation appears as an expandable system-status surface;
- observation, interpretation, and action retain distinct visual/audio grammar;
- `WHY?` reveals action provenance in place;
- `CANCEL`/`CLEAR` can invalidate an action immediately by action ID;
- the inspection rail doubles as an event timeline for replay;
- loss of cloud/model/sensor capability degrades progressively instead of
  collapsing the workspace;
- simulation/replay lives in the Tauri developer workbench, not the technician HUD;
- confidence changes morph the existing referent instead of replacing it;
- evidence snapshots acknowledge capture without implying the observation is verified.
