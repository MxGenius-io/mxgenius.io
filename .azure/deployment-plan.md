# MXGenius Azure Deployment Plan

## Expanded Fictional Parts Demo — 2026-09-18

> **Status:** Deployed and live-verified; authenticated tenant demo activation remains user-triggered
> **Recipe:** AZCLI (existing ACR + Container Apps + GitHub Pages release path)

### Objective and approved scope

Promote the 47-part fictional inventory expansion already committed on canonical
`main`. The static application receives 47 distinct local catalog visuals and a
complete demo-presentation view. The existing `mxg-core` receives the matching
part masters, tenant-derived stock-card fixtures, and multi-tenant seed logic.
This release creates no Azure resource, migration, secret, role assignment,
network path, provider connection, or SKU change.

### All validation checks pass

- [x] Azure CLI 2.86.0 is authenticated to the enabled existing production
  subscription and expected Central US resource group.
- [x] `mxg-rg-50106`, ACR `mxgacr50106`, and Container App `mxg-core` report
  successful provisioning; the current Core revision is healthy and serves
  100% traffic with one replica.
- [x] Infrastructure compilation, template validation, and what-if are not
  applicable because this release changes no Bicep, Terraform, migration,
  resource configuration, identity, RBAC, or secret source.
- [x] The complete application suite, complete locked Rust workspace suite,
  Rust formatting, warnings-denied Clippy, and locked optimized Core build pass.
- [x] The Docker build context contains the required Dockerfile and lockfile;
  ACR remote build remains the authoritative container build path.
- [x] Subscription and resource-group policy assignment counts are zero.
- [x] Static role review confirms no new data operation or RBAC requirement.

### Validation Proof

- At `2026-09-18T06:30:44-04:00`, source
  `ff1007c94510e719a78b532dd3111413b240d858` matched `origin/main` and the
  working tree was clean before this deployment record was added.
- `npm test` passed 484/484 checks. The expanded inventory contract verified
  exactly 47 roster rows, part masters, tenant stock cards, visual keys, and
  unique 1536×1024 JPEGs within the 350 KB asset budget.
- `cargo test --locked --workspace` passed 325 executable Rust checks with the
  one live Azure credential-gated manual-library test intentionally ignored.
  The new tenant-ID regression is included. `cargo fmt --all -- --check`,
  warnings-denied workspace Clippy, and
  `cargo build --locked --release -p mxgenius-mcp` also passed.
- Azure read-only inspection confirmed enabled subscription
  `d1a68ed7-2983-4a86-ab0e-e56df9e2e325`, resource group `mxg-rg-50106`, ACR
  `mxgacr50106`, and the healthy current revision `mxg-core--flt155f23d` using
  image `mxg-core:live-traffic-155f23d-20260917`.
- Pre-deployment `https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io/healthz`,
  `/readyz`, and `/adapterz` each returned HTTP 200.
- Subscription and resource-group Azure Policy assignment counts were zero.
  Live role inspection confirmed the existing Core identity retains only its
  required `Storage Blob Data Contributor` role on the private documents
  container and `Cognitive Services User` role on Document Intelligence.
- Diff inspection found no migration or infrastructure delta. The production
  Dockerfile remains a locked multi-stage Rust build with a non-root runtime.

### Promotion and acceptance

- [x] Commit and push this validated deployment record to canonical `main` and
  confirm the GitHub Pages release succeeds.
- [x] Build the exact `services/mcp` source in ACR with an immutable source tag.
- [x] Promote one new `mxg-core` revision while retaining the current healthy
  revision for rollback.
- [x] Confirm image digest, revision health, replica count, 100% traffic, and
  post-deployment health/readiness/adapter probes.
- [ ] Confirm the authenticated demo loader returns the expanded tenant stock
  count; do not fabricate a user session or mutate another tenant for testing.

### Deployment proof

- Deployment record commit `510379d918cb6f03078ecfacf88d559cff946829`
  reached canonical `main`; GitHub Pages run `35335174878` completed
  successfully.
- ACR run `cj3w` built
  `mxgacr50106.azurecr.io/mxg-core:parts-demo-510379d-20260918` with digest
  `sha256:8bb07ddd5b64a26a779a51bbf2f7d6dd63d30dbfe66d8bbc4be8ab0d6ef2eac6`.
- Container App revision `mxg-core--parts510379d` is active, healthy, has one
  ready replica, and receives 100% of production traffic. Previous revision
  `mxg-core--flt155f23d` remains the rollback target.
- Post-deployment `/healthz`, `/readyz`, and `/adapterz` checks each returned
  HTTP 200. The live dashboard returned HTTP 200 with the expected cache pins,
  and a representative new catalog image returned HTTP 200 as `image/jpeg`
  with the expected byte length.
- Anonymous access to `/api/demo-data` returned HTTP 401, confirming that the
  deployed route is mounted and remains fail-closed. Loading the expanded stock
  into a specific tenant intentionally remains an explicit authenticated
  **Load Demo Content** action in Settings.

### Rollback

Shift traffic back to `mxg-core--flt155f23d` and restore the preceding static
commit if acceptance fails. The seed is idempotent and additive; rollback does
not delete parts, stock, cases, manuals, images, devices, or customer data.

## Deterministic OpenSky Live Traffic — 2026-09-17

> **Status:** Deployed and live-verified
> **Recipe:** AZCLI (existing ACR + Container Apps + GitHub Pages release path)

### Objective and approved scope

Add a user-started real-time aircraft-position layer to the existing fleet globe
without changing the current JetNet fleet-location layer. The browser requests a
shared server snapshot only while the dashboard globe is visible. The fleet proxy
authenticates to OpenSky with OAuth2 client credentials, performs no more than one
upstream state-vector request every 30 seconds per running replica, and returns a
bounded normalized aircraft list. The browser renders a clearly labeled
Pull/List/Render ribbon, current-position points, source-aware hover detail, and
stale-snapshot status. A separate on-demand JetNet route button displays recent
origin-to-destination records and never represents those arcs as live positions.

The user approved this path by requesting the deterministic OpenSky mode and
providing a dedicated API client for server-side configuration. No credential is
stored in Git, browser code, or the deployment plan.

### Architecture and release delta

- **Static application:** publish the updated dashboard, application client,
  globe controller/styling, environment manifest, tests, and feature catalog.
- **Fleet proxy:** build `services/fleet-proxy` in existing ACR and promote one
  immutable image to the existing `mxg-fleet` Container App.
- **Application core:** build the exact `services/mcp` source and promote one
  immutable image to the existing `mxg-core` Container App so the server-owned
  model site map matches the moved Settings controls and new globe layers. The
  same core delta keeps an explicitly requested AMM/IPC/NDT/SPM/SSM family
  primary rather than blending supporting manual families into it.
- **Secrets:** add the OpenSky client secret as a Container Apps secret; bind
  `OPENSKY_CLIENT_SECRET` through a secret reference. Configure the client ID
  and 30-second poll interval as non-secret environment values.
- **Provider boundary:** OAuth token and OpenSky REST calls remain server-only.
  The browser uses the existing authenticated fleet-proxy boundary.
- **Infrastructure:** no new Azure resource, SKU, identity, role assignment,
  database migration, network path, or storage object is introduced.
- **Scale assumption:** the current `mxg-fleet` single-replica setting is
  retained so the in-memory shared snapshot is also the deployment-wide
  deterministic throttle for this demo release.

### All validation checks pass

- [x] Azure CLI is installed and the expected subscription is authenticated.
- [x] Existing resource group, ACR, Container Apps environment, `mxg-fleet`
  app, active revision, scale, secrets, and environment-key names are inspected
  without printing secret values.
- [x] Bicep compilation, template validation, and what-if are confirmed not
  applicable because this release changes no infrastructure template.
- [x] JavaScript syntax, complete application tests, focused proxy tests,
  whitespace validation, and fleet-proxy container build inputs pass.
- [x] Rust workspace tests, formatting, warnings-denied Clippy, and locked
  optimized `mxgenius-mcp` build pass for the exact application-core source.
- [x] A real OpenSky OAuth exchange and one state-vector request succeed without
  printing or persisting the access token.
- [x] Subscription and resource-group Azure Policy assignments introduce no
  blocker.
- [x] Static role review confirms no RBAC delta and no new managed-identity data
  operation.

### Validation Proof

- Azure CLI `2.86.0` authenticated to enabled subscription
  `d1a68ed7-2983-4a86-ab0e-e56df9e2e325` in the expected tenant. Resource
  group `mxg-rg-50106` and ACR `mxgacr50106` both reported `Succeeded`.
- `mxg-fleet` reported `Succeeded`, single-revision mode, minimum and maximum
  replica counts of one, and active healthy revision `mxg-fleet--jetd85cc27`
  serving 100% traffic. Existing environment inspection returned names and
  secret-reference names only; no secret values were queried.
- `node --check` passed for `app.js`, `application-client.js`, and
  `services/fleet-proxy/server.js`; `git diff --check` passed. The focused
  client/proxy/structure run passed 107/107 checks and `npm test` passed all
  467 checks.
- `cargo fmt --all -- --check` passed. The locked all-target workspace suite
  passed 325 executable Rust checks with one live Azure credential-gated test
  intentionally ignored. Warnings-denied workspace Clippy passed, followed by
  a successful locked optimized `mxgenius-mcp` release build. Validation caught
  and corrected two stale manifest-version assertions before the final pass.
- The fleet-proxy Dockerfile remains a bounded Node 22 Alpine image containing
  only `server.js`, running as the non-root `node` user. Local Docker is not
  installed, so the existing ACR remote build remains the authoritative image
  build during deployment.
- One direct OAuth client-credentials exchange succeeded, followed by one
  authenticated OpenSky `/states/all?extended=1` request returning HTTP 200,
  12,646 positioned aircraft, and 3,996 remaining credits. Neither access token
  nor client credential was printed or persisted in repository files.
- Subscription and resource-group Azure Policy assignment counts were both
  zero. Static review found no infrastructure/RBAC delta: OpenSky uses an
  outbound HTTPS credential, not a managed-identity data-plane operation.
- A diff-level credential scan confirmed that neither the OpenSky client ID nor
  client secret appears in tracked changes. The production credential is
  stored only as a Container Apps secret and secret reference.
- Canonical service source commit `155f23d78c10fc2e451803457b6117b70ddab4c5`
  was published by successful GitHub Pages run `35266552407`. A live field
  check then exposed and corrected one frontend coupling: a degraded JetNet
  registry could return before the independent OpenSky controls were bound.
  Hardening commit `31b3ec4d0c27fa169abb9b3037698b1de27395a5`
  keeps the globe and Live Traffic mode available with an empty registry; its
  successful Pages run is `35268407394`.
- ACR runs `cj3v` and `cj3u` published
  `mxg-core:live-traffic-155f23d-20260917` at digest
  `sha256:3b78a56881571ec067d57c7860a5367d7321a5efd6972378a9f83b0f1c4f41bc`
  and `mxg-fleet:live-traffic-155f23d-20260917` at digest
  `sha256:f48bcc9dca5c2e6d2f9a1c5f0546a0134e4723bfdb446c2ac233ead975000e03`.
- Revisions `mxg-core--flt155f23d` and `mxg-fleet--flt155f23d` are Healthy,
  latest-ready, RunningAtMaxScale, provisioned with one replica, and serving
  100% traffic. Core health, readiness, and adapter probes and fleet health and
  status probes returned HTTP 200. Fleet status reported OpenSky configured and
  its shared server snapshot ready.
- Signed-in production acceptance started Live Traffic from the globe, visibly
  rendered the Pull/List/Render ribbon and aircraft layer, and returned 12,739
  listed aircraft with the deterministic 3,000-point display cap. The next
  bounded refresh returned 12,724 listed and 3,000 rendered at the displayed
  30-second cadence. Stopping the mode immediately hid the ribbon and reset the
  control; restarting restored the cached live snapshot. The verified browser
  was left on Live Traffic mode for owner review.

### Promotion and acceptance

- [x] Commit and push the exact validated source to canonical `main`; confirm
  the matching GitHub Pages run succeeds.
- [x] Build `services/mcp` and `services/fleet-proxy` in ACR with immutable
  source-tagged images.
- [x] Promote `mxg-core`, then confirm health, readiness, adapter state, image
  digest, one-replica scale, and the absence of a migration delta.
- [x] Configure the existing `mxg-fleet` secret reference and non-secret
  OpenSky environment values, promote one new fleet revision, and retain the
  previous ready revision for rollback.
- [x] Confirm revision health, one-replica scale, ingress, image digest, and
  live health/status without returning secret values.
- [x] In a signed-in production session, start Live Traffic, observe the
  Pull/List/Render ribbon and current aircraft points, wait through one
  30-second refresh, stop the mode, and restart it cleanly.

### Rollback

Shift `mxg-core` and `mxg-fleet` traffic to their preceding healthy revisions
and restore the previous static commit if acceptance fails. The new Container
Apps secret may remain dormant or be rotated; rollback deletes no customer,
fleet, manual, image, case, part, device, or payment data.

## Tenant-owned JetNet connections — 2026-09-17

> **Status:** Deployed and live-verified
> **Recipe:** AZCLI (existing ACR + Container Apps release path)

Add an organization-scoped JetNet connection card to Settings and keep Restart
Tour and Sign Out together in one bottom action row. Managers and administrators
can verify, replace, or disconnect their organization's JetNet account. The
credential is AES-256-GCM encrypted before PostgreSQL persistence, never returned
to the browser, and exposed only to the existing fleet proxy through its private
service bearer. Fleet provider sessions and snapshots are isolated by
organization; organizations without an override continue to use the managed
MXGenius service connection.

### Validation and promotion

- [x] `npm test` passed 459/459 application and service contract checks.
- [x] Workspace Rust tests, formatting, and warnings-denied Clippy passed.
- [x] Migration `0032_provider_connections.sql` is additive and copies or
  deletes no existing account, fleet, manual, image, case, part, or device data.
- [x] Existing Azure resources, revisions, environment names, and secret
  references were inspected without disclosing credential values.
- [x] Commit and push the exact source to canonical `main`; confirm Pages.
- [x] Add the provider-encryption key and existing private fleet bearer to
  `mxg-core`, then promote and probe the core revision.
- [x] Promote `mxg-fleet`, verify the tenant credential-broker path, and perform
  signed-in read-only visual acceptance without entering a real credential.

### Deployment proof

- Canonical source commit `d85cc2726d8382b5f5c018bd57ca7dab4cd2df69`
  was published by successful GitHub Pages run `35244733557`.
- ACR runs `cj3t` and `cj3s` published
  `mxg-core:tenant-jetnet-d85cc27-20260917` at digest
  `sha256:dfb8e350a65ce091067489171b4286cdbc307cc529f4fd5f4a7a1d81ed620bef`
  and `mxg-fleet:tenant-jetnet-d85cc27-20260917` at digest
  `sha256:6bcdebcad8df62c3fe2a94e0ed2fcd2512f1888ff6d5b67f50af32c8a165f69b`.
- Revisions `mxg-core--jetd85cc27` and `mxg-fleet--jetd85cc27` are Healthy,
  latest-ready, Running, and provisioned with one replica. Core health,
  readiness, and adapter probes and fleet health/status returned HTTP 200.
- The internal credential broker authenticated with the existing private
  service bearer and returned the expected HTTP 404 for an organization with
  no override; anonymous core and fleet mutation requests returned HTTP 401.
- Signed-in browser acceptance displayed the unconfigured JetNet card without
  a returned secret and showed equal-width Restart Tour and Sign Out buttons in
  one row. No real JetNet credential was entered or persisted during acceptance.

### Rollback

Restore `mxg-core--cust22ac710` and `mxg-fleet--0000010`, then revert the static
release if acceptance fails. Migration 0032 is additive and may remain in place;
it contains no rows until an authorized customer connects an account.

## Customer Operations Control Plane — 2026-09-17

> **Status:** Deployed and live-verified
> **Recipe:** AZCLI (existing ACR + Container Apps release path)

Promote the tenant-scoped Customer Operations vertical slice as one paired
static/core release. Operations Center gains a Customers workspace for company
records, multiple registered Pi devices, Equipment Drive assignment, an
operational payment ledger, and heartbeat/deployment/error visibility. Device
Registry and Equipment Drives leave Settings but retain their existing device
credential, short-code claim, package, and assignment contracts. Migration
`0031_customer_operations.sql` is additive: it creates customer and payment
tables and adds an optional tenant-constrained customer reference to existing
edge devices. It copies or deletes no customer, device, payment, manual, image,
or source-PDF data.

### All validation checks pass

- [x] Azure CLI `2.86.0` and the existing authenticated subscription are
  available.
- [x] Subscription `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), resource group
  `mxg-rg-50106`, Central US environment `mxg-cae-50106`, ACR
  `mxgacr50106`, and Container App `mxg-core` are enabled and provisioned.
- [x] Bicep compilation, template validation, and what-if are not applicable:
  this release changes no infrastructure template, resource SKU, identity,
  secret, or RBAC source.
- [x] The complete application and Rust suites, formatting, warnings-denied
  Clippy, whitespace validation, and locked optimized build passed.
- [x] Subscription and resource-group policy assignment counts are zero.

### Validation proof

- `npm test` passed 454/454 application and contract checks.
- `cargo test --workspace` passed 323 executable checks with one live
  credential-gated exporter intentionally ignored. `cargo fmt --all --
  --check`, warnings-denied workspace Clippy, and
  `cargo build --locked --release -p mxgenius-mcp` passed.
- `git diff --check` passed, Operations Center contains 92 unique element IDs,
  and the migration-byte contract confirmed SQLx migrations retain LF bytes.
- The new server tests verify organization scoping, Manager/Administrator
  authorization, multi-device ownership, payment history, and reuse of the
  existing heartbeat, assignment, and deployment ledgers.
- Pre-deployment `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200.
  `mxg-core--chat6603355` is Healthy, Provisioned, running one replica, and
  serving 100% traffic.
- Static and live role verification found no permission delta. The `mxg-core`
  system identity retains `Storage Blob Data Contributor` on the private
  `documents` container and `Cognitive Services User` on the existing
  Document Intelligence account. The established registry-secret pull path
  makes a new `AcrPull` propagation gate inapplicable.

### Deployment and acceptance

- [x] Confirm the existing subscription and Central US release target with the
  owner immediately before deployment.
- [x] Commit and push the exact source on canonical `main`; confirm the matching
  GitHub Pages run completes successfully.
- [x] Build `services/mcp` in ACR with an immutable tag containing the source
  commit and promote one matching `mxg-core` revision.
- [x] Confirm the additive SQLx migration completes, then re-run health,
  readiness, adapter, revision, replica, traffic, and live-role checks.
- [ ] Complete signed-in acceptance: create one customer, attach two devices,
  publish and assign an Equipment Drive, inspect deployment telemetry, and
  record a payment-history row.

### Deployment proof

- Canonical `main` source commit
  `22ac710d19f919d6b4520895a6764bfda74ac7be` was published by successful
  GitHub Pages run `35236232641`.
- ACR run `cj3r` built and pushed immutable image
  `mxg-core:customer-ops-22ac710-20260917` with digest
  `sha256:f21bec42532e2bbf52c7b46feb00901716efcd03d4a3dd0fdda8d3149785b4d2`.
- Container App revision `mxg-core--cust22ac710` is the latest ready revision,
  Running and Provisioned with one replica and 100% traffic.
