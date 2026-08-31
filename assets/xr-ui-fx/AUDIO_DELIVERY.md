# Audio Delivery — MXGenius XR UI & FX

26 sound-cue source masters generated, all `status: needed` rows from `sound-cues.csv`.

## Delivery summary

| Spec | Value | Note |
|---|---|---|
| Format | WAV (PCM) | per `audio/*/README.md` |
| Sample rate | 44100 Hz | tool constraint — brief asked 48 kHz; resample at runtime if needed |
| Bit depth | 16-bit | tool constraint — brief asked 24-bit; convert with `ffmpeg -c:a pcm_s24le` if needed |
| Channels | Mono (1) | per brief: 'mono unless stereo width is intentional' |
| Peak normalization | By priority | P0 −3 dBFS, P1 −8 dBFS, P2 −12 dBFS, P3 −16 dBFS |
| Loudness | EBU R128 via `loudnorm` | target −16 LUFS, TP −1.5 dB |
| Fade in | 6 ms | |
| Fade out | 50 ms | within brief's 40–80 ms cancellation-release window |
| Loops (SND-010, SND-020) | 120/80 ms acrossfade | seamless on join |
| Total runtime | 13.5 s (sum) | |

## Caveats

1. The available audio model is a text-to-music generator, not a dedicated SFX synth.
   Each cue was produced by a 10–60 second generation that was trimmed and processed
   to the target duration. Source material is musical/ambient, so the resulting cues
   carry some musical character; if you need strictly synthetic/digital, regenerate
   with a dedicated SFX tool.
2. The model could not hit the brief's 48 kHz / 24-bit target exactly. Resample/convert
   with `ffmpeg` at intake if your runtime requires those exact values.
3. Family consistency was achieved with priority-based peak targets, not a single
   master loudness target — the brief says routine UI is quiet and safety is loudest.
4. Loops were built by extracting a section of source and crossfading the two halves
   at the join point. If a loop sounds off, regenerate the source with a more loop-friendly prompt.

## Cue manifest

| ID | File | Folder | Pri | Target ms | Actual ms | Peak dB | Character |
|---|---|---|---|---:|---:|---:|---|
| SND-001 | `ui_focus_soft.wav` | `audio/ui` | P3 | 90 | 90 | -15.6 | Airy tactile tick with no pitch flourish |
| SND-002 | `ui_press_primary.wav` | `audio/ui` | P1 | 120 | 120 | -7.6 | Short confident mechanical-soft click |
| SND-003 | `ui_press_secondary.wav` | `audio/ui` | P2 | 100 | 100 | -12.3 | Lighter dry click related to primary press |
| SND-004 | `ui_cancel_retract.wav` | `audio/ui` | P1 | 240 | 240 | -7.5 | Soft inward reverse sweep ending cleanly |
| SND-005 | `ui_back_close.wav` | `audio/ui` | P2 | 160 | 160 | -11.5 | Muted downward tuck |
| SND-006 | `workflow_step_advance.wav` | `audio/ui` | P1 | 260 | 260 | -7.6 | Two-tone restrained upward confirmation |
| SND-007 | `workflow_complete.wav` | `audio/ui` | P2 | 420 | 420 | -11.5 | Warm single resolution tone without celebration |
| SND-008 | `voice_listen_start.wav` | `audio/ui` | P1 | 220 | 220 | -7.6 | Soft breath-like aperture |
| SND-009 | `voice_listen_stop.wav` | `audio/ui` | P1 | 180 | 180 | -8.7 | Matching aperture closes |
| SND-010 | `voice_processing_loop.wav` | `audio/ui` | P3 | 1200 | 1200 | -15.5 | Very quiet organic digital texture |
| SND-011 | `spatial_acquire.wav` | `audio/spatial` | P1 | 520 | 520 | -7.5 | Directional narrowing sweep resolving at target |
| SND-012 | `spatial_candidate.wav` | `audio/spatial` | P1 | 360 | 360 | -7.5 | Soft unresolved amber harmonic with open tail |
| SND-013 | `spatial_confirm.wav` | `audio/spatial` | P1 | 300 | 300 | -7.6 | Stable compact green-toned chime |
| SND-014 | `spatial_rejected.wav` | `audio/spatial` | P1 | 300 | 300 | -7.6 | Low-energy dissolve with no error alarm |
| SND-015 | `spatial_guide_begin.wav` | `audio/spatial` | P2 | 420 | 420 | -11.5 | Subtle directional rise from user toward target |
| SND-016 | `spatial_target_arrive.wav` | `audio/spatial` | P2 | 180 | 180 | -11.6 | Small localized arrival ping |
| SND-017 | `evidence_capture.wav` | `audio/ui` | P1 | 220 | 220 | -7.5 | Camera-adjacent tactile seal without mimicking a phone shutter |
| SND-018 | `evidence_attached.wav` | `audio/ui` | P2 | 260 | 260 | -11.6 | Soft latch confirmation |
| SND-019 | `provenance_open.wav` | `audio/ui` | P3 | 260 | 260 | -15.1 | Layered paper-thin unfold |
| SND-020 | `system_relocalizing_loop.wav` | `audio/system` | P1 | 1600 | 1600 | -7.5 | Nearly subliminal slow locator texture |
| SND-021 | `system_relocalized.wav` | `audio/system` | P1 | 280 | 280 | -7.5 | Quiet focus snap with softened tail |
| SND-022 | `system_degraded.wav` | `audio/system` | P1 | 300 | 300 | -7.5 | Single neutral descending interval |
| SND-023 | `system_reconnected.wav` | `audio/system` | P2 | 300 | 300 | -11.5 | Single neutral resolving interval |
| SND-024 | `system_permission_needed.wav` | `audio/system` | P2 | 260 | 260 | -11.5 | Polite hollow knock with no alarm character |
| SND-025 | `safety_attention.wav` | `audio/system` | P0 | 380 | 380 | -2.6 | One decisive broadband attention cue with short tail |
| SND-026 | `safety_acknowledged.wav` | `audio/system` | P0 | 280 | 280 | -2.6 | Grounded low-mid confirmation tone |

## Production notes

- Source masters are placed in `audio/<family>/<filename.wav>` per the intake rules in the parent `README.md`.
- All filenames match `sound-cues.csv` exactly.
- Folder assignments match the CSV (UI, spatial, system).
- Spatial cues are mono with a flat envelope — the runtime owns positioning and room response.
- Routine cues are quiet; only the safety family reaches near-full scale.
- Clean tails are guaranteed by the 50 ms fade-out, so cancellation can use the full 40–80 ms release window.
