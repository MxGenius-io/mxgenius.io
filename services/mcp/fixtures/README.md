# Fixtures

Sanitized, fictional fixture data for explicit `--insecure-local` use. None of this
data references real operators, real aircraft, real manuals, real ADs, or
any licensed source material. Do not copy fixture records into production.

| File | Purpose |
| --- | --- |
| `jetnet/aircraft.json`        | 3 fictional JetNet aircraft DTOs |
| `jetnet/profile.json`         | 1 fictional aircraft profile DTO |
| `manual_corpus/catalog.json`  | Fictional manual catalog entries |
| `manual_corpus/excerpts.json` | Fictional manual excerpts |
| `faa/ads.json`                | Fictional AD records |
| `digital_twin/models.json`    | Fictional 3D model catalog entries |

Adapters consume these fixtures only when no live source is configured. The
`NotConfigured*Adapter` defaults reject all calls with `NOT_CONFIGURED`;
fleshed-out adapters swap in real fixture-backed implementations for local
development.