- Post-deployment `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200;
  PostgreSQL and `manuals-catalog-v3` reported ready. An unauthenticated
  `/api/customer-accounts` request returned the expected `401 AUTH_REQUIRED`,
  confirming the route is mounted behind the application identity boundary.
- Signed-in read-only acceptance loaded the live Customers tab, reported an
  authenticated workspace, zero customer accounts, one managed/authorized
  device, and one device in the unassigned queue. The remaining unchecked
  acceptance item intentionally requires real customer, device, drive, and
  payment mutations and was not fabricated for deployment proof.

### Rollback

Restore `mxg-core--chat6603355` and the preceding static commit if acceptance
fails. Migration 0031 is additive and may remain in place during application
rollback; pre-existing devices remain valid and unassigned because the new
customer reference is nullable. Do not drop the customer tables as rollback.

## Full-Catalog Conversational Hardening — 2026-09-17

> **Status:** Deployed and accepted
> **Recipe:** AZCLI (existing ACR + Container Apps release path)

Promote commit `66033559d82f8f223feeca3e3b4f5e2cd15485af` as a paired static/core release. The core maps natural
aircraft names such as `Beechcraft 1900C` to the exact 91-family prepared
catalog vocabulary, keeps retrieval mechanics out of user-facing answers, and
waits for Realtime tool/context acknowledgement before reporting voice ready.
Generic section wording such as "standard practices" no longer forces a
nonexistent standalone publication-family filter, and registered figures use
their source page text to resolve generic legacy captions without weakening
aircraft or component scope.
The static application presents readable four-library Equipment Drive labels
and removes the redundant header Tour button. Existing infrastructure,
identities, RBAC, secrets, database schema, Search index, Blob data, Pi data,
and resource SKUs are unchanged.

### All validation checks pass

- [x] Azure CLI `2.86.0` and the existing authenticated subscription are
  available.
- [x] Subscription `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), resource group
  `mxg-rg-50106`, and Central US Container Apps environment
  `mxg-cae-50106` are enabled and provisioned.
- [x] Bicep compilation, template validation, and what-if are not applicable:
  this release changes no infrastructure or RBAC source.
- [x] The locked optimized `mxgenius-mcp` build completed successfully.
- [x] Subscription and resource-group policy assignment counts are zero.

### Validation proof

- `npm test` passed 450/450 application and contract checks.
- `cargo test --workspace` passed 316 executable checks with one live
  credential-gated exporter test ignored. `cargo fmt --all -- --check`,
  warnings-denied workspace Clippy, and the locked optimized release build
  passed.
- The local derived-data audit covered 91 aircraft, 10,078 manuals, 111,930
  chapters, and 350,645 per-manual image references with zero missing and zero
  empty linked files. It did not copy source PDFs.
- Direct Azure AI Search probing returned multiple `MODEL 1900-C AIRLINER`
  Chapter 20 Standard Practices records with registered assets.
- Pre-deployment `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200;
  PostgreSQL and `manuals-catalog-v3` report ready and healthy.
- Static role verification found no infrastructure or RBAC delta. The existing
  `mxg-core` system identity and least-privilege data roles remain unchanged.

### Deployment and acceptance

- [x] Build the exact committed `services/mcp` source in ACR with immutable tag
  `catalog-chat-6603355-20260917`.
- [x] Promote `mxg-core` as revision `mxg-core--chat6603355`.
- [x] Confirm health, readiness, adapter status, revision, digest, replica
  count, traffic, and live roles.
- [x] Verify GitHub Pages and replay the natural Beechcraft 1900C
  standard-practices request with excerpt, source pill, and linked image.

### Production record

- Source: `66033559d82f8f223feeca3e3b4f5e2cd15485af` on canonical `main`.
- GitHub Pages: run `35223325225` completed successfully for the exact source.
- ACR: run `cj3q`; image
  `mxgacr50106.azurecr.io/mxg-core:catalog-chat-6603355-20260917`; digest
  `sha256:546003b8341ca3160b4724bc7888652c513ede0f6a24bf69d321d3e326332282`.
- Container Apps: `mxg-core--chat6603355`, Healthy, Provisioned, one replica,
  RunningAtMaxScale, latest-ready, and serving 100% traffic.
- Post-deployment `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200;
  PostgreSQL and `manuals-catalog-v3` reported ready and healthy.
- Live roles remained unchanged: Storage Blob Data Contributor on the private
  `documents` container and Cognitive Services User on the existing Document
  Intelligence account.
- Acceptance prompt: "What standard-practices guidance applies to a structural
  inspection finding on a Beechcraft 1900C? Show me the most relevant figure
  if there is one." The production response returned one focused Chapter 20
  record, a green Registered source pill, a readable excerpt, and the actual
  page-32 Figure 14 image. The browser confirmed the image completed at
  2025×2550 pixels.
- Tests: 450/450 application checks and 316 executable Rust checks passed; one
  live credential-gated exporter remained intentionally ignored. Formatting,
  warnings-denied Clippy, and whitespace checks passed.

### Rollback

Restore the preceding immutable ACR image and static commit if a later
regression appears. No data or schema rollback is needed.

## Friday Funding Demo Release — 2026-09-16

> **Status:** Validated
> **Recipe:** AZCLI (existing ACR + Container Apps release path)

Promote commit `a0fc60c` as a paired static/core release. The static application
adds readable manual excerpts and distinct fictional demo imagery. The core
restructures the tenant-scoped, idempotent Demo Content seed into the three
Friday scenarios: strobe light, right main wheel/brake, and windshield remote
review. Existing infrastructure, identities, secrets, database schema, Search
index, Blob corpus, Pi releases, and cost-bearing resource SKUs are unchanged.

### All validation checks pass

- [x] Azure CLI installation: Azure CLI `2.86.0` is available.
- [x] Authentication: subscription `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`) is enabled in tenant
  `bb1b06c5-1b43-4295-8c01-d7ffd3a5b366`.
- [x] Bicep compilation: not applicable; this release changes no
  infrastructure template or Azure resource definition.
- [x] Template validation: not applicable; the established Container App is
  promoted by immutable image and revision suffix only.
- [x] What-if preview: no infrastructure delta. Resource group
  `mxg-rg-50106`, ACR `mxgacr50106`, and Container App `mxg-core` are already
  provisioned and healthy.
- [x] Container/build verification: locked optimized `mxgenius-mcp` build
  completed successfully; the authoritative container image will be built by
  the existing ACR remote-build path from the committed `services/mcp` tree.
- [x] Azure Policy validation: subscription and resource-group assignment
  counts are both zero.

### Validation proof

- `node --test tests/*.test.mjs` passed 444/444 tests; `node --check app.js`
  and `git diff --check` passed.
- `cargo test --locked --workspace --all-targets -q` passed 307 executable
  checks with one credential-gated check ignored. `cargo fmt --all -- --check`,
  warnings-denied workspace Clippy, and
  `cargo build --locked --release -p mxgenius-mcp` passed.
- The demo-seed contract test proves three ordered cases, the remote-witness
  marker, strobe inventory, hidden legacy history, and complete component
  remapping on rerun.
- Pre-deployment `https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io/healthz`,
  `/readyz`, and `/adapterz` returned HTTP 200. Readiness reports PostgreSQL and
  `manuals-catalog-v3` healthy; Parts and remote witness are available.
- `mxg-core` is running and provisioned on revision
  `mxg-core--live352eeda`; ACR is provisioned on the Basic SKU.

### Role assignment verification

- **Status:** Verified; no RBAC or identity change is present in this release.
- **Identity checked:** existing `mxg-core` system identity
  `f690814f-1f55-4394-adaa-8120d5d433c7`.
- **Static scope:** application code continues using the existing private Blob,
  Document Intelligence, Search, and PostgreSQL boundaries. No Bicep,
  Terraform, managed-identity declaration, or role-assignment source changed.
- **Deployment authentication:** the existing registry secret remains the ACR
  pull path, so a new managed-identity `AcrPull` propagation gate is not
  applicable.

### Deployment and acceptance

- Build `services/mcp` in ACR with an immutable tag containing the final commit.
- Promote `mxg-core` with a matching revision suffix and keep
  `mxg-core--live352eeda` available for rollback until acceptance completes.
- Re-run health/readiness/adapter probes, load Demo Content once, and cold-test
  the strobe, wheel, and windshield flows in that order.

### Registered Figure 601 acceptance — 2026-09-17

- Commit `854a8d8` is on canonical `main`; GitHub Pages run `35189643210`
  completed successfully for that commit.
- ACR run `cj38` published
  `mxg-core:friday-evidence-854a8d8-20260917` with immutable digest
  `sha256:92bebe6a36331ba5db2f588c71c129d212ceb2a32443a7266f3c3476870c3c5e`.
- Revision `mxg-core--fig854a8d8` is Healthy, Provisioned, running one replica,
  and serving 100% traffic. `/healthz`, `/readyz`, and `/adapterz` returned HTTP
  200; readiness identifies `manuals-catalog-v3` as healthy.
- Azure Search still contains exactly 1,060,418 manual records. The two CL350
  Chapter 56 Figure 601 records contain one-element `assets_json` arrays with
  their registered SHA-256 values; only their derived PNGs were published.
  No source PDF was copied.
- A fresh signed-in production replay from the active `Challenger 350`
  windshield case rendered Figure 601 Sheet 1 in the evidence card with an
  `M-01` registered-source pill. A fresh wheel advisory kept cited part numbers
  and represented unavailable labor hours without a literal `null` value.

### Rollback

Restore `mxg-core--live352eeda` and the prior static commit if the new revision
or any browser acceptance gate fails. The Demo Content seed is idempotent and
uses only visibly labeled synthetic records; no schema rollback is required.

## Canonical Manual Catalog v3 — 2026-09-16

> **Status:** Deployed and healthy
> **Recipe:** AZCLI (existing Azure AI Search + Blob Storage + ACR + Container Apps release path)

Promote the complete canonical `D:\Data\mxgenius` flattened manual catalog as
the single source for both model retrieval and Equipment Drive publication.
The model receives the full multi-aircraft Search catalog. Each physical Pi
release is compiled from the same records and content-addressed images, scoped
to the selected drive's aircraft family so it remains inside the agent's 2 GiB
single-slot contract. No source PDFs are copied.

### Deployment scope

- Create and verify the additive `manuals-catalog-v3` Azure AI Search index and
  the deduplicated `documents/manual-assets/legacy-rag/v3/` image prefix before
  changing production retrieval.
- Build the exact committed `services/mcp` source in the existing
  `mxgacr50106` registry, promote only the existing `mxg-core` Container App,
  and point it at `manuals-catalog-v3` after corpus verification succeeds.
- Update the static application terminology and settings copy to describe the
  shared, profile-aware model-context and Equipment Drive release boundary.
- Preserve the existing resource group, identities, secrets, networking,
  database, Pi agent, Entra configuration, and cost-bearing resource SKUs.

### Validation steps

- Reconcile v3 to 91 aircraft, 106,967 shards, and 1,060,418 source chunks;
  verify image Blob names and hashes, accepted media types, and the absence of
  copied PDFs.
- Run Rust formatting, locked all-target workspace tests, warnings-denied
  Clippy, an optimized build, the complete application suite, Python compile
  checks, ingestion dry-run coverage, and `git diff --check`.
- Reconfirm the approved Azure subscription, existing resource health,
  identity/RBAC posture, Search capacity, and current service endpoints.
- After promotion, test broad natural questions against more than one aircraft
  family and verify evidence pills, expandable excerpts, and catalog images.
- Publish and inspect one CL350 Equipment Drive release from the same v3
  catalog, confirming its manifest, aircraft scope, asset hashes, and 2 GiB
  limit before assignment to the Pi.

### Validation proof

- The canonical source reconciles to 91 aircraft, 106,967 shards, and
  1,060,418 unique chunk IDs. Azure Search v3 reports exactly 1,060,418 manual
  records across the same 91 aircraft: 967,371 text-only and 93,047 page-linked.
- Azure Blob contains 42,407 unique content-addressed PNG/JPEG figures totaling
  9,671,431,504 bytes under the v3 prefix, with zero PDFs. A downloaded sample
  re-hashed to its Blob filename. The formerly failing 38,938-byte G500 image
  register is retrievable with all 86 linked assets available and hash-matched.
- The v3 schema keeps `assets_json` retrievable but out of the term/facet/sort
  indexes and keeps the 384-dimension vector non-retrievable. The Basic Search
  service remains healthy at one partition/replica; v3 consumes 5,885,896,147
  bytes plus a 1,686,813,012-byte vector index.
- The frozen browser suite passes 442/442. The locked Rust workspace passes
  306/306 executable checks with one credential-gated live exporter ignored;
  formatting, warnings-denied Clippy, release build, Python compile, focused
  corpus contracts, and `git diff --check` also pass.
- A verified vector-page derivative corrects the CL350 FDR removal diagram
  without copying its source PDF. Blob metadata, the frozen register, and the
  `manuals-catalog-v3` record agree on Figure 401, manual page 403, and SHA-256
  `74c13c22b4c9c56a6fd0ccac3204a4cf49c9ed6ae57a0d9280112a5409501152`.

### Deployment proof

- Exact source commit `1c08ffbc06509ea9ac3992ece0d04c814b87258b` is on canonical
  `main`; GitHub Pages run `35173241950` completed successfully for that commit.
- ACR run `cj35` published
  `mxg-core:rag-verified-1c08ffb-20260916` with immutable digest
  `sha256:91c959e931d4db84f0a7bc1f2504afb456fdbd52b4d0b872d27fb18a9ccaca0c`.
- Container Apps revision `mxg-core--rag1c08ffb` is Healthy, Provisioned,
  latest-ready, running one replica, and serving 100% traffic. The prior
  `mxg-core--uicafef27` revision remains healthy at 0% for rollback.
- Post-promotion `/healthz`, `/readyz`, and `/adapterz` return HTTP 200.
  Readiness identifies `manuals-catalog-v3` as ready and healthy. Managed
  identity roles remain unchanged and container-scoped where applicable.

## Natural Registered-Image Intent — 2026-09-15

> **Status:** Deployed and live-verified
> **Recipe:** AZCLI (existing ACR + Container Apps release path)

Extend the frozen CL350 AMM image register with explicit natural-language
aliases for removing or installing the flight data recorder. The change stays
inside the existing deterministic register: it does not enable fuzzy matching,
does not alter manual content or asset hashes, and preserves the visual-intent
and CL350 aircraft gates.

### Deployment scope

- Build `services/mcp` from the exact committed source in the existing
  `mxgacr50106` registry and promote only the existing `mxg-core` Container App.
- Preserve the frozen Search index, Blob assets, Pi Equipment Drive, secrets,
  identity, ingress, scale, database, Entra objects, RBAC, and frontend.
- No infrastructure, data, permission, or cost-bearing resource change is
  included.

### Validation steps

- Prove that the natural FDR-removal wording resolves only the registered page
  165 asset while generic text and wrong-aircraft requests still fail closed.
- Run Rust formatting, complete locked all-target workspace tests,
  warnings-denied Clippy, the frontend/application contract suite, and
  `git diff --check`.
- Reconfirm the Azure deployment target, current readiness, identity/RBAC
  posture, then promote through the established ACR and Container App path.
- Repeat the natural production request and verify one removal image, the
  correct source pill/excerpt, and no data-download figure.

### Validation proof

- The focused natural-language lookup resolved only
  `IMG-CL350-AMM-31-FDR-REMOVAL` on page 165. Existing fail-closed coverage
  still rejects generic text-only prompts, the wrong aircraft, and ambiguous
  unregistered figures.
- Rust formatting passed. The complete locked all-target workspace passed 299
  tests with one credential-gated live exporter intentionally ignored; strict
  Clippy passed with warnings denied; the locked optimized workspace build
  passed. The complete application suite passed 425/425 and
  `git diff --check` passed.
- Azure CLI reconfirmed subscription `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), resource group
  `mxg-rg-50106`, Central US ACR `mxgacr50106`, and the running `mxg-core`
  Container App. Subscription and resource-group policy assignment counts are
  zero.
- `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200. Readiness reports
  PostgreSQL and the frozen `manuals-authoritative-v2` Search source healthy.
- No RBAC change is required. The core system identity retains only
  `Storage Blob Data Contributor` on the private `documents` container and
  `Cognitive Services User` on the existing Document Intelligence account.
  The established ACR registry secret remains in use, so the new-resource
  `AcrPull` propagation gate is not applicable.

### Deployment proof

- GitHub `main` contains source commit `131447d` (`Resolve natural registered
  image requests`). ACR run `cj32` built and pushed
  `mxgacr50106.azurecr.io/mxg-core:manual-final-131447d-20260915` with digest
  `sha256:0de0abb4c1641cc3407e7fe61fe0379db82c41a93a96c4210bff3139c3815b42`.
- Container Apps revision `mxg-core--fdr131447d` is healthy and provisioned
  with one ready replica, zero restarts, and 100% traffic. Single-revision mode
  retired the prior revision; only the accepted revision remains active.
- Post-deployment `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200, and
  readiness still reports the frozen five-manual Search pack healthy.
- The visible authenticated production Copilot was tested with the natural
  request, “Can you show me the manual diagram for removing the flight data
  recorder from a CL350?” It returned one `[M-01]` pill, one registered page
  165 removal/installation record, one fully loaded 8103×9903 image, and an
  expandable source excerpt/hash. No page 150 data-download figure appeared.

## Five-Manual Retrieval Finalization — 2026-09-15

> **Status:** Deployed and live-verified
> **Recipe:** AZCLI (existing ACR + Container Apps release path)

Finalize the frozen CL350 manual path vertically from the authoritative Azure
Search corpus, through model grounding, to the production citation/excerpt and
registered-diagram UI. Explicit AMM, IPC, SPM, NDT, and SSM requests are scoped
to their requested manual before hybrid retrieval. Chapter/ATA filtering is
used only where that field is populated by the frozen index; SPM and NDT retain
manual-only filtering. Any retrieved text evidence is returned to the browser
even when the model classifies the answer as ordinary conversation.
An aircraft explicitly named in a manual question takes precedence over an
unrelated active demo case for retrieval, while that case remains available as
case context. The bounded application-awareness manifest now mirrors the
durable navigation, concise surface hints, and user-facing terms such as
Equipment Drive, Content Upload, and Demo Content; product-orientation answers
do not inherit irrelevant manual evidence from an active case or prior turn.

### Deployment scope

- Build `services/mcp` from the exact committed source in the existing
  `mxgacr50106` registry and promote only the existing `mxg-core` Container App.
- Preserve the frozen `manuals-authoritative-v2` index, all manual/image Blob
  content, the published Pi Equipment Drive, environment settings, secrets,
  identity, ingress, scale, database, migrations, Entra objects, and RBAC.
- No infrastructure, data, permission, frontend, or cost-bearing resource
  change is included.

### Validation steps

- Run Rust formatting, complete locked all-target workspace tests,
  warnings-denied Clippy, and the locked optimized workspace build.
- Run the complete frontend/application contract suite and `git diff --check`.
- Reconcile the frozen five-manual manifest with Azure and probe one indexed
  production subject per manual.
- Confirm the approved subscription, Central US resource group, Container Apps
  environment, ACR, policy posture, current health/readiness/adapter endpoints,
  registry authentication mode, and live managed-identity roles.
- After promotion, run one authenticated production model query per manual and
  verify model grounding, evidence pills, expandable excerpts, and the
  registered AMM diagram without inventing figures for text-only manuals.

### Validation proof

- `cargo fmt --all -- --check` passed. The complete locked all-target Rust
  workspace passed 299 tests with one credential-gated live exporter
  intentionally ignored; strict Clippy passed with warnings denied; the locked
  optimized workspace build passed.
- `npm test` passed 425/425 application and contract checks after updating the
  evidence-return contract; the focused maintenance-advisory suite passed
  18/18. `git diff --check` passed.
- The authoritative reconciliation matched all five manuals, eight source
  documents, 13,121 approved chunks, and five registered AMM images with no
  hash/count failures. Direct Azure Search probes returned qualified AMM, IPC,
  SPM, NDT, and SSM records; SPM's frozen records correctly expose no ATA field.
- Azure CLI confirmed approved subscription `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), resource group
  `mxg-rg-50106`, and the existing Central US Container Apps environment and
  ACR are enabled and provisioned. Subscription/resource-group policy
  assignment counts are zero.
- Pre-deployment `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200. The
  current core is running and uses the established registry secret rather than
  managed-identity ACR pull, so the new-resource `AcrPull` propagation gate is
  not applicable.
- Static and live role review found no RBAC delta. The `mxg-core` system
  identity retains only `Storage Blob Data Contributor` on the private
  `documents` container and `Cognitive Services User` on the existing Document
  Intelligence account.

### Deployment proof

- Commits `135d2a0`, `bb60c9f`, `f9abf92`, and `c43b3f8` were pushed to
  canonical `main`. The last revision includes the live-found active-case
  precedence fix and the application-help/manual-evidence isolation boundary.
- Final ACR run `cj31` built
  `mxg-core:manual-final-c43b3f8-20260916` with digest
  `sha256:6eacd2ba2e209c5936039be0aedbe7d7a50a2c9e24afb6173430830ff74d70a3`.
  Revision `mxg-core--manualsc43b3f8` is Healthy, Provisioned, running one
  replica, and serving 100% of Single-mode traffic.
- Post-deployment `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200;
  Postgres and `manuals-authoritative-v2` pack
  `mxg-cl350-starter-manuals-v1` report ready and healthy.
