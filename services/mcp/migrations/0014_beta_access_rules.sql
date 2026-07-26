-- 0014 — Server-owned closed-beta access rules.
-- Entra still owns authentication and guest invitations. These rules decide
-- which verified identities may be enrolled into an MXGenius organization.

CREATE TABLE IF NOT EXISTS beta_access_rules (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule            text NOT NULL,
    rule_type       text NOT NULL CHECK (rule_type IN ('email', 'domain')),
    member_role     text NOT NULL DEFAULT 'viewer'
        CHECK (member_role IN (
            'viewer', 'technician', 'planner', 'controller', 'procurement',
            'quality', 'manager', 'administrator'
        )),
    created_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (
        rule = lower(rule)
        AND char_length(rule) BETWEEN 3 AND 254
        AND (
            (rule_type = 'email' AND rule ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
            OR
            (rule_type = 'domain' AND rule ~ '^@[^[:space:]@]+\.[^[:space:]@]+$')
        )
    ),
    UNIQUE (organization_id, rule)
);

CREATE INDEX IF NOT EXISTS beta_access_rules_lookup_idx
    ON beta_access_rules (rule_type, rule, organization_id);
