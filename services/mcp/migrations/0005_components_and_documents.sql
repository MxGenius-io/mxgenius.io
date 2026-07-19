-- 0005 — Components, technical documents, document revisions.

CREATE TABLE IF NOT EXISTS components (
    id              uuid PRIMARY KEY,
    aircraft_id     text NOT NULL,
    ata             text,
    name            text NOT NULL,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS components_aircraft_idx
    ON components (aircraft_id);

CREATE TABLE IF NOT EXISTS technical_documents (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    title           text NOT NULL,
    doc_type        text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE technical_documents
    ADD CONSTRAINT technical_documents_org_id_unique
    UNIQUE (organization_id, id);

CREATE INDEX IF NOT EXISTS technical_documents_org_idx
    ON technical_documents (organization_id);

CREATE TABLE IF NOT EXISTS document_revisions (
    id              uuid PRIMARY KEY,
    document_id     uuid NOT NULL REFERENCES technical_documents(id) ON DELETE CASCADE,
    revision        text NOT NULL,
    effective_date  date,
    supersedes      uuid REFERENCES document_revisions(id),
    uploaded_by     uuid NOT NULL,
    sha256          text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, revision)
);

CREATE INDEX IF NOT EXISTS document_revisions_doc_idx
    ON document_revisions (document_id);
