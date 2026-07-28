# Rocky Parts Vertical Slice

Status: implementation contract
Owner: MXGenius application plane
Target: closed beta, production Azure services only

## Outcome

An authorized organization member can receive a physical aviation part, attach
photos or documents, review OCR/vision suggestions, confirm the receiving
action, and later retrieve the unit through search or a stable QR-backed URL.
The record retains human and machine provenance. FAA Airworthiness Directive
results are candidates for human review, never an airworthiness determination.

## Scope locks

- Entra ID authenticates users. The server-owned organization membership and
  beta access rules authorize them.
- Gmail users enter the beta as Entra B2B guests. Native Google OAuth is not in
  this slice.
- The production client has no mock fallback. Missing configuration or an
  unavailable service is a visible error.
- A `part` is a catalog definition. A `stock_unit` is a tenant-owned physical
  serialized item or lot. The existing global parts catalog and `mxg.parts.*`
  resolution contracts remain intact.
- OCR and vision output is proposed metadata. It never overwrites confirmed
  fields and never certifies identity, condition, trace, or airworthiness.
- Inventory ledger mutations require an authenticated human confirmation.
- QR codes contain a canonical application URL with an opaque unit ID. They
  contain no token, blob URL, tenant ID, serial number, or other sensitive data.
- Visual similarity stores optional model output behind a feature flag. It is
  not biometric identification and is not required to receive or find a part.
- Unit labels are optional. Browser-printable QR labels are included; dedicated
  printer and laser-etch integrations are not.

## Domain contract

### Catalog part

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Existing immutable UUID |
| `partNumber` | yes | Normalized for search, original value retained |
| `description` | yes | Catalog nomenclature |
| `manufacturer` | no | Existing catalog manufacturer text |
| `classification` | no | `rotable`, `repairable`, `expendable`, `consumable` |
| `isSerialized` | yes | Controls serial and quantity validation |
| `metadata` | yes | Bounded extension object |

### Stock unit

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Immutable opaque UUID used by canonical URLs |
| `organizationId` | yes | Derived from authenticated context, never client-selected |
| `partId` | yes | Catalog part |
| `serialNumber` | conditional | Required when the part is serialized |
| `lotNumber` | no | Lot identity for consumables |
| `quantity` | yes | Positive decimal; exactly 1 for serialized units |
| `conditionCode` | yes | `NE`, `NS`, `OH`, `SV`, `RP`, `AR`, `US`, `SC` |
| `status` | yes | Lifecycle below |
| `traceType` | yes | `form_8130`, `easa_form1`, `dual_release`, `coc`, `teardown`, `none` |
| `certificateNumber` | no | Human-confirmed value |
| `location` | yes | Tenant-owned location reference |
| `ownerType` | yes | Defaults to `owned` |
| `receivedAt` | yes | Server timestamp |
| `version` | yes | Monotonic optimistic-concurrency version |
| `metadata` | yes | Confirmed bounded extension object |

### Lifecycle

`receiving_draft -> quarantine -> available -> reserved -> issued`

`quarantine` may transition to `rejected`; `available`, `reserved`, or
`rejected` may transition to `in_repair`; terminal operational states are
`issued`, `shipped`, and `scrapped`. Records are archived, not hard-deleted.
The first beta ships with `quarantine_then_inspect`; direct-to-stock remains a
later site-policy switch.

### Asset and extraction

Every uploaded asset has an immutable ID, organization and unit/draft scope,
kind, original filename, media type, byte size, SHA-256 hash, private blob
reference, uploader, processing state, and timestamps.

An extraction run records provider/model version, state, raw-result reference,
and timestamps. Each candidate records field name, proposed and normalized
values, confidence from 0 to 1, source page/region when available, and
`proposed`, `accepted`, `edited`, or `rejected` review state. Accepted or edited
values record the confirming user and timestamp.

### Inventory event

The inventory event ledger is append-only. Each event records organization,
stock unit, type, quantity delta, source/destination locations, reference,
evidence asset, actor, optional originating agent action, correlation ID, notes,
and server timestamp. Current state is derived or atomically maintained from
confirmed events.

## HTTP application contract

All endpoints require a bearer token and derive organization/user context on
the server.

| Method and route | Purpose |
| --- | --- |
| `GET /api/parts?query=&status=&location=&cursor=` | Search tenant inventory units |
| `POST /api/parts/receiving-drafts` | Start an idempotent receiving draft |
| `GET /api/parts/units/:unitId` | Unit detail, assets, extractions, and history summary |
| `PATCH /api/parts/units/:unitId` | Versioned confirmed metadata correction |
| `POST /api/parts/receiving-drafts/:draftId/assets` | Register an upload and return an authorized upload target |
| `POST /api/parts/assets/:assetId/extractions` | Start or return the idempotent extraction run |
| `POST /api/parts/extractions/:runId/reviews` | Save per-field accept/edit/reject decisions |
| `POST /api/parts/receiving-drafts/:draftId/confirm` | Atomically create unit and ledger event |
| `GET /api/parts/units/:unitId/assets` | List authorized assets |
| `GET /api/parts/assets/:assetId/content` | Authorized download/short-lived redirect |
| `GET /api/parts/units/:unitId/events` | Append-only history |
| `GET /api/parts/units/:unitId/label` | Printable label model or PDF |
| `GET /api/parts/units/:unitId/faa-candidates` | Provenance-rich FAA candidate result |

Errors use `{ "error": { "code", "message", "correlationId", "details"? } }`.
Writes accept an `Idempotency-Key`; versioned writes require `If-Match`.

## Frontend adapter contract

`MXApplicationClient.parts` exposes:

- `search`
- `getUnit`
- `createReceivingDraft`
- `registerAssetUpload`
- `uploadAsset`
- `requestExtraction`
- `reviewExtraction`
- `confirmReceiving`
- `listDocuments`
- `listTransactions`
- `getFaaCandidates`
- `getLabel`

The workspace calls this adapter only. The adapter always uses the configured
production application API and never keeps authoritative units in browser
memory.

## Feature flags

- `partsWorkspace`: exposes navigation and read operations.
- `partsReceiving`: exposes upload, extraction review, and confirmation.
- `partsVisualSimilarity`: stores/queries image-match candidates; default off.
- `partsFaaCandidates`: exposes the provenance-rich FAA panel.

Flags control exposure, not authorization. Server authorization remains
mandatory when a flag is enabled.

## FAA result contract

The FAA response always includes `state`, where state is one of:

- `candidates_found`
- `no_candidates`
- `identifiers_incomplete`
- `source_not_configured`
- `source_unavailable`
- `source_rejected`

It also includes the normalized identifiers used, source name and URL,
retrieval timestamp, and candidate records with their authoritative links.
`no_candidates` means only that the configured query returned no candidates.

## Phase gates

1. Auth: a whitelisted Entra guest is recognized on the landing page without a
   redirect loop; a `403` and a service outage are visibly distinct.
2. Persistence: additive migrations preserve the catalog and enforce tenant
   ownership for units, assets, events, and extractions.
3. API: repository and route integration tests prove tenant isolation,
   idempotency, concurrency, and confirmation.
4. Processing: an uploaded representative file yields reviewable suggestions
   without mutating confirmed data.
5. UI: every visible action reaches the production adapter or is disabled with
   an explanation; no mock data path ships.
6. QR/FAA: a scan survives authentication and opens the correct unit; FAA
   empty/error states retain provenance and never imply compliance.
7. Release: migrations, health checks, feature-flag rollout, Rocky acceptance,
   monitoring, and rollback are complete.