- In one signed-in production Copilot conversation, natural AMM, IPC, SPM,
  NDT, and SSM questions each returned 33 records from the requested manual.
  Every response rendered citation pills, two excerpt previews, and 33
  expandable source disclosures. The AMM response also rendered two verified
  Azure manual images; both loaded at their intrinsic dimensions. Opening the
  first SSM disclosure exposed its complete section text in place.
- A production product-help question correctly routed to Settings, Equipment
  Drives, and Content Upload using the awareness manifest. It rendered as a
  clean conversational answer with zero manual pills, evidence cards, or
  source disclosures, even while a maintenance case remained active.
- Post-deployment Azure RBAC is unchanged: the core identity retains only its
  existing private-Blob contributor and Document Intelligence user roles. No
  infrastructure, data, Entra, Search, Blob, Pi-drive, or permission mutation
  was made.

### Rollback

Keep revision `mxg-core--manualsbb60c9f` available as the pre-awareness
rollback target. If the final revision fails readiness or acceptance, restore
100% traffic to that revision. No data or schema rollback is required.

## Rocky Administrator Promotion — 2026-09-15

> **Status:** Deployed and live-verified

Promote Rocky's two protected MXGenius identities, `rocky@mxgenius.io` and
`hagy2392@gmail.com`, to the tenant-scoped Administrator application role.
This does not grant Azure subscription ownership, modify Entra directory roles,
or broaden the `mxg-core` managed identity. Migration `0030` upgrades existing
memberships at startup, while the protected seed keeps later releases from
restoring the former Procurement or Manager roles.

### Deployment scope

- Build `services/mcp` from the exact committed source in the existing
  `mxgacr50106` registry and promote only the existing `mxg-core` Container App.
- Run the additive SQLx migration through the application's existing startup
  migration path. Update only Rocky's two exact email rules and memberships in
  organizations where the corresponding protected rule exists.
- Preserve all infrastructure, service settings, secrets, Entra objects, Azure
  RBAC assignments, manual/Search content, Blob content, and application data.

### Validation proof

- `cargo test --workspace` passed 288 tests with one credential-gated manual
  exporter intentionally ignored; the two new Rocky role/migration regression
  checks also passed independently.
- `cargo fmt --all -- --check`, warnings-denied workspace Clippy,
  `cargo build --locked --release -p mxgenius-mcp`, and `git diff --check`
  passed on 2026-09-15.
- Azure CLI 2.86.0 confirmed the previously approved subscription
  `d1a68ed7-2983-4a86-ab0e-e56df9e2e325`, Central US resource group
  `mxg-rg-50106`, and Container Apps environment `mxg-cae-50106` are enabled
  and provisioned. Subscription and resource-group policy assignment lists are
  empty.
- `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200 before promotion;
  Postgres and the frozen manual library report ready and Parts is available.
- Static and live role review found no Azure RBAC delta. The `mxg-core` system
  identity retains only `Storage Blob Data Contributor` on the private
  `documents` container and `Cognitive Services User` on the existing Document
  Intelligence account. ACR pull continues through the established registry
  secret, so the managed-identity `AcrPull` propagation gate does not apply.
- The ordered migration set contains 30 unique SQL files and ends at
  `0030_promote_rocky_administrator.sql`.

### Deployment proof

- Commit `fffa8b4` was pushed to canonical `main`. ACR run `cj2w` built the
  exact committed MCP source as `mxg-core:rocky-admin-fffa8b4-20260915` with
  digest `sha256:32861817bb11b80e04cc1272822161b1d6cecc0c1434d162fb2f2e1a84151027`.
- Revision `mxg-core--rockyfffa8b4` is Healthy, Provisioned, running one
  replica, and serving 100% of single-mode traffic. Its startup log shows the
  SQLx migration ledger was reconciled before the application began listening.
- Production `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200 after
  promotion; Postgres and the frozen manual library are ready and Parts remains
  available.
- An authenticated production `GET /api/beta-access` returned both
  `rocky@mxgenius.io` and `hagy2392@gmail.com` as locked rules with
  `member_role: administrator`. The visible Operations Center registry also
  lists both protected identities.
- Post-deployment Azure RBAC verification is unchanged: the `mxg-core` identity
  retains only its existing private-Blob contributor and Document Intelligence
  user assignments. No Azure or Entra administrator role was added.

### Rollback

Keep `mxg-core--manuals82092ac` active and available until the new revision
passes migration, health, readiness, adapter, and role verification. If the
promotion fails, restore that image/revision; migration `0030` is deliberately
forward-only, so role rollback would require an explicit reviewed follow-up
rather than silently narrowing Rocky's access.

## Conversation Isolation and Expandable Manual Sources — 2026-09-15

> **Status:** Deployed and live-verified

This paired static/core release prevents a response shown in an earlier chat
from being treated as context for a newly created conversation, and makes every
retrieved manual record an accessible disclosure so its section excerpt can be
opened on demand. The browser clears its displayed-response state at thread,
case, and new-conversation boundaries; the core independently removes that
field whenever no persisted conversation exists and explicitly prohibits reuse
of a prior registered figure when the current prompt has no register match. It
also completes the freeze-point drive cleanup with a manager-only, recoverable
archive action that refuses to hide a drive still assigned to a Pi.

### Deployment scope

- Publish the cache-versioned dashboard application through the existing
  canonical `main` GitHub Pages workflow.
- Build `services/mcp` from the exact committed source in the existing ACR and
  promote only the existing `mxg-core` Container App.
- Preserve every environment setting, secret, identity, ingress and scale
  setting, role assignment, schema, source Search index, and source manual
  Blob. No infrastructure, migration, or permission change is included.
- As a signed-in acceptance action, create one manuals-only Equipment Drive,
  publish the frozen five-manual/five-image Azure library into it, assign that
  version to the registered Pi, and only then archive the obsolete named test
  drive. The archive retains its version metadata and Blob content.

### Validation plan

- Run JavaScript syntax, the complete application suite, Rust formatting, the
  locked workspace suite, warnings-denied Clippy, the locked release build,
  and `git diff --check`.
- Reconfirm the previously approved `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), Central US resource group, ACR,
  current core revision, policy posture, health/readiness, registry pull
  configuration, and live managed-identity roles.
- After promotion, use the signed-in visible browser to verify that a broad
  Bombardier prompt cannot inherit the earlier registered figure, that the
  exact CL350 task still renders its registered image, and that the associated
  manual excerpt expands without blocking an ordinary follow-up question.
- Verify the Pi receives a new desired generation for the manuals-only version,
  then verify the drive list contains only the manuals drive. Never archive a
  drive with a current Pi assignment.

### Validation proof

- `npm test` passed 423/423 application and contract checks. `node --check`
  passed for `app.js`, `application-client.js`, and
  `equipment-pack-workspace.js`; `git diff --check` also passed.
- Live creation exposed and corrected a post-success browser cleanup fault: the
  asynchronous submit handler now retains the form reference before awaiting
  the API, so a created drive no longer reports a false `.reset()` error.
- `cargo fmt --all --check`, the complete locked Rust workspace and all-target
  suite, warnings-denied workspace Clippy, and the locked optimized workspace
  build passed. The credential-gated live archive test remains intentionally
  ignored by the ordinary suite.
- Azure CLI 2.86.0 confirmed the approved, enabled subscription and Central US
  target. ACR run `cj2v` produced
  `sha256:03d82004c604fbb50071994911f89c6464d1dd43db3baed013a9a15d9b920855`;
  `mxg-core--manuals82092ac` is Healthy with one replica and 100% Single-mode
  traffic. Pages runs `35018889445` and `35020385656` successfully deployed the
  paired `82092ac` release and the live-found `d158219` form cleanup.
- `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200. The frozen manual
  library is ready and the Parts adapter remains available. Subscription and
  resource-group policy assignment counts are both zero.
- Static review found no infrastructure, migration, identity, secret, or RBAC
  delta. Live role verification found the unchanged `Storage Blob Data
  Contributor` assignment on the private `documents` container and `Cognitive
  Services User` on the existing Document Intelligence account. ACR pull
  continues through the established registry secret, so no new `AcrPull`
  assignment or propagation gate applies.
- Signed-in acceptance created `CL350 Manuals`, published immutable version 1,
  and assigned it to `Other New Pi` as desired generation 4. The obsolete
  `the first test pack` drive was then soft-archived; the visible list now
  contains only the manuals drive while the archived version Blobs remain
  recoverable.
- A byte-level readback of the exact 52,879,267-byte published ZIP matched its
  `sha256:304f1f4cae67da1db4ba247445ad17aaaa973b9df28a585b9ffcf1695198e3d9`
  immutable name. Its AMM, IPC, SPM, NDT, and SSM records total 13,121 index
  rows, matching the frozen
  `sha256:8522219c188bb09a5dc8104405a78f85e814e74c8c46bdce4e731a65888eece9`
  content set. All five image byte hashes match both `INDEX/image-map.json` and
  the model's frozen image register.
- A clean broad CL350 conversation returned zero manual records and no inherited
  image. Separate live lookups for the two elevator figures, brake transducer,
  FDR download, and FDR removal each rendered the correct registered image and
  exactly one manual record; the section disclosure expanded and an ordinary
  manufacturer question remained unblocked. Core logs recorded successful
  terminal status and zero model tool calls for these deterministic lookups.

### Rollback

Keep `mxg-core--imgroute94f` and its immutable image available. If any build,
startup, readiness, model-routing, image, excerpt, or ordinary-chat gate fails,
restore that revision and revert the paired Pages commit. The obsolete test
drive is soft-archived rather than deleted and can be recovered from its
retained row; the manuals-only drive/version can remain dormant without data
repair or resource deletion.

## Parts and Maintenance Display Polish — 2026-09-15

> **Status:** Deployed and live-verified

This paired static/core release closes the narrow Parts-drawer layout fault,
gives the fictional inventory family-specific presentation imagery, converts
Settings to one non-destructive Show/Hide Demo Content toggle, and restores
CL350 manual figures for conversational model responses. The manual Blob route
and registered FDR image are healthy. The response layer had been omitting
manual records whenever a figure-bearing answer was classified as conversation
rather than maintenance advisory, and its register routing gave an unrelated
active-case model precedence over the explicitly requested CL350. Case-image
intake also reused the observation note as its evidence hash, causing every
later image with that note to collide with the first organization record.

### Deployment scope

- Publish the static application and ten new fictional JPEG assets through the
  existing canonical `main` GitHub Pages workflow.
- Build `services/mcp` from the exact committed source in the existing ACR and
  promote only `mxg-core`; preserve every environment setting, secret,
  identity, ingress, scale rule, role assignment, Search index, and Blob.
- Reuse the existing idempotent `/api/demo-data`, case-media, and registered
  manual-asset boundaries. No schema, migration, deletion, or infrastructure
  creation is required.

### Validation proof

- 2026-09-15: release commit `94f0951` passed the complete `mxgenius-mcp`
  test suite (91 unit tests, 94 integration/bin tests, one credential-gated live
  exporter intentionally ignored), warnings-denied workspace Clippy, Rust
  formatting, and the locked optimized workspace release build.
