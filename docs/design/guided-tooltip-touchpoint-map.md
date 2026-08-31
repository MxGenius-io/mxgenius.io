# Guided tooltip touchpoint map

This map is the recording and implementation contract for contextual help. Each guide ID resolves through `assets/xr-ui-fx/audio/tooltips/scripts/manifest.json`, where the narration draft, interface selectors, and visual beats live together.

## Interaction pattern

- A visible `?` opens a non-modal popover anchored to the control or section it explains.
- The same guide can render written script, video, voiceover, and captions. Scripted entries remain useful before media is recorded.
- The popover closes from its close control, Escape, a second press on the trigger, or an outside press.
- Mobile uses a stable bottom sheet so guidance does not jump as the camera or viewport changes.
- Help never replaces the primary action. Launch, selection, and workflow controls remain separate.

## Live entry points

| Surface | Guide ID | Visible trigger | Primary touchpoints | Teaching outcome |
| --- | --- | --- | --- | --- |
| Browser fleet globe | `fleet-globe-controls` | Globe top-right `?` | texture rail, fleet search/type filter, results sheet, XR launch | Filter JetNet fleet context, select a location, and carry that selection forward. |
| Maintenance case | `maintenance-case` | Case header `?` | existing case selector, intake, spatial marker controls, result | Keep discrepancy, evidence, finding, approval, and closure in one record. |
| Parts | `parts-management` | Parts toolbar `?` | receive, extraction review, inventory views, unit drawer | Explain evidence-first receiving and controlled serialized inventory. |
| 3D viewer shell | `3d-viewer-navigation` | Viewer tab and viewer header `?` | model selector, canvas, camera reset, HUD preview, VR | Move from model selection to spatial inspection without losing context. |
| 3D mesh inspector | `mesh-inspection` | Part inspector `?` | mesh selection, hierarchy path, mapping state | Make the selected mesh the anchor for parts, cases, and procedures. |
| Fleet XR scene | `fleet-globe-controls` | XR scene HUD `?` | summary HUD, location points, detail card, model context | Reuse the browser fleet mental model in headset space. |
| Sensor scene | `sensor-bridge-flow` | Sensor HUD `?` | app handoff, native panel, FLIR source, compatibility trace | Show exactly where the browser-to-native-to-camera chain is waiting. |
| Native iOS AR | `native-ar-globe` | Companion `?` shown only with AR control | placement, location pin, aircraft card, model context | Mirror fleet globe selection in an iOS-only spatial view. |

## Mapped follow-on touchpoints

These guides are already scripted in the manifest so a trigger can be added when the corresponding UI state is stable.

| Guide ID | Surface/state | Touchpoints | Activation note |
| --- | --- | --- | --- |
| `fleet-location-data` | Globe location selected | globe tooltip, results sheet, XR location card | Open from the selected-location detail card. |
| `aircraft-explorer` | Aircraft Explorer expanded | triage/direct mode, filters, aircraft result | Place in the expanded section body, not inside the interactive `<summary>`. |
| `procedure-media` | Selected mesh has paired media | media button, drawer, video, pairing label | Show only when `data-ready="true"`. |
| `thermal-mount-exploded` | Thermal mount assembly loaded | model/animation selectors, play, scrubber, inspector | Keep dormant until the authored assembly and exploded animation are present. |
| `sensor-diagnostics` | Sensor scene overview | source status, evidence capture, realtime witness | Use after the bridge guide when the sensor is streaming. |
| `model-context` | Copilot has an active aircraft/part/mesh | selection chip, chat context, source references | Add after one shared visual treatment exists across browser and spatial surfaces. |

## Recording template

Each tooltip should target 20–35 seconds and use the same four-part rhythm:

1. **Orient** — name the workspace and the operational outcome.
2. **Act** — demonstrate no more than two primary interactions.
3. **Confirm** — point to the state, source, or evidence that proves the action succeeded.
4. **Hand off** — state the next logical workspace or decision.

The manifest `beats` are the shot list. Record the visual pass first, then write the final voiceover to the actual timing, and derive captions from the approved voiceover. Avoid describing animation that is not yet implemented or calling registry/fleet data a live flight track.

## Media naming contract

For guide ID `example-guide`:

- Video: `assets/xr-ui-fx/visual/tooltips/example-guide.mp4`
- Voiceover: `assets/xr-ui-fx/audio/tooltips/voiceover/example-guide.wav`
- Captions: `assets/xr-ui-fx/audio/tooltips/captions/example-guide.vtt`

Change the manifest status from `scripted` to `ready` only after all three assets exist and the timing has been checked in both the anchored desktop popover and the mobile bottom sheet.
