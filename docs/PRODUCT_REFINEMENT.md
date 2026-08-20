# MXGenius Product Refinement

A standing assessment of every product surface: what is genuinely reachable
end to end, what is a shell over an unwired contract, and what refinement is
queued next.

This is **not** a duplicate of `PRODUCTION_MOUNT_TASKLIST.md`. That document
tracks the POC-to-v1 mount along its critical path. This one asks a narrower,
repeatable question of each surface — *can a user actually complete the job
this surface exists to do?* — and records the answer with evidence.

## Status legend

Matches the house convention in `PRODUCTION_MOUNT_TASKLIST.md`.

- `[x]` complete and verified end to end
- `[~]` implementation in progress or awaiting its verification gate
- `[ ]` not started
- `[!]` blocked by an external decision, credential, entitlement, or domain review

## How a surface gets assessed

Reading the code is not enough. The parts module read as finished — a full
schema, a complete HTTP contract, a wired UI, no TODOs — while being unable to
do the one thing it existed for. The assessment that caught it was three
questions, and every surface below should be put through the same three:

1. **Trace one real job end to end.** Not "does the endpoint exist" but "can a
   named person finish the task they opened this screen to do?" For parts that
   was *receive a part and later hand it to a mechanic.* The receive half
   worked; the hand-it-over half had no code at all.
2. **Diff the schema against the code.** A `CHECK` constraint, an enum, or a
   contract table names every state the designers intended. Grep each value
   against the server. Parts defined eleven inventory event types and
   implemented one; nothing failed, because nothing asserted otherwise.
3. **Ask what the UI refuses to offer.** A missing button is invisible in
   tests and in code review. The receiving wizard had no manual-entry path, so
   a part could not be created at all without uploading an image first —
   a restriction the backend never imposed.

When a surface passes, add the assertion that keeps it passing. Parts now has
a test that fails if a twelfth event type is added to the constraint and left
unwired.

## Surface assessment

| Surface | State | Notes |
| --- | --- | --- |
| Parts and inventory | `[x]` | All 11 event types reachable; demand meets stock. Phase 4 remains. |
| In-app feedback | `[x]` | Reporter, My Feedback, admin triage queue, ticket numbers. |
| Landing page | `[x]` | Rebuilt from the investor deck. |
| Authentication | `[~]` | Entra + beta-access rules live; guest onboarding needs a real-world pass. |
| Maintenance cases | `[~]` | Create/get/status exist; the case-scoped acceptance surfaces are the mount tasklist's active item. |
| AI advisory / chat | `[~]` | Grounded advisory with citations; streaming and fallback gaps tracked as MCP-AI-201..205. |
| Digital twin / 3D | `[~]` | Model catalog and markers live; operational slice partially mounted. |
| XR / Quest | `[~]` | Transport and presence tested; live headset gates still pending. |
| Compliance / FAA | `[~]` | AD and SAIB lookup wired behind an adapter that silently degrades. See below. |
| Fleet (JetNet) | `[~]` | Same silent-degradation pattern. |
| Weather | `[~]` | Same silent-degradation pattern. |
| Scheduling | `[~]` | Handlers exist; parts-readiness can now draw on the real shortage view. |
| MRO facilities | `[~]` | Pool-backed tools wire in production; `route_eta` and `contact_pack` still return typed partials. |
| Analytics / KPIs | `[ ]` | Handlers exist, no surface consumes them. |
| Project workspaces | `[x]` | Build board and patent workspace shipped. |
| Trust center / waitlist | `[x]` | Static, current. |

## Cross-cutting findings

These are patterns, not single bugs. Each one produced a real defect already,
so each is worth a standing check rather than a one-time fix.

### 1. Schema ahead of code, with nothing asserting the gap `[~]`

The parts module encoded eleven event types, nine statuses, five ownership
types, and six location types. One event type and one ownership type were
reachable. The database was documentation of an intent the code never met, and
no test noticed.

- [x] Parts: all event types reachable, asserted by test
- [ ] Audit `stock_units.owner_type` — `customer`, `consignment`,
      `exchange_core`, and `loaner` are still unreachable; the wizard hardcodes
      `owned`
- [ ] Run the same constraint-vs-code diff over `maintenance_cases`,
      `compliance`, and `evidence`
- [ ] Add the reachability assertion wherever a family is completed