- Azure CLI 2.86.0 confirmed the approved `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), Central US resource group,
  registry, and Container Apps environment are provisioned successfully. The
  current `mxg-core--casemedia1cb` rollback revision is Running and ready, and
  the resource group has no policy assignments.
- The release changes only the chat routing source and changelog. It has no
  migration, infrastructure, setting, secret, identity, role, Search, or Blob
  delta. The existing deployment recipe therefore remains the exact-source ACR
  build followed by a new `mxg-core` revision and health/readiness probes.
- 2026-09-15: the targeted Maintenance, Parts, structure, and target-registry
  suite passed 214/214 checks; the complete application suite passed 419/419.
- JavaScript syntax validation and `git diff --check` passed.
- The targeted Rust manual-library suite passed 4/4 with the credential-gated
  live archive test intentionally ignored.
- Production resource inspection reports `mxg-core--demo065f8` Running with
  provisioning Succeeded. The registered CL350 FDR-removal asset returned HTTP
  200 as `image/png` with 517,796 bytes through `/manual-assets`.

### Deployment proof

- Static commits `7b886b3`, `9bc832c`, `ea0e18f`, `1cb311e`, and `94f0951`
  were pushed to canonical `main`. Their GitHub Pages runs `35004445396`,
  `35006006738`, `35006539246`, `35009108551`, and `35010928606` all completed
  successfully.
- ACR run `cj2r` published
  `mxg-core:display-polish-7b886b3-20260915` at digest
  `sha256:94971d1f9b072adec416505695c823e4bb9b3e002647598cc8cb7e98e4f48690`.
  ACR run `cj2s` published `mxg-core:case-media-1cb311e-20260915` at digest
  `sha256:be51fbe50eadd071fa5d797a1720a9c95c7e7cc50ac78edef2e272f9baaac76a`.
  Final ACR run `cj2t` published
  `mxg-core:manual-route-94f0951-20260915` at digest
  `sha256:fadd663f0e6cf55b6bc0016a4915a4ca556727fcce8f594a55626931a8f7a4ff`.
- Revision `mxg-core--imgroute94f` is Healthy, Provisioned, running one replica,
  and serves 100% traffic. Production `/healthz`, `/readyz`, and `/adapterz`
  returned HTTP 200; readiness reports Postgres and the frozen Azure manual
  library ready, and Parts remains available.
- The visible signed-in Settings toggle was tested in both states. Demo mode
  shows only the labeled fictional Maintenance and Parts records with varied
  family-specific imagery; hidden mode returns the preserved operational
  records. The bounded Parts drawer retains its own scroll region.
- A live case intake created `MXG-CASE-20260915-8A2AC197`
  (`8a2ac197-41b7-4bb8-9141-e2ffb2d40b65`) for `N350MX` and attached the new
  landing-light JPEG after the evidence hash was corrected to include the
  immutable observation identity and media references. Switching away and
  back recalled the stored private 1536x1024 Blob image without the template
  fallback.
- From that same active `MATRIX` case, a fresh production conversation asked
  for CL350 AMM Task `31-31-01-000-801`. The deterministic register bypassed
  semantic Search, returned `IMG-CL350-AMM-31-FDR-REMOVAL`, cited `M-01`, and
  rendered the complete 8103x9903 page-165 image. Core logs recorded
  `manual_record_count=1`, `model_tool_calls=0`, terminal status `success`, and
  correlation ID `e8f28b28-eedb-4ccb-b6d2-aa52c6866248`. No new browser error
  or warning was emitted during the final request.
- Post-promotion role verification is unchanged: the `mxg-core` identity has
  `Storage Blob Data Contributor` only on the private `documents` container and
  `Cognitive Services User` only on the existing Document Intelligence account.
  ACR access continues through the app's established registry secret; no role,
  secret, setting, resource, migration, Search record, Blob object, case, or
  part was created by the final routing promotion.

### Rollback

Revert the paired commit through the normal `main` workflow and shift Container
App traffic to `mxg-core--casemedia1cb`. The release does not delete records or
alter schema, Blob content, Search content, identity, secrets, or RBAC.

## Equipment Pack Control Plane — 2026-09-13

> **Status:** Deployed and live-verified

## Demo Presentation Cleanup — 2026-09-15

This paired release turns the existing fictional Maintenance and Parts seed into
a clean presentation workspace. When the browser detects the tenant's labeled
demo cases or parts, it keeps stale test and operational history out of those
views, opens the newest demo case, and applies the same scope across Parts tabs
and reports. A signed-in live trace also found and corrected two demo-seed
contract mismatches: normalized discrepancies now carry their required raw
text, and seeded cases reference the canonical aircraft UUID consumed by model
capabilities while the interface retains the friendly `N350MX` label.

### Deployment scope

- Push the validated static application to canonical `main` and let the
  existing GitHub Pages workflow publish it.
- Build `services/mcp` from the exact committed source in the existing ACR and
  promote only the existing `mxg-core` Container App. Preserve its environment,
  secrets, identity, ingress, scaling, and traffic configuration.
- Reuse the existing authenticated `/api/demo-data` endpoint and data plane;
  no infrastructure, migration, secret, identity, role, Search index, or Blob
  change is required.
- Refresh the idempotent fictional tenant seed through the signed-in Settings
  action after the static release lands, then verify Maintenance and Parts in a
  visible browser.

### Validation proof

- 2026-09-15: `npm test` passed 419/419 application and contract tests. Targeted
  Maintenance, Parts, structure, and target-registry checks cover the automatic
  demo scope, explicit return to operational records, cache pins, and existing
  application boundaries.
- The full locked Rust workspace passed, strict Clippy completed with warnings
  denied, and the targeted demo-seed contract tests passed 4/4.
- JavaScript syntax checks and `git diff --check` are clean.
- Azure CLI confirmed the documented subscription, Central US resource group,
  ACR, and existing `mxg-core--parts915` revision are healthy, Running, and
  ready, with zero resource-group policy assignments. `/healthz`, `/readyz`,
  and `/adapterz` each returned HTTP 200.
- The signed-in refresh completed idempotently with 1 demo aircraft, 4
  maintenance cases, 26 stock units, and 4 evidence records. Maintenance and
  Parts both present only the labeled fictional dataset while presentation mode
  is active; operational records remain preserved and return when demo content
  is hidden.

### Deployment Proof

- Application commit `065f8be` was pushed to canonical `main`; GitHub Pages run
  `34998084172` completed successfully with the full JavaScript and Rust gate.
- ACR run `cj2q` built the committed MCP source as
  `mxg-core:demo-clean-065f8be-20260915`, immutable digest
  `sha256:4d27df2c9ff0346c3200356fb67b2395bad2194d12debf48be0ee93da357b93f`.
- Container App revision `mxg-core--demo065f8` is Healthy, latest-ready, and
  serves 100% traffic. The previous `mxg-core--parts915` revision remains
  available for rollback. Production `/healthz`, `/readyz`, and `/adapterz`
  each returned HTTP 200; readiness reports the database and manual library
  ready, with Parts available.
- The signed-in Settings refresh returned exactly 1 aircraft, 4 maintenance
  cases, 26 stock units, and 4 evidence records; rerunning it updated the same
  fictional records instead of creating duplicates.
- The newest maintenance demo opens automatically with the stable N350MX
  visual, friendly aircraft label, two case events, and CL350 manual evidence.
  The earlier false supporting-details warning is absent after the capability
  responses complete.
- Parts live checks showed only `MXG-DEMO-*` inventory, six demo requests with
  N350MX aircraft labels, and the three DEMO locations. The prior ordinary
  stock record remains stored but is hidden by presentation mode.
- No infrastructure, migration, identity, secret, RBAC, Search-index, or Blob
  change was made. The existing service assignments and data-plane boundaries
  are unchanged.

### Rollback

Revert the release through the normal `main` workflow and shift Container App
traffic to `mxg-core--parts915`. No migration or deletion was performed; the
fictional seed remains idempotent and presentation mode does not remove
operational records.

## Maintenance and Parts Presentation Stabilization — 2026-09-15

This release separates maintenance model context from procurement state,
defers Parts reads until the workspace is actually opened, and completes the
paired presentation pass. The dashboard now uses six optimized, explicitly
labeled fictional demo visuals through a deterministic browser registry. Real
uploaded case evidence and aircraft imagery retain priority, and cases with
recorded media no longer flash the generic mechanic placeholder while private
content loads. Parts request paging and checkbox controls now follow the
application's dark visual system.

### Deployment scope

- Push the complete static application and feature catalog to canonical
  `main`, allowing the existing GitHub Pages workflow to publish them.
- Build `services/mcp` from the exact committed source in the existing ACR and
  promote only the existing `mxg-core` Container App.
- Preserve all Container App environment settings, secrets, identity, ingress,
  scaling, database state, Blob content, Search indexes, and role assignments.
- Create no Azure resource, migration, stored demo case, stock unit, or
  production evidence record. The visual registry applies only to records
  already marked as fictional demo data.

### Validation Proof

- 2026-09-15: `npm test` passed 417/417 browser and contract tests,
  including behavioral isolation checks for the fictional visual registry.
- 2026-09-15: targeted Parts, maintenance, application-client, structure, and
  target-registry checks passed 237/237 tests after the visual integration.
- 2026-09-15: `cargo test --locked --workspace`, Rust formatting, and strict
  workspace Clippy passed; the credential-gated exporter test remains
  intentionally ignored by the ordinary suite.
- 2026-09-15: `cargo build --locked --release --workspace` completed from the
  release tree.
- 2026-09-15: JavaScript syntax checks passed for the new registry and all
  changed application bundles; `git diff --check` is clean.
- 2026-09-15: all six generated JPEG assets were visually inspected after
  optimization and contain no labels, logos, registration numbers, or UI
  text. Their combined deployed size is under 1.7 MiB.
- 2026-09-15: Azure CLI confirmed the documented default subscription, Central
  US resource group, ACR, and current `mxg-core` revision are healthy, with
  zero policy assignments.
- 2026-09-15: no infrastructure or RBAC file changes are present. Live role
  verification confirmed the `mxg-core` identity retains `Storage Blob Data
  Contributor` on the private `documents` container and `Cognitive Services
  User` on the existing Document Intelligence account; the existing ACR
  registry configuration is unchanged.

### Rollback

Shift Container App traffic back to `mxg-core--imgreg915` and revert the paired
GitHub Pages release. No schema or data repair is required because this release
contains no migration and creates no operational record.

### Deployment Proof

- Integrated commit `f571423` and startup correction `8bdcf99` were pushed to
  canonical `main`. Final GitHub Pages run `34974166813` completed successfully
  after the full application test gate; the correction changed no MCP source.
- ACR run `cj2p` built the committed `services/mcp` source and published
  `mxg-core:parts-stable-f571423-20260915` with immutable digest
  `sha256:033f21bfba37629485e8c7229d233ca564524869c40096f16e726cd9ad7f15cb`.
- Container App revision `mxg-core--parts915` is Healthy, latest-ready, and
  serves 100% traffic. Production `/healthz`, `/readyz`, and `/adapterz`
  returned HTTP 200; readiness reports database and manual library ready, and
  the adapter reports Parts available.
- Live static checks confirmed the final `case-workspace.js?v=18`, dark Parts
  stylesheet, demo visual registry, feature catalog pin, and all six optimized
  JPEG assets. Every asset returned HTTP 200.
- A signed-in visible-browser smoke confirmed the Parts inventory and request
  tabs load on entry, pager buttons and checkboxes use the dark treatment, an
  ordinary production stock record receives no demo visual, and the newest
  maintenance case now opens automatically after a fresh dashboard load. Its
  private recorded image loaded directly without the retired generic-image
  flash.
- Post-deployment role verification found the same two existing assignments:
  `Storage Blob Data Contributor` on the private `documents` container and
  `Cognitive Services User` on the Document Intelligence account. No resource,
  role, migration, Search corpus, Blob content, case, or stock record was
  created or changed by this release.

## Azure Manual Library and Operations Release Delta — 2026-09-15

This release surfaces the frozen five-manual Azure Search corpus and its linked
private Blob diagrams through the existing Equipment Drive control plane. A
manager or administrator can build and publish the approved library directly
into a selected drive without downloading or re-uploading the corpus through
the browser. Relevant retrieved diagrams are also integrity-checked and added
as bounded image input to the text model; text retrieval and the authoritative
manual-pack boundary remain unchanged.

The paired static release also consolidates reports, build status, readiness,
features, feedback, and access management into the authenticated Operations
Center; publishes the open-ended delivery extension draft and Pi power-harness
wiring reference; and advances the Pi appliance UI to `0.3.1-poc.27` with an
explicit USB-C Drive Emulator state and deterministic shared-state creation.

### Deployment scope

- Push the complete validated source state to canonical `main`, allowing the
  existing GitHub Pages workflow to deploy the static application.
- Build `services/mcp` from the exact committed source in the existing ACR and
  promote only the existing `mxg-core` Container App.
- Preserve every existing Container App environment setting, secret reference,
  identity, replica setting, and ingress setting.
- Create no Azure resource, database migration, role assignment, or Search/Blob
  corpus mutation. Keep `mxg-core--casemedia1` available for rollback.

### Validation Proof

- 2026-09-15: `npm test` passed 411/411 browser and contract tests.
- 2026-09-15: `cargo test --locked --workspace` passed the complete Rust
  workspace; the credential-gated live exporter test remains intentionally
  ignored by the ordinary suite.
- 2026-09-15: the ignored live exporter test was run explicitly with temporary
  read credentials and built the deterministic archive from 13,121 approved
  Search chunks, 197 flattened source files, and five hash-verified Blob images.
- 2026-09-15: `cargo fmt --all -- --check`, warnings-denied workspace Clippy,
  and `cargo build --locked --release --workspace` passed.
- 2026-09-15: the Pi backend suite passed 87/87 tests after its release-restart
  ordering assertion was corrected to address the executable restart path.
- 2026-09-15: changed and untracked release files contained no
  credential-shaped values; `git diff --check` passed.
- 2026-09-15: Azure CLI confirmed the enabled target subscription, Central US
  resource group, healthy current Container App and ACR, zero policy
  assignments, and all six required manual-library environment setting names.
- 2026-09-15: live role verification confirmed the `mxg-core` identity retains
  `Storage Blob Data Contributor` only on the private `documents` container.
- 2026-09-15: the current production `/healthz`, `/readyz`, and `/adapterz`
  endpoints returned HTTP 200 and reported the frozen v2 manual source healthy.

### Rollback

Shift Container App traffic to `mxg-core--casemedia1` and revert the GitHub
Pages release to commit `3165f16`. The new route and archive builder are
additive and do not mutate the source Search index or manual-image collection.

### Deployment Proof

- Git commit `bdf3a70` was pushed to canonical `main`. GitHub Pages run
  `34958638751` completed successfully, and live cache-busted requests confirmed
  the manual-library control on `dashboard.html` and the authenticated
  `operations-center.html` shell.
- ACR run `cj2k` built the exact committed `services/mcp` source and published
  `mxg-core:manual-library-bdf3a70-20260915` with immutable digest
  `sha256:e45ebc431c19857265e6a9438fcd3206c604f6dba4c56e89d398a39c92e610c1`.
- Container App revision `mxg-core--manuals915` is Healthy, latest-ready, and
  serves 100% traffic. Production `/healthz`, `/readyz`, and `/adapterz`
  returned HTTP 200; readiness reports `manual_library: ready`, and the adapter
  reports frozen pack `mxg-cl350-starter-manuals-v1` ready.
- Anonymous `POST /api/equipment-packs/{pack_id}/manual-library` returned HTTP
  401. The `mxg-core` identity still holds `Storage Blob Data Contributor` only
  on the private `mxgstorage50106/documents` container.

### Manual-image Applicability Correction — 2026-09-15

The first signed-in production request named the CL350 and exact FDR AMM task
but returned zero manual records because retrieval accepted aircraft
applicability only from an active case or aircraft profile. The correction
allows an explicit supported `CL350`, `CL-350`, `Challenger 350`, or
`BD-100-1A10` name in the bounded conversation query to seed the frozen-pack
applicability filter. Unsupported and ambiguous models continue to return no
manual evidence.

Validation passed with 85 backend unit tests, one intentionally ignored
credential-gated live exporter test, warnings-denied Clippy, Rust formatting,
and a regression proving `Challenger 3500` and unspecified aircraft do not
resolve to the CL350 pack. Promote only `mxg-core`; preserve all settings,
roles, data, and the healthy `mxg-core--manuals915` rollback revision.

### Deterministic Manual Image Register — 2026-09-15

The five approved CL350 AMM figures now have a frozen, human-readable register
inside the existing manual-pack manifest. Each entry joins its task terms,
record identity, page, caption, content-addressed Blob reference, and SHA-256
before model execution. An explicit, unambiguous image request is resolved in
memory; Azure embeddings and Search are skipped, exactly one hash-verified
image is attached to the model turn, and the same registered figure is rendered
in ordinary and advisory chat responses. Generic, ambiguous, and non-CL350
requests continue to fail closed or use the existing semantic retrieval path.

#### Deployment scope

- Promote the paired static `app.js`/`dashboard.html` change through the
  existing GitHub Pages workflow and the existing `mxg-core` container image.
- Create no Azure resource, index record, Blob object, role assignment,
  database migration, secret, ingress rule, or scaling change.
- Preserve every existing Container App setting and keep
  `mxg-core--manuals915` available for rollback.

#### Validation Proof

- 2026-09-15: `npm test` passed 412/412 browser and contract tests, including
  the five-entry register, zero-semantic-request direct path, inline figure
  rendering, and paired frontend cache-version assertions.
- 2026-09-15: `cargo test --locked --workspace` passed all ordinary Rust tests;
  the one credential-gated live exporter test remained intentionally ignored.
- 2026-09-15: `cargo fmt --all -- --check`, warnings-denied Clippy,
  `cargo build --locked --release --workspace`, `node --check app.js`, and
  `git diff --check` passed.
- 2026-09-15: the direct-register regression resolved Task
  `31-31-01-000-801` to `IMG-CL350-AMM-31-FDR-REMOVAL`; generic text,
  `Challenger 3500`, and the ambiguous pitch-disconnect request did not resolve.
- 2026-09-15: Azure CLI 2.86.0 confirmed the enabled target subscription, ACR
  provisioning state `Succeeded`, and `mxg-core` running on healthy revision
  `mxg-core--manuals915`. Live `/healthz`, `/readyz`, and `/adapterz` returned
  HTTP 200 with the frozen manual source ready and healthy.
- 2026-09-15: static role verification found no IaC or permission change. Live
  verification confirmed the core identity retains `Storage Blob Data
  Contributor` scoped only to the private `mxgstorage50106/documents`
  container.

#### Deployment Proof

- Git commit `ec0f917` was pushed to canonical `main`. GitHub Pages run
  `34962740870` completed successfully, and a cache-busted production request
  confirmed `dashboard.html` serves frontend bundle `app.js?v=62`.
- ACR run `cj2n` built the exact committed `services/mcp` source and published
  `mxg-core:manual-register-ec0f917-20260915` with immutable digest
  `sha256:d9785238c40eaba06f2ade5844a0f41c8c92187beaeba3e427a61827dc18bbe5`.
- Container App revision `mxg-core--imgreg915` is Healthy, latest-ready, and
  serves 100% traffic. Production `/healthz`, `/readyz`, and `/adapterz`
  returned HTTP 200; readiness reports the manual library ready and the frozen
  pack healthy. Revision `mxg-core--manuals915` remains available for rollback.
- A fresh signed-in production conversation requested CL350 AMM Task
  `31-31-01-000-801`. The copilot rendered the registered flight data recorder
  image inline, labeled it as page 165, and briefly identified the download
  display sequence. Revision logs recorded terminal status `success`,
  `manual_record_count=1`, and `model_tool_calls=0` for correlation ID
  `38044525-4a4a-4408-9eba-3f5210638204`.
- Post-promotion role verification remains unchanged: the `mxg-core` identity
  has `Storage Blob Data Contributor` only on the private
  `mxgstorage50106/documents` container.

#### Rollback

Shift Container App traffic back to `mxg-core--manuals915` and revert the paired
GitHub Pages commit. The register is additive metadata and makes no Search or
Blob mutation, so rollback requires no data repair.

### 1. Project Overview

**Goal:** Extend the existing MXGenius Azure core with a fast, durable control
plane for uploading immutable equipment-folder packages, assigning a package
version to a Raspberry Pi, notifying the device immediately, transferring the
content securely, recording verified activation state, and approving a new Pi
with a seven-digit device-originated claim instead of a manually copied secret.

**Path:** Add Components (MODIFY existing Azure application)

### 2. Requirements

| Attribute | Value |
|-----------|-------|
| Classification | Pilot-ready production path |
| Scale | Small initial fleet (<1,000 devices); tenant- and device-scoped from the first release |
| Budget | Cost-optimized; reuse the deployed application and data plane |
| Subscription | Confirmed reuse: Azure subscription 1 (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`) |
| Location | Confirmed reuse: Central US |
| Compliance | Private content, tenant isolation, least privilege, auditable assignments, no broad storage credentials in clients |
| Connectivity | Pi initiates outbound TLS only; no inbound Pi firewall rule or public listener |
| Transfer | Resumable, bounded-memory transfer with content and manifest hashes |
| Update semantics | Durable desired state plus immediate notification; idempotent A/B activation acknowledgement |

### 3. Components Detected

| Component | Type | Technology | Path / Azure target |
|-----------|------|------------|---------------------|
| MXGenius core | API, MCP server, WebSocket host | Rust, Axum, Tokio, SQLx | `services/mcp` → `mxg-core` Container App |
| Application database | Durable tenant and device state | PostgreSQL 16 | Existing `mxg-pg-50106` |
| Package object store | Private package bytes | Azure Blob Storage | Existing `mxgstorage50106/documents` |
| Identity boundary | Human authentication and tenant membership | Entra OIDC plus application roles | Existing dispatcher/auth context |
| Pi edge bridge | Native device client and USB-image activation | Python, FastAPI, systemd | `services/xr-diagnostics-kiosk` (paired `0.3.1-poc.26` release) |

Existing reusable seams:

- The core applies ordered additive SQL migrations at startup.
- Human routes already fail closed through `application_context` and carry an
  authenticated organization, user, and role.
- The core managed identity already has `Storage Blob Data Contributor` on the
  private `documents` container.
- Blob reads and writes already use HTTPS plus managed-identity bearer tokens.
- Axum WebSocket support is already deployed and the Container App is held at
  one replica. Durable polling remains authoritative so a missed socket event
  cannot lose an update and future scale-out does not change correctness.
- Equipment Pack desired-state and activation use migration `0027`; the
  device-originated approval flow is added by migration `0028`; and migration
  `0029` permits a device-authenticated self-unregister to clear its credential
  while retaining the row as offline and recoverable by a new approved claim.

### 4. Recipe Selection

**Selected:** AZCLI / existing Container Apps release path

**Rationale:** This is a modification to an existing containerized Rust service
already built through ACR and promoted with Azure CLI. No new project scaffold,
resource group, network, or compute service is needed. The change is additive
application code, one migration, existing Blob usage, and a new Container App
revision after validation.

### 5. Architecture

**Stack:** Existing Azure Container Apps + PostgreSQL + private Blob Storage

#### Control and data flow

```text
Authenticated dashboard / VR
        | create pack, upload blocks, assign version
        v
mxg-core ---------------------------------------------------+
        | transaction: desired version + generation         |
        v                                                   |
PostgreSQL (source of truth)                                |
        |                                                   |
        +-- post-commit WSS nudge --> outbound Pi client    |
        |                              | GET desired state   |
        |                              | ranged download     |
        v                              v                     |
private Blob <----- bounded blocks --- mxg-core <------------+
                                           |
                                           v
                              Pi verifies, stages inactive
                              image, swaps USB, acknowledges
```

#### Equipment Pack contract

- A pack is an organization-scoped logical collection for one equipment family
  or target workflow.
- A pack version is immutable after publication and contains a ZIP bundle plus
  a canonical manifest: normalized relative paths, per-file SHA-256, aggregate
  SHA-256, byte count, file count, FAT32 compatibility metadata, label, and
  target notes.
- Blob keys remain opaque to clients:
  `documents/equipment-packs/{organization_id}/{pack_id}/{version_id}/{sha256}.zip`.
- Paths that are absolute, traverse with `..`, collide case-insensitively, use
  reserved FAT names, or exceed configured limits are rejected before publish.
- Published versions are append-only; replacing a pack creates a new version.

#### Durable state model (migrations `0027` and `0028`)

- `equipment_packs`: tenant-owned logical pack and equipment metadata.
- `equipment_pack_versions`: immutable manifest, Blob key, hashes, sizes, and
  draft/published state.
- `edge_devices`: tenant-owned Pi identity, hashed device credential, status,
  credential rotation/revocation, and last-seen data.
- `edge_device_enrollment_codes`: one-time, short-lived, 96-bit bootstrap
  records retained as a compatibility recovery path.
- `edge_device_claims`: short-lived seven-digit human approval codes paired
  with a high-entropy credential delivered only to the Pi over TLS. The browser
  sees the claim code and registry result, never the credential.
- `edge_device_assignments`: one current desired version per device with a
  strictly increasing generation and requesting actor.
- `edge_device_deployments`: append-only download/stage/activate/fail history,
  active image slot, hashes, timestamps, and diagnostic error code.
- Every foreign key and query is organization-scoped. Assignment and generation
  advance in one database transaction.

#### Human API (existing Entra gate)

- List/create packs and versions; Manager/Administrator may mutate, all
  authenticated members may read according to the current tenant policy.
- Upload in ordered 8 MiB blocks. The core forwards each block immediately to
  Blob Storage, records its hash, and commits the block list only after all
  expected blocks are present.
- Publish validates manifest, byte count, ordered block set, aggregate hash,
  path safety, and immutable state.
- Approve a Pi-originated seven-digit claim with a friendly device name,
  revoke devices, assign a published version, and inspect deployment history.

#### Device API (separate device credential)

- `POST /api/edge/claims`: the Pi presents its baked hardware ID and receives a
  seven-digit display code plus a private high-entropy credential over TLS.
- `POST /api/edge/claims/approve`: an Entra-authenticated manager binds the
  displayed code and friendly name to the organization without receiving the
  credential.
- `GET /api/edge/claims/{claim_id}`: the Pi polls with its private credential
  until approval, then persists that credential locally.
- `POST /api/edge/enroll`: retained as a compatibility-only recovery exchange.
- `POST /api/edge/unregister`: authenticated node invalidates its cloud
  credential before removing the local copy and requesting a fresh claim.
- `GET /api/edge/state`: return desired generation and pack metadata with ETag;
  `If-None-Match` gives a cheap durable reconciliation fallback.
- `GET /api/edge/packs/{version_id}/content`: permit only the version assigned
  to that device; proxy Blob `Range`, ETag, content length, and cache headers
  without buffering the complete package.
- `POST /api/edge/deployments/{generation}/status`: idempotently record
  downloading, verified, staged, activating, active, or failed.
- `GET /api/edge/ws`: outbound device-authenticated socket carrying only
  generation-change notifications and heartbeats; package bytes never travel
  over WebSocket.

#### Reliability and security decisions

- PostgreSQL is authoritative. WebSocket delivery is an optimization, so a
  connection race, core restart, or missed message cannot strand a device.
- The Pi applies only a generation newer than its acknowledged generation and
  reports success only after hash verification and USB reattachment.
- Upload blocks are independently retryable and idempotent. Download supports
  resume through HTTP ranges.
- No storage account key, container SAS, database credential, or human bearer
  token is issued to a Pi. The core managed identity remains the only Blob
  principal used by this flow.
- Device credentials are tenant-bound, individually revocable, compared in
  constant time, and kept root-readable on the Pi in the later client slice.
- A feature flag defaults the new surface off until migration and live smoke
  tests pass.

#### Existing posture explicitly outside this slice

- Storage minimum TLS is presently TLS 1.0 and PostgreSQL public network access
  is enabled. Changing either can affect other live workloads, so these are
  recorded security-hardening follow-ups, not silently altered here.
- No IoT Hub, Service Bus, Web PubSub, new storage account, or new Container App
  is justified for the pilot. Those become scale options only if fleet volume
  or multi-replica fan-out proves the need.

### 6. Provisioning Limit Checklist

No Azure resources are added; this slice reuses the current Central US data and
compute plane. Quota CLI was checked first as required, and Resource Graph was
used to corroborate current counts.

| Resource type | Number to deploy | Total after deployment | Limit / quota | Evidence |
|---------------|------------------|------------------------|---------------|----------|
| `Microsoft.App/managedEnvironments` | 0 | 1 | 50 | `az quota`: `ManagedEnvironmentCount`; current usage 1 |
| `Microsoft.App/containerApps` | 0 | 4 | No new capacity requested | Azure Resource Graph; existing apps only |
| `Microsoft.Storage/storageAccounts` | 0 | 2 | 250 | `az quota`: `StorageAccounts`; current usage 2 |
| `Microsoft.DBforPostgreSQL/flexibleServers` | 0 | 1 in target RG | No new capacity requested | Existing `mxg-pg-50106`; schema rows only |

