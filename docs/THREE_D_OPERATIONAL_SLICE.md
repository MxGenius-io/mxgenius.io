# Practical 3D Operational Slice

## Outcome

Turn the existing Three.js renderer into a case-linked inspection/navigation surface without claiming a simulation-grade digital twin.

The compatibility slice now ships raycast selection, reversible highlighting, click-versus-orbit protection, explicit demo-asset classification, and a same-origin iframe boundary. Canonical persistence and evidence remain mount work.

The first operational flow is:

```text
Maintenance Case
-> aircraft/component/ATA context
-> applicable model
-> mapped zone or mesh highlight
-> linked observations/documents/evidence
-> confirmed case marker
```

## Reusable Coastal Aircraft pattern

The Coastal Aircraft Maintenance example provides a useful raycasting implementation in `scene.js`:

- normalize pointer coordinates against `renderer.domElement`;
- call `raycaster.setFromCamera(pointer, camera)`;
- recursively intersect the loaded model;
- walk the selected mesh's parent path;
- preserve and restore the original material;
- clone the material and apply a visible emissive highlight.

MXGenius should reuse the interaction mechanics, not its dev-only assumptions.

## Production adaptation

### Viewer-to-host selection event

When a user clicks a mesh, the iframe posts a versioned event to the parent application:

```json
{
  "type": "mxgenius.viewer.part-selected",
  "version": 1,
  "detail": {
    "context": { "caseId": null },
    "model": { "name": "model", "revision": "v1", "operationalStatus": "demo_asset" },
    "selection": {
      "meshName": "raw-mesh-name",
      "path": "assembly › mesh",
      "mappingStatus": "demo",
      "componentId": null,
      "partNumber": null
    }
  }
}
```

Raw mesh selection is navigation data only. It is not authoritative configuration evidence.

### Host-to-viewer commands

The parent application sends typed commands:

```text
mxgenius.viewer.set-context
mxgenius.viewer.highlight-part
mxgenius.viewer.clear-selection
```

The host exposes the compatibility API as `window.MX3DViewer.setContext(...)`, `highlightPart(...)`, and `clearSelection()`. `mxgenius.viewer.ready` replays pending context and selection after model load.

These commands become consumers of:

- `mxg.digital_twin.list_models`
- `mxg.digital_twin.component_state`
- `mxg.digital_twin.highlight_zone`
- `mxg.digital_twin.link_documents`
- `mxg.digital_twin.attach_case_marker`

### Stable mapping files

Each operational model requires a versioned mapping file separate from the GLB:

```text
3d-viewer/mappings/{model_id}.json
```

Minimum shape:

```json
{
  "model_id": "example-aircraft",
  "model_revision": "1",
  "applicability": [],
  "zones": [
    {
      "zone_id": "zone-id",
      "ata_chapter": "28",
      "component_ids": [],
      "mesh_paths": [],
      "camera_preset": null,
      "mapping_evidence": []
    }
  ]
}
```

The compatibility slice accepts optional catalog `partMappings` by exact hierarchy path, with mesh name only as a temporary fallback. The MCP mount should move these records into versioned mapping files and resolve the first exact mapped path while walking ancestors. Names alone are insufficient because duplicate mesh names are common.

### Honest mapping states

Every model/selection reports one of:

- `demonstration` — visual asset only;
- `unmapped` — selectable mesh, no operational meaning;
- `mapped` — stable zone/component link exists;
- `validated` — mapping has supporting evidence and approval.

Only mapped or validated selections may be used to propose a case marker. Persisting the marker still requires the normal trusted confirmation and audit flow.

## Highlight implementation requirements

- [x] Support single and material-array meshes.
- [x] Store original material references per selected mesh.
- [x] Clone highlight materials and dispose clones when cleared.
- [x] Never mutate shared source materials globally.
- [x] Keep OrbitControls working and distinguish click from drag.
- [x] Clear selection on model replacement.
- [ ] Add separate hover and selected states.
- [ ] Ignore helper, invisible, and explicitly non-selectable meshes through mapping policy.
- [ ] Provide keyboard-accessible selection through the mapped component/zone list.
- [ ] Focus the camera using a mapped preset or computed bounding box.
- [ ] Degrade to a zone/document card when no mesh mapping exists.

## Parent workspace

The embedded viewer should be paired with a case rail containing:

- selected aircraft/model/revision;
- selected component/zone and mapping state;
- case observations and markers;
- linked manual sections/diagrams;
- evidence and currency warnings;
- `Attach marker` confirmation action.

The 3D surface does not diagnose, approve work, or establish aircraft configuration by itself.

## Asset separation

The current seven catalog models remain available but must be labelled by status. Camera, helmet, truck, gearbox, engine block, generic commercial jet, and drone assets must not be presented as validated aircraft twins.

An operational asset is admitted only when it has:

- stable model ID and revision;
- explicit aircraft/component applicability;
- license/provenance metadata;
- semantic mapping file;
- load and mapping tests;
- documented fallback behavior.

## Acceptance test for the wildcard slice

1. Open a fixture-backed Maintenance Case with a mapped component.
2. Load the applicable model and revision.
3. `highlight_zone` resolves stable mesh paths and camera context.
4. The viewer highlights the mapped meshes.
5. Clicking the mesh returns the same zone/component mapping.
6. The case rail displays linked observations, documents, and evidence.
7. A confirmed marker persists through `attach_case_marker` and appears after reload.
8. An unmapped mesh is visibly identified as unmapped and cannot silently become an operational marker.
