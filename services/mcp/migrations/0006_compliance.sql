-- 0006 — Regulatory items and case links.

CREATE TABLE IF NOT EXISTS regulatory_requirements (
    id              uuid PRIMARY KEY,
    source_reference text NOT NULL,
    document_id     uuid REFERENCES technical_documents(id),
    summary         text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS regulatory_requirements_source_idx
    ON regulatory_requirements (source_reference);

CREATE TABLE IF NOT EXISTS case_regulatory_links (
    case_id         uuid NOT NULL REFERENCES maintenance_cases(case_id) ON DELETE CASCADE,
    requirement_id  uuid NOT NULL REFERENCES regulatory_requirements(id) ON DELETE CASCADE,
    PRIMARY KEY (case_id, requirement_id)
);

CREATE INDEX IF NOT EXISTS case_regulatory_links_req_idx
    ON case_regulatory_links (requirement_id);