**Status:** ✅ No provisioning-capacity change. Existing policy assignment
query returned no subscription policy assignments. No quota, SKU, region,
replica, ingress, or cost-bearing resource change is planned.

### 7. Execution Checklist

#### Phase 1: Planning

- [x] Analyze workspace
- [x] Gather requirements from the Equipment Pack / dynamic USB workflow
- [x] Confirm subscription and location with user
- [x] Check subscription policy assignments
- [x] Prepare resource inventory
- [x] Fetch quotas and validate capacity
- [x] Scan codebase
- [x] Select recipe
- [x] Plan architecture
- [x] User approved this plan on 2026-09-10

#### Phase 2: Execution

- [x] Research selected Azure components
- [x] Add the database migration and Equipment Pack service/API contracts
- [x] Add device enrollment, desired-state reconciliation, notification, and acknowledgements
- [x] Add resumable package upload and ranged authenticated device download
- [x] Add tests and operational telemetry
- [x] Set plan status to `Ready for Validation`

#### Phase 3: Validation

- [x] Invoke `azure-validate`
- [x] All validation checks pass
  - [x] Azure CLI installation and active authentication
  - [x] Confirm selected subscription is enabled
  - [x] Bicep compilation — not applicable; this MODIFY slice adds no infrastructure template
  - [x] ARM template validation — not applicable; no Azure resource shape changes
  - [x] ARM what-if — not applicable; no resource deployment is planned before image promotion
  - [x] Container build using the checked-in `services/mcp/Dockerfile`
  - [x] Azure Policy validation — no subscription policy assignments returned
  - [x] Static RBAC review — no IaC role changes; code requires Blob read/write only
  - [x] Existing managed-identity role evidence — `mxg-core` has Storage Blob Data Contributor scoped only to `mxgstorage50106/documents`
- [x] Complete local, migration, container, identity, and live smoke validation
- [x] Set plan status to `Validated` and record proof

#### Phase 4: Deployment

- [x] Invoke `azure-deploy`
- [x] Deploy only after validation and explicit release direction
- [x] Report endpoints and rollback target
- [x] Set plan status to `Deployed`

### 8. Validation Proof

| Check | Command Run | Result | Timestamp |
|-------|-------------|--------|-----------|
| Specialized SDK scan | `rg` for Copilot SDK markers | ✅ No specialized SDK detected | 2026-09-10 |
| Subscription policy | `az policy assignment list` | ✅ No assignments returned | 2026-09-10 |
| Container Apps quota | `az quota list` and `az quota usage list` | ✅ 1 / 50 managed environments; no new resource | 2026-09-10 |
| Storage quota | `az quota list` and `az quota usage list` | ✅ 2 / 250 storage accounts; no new resource | 2026-09-10 |
| Planning gate | No application implementation or deployment before approval | ✅ Held | 2026-09-10 |
| Frontend tests | `npm test` | ✅ 397 passed, 0 failed | 2026-09-10 |
| Pi kiosk tests | `python -m unittest discover -s backend -p 'test_*.py'` | ✅ 56 passed, 0 failed | 2026-09-10 |
| Locked Rust tests | `cargo test --locked --workspace` | ✅ 272 passed, 0 failed | 2026-09-10 |
| Equipment Pack contracts | unit plus `tests/equipment_packs.rs` | ✅ tenant, enrollment, revocation, manifest, path checks passed | 2026-09-10 |
| Lint gate | `cargo clippy --locked --workspace --all-targets -- -D warnings` | ✅ Clean | 2026-09-10 |
| Release build | `cargo build --locked --release` | ✅ Optimized binary built | 2026-09-10 |
| Isolated migration attempt | rollback-only shadow schema through the existing Azure DB endpoint | ⚠️ Local client could not connect; no schema was applied | 2026-09-10 |
| Azure CLI and auth | `az version`; `az account show` | ✅ CLI 2.86.0; selected subscription enabled | 2026-09-10 |
| Policy gate | `az policy assignment list` | ✅ No assigned subscription policies | 2026-09-10 |
| Managed identity RBAC | `az role assignment list` for the `mxg-core` principal | ✅ Storage Blob Data Contributor scoped to `mxgstorage50106/documents` | 2026-09-10 |
| Linux container build | `az acr build --no-push ...` | ✅ ACR run `cj26`; Dockerfile completed; no image published | 2026-09-10 |
| Current live baseline | `/healthz`, `/readyz`, current revision and flag inspection | ✅ Both HTTP 200; `mxg-core--spatialshell3eacbb0` unchanged; feature flag absent/off | 2026-09-10 |
| Frontend regression | `npm test -- --runInBand` | ✅ 403 passed, 0 failed | 2026-09-13 |
| Pi kiosk regression | `python -m unittest discover -s services/xr-diagnostics-kiosk/backend -p 'test_*.py'` | ✅ 80 passed, 0 failed | 2026-09-13 |
| Rust workspace regression | `cargo test --manifest-path services/mcp/Cargo.toml --workspace` | ✅ All workspace and contract tests passed | 2026-09-13 |
| Lint and release gates | `cargo clippy --locked --workspace --all-targets -- -D warnings`; `cargo build --locked --release` | ✅ Clean optimized build | 2026-09-13 |
| Pi release preview | `preview-release.ps1 -TestOnly -NoBrowser` against `0.3.1-poc.23` | ✅ HTTP, schema, state, WSS, scanner, and thermal checks passed | 2026-09-13 |
| Azure resource/RBAC recheck | `az account`, resource, role, policy, and Container App inspection | ✅ Existing subscription/resources healthy; no infrastructure or RBAC delta | 2026-09-13 |
| Linux container rebuild | `az acr build --no-push ...` | ✅ ACR run `cj28`; Dockerfile completed; no image published | 2026-09-13 |
| Pi controls regression | kiosk Python suite, exact release preview, image read-only mount audit | ✅ 85 tests; `0.3.1-poc.25` preview passed; image contains Wi-Fi busy feedback, persistent auto-connect, unregister controls, and excludes `piwiz` autostart | 2026-09-13 |
| Device self-unregister contracts | Rust Equipment Pack test plus strict clippy | ✅ 8/8 contract tests; active devices retain credential requirement; offline self-unregister may clear it | 2026-09-13 |
| Current Azure boundary | subscription, group, Container Apps environment, policy, managed identity, live health/readiness | ✅ Existing Central US resources healthy; 0 policy assignments; Blob contributor remains container-scoped; HTTP 200 | 2026-09-13 |
| Exact committed container validation | `az acr build --no-push` from `services/mcp` at `83bc383` | ✅ ACR run `cj2b`; optimized locked Docker build succeeded; no image published | 2026-09-13 |
| Existing registry pull posture | Container App registry configuration and ACR role query | ⚠️ Existing app uses ACR admin credential; system identity has no `AcrPull`. Preserved for this release; migrate separately. | 2026-09-13 |
| Pi controls production image | `az acr build` from `services/mcp` at `0fe7f3e` | ✅ ACR run `cj2c`; image published with digest `sha256:9d71329f9a370caf338b7fa2bf456b66805fa67d5d2bec9fdf29257076f13aee` | 2026-09-13 |
| Pi controls production promotion | `az containerapp update`; revision, health, and fail-closed probes | ✅ `mxg-core--pictl0fe7f3e` healthy/latest-ready at 100% traffic; `/healthz` and `/readyz` HTTP 200; anonymous `POST /api/edge/unregister` HTTP 401 | 2026-09-13 |
| Revoked-device approval recovery | manager approval contract, strict clippy, and production image build | ✅ A signed-in manager may approve a fresh claim for the same revoked hardware and rotate its credential; device self-restore remains impossible; ACR run `cj2d` published digest `sha256:07994817c8683d685b6000426ffddad32ab5153e845347b2f40f3c858a2604ad` | 2026-09-13 |
| Approval recovery promotion | `az containerapp update` plus revision and health probes | ✅ `mxg-core--piapp99cf04f` healthy/latest-ready at 100% traffic; `/healthz` and `/readyz` HTTP 200 | 2026-09-13 |
| Deterministic pack-switch release | 403 frontend tests; 86 Pi tests; 10 Equipment Pack contracts; strict Rust clippy; exact `0.3.1-poc.26` preview | ✅ All local release gates passed for commit `b2ddb6e` | 2026-09-14 |
| Azure baseline and live roles | subscription, Central US resources, policy assignments, `mxg-core` identity roles, `/healthz`, and `/readyz` | ✅ Existing resources healthy; 0 policy assignments; data-plane roles unchanged and correctly scoped; HTTP 200 | 2026-09-14 |
| Exact committed container validation | `az acr build --no-push` from `services/mcp` at `b2ddb6e` | ✅ ACR run `cj2e`; locked optimized Docker build succeeded; no image published | 2026-09-14 |
| Deterministic pack-switch production image | `az acr build` from `services/mcp` at `b2ddb6e` | ✅ ACR run `cj2f`; immutable image published with digest `sha256:81cf762a40d4d6575cd67131c43ff0dea63f413b5de653f4b7cf6aefb34d5b26` | 2026-09-14 |
| Deterministic pack-switch promotion | Container App revision, traffic, health, readiness, and anonymous auth probes | ✅ `mxg-core--packswb2ddb6e` Healthy/latest-ready at 100% traffic; health/readiness HTTP 200; anonymous desired-state read HTTP 401 | 2026-09-14 |
| Pi `0.3.1-poc.26` appliance image | Pinned-base build, writable and read-only filesystem checks, XZ integrity test, and read-only mounted-image audit | ✅ Both filesystems clean; identity/services/USB configuration and shipped source verified; `.img.xz` SHA-256 `55848df65dcd90b0403fe1d66fde1dcf3bf7f1533ebd9047e88c646e982579bf` | 2026-09-14 |
| Copilot awareness and case-workspace regression | `npm test`; `cargo test`; strict clippy and formatting | ✅ 411 frontend tests and 176 Rust tests passed; formatting and warnings-denied clippy clean | 2026-09-14 |
| Pages release | GitHub Actions validation and deployment | ✅ Runs `34915747319` and `34918061797` completed successfully for the conversational, intake, naming, Equipment Drive, and case-media changes | 2026-09-14 |
| Case-media access boundary | Live ordinary-user case recall plus managed-identity RBAC inspection | ✅ Stored JPEG rendered through the authenticated application route; no end-user Blob role required; service identity remains contributor only on `mxgstorage50106/documents` | 2026-09-14 |
| Copilot-awareness production image | `az acr build` from `services/mcp` | ✅ ACR run `cj2h`; digest `sha256:4dac6d73bf84f9449f41e20cbfc87c7235b4f0d24647570b6c9ec1d141b7d27e` | 2026-09-14 |
| Case-media production image | `az acr build` from `services/mcp` at `f9cd9b5` | ✅ ACR run `cj2j`; digest `sha256:0262661e42072abff88c961436687a72e7935680703cc9b0cd9aa57a0a65a71b` | 2026-09-14 |
| Case-media production promotion | Container App revision, health, readiness, adapter, and signed-in browser probes | ✅ `mxg-core--casemedia1` Healthy/latest-ready at 100% traffic; all three probes HTTP 200; recalled case rendered its stored JPEG and RFC 3339 timestamps | 2026-09-14 |

### 8.1 Deployment Proof

#### Copilot awareness, maintenance intake, Equipment Drives, and case media — 2026-09-14

- Git commits `014f247`, `1e8cd8a`, and `f9cd9b5` were pushed to the canonical
  shared `main`. GitHub Pages runs `34915747319` and `34918061797` completed
  validation and deployment successfully.
- The release gives the copilot a server-owned product map and request-scoped
  runtime facts, separates ordinary conversation from the nested maintenance
  advisory, and stores natural assistant text in persisted conversation memory.
- Maintenance intake now reports missing fields inside its drawer and focuses
  the field that needs attention. Cases use stable
  `MXG-CASE-YYYYMMDD-XXXXXXXX` display references, and the operator-facing
  Equipment Pack wording is normalized to Equipment Drive without changing the
  internal API or database contract.
- ACR run `cj2h` published the copilot-awareness backend, then ACR run `cj2j`
  published `mxg-core:case-media-f9cd9b5-20260914` with digest
  `sha256:0262661e42072abff88c961436687a72e7935680703cc9b0cd9aa57a0a65a71b`.
- Revision `mxg-core--casemedia1` is Healthy, latest-ready, and serves 100%
  traffic. Live `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200.
- Live signed-in browser acceptance recalled case `03cd5114` through the same
  ordinary organization-member session that reads the case. Its stored JPEG
  rendered instead of the fallback image, its display reference included the
  opening date, and the empty create action produced focused inline validation
  without creating a record.
- No user-facing permission was broadened. Case-media access remains protected
  by the normal application session and organization-scoped database lookup;
  the service managed identity remains `Storage Blob Data Contributor` only on
  the private `mxgstorage50106/documents` container.
- Rollback is non-destructive: shift traffic to `mxg-core--aware014f2`, whose
  immutable image digest is
  `sha256:4dac6d73bf84f9449f41e20cbfc87c7235b4f0d24647570b6c9ec1d141b7d27e`.

#### Deterministic Equipment Pack activation and `0.3.1-poc.26` — 2026-09-14

- Git commit `b2ddb6e` was pushed to canonical shared `main` after 403 frontend
  tests, 86 Pi tests, 10 Equipment Pack contracts, strict Rust clippy, and the
  exact 53-file Pi release preview passed.
- ACR run `cj2f` published
  `mxg-core:pack-switch-b2ddb6e-20260914` with digest
  `sha256:81cf762a40d4d6575cd67131c43ff0dea63f413b5de653f4b7cf6aefb34d5b26`.
- Revision `mxg-core--packswb2ddb6e` is Healthy, latest-ready, and serves 100%
  traffic. Live `/healthz` and `/readyz` returned HTTP 200; anonymous
  `GET /api/edge/state` returned HTTP 401.
- Live role verification confirmed the unchanged `mxg-core` managed identity
  remains `Storage Blob Data Contributor` only at the private
  `mxgstorage50106/documents` container and `Cognitive Services User` at the
  existing Document Intelligence resource.
- Pi image `0.3.1-poc.26` was rebuilt from the pinned Raspberry Pi OS base. Its
  builder repaired and then read-only verified both filesystems, and a final
  read-only mount audit verified the baked hardware identity, enabled services,
  USB peripheral configuration, removal of `piwiz.desktop`, pack metadata UI,
  and source-identical configfs unlink/swap/relink implementation.
- The compressed image SHA-256 is
  `55848df65dcd90b0403fe1d66fde1dcf3bf7f1533ebd9047e88c646e982579bf`;
  the Imager-ready raw image SHA-256 is
  `22022d7003a7f5d567ef285fa19b057dc8900717f7ff0bfc60dee39777ae0cff`.
- Rollback is non-destructive: shift cloud traffic to
  `mxg-core--piapp99cf04f` and reflash Pi image `0.3.1-poc.25`.

#### Pi approval recovery and `0.3.1-poc.25` — 2026-09-13

- Git commit `99cf04f` was pushed to canonical shared `main` after 403 frontend
  tests, 85 Pi tests, 9 Equipment Pack contracts, strict Rust clippy, and the
  exact 58-file Pi preview passed.
- ACR run `cj2d` published `mxg-core:pi-approval-99cf04f-20260913` with digest
  `sha256:07994817c8683d685b6000426ffddad32ab5153e845347b2f40f3c858a2604ad`.
- Revision `mxg-core--piapp99cf04f` is Healthy, latest-ready, and serves 100%
  traffic. Live `/healthz` and `/readyz` returned HTTP 200.
- Manager approval of a fresh seven-digit claim now restores the matching
  revoked hardware row and rotates its credential. A node cannot restore
  itself, so revocation remains manager-controlled.
- Pi image `0.3.1-poc.25` adds visible Wi-Fi scan progress and marks the most
  recently joined NetworkManager profile persistent, auto-connectable, and
  preferred. Its read-only image audit verified those files and the absence of
  `piwiz.desktop`.
- Rollback is non-destructive: shift cloud traffic to
  `mxg-core--pictl0fe7f3e` and use Pi image `0.3.1-poc.24`.

#### Pi Equipment Pack controls release — 2026-09-13

- Git commits `83bc383` and `0fe7f3e` were pushed to the canonical
  `MxGenius-io/mxgenius.io` shared `main` before the production image build.
- ACR run `cj2c` published
  `mxg-core:pi-controls-0fe7f3e-20260913` with digest
  `sha256:9d71329f9a370caf338b7fa2bf456b66805fa67d5d2bec9fdf29257076f13aee`.
- Revision `mxg-core--pictl0fe7f3e` is Healthy, latest-ready, and serves 100%
  traffic. Live `/healthz` and `/readyz` returned HTTP 200.
- Anonymous `POST /api/edge/unregister` returned HTTP 401, proving the new
  route is deployed and remains device-authenticated.
- The paired Pi image is `0.3.1-poc.24`; its read-only mount audit verified
  the update progress UI, self-unregister controls, and removal of the
  Raspberry Pi first-run wizard autostart that produced the accessibility
  audio loop.
- Rollback is non-destructive: shift traffic to
  `mxg-core--packread245a173`. Additive migration `0029` may remain in place.

#### Device approval and Pi `0.3.1-poc.23` release — 2026-09-13

- Git commits `c010f412ad4155d95239cb8df148aa7ba9348119` and the
  deployment-proof follow-up were pushed to the canonical
  `MxGenius-io/mxgenius.io` shared `main`; Pages run `34784315195`
  completed successfully.
- ACR validation run `cj28` rebuilt the Linux container without publishing it.
  ACR run `cj29` then published
  `mxg-core:edge-claim-c010f41-20260913` with digest
  `sha256:b25b44b724b726afe2dc035ab3b9ae5f0c7adbbad1173ebb71665afbe2774d5c`.
- Revision `mxg-core--claimc010f41` is Healthy, latest-ready, and serves 100%
  traffic. Live `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200.
- The device-originated claim route rejects an invalid hardware ID with HTTP
  400, the Entra-side approval route rejects an anonymous request with HTTP
  401, and an invalid claim-status bearer is rejected with HTTP 401.
- The live dashboard exposes the seven-digit `Setup code` / `Approve device`
  flow and its client calls `/api/edge/claims/approve`; it does not expose or
  copy the device credential.
- Rollback is non-destructive: return traffic to
  `mxg-core--eqpon3d2d398` and its
  `mxg-core:equipment-pack-3d2d398-20260910` image. The additive `0028`
  migration can remain in place.

#### Equipment Pack release — 2026-09-10

- Git commit `3d2d39808ab1c2c9bf5bc788939fad0bd3403482` was pushed to
  `MxGenius-io/mxgenius.io` shared `main`; Pages run `34545985481`
  completed successfully.
- ACR run `cj27` published
  `mxg-core:equipment-pack-3d2d398-20260910` with digest
  `sha256:8a7eeedda5678e0ca4be1c8bb526ce4f6ef8655e6123ad3421d1fd2c3a1c5086`.
- Revision `mxg-core--eqpon3d2d398` is Healthy, latest-ready, and serves
  100% traffic with `MXGENIUS_EQUIPMENT_PACKS_ENABLED=true`.
