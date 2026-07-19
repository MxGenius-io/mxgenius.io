-- 0008 — MRO facilities, capabilities, schedule options, recommendations.

CREATE TABLE IF NOT EXISTS mro_facilities (
    id              uuid PRIMARY KEY,
    name            text NOT NULL,
    source_reference text,
    icao            text,
    city            text,
    country         text
);

CREATE TABLE IF NOT EXISTS facility_capabilities (
    id              uuid PRIMARY KEY,
    facility_id     uuid NOT NULL REFERENCES mro_facilities(id) ON DELETE CASCADE,
    task_code       text NOT NULL,
    rating          text,
    evidence_reference text,
    UNIQUE (facility_id, task_code)
);

CREATE TABLE IF NOT EXISTS schedule_options (
    id              uuid PRIMARY KEY,
    case_id         uuid NOT NULL REFERENCES maintenance_cases(case_id) ON DELETE CASCADE,
    facility_id     uuid REFERENCES mro_facilities(id),
    start_at        timestamptz NOT NULL,
    end_at          timestamptz NOT NULL,
    notes           text,
    CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS schedule_options_case_idx
    ON schedule_options (case_id);

CREATE TABLE IF NOT EXISTS recommendations (
    id              uuid PRIMARY KEY,
    case_id         uuid NOT NULL REFERENCES maintenance_cases(case_id) ON DELETE CASCADE,
    body            jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recommendations_case_idx
    ON recommendations (case_id);
