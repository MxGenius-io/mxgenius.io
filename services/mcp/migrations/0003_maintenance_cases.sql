-- 0003 — MaintenanceCase aggregate root + discrepancies.

CREATE TABLE IF NOT EXISTS maintenance_cases (
    case_id              uuid PRIMARY KEY,
    organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    aircraft_id          text NOT NULL,
    status               text NOT NULL CHECK (status IN (
        'draft','open','triage','diagnosing','planning','awaiting_parts',
        'scheduled','in_work','awaiting_inspection','awaiting_approval',
        'closed','cancelled'
    )),
    priority             text NOT NULL CHECK (priority IN (
        'routine','deferred','urgent','aog'
    )),
    opened_at            timestamptz NOT NULL,
    updated_at           timestamptz NOT NULL DEFAULT now(),
    location             jsonb,
    raw_discrepancy      text NOT NULL,
    normalized_discrepancy jsonb,
    assigned_user_ids    uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
    evidence_ids         uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
    approval_state       text NOT NULL DEFAULT 'pending'
        CHECK (approval_state IN ('pending','approved','rejected','not_required')),
    version              bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);

ALTER TABLE maintenance_cases
    ADD CONSTRAINT maintenance_cases_org_case_unique
    UNIQUE (organization_id, case_id);

CREATE INDEX IF NOT EXISTS maintenance_cases_org_idx
    ON maintenance_cases (organization_id);
CREATE INDEX IF NOT EXISTS maintenance_cases_org_status_idx
    ON maintenance_cases (organization_id, status);
CREATE INDEX IF NOT EXISTS maintenance_cases_org_aircraft_idx
    ON maintenance_cases (organization_id, aircraft_id);

CREATE TABLE IF NOT EXISTS discrepancies (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    case_id         uuid NOT NULL,
    normalized_summary text,
    raw             text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS discrepancies_case_idx
    ON discrepancies (case_id);
