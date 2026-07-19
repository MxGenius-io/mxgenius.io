# MXGenius MCP mount readiness

The clean artifact lives at `services/mcp`. The repository-level `docs/PRODUCTION_MOUNT_TASKLIST.md` is authoritative for status and ordering.

## Verified locally

- exactly 50 locked tools, 16 resources, and 8 prompts;
- MCP protocol `2025-11-25` over Streamable HTTP and stdio;
- canonical schema and universal-envelope snapshots;
- first-wave validation, fixture provenance, and honest `NOT_CONFIGURED` results;
- common RBAC enforcement and an all-capability role/action snapshot;
- OIDC/JWKS and server-side membership-resolution seams;
- confirmation binding to tool/object/version and qualified closure approval;
- in-memory atomic rollback tests for case/event/audit/trace mutations;
- Postgres case and evidence adapters compile behind clean service traits;
- format, 44 tests, clippy-as-error, and build pass.

## Not yet verified

- migrations against an isolated Postgres instance;
- atomic single-use confirmation consumption in Postgres;
- production case/evidence transactions and tenant-safe foreign keys;
- container/runtime health checks;
- deployed MCP smoke test;
- live JetNet, manuals, FAA, weather, parts, MRO, scheduling, and twin adapters.

A compiling adapter is not reported as a deployed capability. Local fixtures require `--insecure-local`; production stdio is rejected because it lacks authenticated HTTP request metadata.
