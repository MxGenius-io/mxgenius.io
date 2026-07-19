# MXGenius Azure Deployment Plan

Status: Validated

## Objective

Deploy the authenticated Rust application/MCP service and connect the public
dashboard to its production-safe API boundary so every pilot capability is
either end-to-end testable or explicitly unavailable with a reason.

## Current state

- Workspace mode: MODIFY existing MXGenius application and Azure estate.
- Static frontend: GitHub Pages at `mxgenius.io`.
- Backend target: to be confirmed from the existing Azure resources.
- Data plane: existing Azure AI Search and Blob Storage; Postgres and identity
  deployment state to be verified.

## Approved architecture

- Subscription: `Azure subscription 1` (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`).
- Region: `centralus`.
- Classification/scale/budget: production pilot, small scale, cost-conscious.
- Recipe: existing Azure CLI/Container Apps path; no new platform or framework.
- Keep `mxg-api` unchanged for compatibility fleet/company/contact endpoints.
- Deploy `mxg-core` as a separate Container App in `mxg-cae-50106` from
  `mxgacr50106`, using the existing PostgreSQL, Search, Blob, and Log Analytics.
- Use Container App secrets for runtime credentials; nothing secret enters Git or
  the Pages artifact.
- Configure Entra OIDC, tenant membership, signed confirmation grants, OpenAI,
  DRS, manuals, and JetNet at the server boundary.
- Set only dashboard `mcpBase` to the verified `mxg-core` endpoint.
- Rollback: restore the previous dashboard runtime configuration or deactivate
  the new core revision; `mxg-api` is never replaced.

## Resource and policy check

- Existing resources are healthy and reused; no new environment, database,
  registry, storage account, or Search service is provisioned.
- New resource count: one `Microsoft.App/containerApps` application in the
  existing environment; current count 1, total after deployment 2.
- Subscription policy assignments returned no blocking constraints.
- Microsoft.Quota is not registered; capacity is validated at the existing
  environment scope before deployment. No quota increase is requested.

## Security and secrets

- No provider, DRS, JetNet, database, or signing credentials in browser code,
  source control, deployment logs, or public artifacts.
- Production mode remains fail-closed for missing identity, tenancy, database,
  confirmation, or authoritative-source configuration.

## Deployment stages

1. Inventory code, Azure context, existing resources, and runtime dependencies.
2. Freeze the least-change deployment architecture and rollback boundary.
3. Generate or update deployment artifacts and runtime configuration.
4. Validate locally and with Azure readiness checks.
5. Deploy to a non-production/revision boundary and run full-stack smoke tests.
6. Promote the dashboard runtime configuration and verify the custom domain.
7. Complete missing case-scoped frontend acceptance surfaces.

## Validation gates

- Node and Rust test suites, formatting, clippy, and release build.
- No secret material in Git or static artifacts.
- Health, readiness, OIDC, database, adapter, MCP, chat, and Realtime checks.
- Browser workflows for case, evidence, DRS, diagrams, 3D markers, confirmation,
  parts, MRO, weather, scheduling, approvals, and closure.
- Documented rollback to the previous backend revision and frontend commit.

## Execution checklist

- [x] Analyze workspace and existing Azure estate.
- [x] Freeze subscription, region, architecture, and rollback boundary.
- [x] User approved forward execution.
- [ ] Generate deployment/runtime configuration.
- [ ] Validate image, migrations, identity, adapters, and transports.
- [ ] Deploy `mxg-core` and smoke-test its revision.
- [ ] Switch `mcpBase` and complete browser acceptance flows.
- [ ] Record release and rollback evidence.

## Validation proof

- 2026-07-19: `cargo fmt --all -- --check` passed.
- 2026-07-19: `cargo test --workspace --locked` passed (51 tests).
- 2026-07-19: `cargo clippy --workspace --all-targets --locked -- -D warnings` passed.
- 2026-07-19: `npm test` passed (27 tests).
- 2026-07-19: OpenAI and FAA DRS deployment inputs are present outside Git.
- 2026-07-19: subscription `d1a68ed7-2983-4a86-ab0e-e56df9e2e325`,
  Container Apps environment `mxg-cae-50106`, and ACR `mxgacr50106` were verified.
- Static role verification: this Azure CLI deployment reuses ACR admin
  credentials and Container App secrets; it creates no managed identity or new
  RBAC assignment in this pilot mount.

## Approval

Approved by the user’s instruction to move forward on 2026-07-19.
