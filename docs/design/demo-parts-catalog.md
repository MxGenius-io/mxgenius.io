# Demo Parts Catalog Expansion

This frozen roster adds **47 fictional inventory cards** to the MXGenius Parts
demo. It supplements the existing Friday scenario inventory; it does not replace
or reinterpret any real operator, OEM, or approved maintenance data.

## Durable contract

- Every row has one synthetic `parts` record and one tenant-scoped
  `stock_units` record. A catalog row without a stock unit does not produce a
  card in the Parts workspace.
- `MXG-DEMO-` is the presentation-data boundary. No identifier in this roster
  is an approved, orderable, or aircraft-applicable part number.
- `slug` is immutable and is stored as `metadata.demo_visual_key`. The local
  image contract is `media/demo/parts/<slug>.jpg`.
- Names and part numbers may be improved later without renaming an existing
  image. Category and catalog index remain metadata so a future filter or
  curated ordering can be added without parsing descriptions.
- Serialized inventory stays at quantity one. Bulk consumables and hardware
  use a single lot card with a synthetic on-hand quantity.
- The presentation view retrieves up to 200 demo units and shows the complete
  demo inventory. It must not silently collapse back to the six Friday-flow
  parts.

## Build passes

1. **Roster and cards** — seed all 47 part masters and stock units, widen demo
   presentation scope, and resolve images from stable visual keys.
2. **Images** — generate one distinct 3:2 catalog image per slug. Never copy one
   asset to fill multiple cards.
3. **Closeout** — verify count, unique paths and hashes, readable cards, drawer
   rendering, lazy loading, and no production records in presentation mode.

## Frozen roster

Condition codes are the application values: `NE` new, `SV` serviceable, `OH`
overhauled, and `US` unserviceable/display-only pending inspection. `US` rows
are seeded in quarantine.

