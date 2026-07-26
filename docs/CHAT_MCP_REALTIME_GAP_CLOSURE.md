# MXGenius Chat, MCP, and Realtime Gap-Closure Plan

This plan closes the gaps found in the July 26, 2026 repository and deployed-system
review. It is an implementation ledger: a task moves to `[x]` only after its code,
automated tests, and required deployed smoke evidence exist.

## Status legend

- `[x]` complete and verified
- `[~]` implementation in progress or awaiting verification
- `[ ]` not started
- `[!]` blocked by an external decision, credential, entitlement, or deployment dependency

## Outcomes

The work is complete when:

1. text chat supports grounded multi-turn conversations and controlled MCP-backed tool use;
2. Realtime connects with the current OpenAI WebRTC session contract and survives normal interruption and network loss;
3. the model sees only relevant, currently usable capabilities;
4. citations, source limitations, approvals, and tool results are validated before display;
5. cloud failure reaches an honest, tested fallback instead of a dead initialization path;
6. browser, application, MCP, adapter, and OpenAI activity share traceable correlation IDs;
7. CI blocks deployment when frontend, Rust, schema, or contract tests fail; and
8. release notes identify the exact frontend, backend, prompt, schema, and model configuration shipped.

## Scope boundaries

- Preserve the locked 50 canonical MCP capability names.
- Preserve server-owned identity, tenant, role, case access, and confirmation context.
- Do not send the user's Entra token, confirmation grant, or other MXGenius credentials to OpenAI.
- Do not let text or voice models execute mutations without the existing application confirmation path.
- Do not treat transcripts as maintenance records unless the user explicitly attaches an observation.
- Do not enable an unavailable adapter merely to avoid a `NOT_CONFIGURED` result.
- Keep compatibility fleet signals distinct from authoritative case and manual evidence.

## Critical path

```text
SEC-AI-201 credential containment
  -> REL-AI-201 trustworthy test baseline and CI
  -> RTC-201 current Realtime session contract
  -> RTC-202 deterministic voice lifecycle
  -> MCP-AI-201 negotiated MCP client lifecycle
  -> MCP-AI-202 availability-aware tool catalog
  -> AI-201 server-owned multi-turn text conversation
  -> AI-202 server-owned MCP tool loop
  -> AI-203 grounded output and citation validation
  -> AI-204 streaming/progress UX
  -> AI-205 honest on-device fallback
  -> REL-AI-202 observability and evaluation
  -> REL-AI-203 staged deployment, rollback, and release evidence
```

WIP limit: one critical-path implementation task at a time. Tests and documentation
for that task are part of the same work item.

## Phase 0: Contain and establish a trustworthy baseline

### SEC-AI-201 — Remove the GitHub credential from repository remotes

Closed-beta disposition (2026-07-26): deferred by explicit product-owner risk
acceptance. This does not block the chat/MCP/Realtime implementation tranche.

- [!] Revoke and rotate the personal access token currently embedded in local Git remote URLs.
- [ ] Replace both remote URLs with credential-free HTTPS plus a credential manager, or SSH.
- [ ] Search tracked files, Git history, deployment archives, logs, and CI output for the revoked token.
- [ ] Record the rotation date and owner in the private operational runbook without storing the secret.

Acceptance:

- `git remote -v` contains no credentials.
- The revoked token cannot authenticate.
- Repository secret scanning reports no active token material.

### REL-AI-201 — Restore green tests and make them deployment gates

- [x] Fix the two Realtime test-harness failures without weakening resource-cleanup assertions.
- [x] Reconcile the two stale globe/on-device structure assertions with intended product behavior.
- [x] Resolve the current MCP schema snapshot mismatch after reviewing the uncommitted compliance contract edits.
- [x] Remove the unused Rust compliance helper or restore its intended call site so clippy remains clean.
- [x] Add a CI job that runs `npm test`.
- [x] Add a CI job that runs `cargo fmt --check`, `cargo test --workspace`, and clippy with warnings denied.
- [x] Make GitHub Pages deployment depend on the successful frontend and Rust gates.
- [ ] Add a separate backend build/deploy workflow; do not deploy opaque ZIP files manually as the release source.

Acceptance:

- Frontend and Rust suites pass from a clean clone.
- A deliberately failing test prevents Pages and backend deployment.
- CI publishes test results and the commit SHA used for each artifact.

## Phase 1: Repair Realtime transport and voice lifecycle

### RTC-201 — Adopt the current OpenAI Realtime WebRTC session contract