- Live `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200. Anonymous
  human Equipment Pack reads and device desired-state reads returned HTTP 401;
  a structurally valid but unknown enrollment code also returned HTTP 401.
- The Azure CLI identity cannot mint this application's delegated user token,
  so the final authenticated tenant read remains a browser-session smoke test.
- Rollback is non-destructive: use the feature-off
  `mxg-core--equip3d2d398` revision first, or the prior
  `mxg-core--spatialshell3eacbb0` revision and image if a full code rollback is
  required. No revisions, images, migrations, Blobs, roles, or secrets were
  deleted.

### 9. Files to Generate or Modify

| File | Purpose | Planned status |
|------|---------|----------------|
| `.azure/deployment-plan.md` | Source-of-truth plan and validation proof | Updated |
| `services/mcp/migrations/0027_equipment_packs.sql` | Tenant-safe pack, version, device, assignment, enrollment, and deployment schema | Created |
| `services/mcp/migrations/README.md` | Migration inventory | Updated |
| `services/mcp/server/src/application/equipment_packs.rs` | Transactional repositories and state transitions | Created |
| `services/mcp/server/src/application/mod.rs` | Export Equipment Pack application module | Updated |
| `services/mcp/server/src/transport/http.rs` | Human/device routes, block transfer, ranged delivery, WSS notification | Updated |
| `services/mcp/server/tests/equipment_packs.rs` | Migration, auth, tenant, idempotency, race, and transfer contract tests | Created |
| `services/mcp/README.md` | Configuration and operational contract | Updated |

The Pi `0.3.1-poc.26` appliance is built and distributed separately from the
Azure core image and Container App promotion.

### 10. Next Steps

1. Flash the audited `0.3.1-poc.26` appliance image.
2. Approve its seven-digit claim and allow the assigned generation to reconcile.
3. Verify host-side USB enumeration and A/B activation on physical hardware.

### Rollback

- Ship the API behind `MXGENIUS_EQUIPMENT_PACKS_ENABLED=false` by default.
- If the new revision fails health, auth, migration, transfer, or device-state
  checks, restore traffic to `mxg-core--spatialshell3eacbb0`.
- Migration `0027` is additive; leave its empty/dormant tables and any test Blob
  objects in place during rollback rather than dropping data.
- Delete no existing revision, Blob container, database, identity, or secret.

---

## Spatial Maintenance Shell + Parts Order History Delta — 2026-09-08

### Scope and deployment path

- Publish the consolidated Operations/Maintenance spatial shell and compact
  onboarding through the existing GitHub Pages workflow on shared `main`.
- Promote the same committed source state to the existing `mxg-core` Container
  App because it adds the bounded read-only `mxg.parts.order_history`
  capability and advances the canonical registry from 45 to 46 tools.
- Reuse `Azure subscription 1`, Central US resource group `mxg-rg-50106`, ACR
  `mxgacr50106`, Container App `mxg-core`, its existing identity, secrets,
  environment settings, Single revision mode, and one-replica room-owner
  invariant.
- No resource, database migration, role assignment, secret, SKU, region,
  ingress, scale, or topology change is included.

### Validation and promotion gates

- [x] Commit and push the complete frontend and 46-tool contract to shared
  `main` with a clean synchronized working tree.
- [x] Run the complete frontend suite and locked Rust formatting, workspace
  tests, strict Clippy, and optimized release build.
- [x] Build one immutable ACR image from the exact committed `services/mcp`
  context and create one Healthy/latest-ready `mxg-core` revision.
- [x] Verify Pages, `/healthz`, `/readyz`, `/adapterz`, and fail-closed anonymous
  behavior after promotion.
- [ ] Verify the 46-tool catalog through an authenticated browser session; the
  release host does not expose a reusable application token to Azure CLI.

### Deployment proof

- Application commit `3eacbb07442423c5f89e537a8afe1df9b486c89d` and test-only
  closure commit `fc264a925f904cbbb19a9610a317b4ad30318d5a` were pushed to
  `MxGenius-io/mxgenius.io` shared `main` using the repository-approved
  environment credential. GitHub Pages run `34299305013` passed validation,
  assembly, artifact upload, and deployment.
- The complete frontend suite passed 394 tests. Rust formatting, the locked
  workspace suite, strict all-target Clippy, and the optimized locked release
  build passed.
- ACR run `cj24` published
  `mxg-core:spatial-shell-3eacbb0-20260908` with digest
  `sha256:2d0ac717199fb105497effd058d5fd23d7dfe0eac0c33ff4246b6f965dc40640`.
- Revision `mxg-core--spatialshell3eacbb0` is Healthy, latest-ready, and serves
  100% traffic with min 1/max 1 replicas. The previous
  `mxg-core--uisounds5c95104` revision remains preserved, Healthy, stopped, and
  available for rollback.
- Live `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200. Anonymous
  `tools/list` returned the typed `AUTH_REQUIRED` boundary. The published site
  serves Viewer v34, onboarding v10, the shared maintenance runtime and spatial
  shell, and no legacy sensor dashboard tab.

### Rollback

- Preserve the current `mxg-core--uisounds5c95104` revision and
  `mxg-core:ui-sounds-5c95104-20260907` image. If build, readiness,
  authentication, registry, or live smoke checks fail, restore that revision's
  traffic without deleting images, revisions, resources, secrets, or data.

Status: Deployed — commit `5c95104` promoted and live checks passed on 2026-09-07

## UI Sound Hot Swap Delta — 2026-09-07

### Scope and deployment path

- Add one organization-scoped, versioned `index.json` below the existing private
  `documents` Blob container and versioned WAV/MP3/M4A objects for each custom
  sound override.
- Add authenticated read endpoints and Manager/Administrator-only replace and
  restore endpoints to the existing `mxg-core` Container App.
- Keep the 27 bundled files as the automatic fallback. No existing Blob is
  overwritten or deleted, and a failed index read never prevents the dashboard
  or XR surfaces from using the bundled set.
- Publish the frontend control card only with the later shared Git batch. This
  Azure step does not push GitHub or change the public static site.
- The final frontend batch also adds optional case-image intake and an Add image
  action on recalled cases. Both call the already-deployed confirmed
  `mxg.maintenance_case.attach_observation` media path; there is no second
  upload route, storage model, database change, or Azure infrastructure delta.
- The final XR sanity pass keeps the UI-sound adapter available in both the
  embedded and standalone 3D viewer, verifies case-media metadata is reloaded
  into the sensor/Remote Witness projection, and locks the anonymous guest-room
  handoff into tests. The removed QR/manual-code path is replaced end to end by
  a single-use 7-digit PIN, native Quest display, expiry, and revoke.
- Reuse `Azure subscription 1`, Central US resource group `mxg-rg-50106`, ACR
  `mxgacr50106`, Container App `mxg-core`, its current system identity, and the
  private `documents` container. Constrain the Alpha core to one minimum and one
  maximum replica so PIN exchange and its WebSocket always share the same
  in-memory room owner. No resource, SKU, secret, role assignment, database
  migration, or topology change is required.

### Security and storage boundaries

- Browser code receives only authenticated application URLs, never Azure Blob
  URLs, SAS values, storage keys, or credentials.
- Uploads are limited to the 27 published cue IDs, 5 MiB, 15 seconds, and WAV,
  MP3, or M4A files whose extension, media type, and file signature agree.
- Index writes use Azure ETag preconditions plus an application version so two
  administrators cannot silently overwrite one another.
- The current `mxg-core` identity already has `Storage Blob Data Contributor`
  scoped to the existing private `documents` container, which is sufficient for
  index and audio read/write operations.

### Validation steps

- [x] Run the complete frontend suite.
- [x] Run Rust formatting, the complete locked workspace suite, strict Clippy,
  and the optimized locked release build.
- [x] Validate the new cue ID and audio signature guards with focused unit tests.
- [x] Check the diff for whitespace errors and confirm there is no database or
  infrastructure delta.
- [x] Verify the current Azure subscription, Central US resource group, ACR,
  Container App, storage account, storage role, revision mode, scale, and live
  health/readiness endpoints.
- [x] Confirm `Azure subscription 1` and the existing Central US target with the
  user.
- [x] Run one ACR `--no-push` build as the final container validation gate.

### Validation proof

Validated locally on 2026-09-07 against the current uncommitted shared-tree
candidate:

- `npm test`: 382 tests passed, 0 failed, including the shared case-media form
  path and sound-library token refresh behavior.
- `cargo fmt --all -- --check`: passed.
- `cargo test --locked --workspace`: 258 tests passed, 0 failed.
- `cargo clippy --locked --workspace --all-targets -- -D warnings`: passed.
- `cargo build --locked --release -p mxgenius-mcp`: passed.
- `git diff --check`: passed.
- Azure read-only preflight: subscription Enabled; resource group, ACR, storage,
  and Container App provisioning Succeeded; `mxg-core` is Single revision mode
  with min 1/max 2 replicas before promotion. The release sets max replicas to 1
  to preserve the in-memory room-owner invariant. `/healthz`, `/readyz`, and
  `/adapterz` returned 200.
- Live role verification found `Storage Blob Data Contributor` on the exact
  `documents` container scope for the current `mxg-core` system identity. The
  subscription has no Azure Policy assignments.
- Azure ACR build-only run `cj22` completed the full 18-step Dockerfile from the
  exact `services/mcp` candidate with `--no-push`; no image was published.

### Promotion and rollback

- Build one immutable `mxg-core:ui-sounds-<candidate>-20260907` image from the
  exact `services/mcp` working-tree context, create one new revision constrained
  to one replica, wait for it to become Healthy/latest-ready, then verify health
  and fail-closed sound API behavior before accepting Single-mode traffic.
- Preserve `mxg-core--spatialwitness-7cadceb` and image
  `mxg-core:spatial-witness-7cadceb-20260903` as the rollback target. Do not
  delete any image, revision, resource, Blob, secret, role, or data.

### Deployment proof

- Git commit `5c951042bbe85ef80ee2df79988bcf6dedab5d84` was pushed to shared
  `main`; GitHub Pages workflow run `34158265538` passed its frontend, Rust,
  assembly, artifact, and deploy jobs.
- ACR run `cj23` published
  `mxg-core:ui-sounds-5c95104-20260907` with digest
  `sha256:b638414a815c28d084df340b06cec30da8301ba2a7184aab3e85ec45673ea063`.
- Container App revision `mxg-core--uisounds5c95104` became Healthy and
  latest-ready with 100% Single-mode traffic and min 1/max 1 replicas.
- Live `/healthz`, `/readyz`, and `/adapterz` returned 200. Anonymous UI-sound
  reads and room creation returned 401, while an invented 7-digit PIN returned
  the bounded `WITNESS_NOT_FOUND` 404 response.
- The published site exposes the 27-cue Interface Sounds card, case-image
  intake, launch-gated dashboard splash, and temporary no-account 7-digit PIN
  guest page. A live browser pass confirmed a direct dashboard load does not
  display the splash.

## Spatial Target + Remote Witness Alpha 21 Delta — 2026-09-03

### Project overview and approval

- **Goal:** publish the completed spatial-target contract, deliberate still-frame
  scan path, Remote Witness signaling/state service, public guest browser surface,
  and Quest Alpha 21 wearer capture/control implementation for the physical
  headset acceptance matrix.
- **Path:** MODIFY the existing application plane. GitHub Pages publishes the
  static root from the shared `main` branch; one immutable `mxg-core` image
  revision carries the Rust API/WSS changes; the existing Meta private Alpha
  channel receives the already-verified signed APK.
- **Approval:** on September 3, 2026, the user explicitly authorized the Git,
  Azure, and Meta release handoff before entering the headset.
- **Azure context:** reuse the current default `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), existing Central US resource group
  `mxg-rg-50106`, registry `mxgacr50106`, Container Apps environment
  `mxg-cae-50106`, and Container App `mxg-core`.
- **Classification / scale / budget:** existing private Alpha pilot. No new
  resource, replica, SKU, region, database object, role, secret, or topology is
  introduced. Spatial scans are deliberate still-image requests with a hard
  daily cap; continuous witness media is peer-to-peer WebRTC, not Azure-proxied.

### Components, recipe, and architecture

| Component | Type | Technology | Deployment target |
|---|---|---|---|
| Spatial scan + target/session commands | Containerized API | Rust / Axum / existing Responses client | Existing `mxg-core` Container App |
| Remote Witness room, consent, projection, signaling | Containerized API + WSS | Rust / Axum in-memory TTL rooms | Existing `mxg-core` Container App, one replica |
| Customer witness + XR controls | Static frontend | HTML / CSS / JavaScript / WebRTC | Existing GitHub Pages site from `main` |
| Wearer capture + controls | Signed Android APK | Horizon OS / Spatial SDK / libwebrtc | Existing Meta Alpha channel |

- **Recipe:** existing Azure CLI + remote ACR build + Container Apps revision
  promotion. No AZD, Bicep, Terraform, or infrastructure provisioning applies.
- **Specialized technology check:** no Copilot SDK, Azure Functions, APIM,
  AI-gateway, AKS, Terraform, or cross-cloud marker applies.
- **State shape:** Remote Witness rooms remain bounded, TTL-scoped, and
  in-process. The existing one-replica deployment is therefore an explicit
  invariant for this Alpha; no second core or shared room store is created.
- **Media shape:** Azure WSS carries only bounded consent, presence,
  projection, and SDP/ICE messages. Video flows directly between the Quest and
  guest browser. TURN remains disabled until the physical network matrix
  demonstrates a relay is required.

### Release contents and configuration

- Publish the live `witness.*` JSON schema and canonical Android/browser
  signaling fixtures, the one-viewer invitation/exchange/room/control/media/WSS
  routes, and the read-only `witness.html` guest surface.
- Publish the deliberate spatial scan endpoint with 1280-pixel / 1 MiB input
  bounds, 0.85 display threshold, five-result limit, eight-second timeout,
  two-second cooldown, 12-per-minute limit, 100-per-day limit, and bounded
  hash-only cache. Scan images are not persisted.
- Set only these non-secret application settings on the promoted core:
  - `MXGENIUS_SPATIAL_SCAN_ENABLED=true`
  - `MXGENIUS_SPATIAL_SCAN_MODEL=gpt-5.4-mini`
  - `MXGENIUS_WITNESS_INVITE_TTL_SECONDS=300`
  - `MXGENIUS_WITNESS_SESSION_TTL_SECONDS=3600`
  - `MXGENIUS_WITNESS_MAX_VIEWERS=1`
- Preserve every existing secret reference and environment setting, including
  the current server-held model key. Do not print, replace, or add a credential.
- Upload the exact signed `0.1.0-alpha.21` (`versionCode 21`) ARM64 APK whose
  local release verifier and checksum match `meta/meta-release.json`. After Meta
  accepts the upload, update the browser version marker and release metadata to
  Alpha 21 before the final Git push.
- No database migration is included. Existing case gallery/evidence storage is
  reused; Remote Witness adds no archive or parallel media store.

### Validation and promotion gates

- [x] User approved the application-only release and the existing subscription,
  Central US location, GitHub Pages site, and Meta Alpha channel.
- [x] Live read-only inventory confirms the resource group, Container Apps
  environment, registry, and current `mxg-core` revision are Succeeded/Running.
- [x] Git diff, secret/large-file review, full Node suite, Python schema tests,
  Rust format/tests/strict Clippy/release build, Android unit/lint, and signed
  APK verification pass against the exact release tree.
- [ ] Meta accepts Alpha 21 and its automated security/malware gates clear.
- [x] `main` is pushed to `https://github.com/MxGenius-io/mxgenius.io.git` with
  no branch, pull request, merge conflict, or uncommitted release file.
- [x] ACR publishes one immutable image from the exact committed
  `services/mcp` context; the candidate revision becomes Healthy and latest-ready
  before Single mode moves its existing traffic.
- [x] Post-promotion `/healthz`, `/readyz`, and `/adapterz` return HTTP 200;
  witness exchange rejects an invented invitation, protected creation routes
  reject unauthenticated callers, and startup logs contain no migration, panic,
  or bind failure.
- [ ] The deployed frontend exposes `witness.html`, advertises Alpha 21, and the
  deployed core reports spatial scan enabled plus Remote Witness available.

### Validation proof

Validated on September 3, 2026 against the frozen working-tree candidate:

- `git diff --check` passed; 119 changed/new release files contain no file over
  10 MiB. Secret-pattern review found only deliberate fake credential fields in
  test fixtures and no GitHub/AWS/private-key signature.
- The complete frontend suite passed 368 tests. Python schema validation passed
  10 tests, including the Remote Witness and spatial command fixtures.
- `cargo fmt --all -- --check`, 256 locked Rust workspace tests, strict
  all-target Clippy, and the locked optimized `mxgenius-mcp` build passed.
- Android unit tests, debug/release lint, signed release assembly, manifest/ABI/
  dependency/control/credential verification, and signature validation passed.
  The resulting `0.1.0-alpha.21` ARM64 APK is 176,508,662 bytes with SHA-256
  `9fc89f88537c41f13f940b022d0ea7d6aa1fcb4dff5d7a922a688729cb76aafc`,
  matching `meta/meta-release.json` exactly.
- ACR validation run `cj20` built the complete 18-step Dockerfile from the exact
  367.987-KiB `services/mcp` context with `--no-push` and completed successfully.
- Live preflight returned HTTP 200 from `/healthz`, `/readyz`, and `/adapterz`.
  The current resource group, Container Apps environment, registry, and core app
  are Succeeded; `mxg-core` is Running in Single mode with one minimum replica.
- Static RBAC changes are not applicable. Live role verification confirms the
  unchanged core identity retains `Storage Blob Data Contributor` on the
  private `documents` container and its dormant `Cognitive Services User` role.
  ACR access continues through the existing registry secret reference; no role
  or secret was added or changed.

### Deployment proof

Git and Azure were promoted and verified on September 3, 2026; Meta Alpha 21
remains the final manual release-channel handoff:

- Commit `7cadceb03411bf17a014168befccb184c981fc5f` was pushed directly to
  `origin/main`. GitHub Pages returned HTTP 200 for `witness.html`, `witness.js`,
  and `xr-target-registry.js`.
- ACR run `cj21` published
  `mxgacr50106.azurecr.io/mxg-core:spatial-witness-7cadceb-20260903` with digest
  `sha256:06b3a58a1e516d8cb37f5f29efcf810125cbb075f3c729d7a23c89a36a27f540`.
- Revision `mxg-core--spatialwitness-7cadceb` is active, Healthy, Running,
  Provisioned, latest-ready, and serving 100% traffic with one replica. The six
  reviewed spatial-scan and witness values are present as non-secret settings.
- `/healthz`, `/readyz`, and `/adapterz` returned HTTP 200. Adapter readiness
  reports `spatial_scan` and `remote_witness` ready; an invented invitation
  returned `WITNESS_NOT_FOUND` and valid anonymous invitation creation returned
  `AUTH_REQUIRED`.
- Startup logs show the existing SQLx migration state, 45 registered tools, 15
  resources, 8 prompts, and a clean HTTP bind on port 3030 with no panic or
  migration failure.
- The exact signed Alpha 21 APK remains at
  `services/xr-flir-companion/app/build/outputs/apk/release/app-release.apk` with
  SHA-256
  `9fc89f88537c41f13f940b022d0ea7d6aa1fcb4dff5d7a922a688729cb76aafc`.
  The public runtime marker intentionally remains Alpha 19 until Meta accepts
  this artifact and its automated gates clear.

### Rollback

- Preserve image `mxgacr50106.azurecr.io/mxg-core:parts-model-f8d95cb-20260825`
  and revision `mxg-core--partsmodel-f8d95cb` until the headset/browser smoke
  passes.
- If the candidate does not build, start, become ready, authenticate, or pass
  health and fail-closed probes, restore the prior image/revision. Do not delete
  resources, data, assets, revisions, secrets, role assignments, or Meta builds.
- The static frontend can be restored to Git commit `6c69116`; Alpha 19 remains
  the Meta fallback while Alpha 21 is evaluated.

## Parts Model Extraction Delta — 2026-08-25

### Project overview and approval

- **Goal:** promote the completed Parts receiving extraction path that sends the
  existing private JPEG, PNG, WebP, or PDF asset through the MXGenius Responses
  model, returns strict-schema candidate metadata, and keeps Rocky's existing
  human review and receiving controls authoritative.
- **Path:** MODIFY the existing production application plane with one immutable
  `mxg-core` image revision and the already-published static frontend at Git
  commit `f8d95cbf1cef574b5cd0d75c98bef0444788b93a`.
- **Approval:** on August 25, 2026, the user explicitly authorized pushing the
  build-ready change to Azure and asked for confirmation before notifying Rocky.
