# MXGenius MCP

Standalone Rust capability service for the locked MXGenius v1 catalog:

- exactly 50 typed tools;
- 16 resources and 8 prompts;
- MCP Streamable HTTP (`POST /mcp`) and local stdio;
- canonical domain/contracts in `shared`;
- transport, identity, policy, handlers, and adapters in `server`;
- Maintenance Case, evidence, event, audit, approval, and trace persistence seams;
- sanitized fictional fixtures only in explicit local-development mode.

The application mounts this service through one authenticated orchestration boundary. Domain logic does not move into the dashboard.

## Layout

```text
services/mcp/
  shared/       canonical domain types, envelopes, policy, contracts, schemas
  server/       MCP runtime, auth boundary, handlers, application services
  migrations/   ordered PostgreSQL schema
  fixtures/     fictional local-development data; never production data
  docs/         contract and integration references
```

## Quality gate

```powershell
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build --workspace
```

Current gate: 51 tests pass across the workspace, including the locked 50-tool schema and RBAC snapshots, transport and application-orchestration black-box cases, tenant isolation, confirmation binding, case rollback, digital-twin marker persistence, production-adapter behavior, and datetime wire-format tests.

## Local development

Local mode is explicit and uses only in-memory state and sanitized fixtures:

```powershell
cargo run -p mxgenius-mcp -- --insecure-local
```

The endpoint is `http://127.0.0.1:3030/mcp`. Clients must send:

```text
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-11-25   # after initialize
```

Trusted identity, tenant, role, approval, and confirmation never belong in tool arguments. Local mode supplies test trust at the server boundary.

## Production mode

Omit `--insecure-local`. Startup then requires:

```text
DATABASE_URL
MXGENIUS_OIDC_DISCOVERY_URL
MXGENIUS_OIDC_AUDIENCE
MXGENIUS_CONFIRMATION_SECRET       # at least 32 bytes
MXGENIUS_CONFIRMATION_ISSUER       # optional; default mxgenius-application
MXGENIUS_CONFIRMATION_AUDIENCE     # optional; default mxgenius-mcp
MXGENIUS_MCP_ADDR                  # optional; default 127.0.0.1:3030
MXGENIUS_MCP_ALLOWED_ORIGINS       # optional comma-separated allowlist
AZURE_SEARCH_ENDPOINT              # Azure AI Search service endpoint
AZURE_SEARCH_KEY                   # server-side Search credential
AZURE_SEARCH_INDEX                 # optional; default manuals-authoritative-v1
MXGENIUS_MANUAL_SEARCH_FILTER      # required; source_class eq 'manual'
MXGENIUS_EMBEDDINGS_ENDPOINT       # optional; default OpenAI /v1/embeddings
MXGENIUS_EMBEDDINGS_API_KEY        # or OPENAI_API_KEY
MXGENIUS_EMBEDDINGS_MODEL          # optional; default text-embedding-3-small
MXGENIUS_EMBEDDINGS_AUTH           # optional; bearer or api-key
MXGENIUS_JETNET_API_TOKEN          # server-side JetNet API token
MXGENIUS_JETNET_BEARER_TOKEN       # server-side JetNet bearer token
MXGENIUS_JETNET_BASE_URL           # optional; JetNet customer API default
MXGENIUS_DRS_API_KEY               # FAA-issued DRS data-pull key
MXGENIUS_DRS_ENDPOINT              # optional; default https://drs.faa.gov/api/drs/
MXGENIUS_DRS_AD_DOCUMENT_TYPES     # optional; default ADFRAWD,ADFREAD
MXGENIUS_DRS_SAIB_DOCUMENT_TYPE    # optional; default SAIB
MXGENIUS_DRS_MAX_PAGES             # optional safety limit; default 20
```

Production startup:

1. connects to Postgres and applies ordered migrations;
2. loads OIDC discovery metadata and JWKS;
3. validates RS256 bearer tokens, issuer, audience, expiry, and subject;
4. resolves organization membership and role from Postgres;
5. validates and atomically consumes signed confirmation grants;
6. mounts Postgres case and evidence adapters;
7. mounts the authoritative manual corpus only when its Search filter and embedding provider are configured;
8. mounts JetNet through a tenant-scoped canonical aircraft catalog when its credentials are present;
9. mounts FAA DRS AD/SAIB metadata through the official data-pull API when an issued key is present. Missing sources remain honestly unavailable.

Live manual retrieval can be checked without starting the full authenticated server:

```powershell
cargo run -p mxgenius-mcp --example manual_search_smoke -- 'Global 7500 fuel system leak inspection'
```

The command reads configuration only from the environment and prints citation/asset metadata, not retrieved manual text.

Live FAA DRS metadata can be checked through the same production adapter:

```powershell
cargo run -p mxgenius-mcp --example faa_drs_smoke
```

The smoke test prints identifiers and official DRS links only. It labels all
aircraft matches as candidates; final AD effectivity and serial applicability
remain qualified human determinations.

The DRS key is a server-side secret. Keep it in the deployment secret store and
set `MXGENIUS_DRS_API_KEY` at runtime; never place it in dashboard code, source
control, fixtures, or logs.

The Postgres adapters compile behind `CaseService` and `EvidenceStore`. Their live migration/transaction gate remains open until exercised against an isolated Postgres instance; see the repository-level `docs/PRODUCTION_MOUNT_TASKLIST.md`.

## Safety boundary

- No autonomous return-to-service authority.
- No model-selected identity, tenant, role, approval, or confirmation.
- Every production mutation requires a signed single-use grant bound to actor, organization, tool, object, object version, and expiry.
- Case closure additionally requires a qualified approval.
- `NOT_CONFIGURED` tools return partial envelopes with nullable/empty outputs, never fabricated operational records.
- Fixtures remain `shadow` evidence and are explicitly marked fictional/unverified.
