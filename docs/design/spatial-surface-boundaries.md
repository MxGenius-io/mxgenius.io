# MXGenius spatial surface boundaries

This contract keeps the four spatial products distinct while allowing them to
share visual, audio, identity, and model-session infrastructure.

## 1. Fleet globe

The globe is the JetNet fleet-intelligence surface.

- Source: authenticated JetNet aircraft, company, image, and engine data.
- Primary object: a geographic fleet location containing selectable aircraft.
- Controls: map texture, fleet attention filters, location paging, rotation,
  recentering, and location/aircraft drill-down.
- Model context: the selected JetNet location is supplied to the spatial
  copilot; only typed application capabilities may retrieve operational facts.
- Excludes: FLIR/Pi bridge initialization and thermal diagnostics.

## 2. 3D viewer

The viewer is the technical model and mesh-inspection surface.

- Sources: owned GLB assets and approved open technical sources such as NASA.
- Primary object: the selected model, mesh, component, or authored animation.
- Controls: mesh selection, maintenance HUD, procedure media, animation
  scrubbing, and one-/two-grab model manipulation.
- Thermal-mount responsibility: the mount assembly and its exploded view live
  here, not in the globe or sensor workspace.

## 3. Sensor workspace

The sensor workspace owns the FLIR and Pi bridge lifecycle.

- Sources: Quest-local FLIR bridge, optional Pi diagnostics, and remote witness.
- Primary object: thermal frames, bridge state, diagnostic trace, and captured
  evidence.
- Controls: connect/launch, show or pin thermal display, scale, voice, and
  snapshot evidence.
- Isolation: loading the fleet globe must not import, start, or preflight the
  sensor runtime.

## 4. Native AR

AR is the iOS-only mobile equivalent of the fleet globe.

- Source and behavior: the same bounded JetNet globe pins, location selection,
  aircraft detail, model context, and spatial audio used by the fleet surface.
- Host gate: it is exposed only when Capacitor reports the `ios` platform and
  the native JetNet AR plugin reports support.
- Unsupported behavior: AR controls remain hidden and disabled on the web,
  Android, Quest, and any host without the native capability.

## Shared infrastructure

The surfaces may share authentication, the application client, typed model
capabilities, realtime voice presence, spatial audio cues, and the future
guided-tooltip engine. Sharing infrastructure must not merge their domain
objects or start another surface's runtime.