- **Azure context:** reuse `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), `centralus`, resource group
  `mxg-rg-50106`, registry `mxgacr50106`, Container Apps environment
  `mxg-cae-50106`, and Container App `mxg-core`.
- **Classification / scale / budget:** existing small production pilot,
  cost-optimized within the current service envelope. No data-residency,
  subscription-policy, or architecture change is introduced; the live
  subscription currently has no policy assignments.

### Components, recipe, and architecture

| Component | Type | Technology | Deployment target |
|---|---|---|---|
| Parts extraction API | Containerized API | Rust / Axum / SQLx / OpenAI Responses | Existing `mxg-core` Container App |
| Parts review | Static frontend | HTML / CSS / JavaScript | Existing GitHub Pages release from `main` |
| Evidence | Private files | Existing Azure Blob Storage | Existing `documents` container |
| Extraction audit | Relational state | Existing PostgreSQL schema | Existing production database |

- **Recipe:** existing Azure CLI + remote ACR build + Container Apps revision
  promotion. No AZD, Bicep, Terraform, new resource, or generated infrastructure
  artifact applies to this application-only delta.
- **Specialized technology check:** no Copilot SDK, Azure Functions, APIM,
  AI-gateway, AKS, or cross-cloud marker applies.
- **Capacity:** 0 new Azure resources, 0 new replicas, and no SKU, quota, region,
  scale, ingress, or topology change. Existing resource totals and service
  quotas are unchanged, so no provisioning capacity is consumed.

### Release contents and security boundaries

- Include backend commit `86895d1a59129b9f686f32c2cdb3f2049d1e5062`,
  replacing the Document Intelligence plus regex request path with the existing
  server-held Responses client and strict schema.
- Include frontend closure commit
  `f8d95cbf1cef574b5cd0d75c98bef0444788b93a`, showing extraction warnings,
  source excerpts, page references, and an authenticated private-source preview
  through the existing `assetId`.
- Reuse the existing `OPENAI_API_KEY` secret reference `openai-key`; create no
  credential and expose no key or Blob URL to the browser. Responses use
  `store: false` and model-derived values carry no synthetic confidence, which
  keeps every candidate in human review.
- Preserve all current Container App environment variables, secrets, managed
  identity, RBAC, ingress, revision mode, and scale settings. The dormant
  Document Intelligence setting and role remain unchanged for rollback safety.
- No database migration is included. Existing extraction run fields already
  record provider, model version, source references, and candidates.

### Validation and promotion gates

- [x] User approved this application-only plan and the existing subscription and
  Central US location.
- [x] Git `main` is clean, synchronized with `origin/main`, and pinned to
  `f8d95cbf1cef574b5cd0d75c98bef0444788b93a`.
- [x] `npm test` passes (224 tests, 0 failures).
- [x] `cargo fmt --all -- --check` passes.
- [x] `cargo test --locked --workspace` passes (193 tests, 0 failures).
- [x] `cargo clippy --locked --workspace --all-targets -- -D warnings` passes.
- [x] `cargo build --locked --release -p mxgenius-mcp` passes.
- [x] Live preflight returns HTTP 200 for `/healthz`, `/readyz`, and `/adapterz`.
- [x] Live configuration confirms `OPENAI_API_KEY` still references
  `openai-key`, and that key can access the configured/default extraction model.
- [x] A remote ACR build publishes one immutable
  `mxg-core:parts-model-f8d95cb-20260825` image.
- [x] One new revision with suffix `partsmodel-f8d95cb` becomes Healthy,
  Running, latest-ready, and receives 100% traffic in existing Single mode.
- [x] Post-promotion health/readiness/adapter checks return HTTP 200,
  unauthenticated Parts extraction fails closed, and startup logs contain no
  migration, panic, or server-start failure.

### Validation proof

Validated at `2026-08-25T06:42:47-04:00` against source commit
`f8d95cbf1cef574b5cd0d75c98bef0444788b93a`:

- The frontend suite passed 224 tests; Rust formatting, 193 workspace tests,
  strict Clippy, and the locked optimized release build all passed.
- Azure ACR build-only run `cj1x` built the complete 18-step Dockerfile from
  the exact `services/mcp` context with `--no-push` and completed successfully.
- The current production revision returned HTTP 200 from `/healthz`,
  `/readyz`, and `/adapterz` before promotion.
- The existing `openai-key` secret reference was resolved without disclosure;
  the API was reachable and `gpt-5.4-mini` was available.
- The subscription is Enabled, the existing resource group, Container Apps
  environment, registry, and app all report successful/running state, and the
  subscription has no Azure Policy assignments.
- Static infrastructure and RBAC validation are not applicable because this
  application-only release contains no Bicep, Terraform, resource, identity,
  or role-assignment change. Live verification confirms the app identity still
  has `Storage Blob Data Contributor` on the private `documents` container;
  the dormant Document Intelligence role is preserved for rollback.
- The current app uses its existing ACR credential secret, so no new `AcrPull`
  assignment or RBAC propagation wait is introduced. Rollback digest is
  `sha256:49c9d45e8d4d30ab015ab3af81d18d94bab82a0e5e4f977bf9e6b045f2a64696`.

### Deployment proof

Deployed and verified at `2026-08-25T06:52:03-04:00`:

- ACR run `cj1y` published
  `mxgacr50106.azurecr.io/mxg-core:parts-model-f8d95cb-20260825` with digest
  `sha256:0ff7da2287b185da78057191be66abf60e79ec5abc1ed180a66bb8ad76be3384`.
- Container Apps revision `mxg-core--partsmodel-f8d95cb` is active, Healthy,
  Running, Provisioned, and latest-ready with one replica. Existing Single
  revision mode sends 100% of ingress traffic to the latest revision.
- The app reports provisioning `Succeeded` and serves the promoted image at
  `https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io`.
- Post-promotion `/healthz`, `/readyz`, and `/adapterz` each returned HTTP 200;
  unauthenticated `POST /api/parts/assets/{id}/extractions` returned HTTP 401.
- Startup logs show existing migrations recognized, 45 tools / 15 resources /
  8 prompts loaded, and the server listening on port 3030 with no panic,
  migration failure, or startup error.
- `OPENAI_API_KEY` remains bound to `openai-key`. No secret value was printed,
  changed, or exposed.
- `https://mxgenius.io/dashboard.html` returned HTTP 200 and references the
  release-matched `parts-workspace.css?v=15` and
  `parts-workspace.js?v=19` assets.

### Rollback

- The prior rollback image remains available as
  `mxgacr50106.azurecr.io/mxg-core:feedback-parts-9cc2b10-20260822` and revision
  `mxg-core--feedbackparts9cc2b10`.
- If the candidate fails to build, start, become ready, authenticate, reach the
  model boundary, or pass health checks, restore the prior image. Do not delete
  resources, data, assets, revisions, secrets, or role assignments.

## Feedback and Parts Expansion Delta — 2026-08-22

### Project overview and approval

- **Goal:** publish Rocky's in-app feedback/reporting flow and the expanded
  procurement, traceability, rotable, core, warranty, cannibalization, and bulk
  import Parts workflows through the existing production application plane.
- **Path:** application-only update of the existing `mxg-core` Container App.
  The static frontend is already published from Git `main` at product commit
  `9cc2b10ed842cfea3104334b336e71ad218478c9`.
- **Approval:** after reviewing the audit findings, the user authorized the
  as-is Azure release on August 22, 2026, then explicitly confirmed the target
  subscription and region.
- **Azure context:** reuse `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), `centralus`, resource group
  `mxg-rg-50106`, registry `mxgacr50106`, Container Apps environment
  `mxg-cae-50106`, and Container App `mxg-core`. No resource, region, SKU,
  identity, RBAC, secret, ingress, or scale change is approved.

### Release contents

- Add authenticated feedback submission and administration, including private
  screenshot storage, through migration `0018_feedback.sql`.
- Expand Parts with procurement/orders, traceability, serialized rotable and
  core obligations, warranty claims, gated cannibalization records, and bulk
  CSV/XLSX import with preview and rollback through migrations `0019`-`0023`.
- Build the exact `services/mcp` context from the clean shared `main` branch and
  publish one immutable ACR tag. SQLx applies the additive migrations before
  the server accepts traffic.

### Validation and security disposition

- Frontend suite passed: 212 tests, 0 failures.
- Rust workspace passed: formatting, strict Clippy, 192 tests, and the locked
  optimized release build.
- `git diff --check` passed and the working tree was clean and synchronized
  with `origin/main` before this deployment record.
- Live preflight passed: the existing revision returned HTTP 200 from
  `/healthz`, `/readyz`, and `/adapterz`; readiness reported the production
  database and authoritative manual source healthy.
- Static RBAC changes are not applicable because this release contains no
  infrastructure or role-assignment change. Live state confirms the
  `mxg-core` system identity retains `Storage Blob Data Contributor` on the
  private `documents` container and `Cognitive Services User` on the existing
  Document Intelligence account.
- The user accepted release with the audit findings left open: cross-tenant
  global part-catalog mutation/rollback behavior, active `quick-xml` RustSec
  advisories through `calamine`, unvalidated authentication `returnUrl`, broad
  Parts authorization, forgeable preview digests, CSV formula injection,
  coarse request/body limits, cannibalization cancellation ownership, and an
  archived uniqueness edge case. This authorization does not close or waive
  those findings for remediation tracking.

### Promotion and rollback gates

- Preserve the ready image
  `mxgacr50106.azurecr.io/mxg-core:patent-b99241d-20260817-0125` and revision
  `mxg-core--patentb99241dv3` throughout deployment.
- Azure's existing `Single` revision mode must keep the current revision live
  until the candidate starts, applies migrations `0018`-`0023`, and becomes
  latest-ready. Migration `0023` intentionally fails if duplicate live parts
  with a null manufacturer already exist; such a failure blocks promotion.
- After promotion, `/healthz`, `/readyz`, and `/adapterz` must return HTTP 200;
  unauthenticated Parts and Feedback API access must fail closed.
- If readiness, migration, authentication, or smoke gates fail, restore the
  previous image. Additive database objects may remain dormant; rollback must
  not drop tables, delete records/assets, change RBAC, or expose secrets.

### Execution checklist

- [x] Confirm subscription, Central US location, resource group, Container Apps
  environment, registry, live revision/image, and pre-deployment health.
- [x] Confirm the exact Git release state, local test/build proof, Docker build
  context, managed identity, required live data-plane roles, and rollback image.
- [x] Mark this application-only delta Validated with accepted audit exceptions.
- [x] Build and identify the immutable ACR image digest.
- [x] Promote one new `mxg-core` revision and verify migration/startup logs.
- [x] Verify live health, readiness, adapter status, fail-closed routes, traffic,
  image, and rollback availability.

### Deployment proof

- 2026-08-22: ACR build `cj1w` completed successfully from the exact
  `services/mcp` context and published
  `mxg-core:feedback-parts-9cc2b10-20260822` with digest
  `sha256:49c9d45e8d4d30ab015ab3af81d18d94bab82a0e5e4f977bf9e6b045f2a64696`.
- 2026-08-22: revision `mxg-core--feedbackparts9cc2b10` became `Healthy`,
  `Running`, latest-ready, and received 100% traffic in the existing `Single`
  revision mode. The Container App provisioning state remained `Succeeded`.
- 2026-08-22: startup logs showed the SQLx migration table and then the server
  listening on port 3030 with no warning/error entries. `/healthz`, `/readyz`,
  and `/adapterz` returned HTTP 200; readiness reported the production database
  and authoritative v2 manual pack healthy.
- 2026-08-22: valid unauthenticated Feedback submission, Feedback admin, and
  Parts requests returned HTTP 401. No test record was created.
- 2026-08-22: post-deployment live RBAC still showed `Storage Blob Data
  Contributor` on the private `documents` container and `Cognitive Services
  User` on the Document Intelligence account for the unchanged `mxg-core`
  managed identity.
- 2026-08-22: rollback remains available through prior image
  `mxg-core:patent-b99241d-20260817-0125`, digest
  `sha256:e4ed8aa53594da0a9e90044a657eb908c0dc40e96c209a44d312457f7217437f`.

## Shared Patent Workspace Delta — 2026-08-17

### Project overview and approval

- **Goal:** publish the organization-shared provisional-patent completion
  workspace requested in Settings, backed by the existing authenticated
  application plane, Azure PostgreSQL database, and private `documents` Blob
  container.
- **Path:** MODIFY the existing small, cost-conscious production pilot.
- **Approval:** the user approved implementation and publication in the current
  task on August 17, 2026 and explicitly named Dwayne Tillman, Joshua Millard,
  and Thomas Hagy as proposed inventors.
- **Azure context:** reuse the previously approved `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), `centralus`, and resource group
  `mxg-rg-50106`. No subscription, region, SKU, scale, or topology change is in
  scope.

### Components and recipe

| Component | Type | Technology | Deployment target |
| --- | --- | --- | --- |
| Patent workspace | Static frontend | HTML, CSS, JavaScript | Existing GitHub Pages site |
| Shared workspace API | Containerized API | Rust / Axum / SQLx | Existing `mxg-core` Container App |
| Current document and revisions | Relational state | PostgreSQL JSONB | Existing production PostgreSQL database |
| References and immutable save archives | Private files | Azure Blob Storage | Existing private `documents` container |

- **Recipe:** existing Azure CLI + ACR + Container Apps release path.
- **Rationale:** this is an application-only update to already-provisioned
  resources. Creating or changing infrastructure would add risk without adding
  capability.
- **Specialized technology check:** no Copilot SDK, Azure Functions, APIM, new
  AI gateway, or cross-cloud migration marker applies.

### Architecture and security boundaries

- The latest shared document is organization-scoped in PostgreSQL and every
  save creates an immutable revision row with the authenticated user and
  optimistic version number.
- Each save also writes an immutable JSON archive under
  `documents/project-workspaces/{organization}/{workspace}/revisions/`.
- Uploaded references are stored under
  `documents/project-workspaces/{organization}/{workspace}/assets/` and are
  downloadable only through the authenticated tenant-scoped API.
- Blob URLs, SAS values, credentials, and storage keys are never returned to
  browser code. The existing `mxg-core` managed identity remains the preferred
  read boundary; existing server-side storage configuration remains the write
  fallback.
- The frontend labels inventor names as proposed until residence,
  contribution, ownership, and substantive review are confirmed. It does not
  submit to USPTO or represent legal review as complete.

### Resource inventory and capacity

| Resource type | Number to deploy | Total after deployment | Limit / quota | Notes |
| --- | ---: | ---: | --- | --- |
| New Azure resources | 0 | unchanged | Not applicable | Existing resources only; no provisioning quota is consumed |
| `Microsoft.App/containerApps` | 0 new / 1 revision | 1 existing app | Existing service envelope | New `mxg-core` image revision only |
| PostgreSQL tables | 3 additive tables | Existing database | Existing database capacity | JSON document capped at 512 KiB; files remain in Blob |
| Storage containers | 0 | 1 existing private `documents` container | Existing account | New tenant-scoped prefixes only |

Capacity status: **within existing limits**. No resource, replica, SKU, region,
or quota change is requested, so a quota increase is not applicable.

### Files and changes

- Add migration `0017_project_workspaces.sql` with tenant-scoped current,
  revision, and asset metadata tables.
- Add authenticated GET/PUT workspace routes plus private asset upload/download
  routes to `mxg-core`.
- Add `patent-workspace.html`, `patent-workspace.css`, and
  `patent-workspace.js` plus the Settings selector and protected-page return
  flow.
- Add browser-contract, client-contract, migration, route, and validation tests.
- No infrastructure file, secret, RBAC assignment, public ingress, database
  deletion, or existing migration is changed.

### Functional verification

- JavaScript syntax checks passed.
- Complete frontend suite passed: 130 tests.
- Rust formatting and compile checks passed.
- Complete Rust workspace suite passed: 121 tests across all test targets.
- Local browser navigation exposed and corrected the protected-page return
  handoff through the registered dashboard redirect URI.
- The authenticated live visual/save check remains a post-deployment gate
  because local Entra redirects intentionally return to the production origin.

### Validation steps

- `git diff --check`.
- `npm test` and JavaScript syntax checks.
- `cargo fmt --all -- --check`.
- `cargo clippy --locked --workspace --all-targets -- -D warnings`.
- `cargo test --locked --workspace`.
- `cargo build --locked --release -p mxgenius-mcp`.
- Confirm Azure CLI subscription, current `mxg-core` revision/image, managed
  identity, storage role, and current health/readiness before promotion.
- Build the exact `services/mcp` source state in the existing ACR, create one
  new `mxg-core` revision, and allow SQLx to apply only additive migration 0017.

### Release gates

- The new revision is latest-ready before traffic is accepted.
- `/healthz` and `/readyz` return HTTP 200 after migration startup.
- Unauthenticated project-workspace access fails closed.
- The promoted frontend opens the protected patent workspace, displays all
  three proposed inventor names, and can save/reload one tenant-shared version.
- One small reference file can be uploaded and retrieved through the private
  application API without exposing a Blob URL.
- GitHub Pages publishes only after the core acceptance gates pass.

### Rollback

- Keep the current ready `mxg-core` revision and image available throughout.
- If startup, migration, health, authentication, or storage gates fail, shift
  traffic back to the previous ready revision and do not publish the frontend.
- Additive migration tables may remain dormant. Rollback does not drop tables,
  delete workspaces, delete Blob data, change RBAC, or remove revisions.
- If frontend acceptance fails after publication, restore the prior Pages
  commit while retaining the compatible backend revision.

### Execution checklist

- [x] Analyze and scan the existing application and deployment context.
- [x] Confirm no new infrastructure or quota is required.
- [x] Implement and locally verify the frontend, API, migration, and tests.
- [x] Preserve tenant, identity, Blob privacy, and rollback boundaries.
- [x] Mark this delta Ready for Validation.
- [x] Run and record the complete validation proof.
- [x] Promote and verify the paired core/frontend release.

### Validation proof

- 2026-08-17: JavaScript syntax checks, `git diff --check`, and all 130 frontend
  tests passed.
- 2026-08-17: Rust formatting, strict workspace Clippy, all 121 Rust tests, and
  the locked release build passed.
