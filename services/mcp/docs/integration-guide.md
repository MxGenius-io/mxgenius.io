# MXGenius MCP integration guide

The application mounts `services/mcp` as a separate capability service. It does not copy domain logic into the dashboard or create a second contract model.

## Ownership

- `shared`: canonical types, policy vocabulary, envelopes, and 50 request/response contracts.
- `server`: MCP transport, trusted identity, policy enforcement, handlers, and adapters.
- `migrations`: 11 ordered Postgres migrations.
- `fixtures`: fictional data for explicit local mode only.

## Application boundary

The application backend owns browser sessions and calls MCP with:

- an OIDC bearer access token for the MXGenius API audience;
- a selected organization header validated against server-side membership;
- a correlation ID;
- for mutations only, a signed single-use confirmation grant.

Identity, tenant, role, approval, and confirmation never appear in tool arguments.

## Runtime modes

- Local: `--insecure-local` mounts in-memory services and sanitized fixtures.
- Production: no flag; Postgres, migrations, OIDC discovery/JWKS, membership lookup, and confirmation verification are mandatory.

## Adapter substitution

| Boundary | Local/unavailable behavior | Production mount |
| --- | --- | --- |
| Case/evidence | in-memory | `PostgresCaseService` / `PostgresEvidenceService` |
| Aircraft | sanitized fixture for the first slice | JetNet adapter |
| Manuals | sanitized excerpts | Azure AI Search/manual corpus adapter |
| FAA | fictional fixture context or `NOT_CONFIGURED` | AD, DRS, and SAIB adapters |
| Weather | `NOT_CONFIGURED` | operational aviation weather adapter |
| Parts/MRO/scheduling | `NOT_CONFIGURED` | typed source adapters |
| Digital twin | `NOT_CONFIGURED` contract outputs | model catalog, component/zone mapping, raycast IDs |

## Mount gate

1. Run format, tests, clippy-as-error, and build.
2. Run all migrations against an isolated Postgres instance.
3. Prove case/event/evidence/audit/approval/trace writes commit once or roll back together.
4. Prove tenant-safe foreign keys and cross-tenant denial.
5. Start production mode with OIDC and Postgres configuration.
6. Initialize MCP, list exactly 50 tools, and execute the first case slice.
7. Mount the application through `application-client.js`; do not expose operational credentials to the static browser.

The repository-level `docs/PRODUCTION_MOUNT_TASKLIST.md` is the authoritative status ledger.