- [x] Replace the legacy session JSON in `create_realtime_call` with the current `type: "realtime"` shape.
- [x] Move voice, transcription, input/output audio, and turn detection into their current nested fields.
- [x] Pin or explicitly configure the approved Realtime model; remove the obsolete preview-model fallback.
- [ ] Configure the approved voice explicitly and evaluate `marin` and `cedar` before pilot freeze.
- [ ] Validate all environment-provided model, voice, and transcription values at startup.
- [ ] Fail readiness with a safe diagnostic when production model configuration is missing or unsupported.
- [x] Add a request-shape snapshot test based on the current OpenAI contract.
- [ ] Add a non-production authenticated SDP smoke test that verifies inbound and outbound audio.

Acceptance:

- `/realtime/calls` returns a valid SDP answer using the approved production configuration.
- The browser receives remote audio and current transcript events.
- No standard OpenAI API key or upstream error body is returned to the browser or written to logs.

Reference:

- <https://developers.openai.com/api/docs/guides/realtime-webrtc>
- <https://developers.openai.com/api/docs/guides/realtime-conversations>

### RTC-202 — Implement a deterministic browser voice state machine

- [ ] Replace scattered state mutations with one explicit reducer covering disconnected, connecting,
      listening, user-speaking, thinking/tool-use, assistant-speaking, interrupted, degraded,
      reconnecting, failed, and closed.
- [x] Add a visible state label to the chat DOM and update it from every state transition.
- [x] Handle `connected`, `channel-open`, `channel-close`, `usage`, `interrupted`, `error`, and
      peer connection-state events.
- [x] Track the active response ID/status and send `response.cancel` only when a response is active.
- [x] Let WebRTC server VAD perform normal automatic interruption; keep explicit cancellation for
      the Interrupt control.
- [x] Stop media tracks, close the peer/data channel, and remove the audio element on terminal failure.
- [x] Add bounded reconnect with exponential backoff and jitter for recoverable network loss.
- [x] Require a fresh session and fresh tool catalog after reconnect.
- [ ] Preserve completed tool-call IDs across reconnect for the lifetime of the browser conversation.
- [ ] Never replay or auto-approve a pending or completed mutation after reconnect.
- [x] Add event IDs to client events that require error correlation.

Acceptance:

- Voice state and failure reason are visible and accessible.
- Channel loss cannot leave the UI in a false listening state.
- Barge-in produces no spurious `response.cancel` errors.
- Reconnect cannot duplicate a tool execution or mutation.

### RTC-203 — Make transcript, tool activity, and fallback behavior honest

- [x] Append finalized voice turns to the visible conversation rather than overwriting one transcript buffer.
- [x] Clearly label partial versus final transcript text.
- [ ] Show tool name, start, completion, latency, partial status, warnings, and trace ID.
- [ ] Show Realtime usage only in an appropriate diagnostics surface; do not expose sensitive metadata.
- [x] Keep the text input available while voice is degraded.
- [ ] Define transcript retention and consent behavior before any persistence is enabled.

Acceptance:

- A user can reconstruct the completed voice exchange from the UI.
- A failed or partial tool call cannot be presented as a successful operational answer.
- Disconnecting voice does not erase text-chat access.

## Phase 2: Close MCP lifecycle and tool-routing gaps

### MCP-AI-201 — Use the MCP initialization lifecycle from browser clients

- [x] Add a single `capabilities.connect()` client primitive.
- [x] Send `initialize`, validate the negotiated protocol version and server capabilities, then send
      `notifications/initialized` before `tools/list` or `tools/call`.
- [x] Cache negotiated connection metadata for the authenticated application session.
- [x] Reinitialize after authentication, organization, backend, or protocol-version changes.
- [x] Make the workbench and Realtime setup use `capabilities.connect()` rather than direct `tools/list`.
- [ ] Add lifecycle-order, version-mismatch, and reauthentication tests.

Acceptance:

- No normal operation is sent before initialization completes.
- Unsupported protocol versions fail visibly and safely.
- Workbench and Realtime use the same negotiated client path.

Reference:

- <https://modelcontextprotocol.io/specification/2025-11-25/schema>

### MCP-AI-202 — Build an availability-aware, task-scoped model tool catalog

- [x] Add machine-readable capability availability to the authenticated backend catalog.
- [ ] Distinguish `available`, `degraded`, `not_configured`, and `unauthorized`.
- [ ] Keep all 50 tools visible in the human operations workbench with honest availability.
- [ ] Give the model only tools relevant to the active case, user intent, role, and configured adapters.
- [ ] Exclude mutations until an active case and confirmation UI are available.
- [x] Keep tool names and input schemas canonical; use transport aliases only at the Realtime boundary.
- [ ] Add catalog tests for no-case, active-case, degraded-adapter, role-restricted, and reconnect states.

