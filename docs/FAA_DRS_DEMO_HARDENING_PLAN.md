# FAA DRS demo hardening plan

## Outcome

Make the existing aircraft-to-FAA path dependable and understandable for a
live demonstration:

`authenticated aircraft -> canonical tenant aircraft -> FAA DRS candidate query -> evidence-backed candidate list`

This is a hardening pass, not a new compliance product. The UI must describe
results as **candidate ADs for qualified review**. It must not claim that an AD
is applicable, complied with, recurring, due, or closed.

## Pre-build audit snapshot — 2026-09-10

### Keep

- `mxg.aircraft.lookup` already resolves the browser's fleet identity to a
  tenant-scoped canonical aircraft.
- `mxg.compliance.applicable_ads` is already the single typed boundary used by
  the aircraft detail UI.
- The production DRS adapter already uses server-side make/model filters,
  bounded pagination, timeouts, explicit rate-limit and credential errors, and
  FAA-only source links.
- The response already contains the AD number, title, effective date, official
  source reference, evidence retrieval time, and a candidate-only confidence
  explanation.
- DRS credentials remain server-side. The deployed application uses an Azure
  secret reference rather than exposing the key to the browser.
- `ComplianceRead` is already available to every authenticated application
  role. No RBAC redesign is needed for this read-only demo.
- The existing authenticated `scripts/live-field-probe.mjs` already exercises
  fleet resolution and the live `mxg.compliance.applicable_ads` capability.

### Tighten

- The UI heading says "FAA Airworthiness Directives," which can be read as an
  applicability determination even though the backend returns candidates.
- The UI drops the effective date, FAA source link, retrieval time, result
  count, and backend confidence explanation.
- Opening the same aircraft repeatedly performs the same live DRS call. The
  existing `MXCache` is only used for fleet bulk data and is not safe to reuse
  unchanged for authenticated MCP responses because its cache key excludes
  identity and organization headers.
- `/adapterz` reports that the FAA capability is registered; it is not a live
  upstream DRS health probe. The authenticated field probe is the release gate.
- The adapter receives the aircraft serial number but DRS matching currently
  uses make/model only. Candidate labeling is therefore mandatory.
- Adapter request-shape tests and the browser client call test pass, but there
  is no focused UI contract covering evidence display and degraded states.

## Scope lock

### In this pass

- One aircraft-detail candidate panel.
- One existing MCP capability and adapter.
- Short-lived duplicate-request suppression.
- Honest source/freshness/error presentation.
- Focused automated tests and one authenticated preflight.

### Explicitly deferred

- General DRS document search.
- SAIB discovery UI.
- Background ingestion, polling, or scheduled synchronization.
- A tenant aircraft AD ledger or new database migration.
- Serial/effectivity applicability decisions.
- Hours/cycles/calendar interval evaluation, recurring AD logic, due dates,
  forecasting, alerts, sign-off, or compliance closure.
- New Azure services, queues, caches, indexes, or replicas.
- Production fallback fixtures or synthetic FAA results.

## Build checklist

### 1. Make the current result trustworthy

- [x] Rename the panel to **FAA AD candidates**.
- [x] Add the fixed qualifier: **Candidate matches from FAA DRS. Qualified
  review is required to determine serial/effectivity applicability and
  compliance status.**
- [x] Render the effective date when supplied.
- [x] Render each validated FAA source as an external **Open in FAA DRS** link.
- [x] Show `N candidates` and, when the list is truncated, `Showing 15 of N`.
- [x] Show the evidence retrieval time from the returned envelope, not the
  browser clock.
- [x] Preserve the existing distinct states: checking, sign-in required,
  identity needed, no candidates, limited, degraded, and live.
- [x] Never change `candidate` to `applicable` in presentation text.

Acceptance: a viewer can tell what was searched, when FAA was reached, how many
candidate records came back, where each record originated, and what the result
does **not** establish.

### 2. Remove repeat-call demo risk at the existing browser boundary

- [x] Add a private in-memory cache and in-flight request map inside
  `application-client.js` for `applicableAds` only.
- [x] Key it by organization ID and canonical aircraft ID; do not include or
  persist bearer tokens.
- [x] Coalesce concurrent identical requests and retain only successful
  envelopes for 15 minutes.
- [x] Preserve the original evidence timestamps in cached envelopes.
- [x] Clear the cache when capability connections are disconnected, the
  organization changes, or the session signs out.
- [x] Do not route this authenticated capability through the existing
  IndexedDB `MXCache` implementation.

Acceptance: opening the same aircraft repeatedly during a demo produces one
DRS lookup per organization/aircraft within the TTL, while a different tenant
or aircraft always gets an independent request.

### 3. Lock the behavior with focused tests

- [x] Extend the application-client test to prove successful caching,
  concurrent request coalescing, TTL expiry, organization isolation, and that
  failures are never cached.
- [x] Add a focused aircraft-detail UI contract for candidate wording, count,
  effective date, official source link, evidence timestamp, truncation, empty
  success, identity-needed, and degraded states.
- [x] Retain the five baseline FAA adapter tests for alias mapping, exact filter
  shape, date parsing, and FAA-only URLs; the focused suite now has eight tests.
- [x] Add response-path coverage for DRS `401/403`, `429`, timeout, malformed
  JSON, and the configured page ceiling without changing production behavior.

Acceptance: every demo-visible state and every upstream failure class has a
deterministic automated assertion.

### 4. Run one release gate and freeze

- [x] Run the focused JavaScript and FAA adapter suites.
- [x] Run the complete frontend and locked Rust workspace gates once the
  focused work is green.
- [x] Review the diff for secrets, browser credentials, unrelated features,
  and accidental claims of applicability or compliance.
- [ ] Run `scripts/live-field-probe.mjs` with the authenticated organization
  context and retain its report. Treat `/adapterz` as capability availability,
  not proof that FAA answered.
- [ ] In the live UI, open one known-result aircraft twice, one no-result
  aircraft, and one unresolved aircraft. Confirm the second known-result open
  is served from the short-lived client cache.
- [ ] Promote the frontend and core together only if both changed; otherwise
  promote only the changed surface.
- [ ] After the live smoke, freeze this slice for the demo. Record newly found
  ideas in the backlog rather than adding them to the release.

## Demo script

1. Open a known tenant aircraft.
2. Point out **FAA AD candidates**, the retrieval time, and the authoritative
   FAA link.
3. State: "MXGenius found records that may apply. A qualified reviewer still
   determines effectivity and compliance."
4. Reopen the aircraft to demonstrate an immediate, stable result without a
   second upstream call.
5. If FAA is unavailable, show the honest degraded state; do not substitute
   fixtures or claim a live result.

## Stop condition

This pass is complete when the four checklist sections are green. Anything
that requires persistence, scheduling, due calculations, new Azure resources,
or a second regulatory workflow belongs in a later sprint.
