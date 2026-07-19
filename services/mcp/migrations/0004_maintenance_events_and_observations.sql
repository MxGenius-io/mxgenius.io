-- 0004 — Maintenance events, observations, case assignments.
-- Events and observations are immutable (no UPDATE allowed via policy).

CREATE TABLE IF NOT EXISTS maintenance_events (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    case_id         uuid NOT NULL,
    from_status     text,
    to_status       text NOT NULL,
    actor_user_id   uuid NOT NULL REFERENCES users(id),
    reason          text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS maintenance_events_case_idx
    ON maintenance_events (case_id, created_at);

CREATE TABLE IF NOT EXISTS observations (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    case_id         uuid NOT NULL,
    note            text NOT NULL,
    component_id    text,
    author_user_id  uuid NOT NULL REFERENCES users(id),
    media_refs      jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS observations_case_idx
    ON observations (case_id, created_at);

CREATE TABLE IF NOT EXISTS case_assignments (
    organization_id uuid NOT NULL,
    case_id         uuid NOT NULL,
    user_id         uuid NOT NULL REFERENCES users(id),
    assigned_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, case_id, user_id),
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS case_assignments_user_idx
    ON case_assignments (user_id);
