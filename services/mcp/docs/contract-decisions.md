# Contract decisions (contract-complete)

The contract lock is authoritative. This file records ambiguity
resolutions made in this build. Each entry is a candidate for promotion
into the contract on a future major version bump.

## D-001: Typed tool inputs and outputs

- **Decision:** Every tool has a dedicated request and response type
  defined in `shared/src/contracts/`. Inputs are deserialized into the
  named type before the application service runs. Outputs are serialized
  inside the universal `CapabilityEnvelope<O>`. The envelope is generic
  over the response; the contract tool boundary is the typed response.
- **Source:** `MXGENIUS_50_CAPABILITY_SPEC.md` and
  `MXGENIUS_V1_CONTRACT_LOCK.md`.
- **Schema names and versions:** every `ToolSpec` carries stable
  `tool_version`, `input_schema_version`, `output_schema_version`, and
  `domain_schema_version`. Default `1.0.0`.
- **Migration impact:** none at v1.

## D-002: JSON Schema generation

- **Decision:** Input schemas are generated from the Rust request types
  using `schemars` at registration time. Output schemas are a stable
  hand-rolled envelope description with the typed output schema embedded
  in `output`.
- **Implementation:** `schemars::gen::SchemaSettings::openapi3()`. The
  schema generator is created per tool to avoid surprising schema-id
  reuse.
- **`OffsetDateTime` problem:** schemars 0.8 does not ship a `time`
  feature. The package uses a local `UtcDateTime` newtype that implements
  `JsonSchema` directly, returning the canonical RFC 3339 schema. The
  domain layer keeps using `time::OffsetDateTime` for arithmetic; the
  contract layer uses `UtcDateTime` for the wire boundary.
- **Migration impact:** none at v1.

## D-003: Authentication boundary

- **Decision:** `mcp::context::ExecutionContextProvider` is the
  authoritative boundary. Two impls ship in this build:
  `InsecureLocalProvider` (dev/test, behind `--insecure-local`) and
  `OidcProvider` (production placeholder, returns `AUTH_REQUIRED` until
  the application-plane model wires a real session validator).
- **Default startup:** `cargo run` without `--insecure-local` exits 2
  (fail-closed).
- **No tool-arg override:** identity, tenant, role, and human
  confirmation are injected by the provider; tool arguments cannot
  override them.
- **Migration impact:** none at v1.

## D-004: Promotion state

- **Decision:** Every tool envelope defaults to `promotion_state: shadow`.
  Production deploys set `MXGENIUS_PROMOTION` per environment.
- **Migration impact:** none at v1.

## D-005: Confidence basis

- **Decision:** Real handlers stamp the basis per the contract lock.
  `mxg.aircraft.lookup` and `mxg.aircraft.profile` use
  `DeterministicLookup`. `mxg.maintenance_case.create` and
  `update_status` use `HumanConfirmed` when the trusted context supplies
  confirmation. `mxg.evidence.collect` uses `DeterministicLookup` for
  dedup. Stub handlers use `ModelOnly` with `score: 0.0`.
- **Migration impact:** none at v1.

## D-006: Capability trace storage

- **Decision:** Traces are emitted to the `tracing` subscriber in this
  build and recorded by the dispatcher. The `capability_traces` table
  is created by `migrations/0009_evidence_approvals_audit.sql` and is
  not yet written by the dispatcher. The application-plane model adds
  the persistence hook in the same transaction as the originating
  mutation.
- **Migration impact:** none. The table is additive.

## D-007: Tooling for the 51st capability

- **Decision:** The contract forbids adding a 51st tool. Multi-step
  experiences are MCP prompts or application orchestration over the
  atomic tools.
- **Implementation:** `prompts.rs` exposes exactly the 8 prompt names
  frozen by the contract.
- **Migration impact:** none.

## D-008: Case transitions and version

- **Decision:** `CaseStatus::can_transition_to` is the single source of
  truth. `update_status` rejects illegal transitions with
  `INVALID_STATE_TRANSITION`. Optimistic version check rejects stale
  updates with `CONFLICTING_EVIDENCE` (mapped to a stable error code).
  Atomic in-memory write covers `maintenance_cases`, `maintenance_events`,
  and `audit_events` rows; the Postgres equivalent is a mount task.
- **Source:** contract lock.
- **Migration impact:** none.

## D-009: Stale version error mapping

- **Decision:** The stale version failure mode surfaces in the envelope
  as `INVALID_INPUT` with the underlying message containing
  `Stale version` (or `CONFLICTING_EVIDENCE` per the dispatcher
  adapter). The test in `server/tests/registry.rs::stale_version_rejected`
  pins the contract.
- **Migration impact:** none at v1.

## D-010: NotConfiguredTool default factory

- **Decision:** A typed `NotConfiguredTool<Req, Resp>` accepts a
  `Fn(Req) -> Resp` factory and produces a typed partial envelope with
  `NOT_CONFIGURED` warning. The factory echoes the request fields into
  the response so callers see their identifiers in the response, never
  invented values.
- **Migration impact:** none.

## D-011: `CaseStatus` ↔ `CaseStatusDto` mapping

- **Decision:** The contract lock freezes the wire values
  `draft | open | triage | diagnosing | planning | awaiting_parts |
  scheduled | in_work | awaiting_inspection | awaiting_approval |
  closed | cancelled`. The domain `CaseStatus` and the contract
  `CaseStatusDto` both serialize to those wire values. Conversion is
  one-to-one via `case_service::status_to_dto`.
- **Migration impact:** none.