| # | Synthetic part number | Display name | Category | Class | Condition | Qty | Reorder | Slug |
|---:|---|---|---|---|---:|---:|---:|---|
| 1 | MXG-DEMO-LGT-1101 | Aurora Wingtip Navigation Module | Lighting | repairable | NE | 1 | 2 | `aurora-wingtip-nav-module` |
| 2 | MXG-DEMO-LGT-1102 | Runway Caster Taxi Lamp | Lighting | repairable | SV | 1 | 2 | `runway-caster-taxi-lamp` |
| 3 | MXG-DEMO-LGT-1103 | PulseCrest Beacon Head | Lighting | repairable | OH | 1 | 1 | `pulsecrest-beacon-head` |
| 4 | MXG-DEMO-LGT-1104 | LumaRail Cabin Strip Kit | Lighting | consumable | NE | 12 | 4 | `lumarail-cabin-strip-kit` |
| 5 | MXG-DEMO-WBR-2101 | AeroArc Nose Wheel Assembly | Wheels & Brakes | rotable | OH | 1 | 1 | `aeroarc-nose-wheel-assembly` |
| 6 | MXG-DEMO-WBR-2102 | VectorTorque Main Wheel | Wheels & Brakes | rotable | SV | 1 | 1 | `vectortorque-main-wheel` |
| 7 | MXG-DEMO-WBR-2103 | HeatWeave Brake Rotor | Wheels & Brakes | repairable | NE | 1 | 4 | `heatweave-brake-rotor` |
| 8 | MXG-DEMO-WBR-2104 | ClampForce Brake Caliper | Wheels & Brakes | repairable | OH | 1 | 2 | `clampforce-brake-caliper` |
| 9 | MXG-DEMO-WBR-2105 | WearCheck Indicator Pin Set | Wheels & Brakes | consumable | NE | 24 | 8 | `wearcheck-indicator-pin-set` |
| 10 | MXG-DEMO-TIR-3101 | GlidePath Nose Tire | Tires | expendable | SV | 6 | 2 | `glidepath-nose-tire` |
| 11 | MXG-DEMO-TIR-3102 | RampStride Main Tire | Tires | expendable | NE | 8 | 2 | `rampstride-main-tire` |
| 12 | MXG-DEMO-TIR-3103 | FieldFlex Low-Pressure Tire | Tires | expendable | US | 4 | 1 | `fieldflex-low-pressure-tire` |
| 13 | MXG-DEMO-ELE-4101 | StartLink Power Contactor | Electrical | rotable | SV | 1 | 2 | `startlink-power-contactor` |
| 14 | MXG-DEMO-ELE-4102 | ArcGuard 10A Breaker | Electrical | expendable | NE | 32 | 10 | `arcguard-breaker-10a` |
| 15 | MXG-DEMO-ELE-4103 | PowerDock Battery Tray | Electrical | expendable | NE | 4 | 1 | `powerdock-battery-tray` |
| 16 | MXG-DEMO-ELE-4104 | BondWeave Ground Strap | Electrical | consumable | NE | 18 | 6 | `bondweave-ground-strap` |
| 17 | MXG-DEMO-AVN-5101 | NavCore Comm Control Panel | Avionics | rotable | SV | 1 | 1 | `navcore-comm-control-panel` |
| 18 | MXG-DEMO-AVN-5102 | HorizonView Display Unit | Avionics | rotable | US | 1 | 1 | `horizonview-display-unit` |
| 19 | MXG-DEMO-AVN-5103 | SquawkLink Transponder Panel | Avionics | rotable | OH | 1 | 2 | `squawklink-transponder-panel` |
| 20 | MXG-DEMO-AVN-5104 | FlightData Interface Unit | Avionics | rotable | NE | 1 | 2 | `flightdata-interface-unit` |
| 21 | MXG-DEMO-AVN-5105 | CrewLink Audio Controller | Avionics | rotable | SV | 1 | 1 | `crewlink-audio-controller` |
| 22 | MXG-DEMO-FIL-6101 | AirShield Intake Filter | Filters | consumable | NE | 15 | 5 | `airshield-intake-filter` |
| 23 | MXG-DEMO-FIL-6102 | HydraPure Return Filter | Filters | consumable | SV | 11 | 4 | `hydrapure-return-filter` |
| 24 | MXG-DEMO-FIL-6103 | CabinMesh Air Filter | Filters | consumable | NE | 20 | 6 | `cabinmesh-air-filter` |
| 25 | MXG-DEMO-HYD-7101 | PressureRidge Hydraulic Pump | Hydraulics | rotable | OH | 1 | 1 | `pressuridge-hydraulic-pump` |
| 26 | MXG-DEMO-HYD-7102 | FlexFlow Hose Assembly | Hydraulics | repairable | NE | 9 | 3 | `flexflow-hose-assembly` |
| 27 | MXG-DEMO-HYD-7103 | FluidNest Reservoir | Hydraulics | repairable | SV | 1 | 2 | `fluidnest-reservoir` |
| 28 | MXG-DEMO-HYD-7104 | ReliefPoint Pressure Valve | Hydraulics | repairable | NE | 1 | 2 | `reliefpoint-pressure-valve` |
| 29 | MXG-DEMO-FCT-8101 | TrimDrive Tab Actuator | Flight Controls | rotable | SV | 1 | 1 | `trimdrive-tab-actuator` |
| 30 | MXG-DEMO-FCT-8102 | RollPivot Aileron Bellcrank | Flight Controls | expendable | NE | 6 | 2 | `rollpivot-aileron-bellcrank` |
| 31 | MXG-DEMO-FCT-8103 | RudderLine Cable Kit | Flight Controls | repairable | NE | 8 | 3 | `rudderline-cable-kit` |
| 32 | MXG-DEMO-FCT-8104 | FlapTrack Drive Gearbox | Flight Controls | rotable | OH | 1 | 1 | `flaptrack-drive-gearbox` |
| 33 | MXG-DEMO-CAB-9101 | SeatRail Locking Fitting | Cabin | expendable | NE | 20 | 8 | `seatrail-locking-fitting` |
| 34 | MXG-DEMO-CAB-9102 | SwivelAir Vent Outlet | Cabin | repairable | SV | 14 | 5 | `swivelair-vent-outlet` |
| 35 | MXG-DEMO-CAB-9103 | BinHold Latch Assembly | Cabin | repairable | NE | 16 | 6 | `binhold-latch-assembly` |
| 36 | MXG-DEMO-CAB-9104 | DoorSoft Pressure Seal | Cabin | consumable | NE | 9 | 3 | `doorsoft-pressure-seal` |
| 37 | MXG-DEMO-SNS-1011 | ThermoSpire Temperature Probe | Sensors | rotable | NE | 1 | 4 | `thermospire-temperature-probe` |
| 38 | MXG-DEMO-SNS-1012 | AirStream Pitot-Static Probe | Sensors | rotable | US | 1 | 2 | `airstream-pitot-static-probe` |
| 39 | MXG-DEMO-SNS-1013 | FuelLevel Capacitive Sender | Sensors | rotable | SV | 1 | 2 | `fuellevel-capacitive-sender` |
| 40 | MXG-DEMO-SNS-1014 | GearNear Proximity Sensor | Sensors | rotable | NE | 1 | 3 | `gearnear-proximity-sensor` |
| 41 | MXG-DEMO-CON-1111 | LockWire Stainless Spool | Fasteners & Consumables | consumable | NE | 22 | 8 | `lockwire-stainless-spool` |
| 42 | MXG-DEMO-CON-1112 | FlushSet Rivet Assortment | Fasteners & Consumables | consumable | NE | 40 | 15 | `flushset-rivet-assortment` |
| 43 | MXG-DEMO-CON-1113 | CushionClamp Line Kit | Fasteners & Consumables | consumable | NE | 28 | 10 | `cushionclamp-line-kit` |
| 44 | MXG-DEMO-CON-1114 | SealPack O-Ring Assortment | Fasteners & Consumables | consumable | NE | 36 | 12 | `sealpack-o-ring-assortment` |
| 45 | MXG-DEMO-SAF-1211 | EvacGlow Exit Path Marker | Safety | consumable | NE | 18 | 6 | `evacglow-exit-path-marker` |
| 46 | MXG-DEMO-SAF-1212 | CrewSecure Four-Point Restraint | Safety | repairable | SV | 1 | 2 | `crewsecure-four-point-restraint` |
| 47 | MXG-DEMO-SAF-1213 | QuickCradle Extinguisher Mount | Safety | expendable | US | 8 | 3 | `quickcradle-extinguisher-mount` |

## Image specification

- Opaque sRGB JPEG, 1536×1024 (3:2), target 350 KB or less.
- Photoreal fictional component on a dark MRO workbench or matte navy surface,
  with restrained cyan rim light and alternating three-quarter angles.
- Keep the complete part inside a centered 75% × 70% safe area because the
  card and drawer use `object-fit: cover`.
- One principal SKU per image. A tidy matched set or organizer is acceptable
  only when the roster names a kit, set, or assortment.
- No people, hands, logos, watermarks, readable labels, real OEM marks, or
  certification/applicability claims.

## Acceptance checks

- Exactly 47 `expanded_parts_47` part rows and 47 corresponding stock units.
- Exactly 47 distinct visual keys and 47 local JPEG files.
- Every card resolves to its own image; no duplicate hashes are accepted.
- All images decode as 3:2 and stay inside the agreed size budget.
- The legacy Friday demo parts still render, and operational records remain
  hidden whenever presentation mode is enabled.
