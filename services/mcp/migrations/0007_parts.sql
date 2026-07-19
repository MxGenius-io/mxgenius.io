-- 0007 — Parts, requirements, suppliers, source options, certificates.

CREATE TABLE IF NOT EXISTS parts (
    id              uuid PRIMARY KEY,
    part_number     text NOT NULL,
    description     text NOT NULL,
    manufacturer    text,
    canonical       boolean NOT NULL DEFAULT true,
    UNIQUE (part_number, manufacturer)
);

CREATE TABLE IF NOT EXISTS part_requirements (
    id              uuid PRIMARY KEY,
    case_id         uuid NOT NULL REFERENCES maintenance_cases(case_id) ON DELETE CASCADE,
    part_id         uuid NOT NULL REFERENCES parts(id),
    quantity        integer NOT NULL CHECK (quantity > 0),
    required_by     timestamptz,
    acceptable_conditions jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS part_requirements_case_idx
    ON part_requirements (case_id);

CREATE TABLE IF NOT EXISTS suppliers (
    id              uuid PRIMARY KEY,
    name            text NOT NULL,
    source_reference text
);

CREATE TABLE IF NOT EXISTS part_source_options (
    id              uuid PRIMARY KEY,
    part_requirement_id uuid NOT NULL REFERENCES part_requirements(id) ON DELETE CASCADE,
    supplier_id     uuid REFERENCES suppliers(id),
    price           numeric,
    eta             timestamptz,
    condition       text,
    certificate_state text,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS part_source_options_req_idx
    ON part_source_options (part_requirement_id);

CREATE TABLE IF NOT EXISTS certificate_records (
    id              uuid PRIMARY KEY,
    case_id         uuid NOT NULL REFERENCES maintenance_cases(case_id) ON DELETE CASCADE,
    part_id         uuid REFERENCES parts(id),
    certificate_type text NOT NULL,
    document_reference text NOT NULL,
    validated       boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS certificate_records_case_idx
    ON certificate_records (case_id);