### 2. Adapters that degrade silently at boot `[!]`

`main.rs` treats configuration failures inconsistently. The manual corpus
adapter is fail-closed — a bad config aborts startup. JetNet, FAA DRS, and
aviation weather each log `tracing::warn!` and fall back to a
`NotConfigured` adapter, and the server starts anyway.

The consequence is that a production deploy missing a JetNet or FAA credential
comes up healthy, serves traffic, and quietly answers compliance questions with
`source_not_configured`. The FAA contract is explicit that `no_candidates` and
`source_not_configured` mean different things; a silent degrade turns that
distinction into something only a log reader would notice.

- [!] Decide the intended posture per adapter: fail-closed at boot, or
      degrade loudly with a surfaced health signal. This is a deployment
      policy decision, not a code cleanup.
- [ ] Once decided, make `/health` or `/ready` report per-adapter availability
      so a degraded deploy is visible without reading logs
- [ ] Surface adapter availability in the UI wherever a user could otherwise
      mistake "not configured" for "nothing found"

### 3. UI that refuses what the backend allows `[~]`

The receiving wizard required a file upload before a part could be created;
`confirm_receiving` never required one. The unit drawer offered no disposition
because none was written, not because any rule forbade it.

- [x] Parts receiving: manual-entry path added
- [x] Parts drawer: movements offered per status
- [ ] Walk the case workspace and advisory surfaces for the same mismatch
- [ ] For each disabled or absent control, confirm the restriction exists
      server-side and is explained to the user

### 4. Contracts documented but unrouted `[~]`

`ROCKY_PARTS_VERTICAL_SLICE.md` specified `PATCH /api/parts/units/:unitId` as a
versioned correction. It was never routed, so a typo caught after confirmation
was permanent. The document and the router disagreed and nothing reconciled
them.

- [x] Parts: `PATCH` routed, corrections emit `metadata_corrected`
- [ ] Diff every route table in `docs/` against the live router
- [ ] Treat a documented-but-unrouted endpoint as a defect, not a backlog item

## Parts and inventory — remaining work

Phases 1 and 2 shipped, along with cycle counting, lot splitting, the shortage
view, and locations management. The remainder is schema-bearing.

### Phase 4 — compliance depth `[!]`

Blocked pending domain review. These decisions carry consequences beyond
software and should not be modeled from a best guess in code.

- [!] Shelf life, cure dates, calibration expiry, with issue-time blocking.
      Sealants, O-rings, oxygen bottles, ELT batteries, and life vests can
      currently be issued expired with the system's blessing.
- [!] Rotable life: TSN, TSO, cycles, carried across install and removal.
      `components` covers aircraft-installed parts, has no life fields, and
      does not reference `stock_units`.
- [!] Exchange and core tracking with return-by dates
- [ ] Ownership beyond `owned`: customer property, consignment, loaners
- [ ] Trace documents linked to `certificate_records`
- [ ] Recurring AD applicability, extending the existing FAA panel

### Phase 5 — purchasing and supply `[ ]`

- [ ] Purchase orders and repair orders with a status flow
- [ ] Receiving booked against a PO line rather than free-standing
- [ ] Vendor records and approvals — `suppliers` is three columns
- [ ] Quote comparison surfaced from `part_source_options`

### Smaller parts items `[ ]`

- [ ] Group per-unit counts into counting sessions with a variance report
- [ ] Min/max/reorder thresholds and stock-on-hand rollups
- [ ] Reserve directly from a shortage row
- [ ] Partial issue from a lot without a manual split first

## Analytics — unconsumed surface `[ ]`

`handlers/analytics.rs` implements executive KPIs, fleet health, parts risk,
and repeat defects. No screen renders any of it. Either it should surface or
it should be marked dormant with the same visibility the technical-library
bundles get in the live smoke test.

- [ ] Decide: surface it, or mark it dormant and assert that it stays so
- [ ] If surfaced, `parts_risk` can now draw on real shortage data

## Working agreement

- One surface at a time. Finish the assessment and its assertion before
  starting the next.
- A status only advances on evidence: a test, a driven UI run, or a deployed
  smoke check. "The code looks right" is what let the parts defect ship.
- Items marked `[!]` need a decision from outside the code. Raise them rather
  than guessing, especially where airworthiness is involved.
