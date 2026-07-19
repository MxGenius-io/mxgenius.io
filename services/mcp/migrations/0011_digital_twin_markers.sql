-- 0011 — Case-scoped digital-twin markers. Geometry remains a presentation
-- mapping; only canonical component/zone identifiers enter operational state.

ALTER TABLE observations
    ADD CONSTRAINT observations_org_id_unique UNIQUE (organization_id, id);

CREATE TABLE IF NOT EXISTS digital_twin_markers (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id         uuid NOT NULL,
    component_id    text,
    zone_id         text,
    severity        text NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
    observation_id  uuid,
    created_by      uuid NOT NULL REFERENCES users(id),
    created_at      timestamptz NOT NULL,
    CHECK (component_id IS NOT NULL OR zone_id IS NOT NULL),
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, observation_id)
        REFERENCES observations(organization_id, id)
);

CREATE INDEX IF NOT EXISTS digital_twin_markers_case_idx
    ON digital_twin_markers (organization_id, case_id, created_at);
