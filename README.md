# MXGenius

MXGenius is an aviation maintenance and fleet-operations platform joining maintenance cases, controlled parts, source-grounded AI assistance, fleet intelligence, 3D inspection, and spatial sensor workflows.

## Start here

- **[Complete feature catalog](FEATURES.md)** — the canonical, status-marked inventory of product capabilities and known gaps.
- [Product refinement audit](docs/PRODUCT_REFINEMENT.md) — end-to-end readiness findings by surface.
- [Production mount task list](docs/PRODUCTION_MOUNT_TASKLIST.md) — critical-path deployment work.
- [Spatial surface boundaries](docs/design/spatial-surface-boundaries.md) — ownership rules for globe, 3D, sensor, and native AR.
- [Guided tooltip touchpoint map](docs/design/guided-tooltip-touchpoint-map.md) — contextual-help and media-script plan.

## Local verification

```powershell
npm test
```

Live checks require the configured Azure environment:

```powershell
npm run test:live
```

Repository work follows the shared-branch and credential rules in [AGENTS.md](AGENTS.md).
