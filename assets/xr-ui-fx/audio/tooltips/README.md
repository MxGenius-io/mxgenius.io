# Guided tooltip audio

This folder owns the spoken guidance paired with short contextual videos.

- `../../../../services/mcp/config/environment-manifest.json` is the shared runtime inventory and approved narration; tooltip media remain in this folder.
- `voiceover/` receives final narration WAV or compressed runtime derivatives.
- `captions/` receives matching WebVTT captions.
- Short video files belong in `assets/xr-ui-fx/visual/tooltips/`.

Set an entry to `ready` only when every referenced file exists. Until then the
frontend displays the approved script without requesting missing media.