- 2026-08-17: Azure CLI confirmed `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), the existing `centralus`
  `mxg-core` Container App, successful provisioning, and current revision
  `mxg-core--0000029`.
- 2026-08-17: Pre-deployment `/healthz` and `/readyz` returned HTTP 200 with the
  production database ready.
- 2026-08-17: Live RBAC confirms the `mxg-core` managed identity retains
  `Storage Blob Data Contributor` on the private `documents` container. No
  role, infrastructure, region, SKU, or scaling change is required.
- 2026-08-17: ACR build `cj1v` published
  `mxg-core:patent-b99241d-20260817-0125` with digest
  `sha256:e4ed8aa53594da0a9e90044a657eb908c0dc40e96c209a44d312457f7217437f`.
- 2026-08-17: Startup logs proved the additive migration ran successfully, then
  exposed pre-existing drift from the approved MiniLM cutover: the core lacked
  its embedding settings and manual-pack ID. The existing
  `mxg-manual-embeddings` credential was reused; no key was created, disclosed,
  or committed.
- 2026-08-17: Revision `mxg-core--patentb99241dv3` became healthy. `/healthz`
  and `/readyz` returned HTTP 200, readiness identified
  `manuals-authoritative-v2` and `mxg-cl350-starter-manuals-v1` as healthy, and
  unauthenticated project-workspace access returned HTTP 401.

## Manual Retrieval Stabilization Delta — 2026-08-11

### Approved scope

- Update the existing private `mxg-manual-embeddings` Container App from
  `services/manual-retrieval` without changing its ingress or credential.
- Build and promote the existing `mxg-core` Container App from `services/mcp`.
- Cut `mxg-core` over from `manuals-authoritative-v1` to the frozen
  `manuals-authoritative-v2` CL350 pack only after the private MiniLM service is
  ready.
- Preserve the current ready images and revisions for rollback.
- Do not modify `mxg-fleet`, `mxg-api`, database migrations, Search documents,
  storage assets, identity, RBAC, scaling, or Azure resource topology.
- Publish the paired static frontend directly to Git `main` only after Azure
  acceptance passes.

### Release gates

- The frozen manifest reconciles to 13,121 approved CL350 chunks across eight
  Search document IDs and five manuals.
- The v2 index declares a 384-dimensional `content_vector` compatible with
  `all-MiniLM-L6-v2`.
- JavaScript, Python, Rust workspace, locked release build, formatting, strict
  Clippy, schema fingerprint, and diff-integrity checks pass.
- The new embedding revision becomes ready before core settings are changed.
- The new core revision becomes latest-ready and returns HTTP 200 from
  `/healthz` and `/readyz`.
- `/adapterz` reports `manuals-authoritative-v2` and healthy manual retrieval.
- Unauthenticated application and fleet boundaries continue to fail closed.

### Rollback

- Restore the prior `mxg-core` image and its previous manual settings if the
  core readiness or adapter gate fails.
- Restore the prior `mxg-manual-embeddings` image if its readiness gate fails.
- Do not delete either failed revision, the v2 index, or the frozen corpus.

### Approval

Approved by the user on 2026-08-11 for Azure subscription
`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`, region `centralus`, resource group
`mxg-rg-50106`, followed by a direct Git push to `main` after Azure acceptance.

## Market-Readiness Delta — 2026-08-04

### Release scope

- Remount the reviewed MCP implementation in `services/mcp` without changing
  the existing migration history.
- Surface backend-derived capability readiness in Operations and the aircraft
  FAA panel.
- Require a whitelisted Entra identity for browser fleet requests while
  preserving the core-to-fleet lane through a shared Container Apps secret.
- Publish the paired frontend only after core and fleet acceptance passes.

### Validated artifacts

- Core: `mxg-core:market-ready-lf-20260804-083609`, digest
  `sha256:2a9536c07e17db66b8acae40c702c6bcbad18b71bcefb368ff83091d1398caaf`.
- Fleet: `mxg-fleet:market-ready-20260804-073721`, digest
  `sha256:326ee2b3d8f2d69184978311ab9550f2d8900cf644e8181797293bc2e248a1e0`.
- JavaScript suite: 84/84. Rust formatting, strict Clippy, workspace tests, and
  locked release build passed.
- Production is healthy on `mxg-core--0000024` and `mxg-fleet--0000007`.
  FAA reports `available` and the fleet internal-auth boundary is configured.

### Remaining gate

Run the existing `scripts/live-field-probe.mjs` against the promoted pair. It
must prove whitelisted fleet access, core-to-fleet lookup, FAA completion, and
the fail-closed unauthenticated fleet boundary. If it fails, retain the current
rollback revisions and inspect the failed revision logs before making changes.

## Closed-Beta Invitation Baseline Delta — 2026-07-28

This release preserves the existing real-time Settings invitation flow and adds
`@mxgenius.io` plus `rocky@mxgenius.io` as protected organization-scoped access
rules. Exact email entries continue to request an Entra B2B invitation through
Microsoft Graph before the access rule is committed. Domain rules authorize
matching, successfully authenticated identities and do not attempt to invite an
entire domain. Rocky's two protected identities receive the `procurement` role
needed for Parts receiving; an existing viewer membership is upgraded
idempotently when an administrator opens the access list.

### Deployment scope

- Build the existing `services/mcp` Container App image from the exact committed
  source archive.
- Promote only `mxg-core`; no database migration, frontend behavior change,
  secret, or new Azure resource is required.
- Preserve the current environment settings and system-assigned managed
  identity.
- Keep the current ready revision available for rollback.

### Validation proof

- 2026-07-28: frontend application suite passed, 80/80 tests.
- 2026-07-28: Rust workspace suite passed, 70/70 tests.
- 2026-07-28: `cargo fmt --all -- --check` and strict workspace clippy passed.
- 2026-07-28: locked optimized workspace release build passed.
- 2026-07-28: `git diff --check` passed.
- 2026-07-28: ACR provisioning state is `Succeeded`.
- 2026-07-28: `mxg-core` provisioning state is `Succeeded`, running status is
  `Running`, and revision `mxg-core--0000015` remains ready.
- 2026-07-28: production health and readiness endpoints returned HTTP 200.
- 2026-07-28: the `mxg-core` system identity
  `f690814f-1f55-4394-adaa-8120d5d433c7` was confirmed to hold Microsoft Graph
  application permission `User.Invite.All`.

### Rollback

Shift traffic to `mxg-core--0000015`. The new baseline rule is inserted
idempotently when Settings reads the organization access list; rollback does
not delete existing rules or guest identities.

## Rocky Parts Release Delta — 2026-07-28

This release closes the Rocky parts vertical slice on the existing application
plane. The user authorized top-to-bottom execution on 2026-07-28 and asked that
work stop only for a genuine credential blocker. Azure CLI authentication,
subscription selection, Container Apps access, ACR access, and GitHub access
have been verified. No credential blocker is present.

### Scope

- Deploy the current static frontend with passive landing-page session
  detection and the production Parts workspace.
- Deploy a new `mxg-core` image containing migration
  `0015_parts_inventory.sql` and the authenticated Parts API.
- Enable the backend with `MXGENIUS_PARTS_ENABLED=true` only in the promoted
  revision.
- Reuse the existing private `documents` Blob container and store Parts assets
  below `documents/parts/{organization}/{draft}/{asset}`.
- Create one Azure AI Document Intelligence account in `centralus`, using the
  available free `F0` SKU, for proposed OCR metadata.
- Grant the existing `mxg-core` system-managed identity:
  - `Storage Blob Data Contributor`, scoped only to the existing private
    `documents` container; and
  - `Cognitive Services User`, scoped only to the new Document Intelligence
    account.
- Configure only the non-secret Document Intelligence endpoint and Blob origin
  on `mxg-core`. Blob and OCR calls use managed identity; no new long-lived SAS
  or service key is introduced.

### Safety and data boundaries

- The migration is additive and tenant-scoped. The server applies SQLx
  migrations before accepting traffic.
- Catalog definitions remain separate from serialized stock units.
- Uploaded assets remain private and flow only through the authenticated
  application API.
- OCR output is a proposal. A human must accept, edit, or reject candidates
  before the signed receiving confirmation.
- FAA results preserve explicit source and identifier states and never imply
  airworthiness.
- QR labels contain only the stable public unit route, never Blob references,
  tokens, or sensitive metadata.
- Parts endpoints return `404 PARTS_NOT_ENABLED` unless the release flag is on.

### Validation gates

- Complete JavaScript and Rust suites pass.
- The non-interactive Rocky gate probe passes gates 0–7 locally.
- `cargo build --locked --release -p mxgenius-mcp`, formatting, clippy, and
  `git diff --check` pass against the exact release tree.
- The free Document Intelligence SKU remains available in `centralus`.
- ACR builds the exact backend source state and the new Container App revision
  becomes ready before traffic is accepted.
- Migration `0015` is present in the promoted image and the ready endpoint
  remains healthy after startup.
- Live unauthenticated probes prove the frontend, health, readiness, and
  fail-closed Parts boundary.
- Final whitelisted-user acceptance proves upload, OCR review, signed receive,
  unit detail, private asset retrieval, QR label, history, and the FAA
  no-result/error distinctions.

### Rollback

- Keep the current ready `mxg-core` revision available.
- Disable `MXGENIUS_PARTS_ENABLED` or shift traffic to the prior revision if a
  smoke gate fails.
- The additive tables may remain dormant; rollback does not delete inventory,
  Blob data, role assignments, or the OCR account.
- Revert the static frontend to the preceding GitHub Pages commit if its paired
  deployment gate fails.

### Local proof

- 2026-07-28: complete frontend/application suite passed (80 tests).
- 2026-07-28: complete Rust workspace suite passed (69 tests).
- 2026-07-28: Rocky local gate probe passed all 9 checks through gate 7.
- 2026-07-28: `FormRecognizer` F0 and S0 SKUs were confirmed available in
  `centralus`.
- 2026-07-28: the existing `documents` container was confirmed private and the
  current core identity was confirmed to have no pre-existing storage role.
- 2026-07-28: locked formatting, strict clippy, complete tests, and the optimized
  `mxgenius-mcp` release build passed against the exact release tree.
- 2026-07-28: `git diff --check` passed and the signed-in Azure principal was
  confirmed as subscription Owner with role-assignment authority.
- 2026-07-28: ACR run `cj1e` built commit `66114b2` as
  `mxg-core:rocky-parts-66114b2` with digest
  `sha256:2a7b59e32094ece0b9015eb11ccb7bc3e58a7f47b08c8a21b1f4946dce503da8`.
- 2026-07-28: Container App revision `mxg-core--0000015` became the latest
  ready revision with the Parts feature flag, private Blob origin, and
  Document Intelligence endpoint configured.
- 2026-07-28: production `/healthz` and `/readyz` returned `200`; readiness
  reported the database ready in production mode after the startup migration
  step.
- 2026-07-28: unauthenticated Parts access failed closed with `401`, the
  deployed dashboard exposed the Parts bundle, and GitHub Pages completed
  successfully at commit `66114b2`.
- 2026-07-28: Rocky's Entra B2B invitation was sent to `hagy2392@gmail.com` and
  is pending acceptance. The final authenticated receiving/OCR/QR/FAA pass
  remains the only acceptance gate.

## Field-Test Release Delta — 2026-07-27

Release baseline: `9cbd9d4`; Realtime companion release is the next local commit.

This validation pass is limited to updating the existing `mxg-core` Container
App and the existing static frontend. It adds:

- a server-enforced GPT-5.6 Luna/Terra/Sol and GPT-5.5 selector for text and
  structured responses, defaulting to Luna;
- the existing strict structured-output and read-only MCP function
  orchestration across all selectable text models;
- persistence of completed Realtime exchanges into tenant/user-scoped chat
  threads; and
- a single authoritative Realtime companion turn that renders structured chat,
  citations, manual images, tables, and UI actions while returning only a
  concise summary to the voice model;
- bounded awareness of the active case, visible Market Intelligence, digital
  twin selection/highlight, and prior displayed response for conversational
  references; and
- frontend cache-version updates for the new selector, persistence client, and
  Realtime companion.

No database migration, Azure resource, identity, secret, ingress, search index,
or Realtime model change is included in this release.

### Field-Test Validation Proof — 2026-07-27

- JavaScript syntax checks passed for `app.js`, `application-client.js`, and
  `case-workspace.js`.
- The complete frontend suite passed: 55/55 tests.
- Rust formatting and strict clippy checks passed.
- The complete Rust workspace suite passed: 66/66 tests.
- `cargo build --locked --release -p mxgenius-mcp` completed successfully.
- `git diff --check` passed.
- No migration differs from the deployed `0608040` baseline.
- Live public health and readiness checks passed against the current core.
- Live Gulfstream G650 Market Intelligence probes returned operation-cost and
  performance data; the unavailable trends subscription is now represented as
  a visible partial result instead of being silently swallowed.
- Live fleet lookup returned 4,437 aircraft through the existing compatibility
  source.
- Static frontend and Container App promotion remain a paired deployment gate.

The existing `mxg-core` revision must retain or receive these non-secret fleet
proxy adapter settings so Active Case aircraft resolution uses the already-live
server-side compatibility source:

- `MXGENIUS_JETNET_BASE_URL=https://mxg-fleet.kindbush-8fee3a17.centralus.azurecontainerapps.io/api/`
- `MXGENIUS_JETNET_API_TOKEN=LIVE_TOKEN`
- `MXGENIUS_JETNET_BEARER_TOKEN=proxy`

### Field-Test Validation Gates

- The exact `services/mcp` archive expands with `Dockerfile`, locked Rust
  dependencies, migrations, fixtures, shared crate, and server crate at its
  root.
- `cargo build --locked --release`, formatting, clippy, and all Rust tests pass.
- JavaScript syntax checks and the complete frontend test suite pass.
- No deployed migration file changed relative to commit `0608040`.
- The text-model allowlist contains only models supporting Responses, function
  calling, structured output, image input, and the configured reasoning level.
- Text and Realtime exchanges both create or continue the same authenticated
  thread and become available to later conversational memory.
- Market Intelligence retains live compatibility-source routing, bounded cache
  behavior, and explicit loading, empty, and provider-error states.
- Active Case selection binds text chat, Realtime persistence, capability
  context, and optimistic case versioning to the same canonical case.
- The static frontend commit and Container App image are promoted together.
- Existing revision `mxg-core--0000009` remains available for rollback until
  field-test smoke checks pass.

## Objective

Mount the prebuilt 384-dimensional MiniLM maintenance-manual corpus behind the
existing typed MCP manual adapter without re-chunking or re-embedding its
1,060,418 records. Preserve the current GPT structured response and collapsed
33-reference frontend contract.

## Requirements

- Workspace mode: MODIFY an existing Azure production-pilot application.
- Classification: small, cost-conscious production pilot.
- Keep the current `mxg-core`, Search v1 index, GPT schema, and frontend live
  throughout the mount.
- Reuse the existing Search service, Storage account, Container Apps
  environment, registry, and Log Analytics workspace.
- Do not expose the manual corpus or embedding endpoint to browser code.
- Every promoted record must retain aircraft, manual, ATA, chapter, page,
  content hash, source locator, retrieval score, and page-linked image lineage.
- The reference appendix remains collapsed and returns up to 33 real matches.
  Match percentages represent retrieval similarity, never diagnostic
  probability.

## Azure Context

- Subscription: `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`).
- Tenant: `Hermetic Labs` (`bb1b06c5-1b43-4295-8c01-d7ffd3a5b366`).
- Region: `centralus`.
- Resource group: `mxg-rg-50106`.
- Existing Container Apps environment: `mxg-cae-50106`.
- Existing registry: `mxgacr50106.azurecr.io`.

## Components

| Component | Type | Technology | Path |
|---|---|---|---|
| Public application | Static frontend | HTML/CSS/JavaScript | repository root |
| Application/MCP core | API service | Rust/Axum | `services/mcp/server` |
| MiniLM embeddings | Internal API service | Python/FastAPI/ONNX | `services/manual-retrieval` |
| Corpus ingestion | Operator utility | Python/Azure REST | `services/mcp/scripts/ingest_minilm_manual_corpus.py` |

No Copilot SDK or other specialized hosting marker is present.

## Existing Data and Capacity

- Source corpus: 1,060,418 chunks, 106,967 shards, 91 aircraft families.
- Source vectors: `all-MiniLM-L6-v2`, 384 dimensions.
- Search service: Basic, one partition, created 2026-06-29.
- Search storage quota: 15 GiB; current use approximately 0.70 GiB.
- Search vector quota: 5 GiB; current use approximately 0.18 GiB.
- New vector raw size: approximately 1.52 GiB before HNSW overhead.
- Target index: `manuals-authoritative-v2`.
- Existing `manuals-authoritative-v1` remains unchanged as rollback.

## Architecture

```text
mxg-core
  -> internal authenticated MiniLM /v1/embeddings
  -> manuals-authoritative-v2 vector query
  -> typed Evidence records
  -> existing GPT structured response
  -> existing collapsed 33-reference appendix
```

The embedding service contains no manuals and performs no retrieval. It only
maps bounded query text into the same vector space already stored in v2.

## Deployment Recipe

Use the existing Azure CLI and Container Apps path.

Rationale:

- The resource group, environment, registry, Search service, and deployment
  conventions already exist.
- Only one small internal API is added.
- No new platform, framework migration, database, or public frontend deployment
  is required.

## Resources and Changes

- Create one Container App: `mxg-manual-embeddings`.
- Create one versioned Search index: `manuals-authoritative-v2`.
- Upload hashed manual figures under
  `documents/manual-assets/legacy-rag/v2/`.
- Upload the immutable compressed corpus artifact under
  `documents/manual-corpus-v2/`.
- Add Container App secrets for the embedding-service shared credential.
- After validation, update only these `mxg-core` settings:
  - `AZURE_SEARCH_INDEX`
  - `MXGENIUS_EMBEDDINGS_ENDPOINT`
  - `MXGENIUS_EMBEDDINGS_MODEL`
  - `MXGENIUS_EMBEDDINGS_AUTH`
  - `MXGENIUS_EMBEDDINGS_API_KEY`

No existing resource is deleted, replaced, or scaled up.

## Security

- The embedding endpoint requires server-side authentication.
- No provider credential or manual content enters Git or GitHub Pages.
- Manual images remain private and flow through the existing controlled proxy.
- The new Container App is restricted to the application service boundary where
  supported by the existing environment.
- Production continues to fail closed when retrieval or embedding is
  unavailable.
- Microsoft Entra user sign-in remains a separate following workstream.

## Policy and Provisioning

- No blocking subscription policy assignments were returned.
- Planned new resources: one CPU-only Container App and one Search index.
- Existing Basic Search capacity is sufficient for the 384-dimensional corpus;
  the full ingestion must stop automatically on quota or indexing failures.
- No quota increase or expensive Search tier change is planned.

## Deployment Stages

1. Validate the OpenAI-compatible MiniLM API locally.
2. Create v2 and upload a two-record CL350 image-bearing shard.
3. Prove MiniLM query-vector compatibility against v2.
4. Validate and deploy `mxg-manual-embeddings`.
5. Ingest one complete aircraft family and run known-query comparisons.
6. Upload the immutable corpus archive and hashed image assets.
7. Ingest the full corpus with idempotent merge-or-upload batches.
8. Verify counts, quota, latency, source hashes, images, and degraded behavior.
9. Update the five `mxg-core` settings and deploy a new revision.
10. Smoke-test the complete GPT → 33 references → images path.

## Validation Gates

- Python compilation and embedding-service unit tests pass.
- Docker image builds and `/healthz` succeeds.
- The embedding endpoint returns exactly 384 values and rejects missing auth.
- The pilot shard is returned by a real vector query in expected rank order.
- An aircraft-family pilot returns 33 references with valid scores and images.
- Full ingestion document and vector metrics remain below Azure quotas.
- GPT produces the strict schema using only supplied `M-##` citations.
- `/adapterz` reports actual manual-adapter health instead of its current
  hard-coded state.
- Existing v1 retrieval remains available until the final cutover succeeds.

### Validation steps

- `python -m py_compile` for the embedding and ingestion utilities.
- Python unit tests for authentication and OpenAI-compatible response shape.
- `docker build` for the embedding service.
- Two-record Azure Search v2 pilot query using MiniLM vectors.
- Container App health, readiness, and authenticated embedding smoke tests.
- Search document/vector counts, quota, and 33-reference GPT smoke test before
  any production setting change.

## Rollback

Restore the five previous `mxg-core` environment settings and activate the
previous Container App revision. The v1 index and frontend are never modified
by corpus ingestion. The new embedding service and v2 index may remain dormant;
deletion is not part of this plan.

## Functional Verification

- Local embedding-service contract: passed.
- Two-record CL350 ingestion: passed.
- Real MiniLM vector query against v2: passed.
- Full service/container/corpus/GPT verification: corpus ingestion complete for CL350; service/core cutover pending.

## Validation Proof

- 2026-07-23: `python -m py_compile` passed for the embedding and ingestion
  utilities.
- 2026-07-23: Python embedding-service unit tests passed (2/2).
- 2026-07-23: ACR remote build succeeded for `mxgenius/manual-embeddings:pilot`.
- 2026-07-23: `manuals-authoritative-v2` CL350 pilot ingestion completed: 17,329 chunks uploaded with linked asset uploads; Search reported 16,600 documents while indexing was still converging.
- 2026-07-23: Container App `mxg-manual-embeddings` provisioned successfully with internal ingress and one active replica.
- 2026-07-23: Rust formatting and workspace tests passed (54 tests).
- 2026-07-23: Frontend structure/client/realtime tests passed (37 tests).
- 2026-07-23: The CL350 two-record v2 pilot was uploaded and queried using the
  real MiniLM model; both records ranked correctly and the second carried two
  image assets.
- 2026-07-23: ACR remote build `cjs` succeeded with digest
  `sha256:a29296f2beb3a7ed8ea93252bec0afdd40a54170cf98880b290804444d62a4f7`.
- 2026-07-23: Local Docker build was unavailable because Docker is not installed;
  Azure Container Registry supplied the authoritative image build proof.

## Execution Checklist

- [x] Audit repository, live GPT path, corpus format, and Azure capacity.
- [x] Implement and unit-test the MiniLM embedding API.
- [x] Implement the dry-run-first v2 ingestion utility.
- [x] Prove two records and two images in v2.
- [x] Prove real 384-dimensional query compatibility.
- [x] Validate the deployment artifacts.
- [x] Provision the embedding service Container App (secret/core cutover pending).
- [ ] Run the complete-aircraft pilot.
- [ ] Ingest and verify the full corpus.
- [ ] Cut over `mxg-core` and run end-to-end acceptance.

## Approval

Approved by the user on 2026-07-23 after review of the subscription, region,
resource scope, rollback, and validation plan.