Acceptance:

- Realtime never advertises a tool backed only by a `NOT_CONFIGURED` adapter.
- The operations workbench still explains unavailable capabilities.
- Tool catalog changes do not alter the locked canonical registry or authorization policy.

### MCP-AI-203 — Harden tool execution

- [x] Add browser abort signals and bounded timeouts to catalog and tool calls.
- [ ] Correlate Realtime call ID, MCP JSON-RPC ID, capability trace ID, and application correlation ID.
- [ ] Convert validation, authorization, unavailable-adapter, timeout, partial, and upstream errors into
      stable model-readable tool outputs.
- [x] Preserve evidence, confidence, warnings, partial state, and trace IDs in every returned envelope.
- [ ] Add retry policy only for idempotent reads and transient failures.
- [ ] Never automatically retry mutations or confirmation issuance.

Acceptance:

- Every model-requested tool call reaches one terminal result.
- Timeout or disconnect cannot leave an unresolved confirmation card indefinitely.
- A retry cannot duplicate an operational mutation.

## Phase 3: Improve text-model output quality

### AI-201 — Add server-owned, bounded multi-turn conversation state

- [ ] Choose and document one state model:
  - server-managed conversation records with bounded prior turns; or
  - Responses continuation using `previous_response_id` with an approved retention mode.
- [ ] Bind conversation IDs to authenticated user, organization, and active case.
- [ ] Reset or branch context when the active case changes.
- [ ] Bound turns and tokens, summarize older conversational context, and preserve material caveats.
- [x] Keep `store: false` unless retention policy explicitly approves stored Responses.
- [ ] Add tests for follow-ups, case switching, tenant isolation, stale conversation IDs, and context limits.

Acceptance:

- Follow-up questions correctly reference prior turns.
- A conversation cannot cross tenant or case boundaries.
- Context compaction does not remove safety limitations, evidence gaps, or pending approval state.

### AI-202 — Add a server-owned Responses tool loop over the MCP dispatcher

- [x] Expose a small task-scoped subset of canonical capability schemas as Responses function tools.
- [x] Execute requested tools server-side through the authenticated dispatcher.
- [x] Never forward browser credentials or trusted authorization fields to OpenAI.
- [x] Continue the Response with correlated tool outputs until a final answer or bounded stopping condition.
- [x] Cap tool rounds, parallel calls, retries, elapsed time, and total returned evidence.
- [x] Pause mutations at the application confirmation boundary; do not treat a model request as approval.
- [ ] Add deterministic tests for read-only calls, partial results, unknown tools, approval-required calls,
      tool loops, and maximum-round termination.

Acceptance:

- Text chat can answer supported operational questions using typed capabilities.
- The model cannot select tenant, actor, role, approval, or confirmation.
- Tool-loop exhaustion ends with a clear partial response rather than an infinite or silent failure.

### AI-203 — Validate grounded output after model generation

- [x] Validate every citation against the exact returned `M-##` record set.
- [x] Reject or remove citations that do not resolve.
- [ ] Validate cited claims against required evidence fields where deterministic checks are possible.
- [ ] Reject non-empty advisory sections that cite no evidence when citations are required.
- [ ] Treat model-generated evidence-strength values as presentation metadata only after citation validation.
- [x] Preserve manual revision, effective date, content hash, source reference, and retrieval warning.
- [ ] Separate conversation and maintenance-advisory schemas so ordinary conversation does not populate
      irrelevant required advisory fields.
- [ ] Add explicit abstention output for missing, conflicting, stale, or unavailable evidence.
- [ ] Add prompt-injection tests using hostile text inside manual excerpts and compatibility records.

Acceptance:

- No displayed citation points to a missing record.
- Untrusted retrieved text cannot change authorization, tool, or output-policy instructions.
- Golden abstention cases do not produce invented procedures, parts, labor, diagnoses, or percentages.

### AI-204 — Add streaming and progress without weakening structured output

- [ ] Define a versioned `/chat` event contract with retrieval, tool, model, partial-text, final-structured,
      usage-summary, and error events.
- [ ] Stream safe progress events immediately.
- [ ] Buffer strict structured JSON until it validates; do not render incomplete JSON as an advisory.
- [ ] Stream ordinary conversational text when the selected response schema permits it.
- [ ] Add client cancellation when the panel closes, the active case changes, or the user sends a replacement request.
- [ ] Preserve one final authoritative response object for audit and rendering.

Acceptance:

