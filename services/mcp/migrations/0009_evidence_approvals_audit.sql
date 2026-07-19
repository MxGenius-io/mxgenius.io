-- 0009 — Evidence, evidence links, approvals, audit events, capability
-- traces, tool versions. Evidence is immutable; corrections supersede
-- via `supersedes` rather than mutating rows.

CREATE TABLE IF NOT EXISTS evidence (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source_type         text NOT NULL,
    source_reference    text NOT NULL,
    kind                text NOT NULL,
    title               text NOT NULL,
    excerpt             text,
    retrieved_at        timestamptz NOT NULL,
    effective_at        timestamptz,
    revision            text,
    license_scope       text,
    content_hash        text NOT NULL,
    content             text NOT NULL,
    supersedes          uuid,
    created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE evidence
    ADD CONSTRAINT evidence_org_id_unique UNIQUE (organization_id, id);

ALTER TABLE evidence
    ADD CONSTRAINT evidence_org_supersedes_fk
    FOREIGN KEY (organization_id, supersedes)
    REFERENCES evidence(organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_org_content_hash_idx
    ON evidence (organization_id, content_hash);
CREATE INDEX IF NOT EXISTS evidence_source_ref_idx
    ON evidence (source_type, source_reference);

CREATE TABLE IF NOT EXISTS evidence_links (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    evidence_id     uuid NOT NULL,
    case_id         uuid NOT NULL,
    aircraft_id     text,
    document_id     uuid,
    PRIMARY KEY (organization_id, evidence_id, case_id),
    FOREIGN KEY (organization_id, evidence_id)
        REFERENCES evidence(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, document_id)
        REFERENCES technical_documents(organization_id, id)
);

CREATE INDEX IF NOT EXISTS evidence_links_case_idx
    ON evidence_links (case_id);

CREATE TABLE IF NOT EXISTS approvals (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id         uuid NOT NULL,
    action          text NOT NULL,
    required_role   text NOT NULL,
    granted_by      uuid REFERENCES users(id),
    granted_at      timestamptz,
    decision        text CHECK (decision IS NULL OR decision IN ('approved','rejected')),
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS approvals_case_idx
    ON approvals (case_id);

CREATE TABLE IF NOT EXISTS audit_events (
    id              uuid PRIMARY KEY,
    case_id         uuid,
    actor_user_id   uuid NOT NULL REFERENCES users(id),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    action          text NOT NULL,
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    correlation_id  uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS audit_events_case_idx
    ON audit_events (case_id, created_at);
CREATE INDEX IF NOT EXISTS audit_events_org_idx
    ON audit_events (organization_id, created_at);

CREATE TABLE IF NOT EXISTS capability_traces (
    id                  uuid PRIMARY KEY,
    trace_id            uuid NOT NULL,
    request_id          uuid NOT NULL,
    correlation_id      uuid NOT NULL,
    tool_name           text NOT NULL,
    tool_version        text NOT NULL,
    input_schema_version text NOT NULL,
    output_schema_version text NOT NULL,
    domain_schema_version text NOT NULL,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             uuid NOT NULL REFERENCES users(id),
    role                text NOT NULL,
    case_id             uuid,
    started_at          timestamptz NOT NULL,
    completed_at        timestamptz NOT NULL,
    latency_ms          bigint NOT NULL,
    status              text NOT NULL,
    evidence_ids        uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
    confidence_basis    text,
    approval_required   boolean NOT NULL DEFAULT false,
    approval_result     text,
    error_codes         text[] NOT NULL DEFAULT ARRAY[]::text[],
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS capability_traces_trace_idx
    ON capability_traces (trace_id);
CREATE INDEX IF NOT EXISTS capability_traces_org_idx
    ON capability_traces (organization_id, started_at);
CREATE INDEX IF NOT EXISTS capability_traces_tool_idx
    ON capability_traces (tool_name, started_at);

CREATE TABLE IF NOT EXISTS tool_versions (
    name                text PRIMARY KEY,
    tool_version        text NOT NULL,
    input_schema_version text NOT NULL,
    output_schema_version text NOT NULL,
    domain_schema_version text NOT NULL,
    updated_at          timestamptz NOT NULL DEFAULT now()
);
