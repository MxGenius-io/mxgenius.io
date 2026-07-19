# Migrations

One ordered, additive migration sequence. The application-plane model reconciles
this against the existing baseline (`organizations`, `users`, `conversations`,
`messages`, `documents`, `document_chunks`, `chunk_embeddings`, `answer_audits`)
when mounting the package into `mxgenius-cloud-poc`.

Stub: each migration is a thin placeholder with the canonical table shape and
no constraints beyond the basics. Flesh out: row-level security, indexes,
triggers for `updated_at`, and reconciliation of the baseline tables.

| File | Purpose |
| --- | --- |
| `0001_organizations_and_memberships.sql` | organization memberships |
| `0002_aircraft_canonical.sql`             | canonical aircraft |
| `0003_maintenance_cases.sql`              | case aggregate + discrepancies |
| `0004_maintenance_events_and_observations.sql` | events, observations, assignments |
| `0005_components_and_documents.sql`       | components, technical documents, revisions |
| `0006_compliance.sql`                     | regulatory requirements + case links |
| `0007_parts.sql`                          | parts, requirements, suppliers, certificates |
| `0008_mro_and_scheduling.sql`             | facilities, capabilities, schedules, recommendations |
| `0009_evidence_approvals_audit.sql`       | evidence, approvals, audit, capability traces, tool versions |