- The user sees meaningful progress before the final advisory.
- Cancellation stops upstream generation and pending idempotent tool work where supported.
- Partial output is never mistaken for a validated maintenance advisory.

### AI-205 — Make the local model a real, constrained fallback or remove it

- [ ] Decide whether supported clients require offline inference.
- [x] If retained, invoke the local model only after a classified recoverable cloud failure or explicit offline mode.
- [ ] Give local output a persistent `OFFLINE / NON-AUTHORITATIVE` label.
- [ ] Restrict local output to supplied local reference text; disable operational tools and mutations.
- [~] Wire local output cleanup and optional TTS to the actual fallback response.
- [ ] Add model-load cancellation, memory-pressure handling, and device capability checks.
- [ ] If offline inference is not a product requirement, remove DeepSeek, Kokoro initialization, dead prompts,
      cleanup functions, and misleading “fallback” claims.

Acceptance:

- Cloud failure produces either a tested constrained fallback or a clear text-only unavailable state.
- The app does not load large unused models during normal web startup.
- Offline output cannot be confused with an authoritative cloud/MCP result.

## Phase 4: Observability, evaluation, and release

### REL-AI-202 — Add end-to-end telemetry and quality evaluation

- [~] Persist safe trace metadata across browser, application, MCP, adapter, OpenAI, and Realtime boundaries.
- [~] Record model name, prompt/schema version, latency stages, tool calls, adapter states, usage, and terminal status.
- [ ] Never log API keys, authorization headers, raw audio, confirmation tokens, or unapproved transcript content.
- [ ] Add dashboards and alerts for chat errors, invalid structured responses, invalid citations, tool failures,
      Realtime connection failures, reconnects, latency, and adapter degradation.
- [ ] Add golden eval sets for groundedness, citation correctness, abstention, conflict handling, follow-up context,
      tool choice, tenant isolation, confirmation safety, and voice interruption.
- [ ] Compare model, prompt, reasoning effort, tool catalog, and retrieval changes on the same eval set.
- [ ] Define pilot SLOs and quality thresholds before release.

Acceptance:

- One correlation ID reconstructs an end-to-end request without exposing secrets.
- A model or prompt change cannot ship without passing the agreed quality thresholds.
- Alerting distinguishes OpenAI, MCP, adapter, authentication, and browser failures.

### REL-AI-203 — Stage deployment, rollback, and release evidence

- [ ] Deploy backend changes to non-production with production-equivalent identity and adapter configuration.
- [ ] Run authenticated text, tool, confirmation, voice, interruption, reconnect, and degraded-adapter smoke tests.
- [ ] Run desktop, mobile, and supported headset/browser interaction checks.
- [ ] Use a percentage or allowlisted pilot rollout with a documented kill switch.
- [ ] Keep the previous frontend and backend artifacts available for rollback.
- [x] Update `CHANGELOG.md` with the July 25 changes and every gap-closure release.
- [ ] Align package, frontend asset, backend image, prompt, schema, and model configuration versions.
- [ ] Record commit SHA, image digest, deployment revision, migrations, model IDs, prompt/schema versions,
      test results, smoke evidence, and rollback procedure.

Acceptance:

- Rollback is exercised, not merely documented.
- Deployed static assets and backend image are traceable to one reviewed commit.
- The release ledger accurately distinguishes implemented, configured, live-smoked, and pilot-verified work.

## Required verification matrix

| Surface | Automated | Non-production | Pilot |
| --- | --- | --- | --- |
| Text conversation continuity | unit + integration | authenticated smoke | sampled quality review |
| Structured output and citations | schema + golden eval | live manual retrieval | citation audit |
| Responses tool loop | mocked + dispatcher integration | configured read tools | trace review |
| Mutation confirmation | policy + replay tests | approve/decline smoke | audit event review |
| MCP lifecycle | protocol-order tests | initialize/list/call smoke | version telemetry |
| Realtime session | request snapshot | real microphone/audio | device matrix |
| Barge-in and reconnect | deterministic event tests | network interruption smoke | failure-rate monitoring |
| Adapter degradation | response fixtures | forced unavailable source | alert verification |
| Offline fallback | plugin harness | supported device test | explicit opt-in only |
| Security and tenancy | negative tests | cross-tenant probes | audit review |

## Definition of done

A task is done only when:

1. code and tests are merged;
2. documentation and changelog are updated;
3. secrets and trusted context stay server-side;
4. degraded behavior is visible and honest;
5. telemetry identifies success, failure, latency, and the exact configuration;
6. required live smoke evidence is attached to the release record; and
7. rollback impact is understood and tested where the change affects production traffic.
