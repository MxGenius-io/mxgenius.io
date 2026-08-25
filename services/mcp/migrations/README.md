# Migrations

One ordered, additive migration sequence. The application-plane model reconciles
this against the existing baseline (`organizations`, `users`, `conversations`,
`messages`, `documents`, `document_chunks`, `chunk_embeddings`, `answer_audits`)
when mounting the package into `mxgenius-cloud-poc`.

The migrations define tenant-safe foreign keys, validation constraints, and
query indexes. Isolated-Postgres migration and cross-tenant verification remain
release gates.

| File | Purpose |
| --- | --- |
| `0001_organizations_and_memberships.sql` | organization memberships |
| `0002_aircraft_canonical.sql`             | canonical aircraft |
| `0003_maintenance_cases.sql`              | case aggregate + discrepancies |
| `0004_maintenance_events_and_observations.sql` | events, observations, assignments |
| `0005_components_and_documents.sql`       | components, technical documents, revisions |
| `0006_compliance.sql`                     | regulatory requirements + case links |
| `0007_parts.sql`                          | parts, requirements, suppliers, certificates |
| `0008_mro_and_scheduling.sql`             | schedules and recommendations; its facility tables are retired and no longer read or written |
| `0009_evidence_approvals_audit.sql`       | evidence, approvals, audit, capability traces, tool versions |
| `0010_confirmation_grants.sql`            | signed single-use confirmation grants |
| `0011_digital_twin_markers.sql`           | case-bound digital-twin markers |
| `0012_user_state_and_conversations.sql`   | chat threads/messages, user settings, and profile images |
| `0014_beta_access_rules.sql`              | server-owned closed-beta email/domain access rules |
| `0013_digital_twin_models.sql`            | uploaded GLB models, mesh manifests, and model/user highlight state |
| `0015_parts_inventory.sql`                | tenant-owned stock units, receiving, assets, extraction review, ledger, and FAA provenance |
| `0016_mro_tenant_scope.sql`               | retired; scoped the removed facility directory. Retained so the applied-migration ledger stays intact |
| `0017_project_workspaces.sql`              | shared project documents, revisions, and private blob-backed reference assets |
| `0018_feedback.sql`                       | in-app bug and feature reports with screenshots and admin triage |
| `0019_part_procurement.sql`               | part request lifecycle head, procurement/repair orders, and the append-only request change journal |
| `0020_part_traceability.sql`              | shipment legs, atomic install/removal events, and a widened paperwork vocabulary including ATA 106 and TSO |
| `0021_rotables_and_cores.sql`            | serialized rotable register, core exchange obligations, and warranty claims |
| `0022_cannibalizations.sql`              | gated cannibalization records correlating a donor removal with a receiver install |
| `0023_part_imports.sql`                  | reversible bulk-import batches with an append-only change journal, plus a soft delete on parts |
| `0024_part_reporting_indexes.sql`        | date-ranged timeline indexes over the parts journals, orders, and shipments so historical reports keyset-scan instead of sequential-scan |
