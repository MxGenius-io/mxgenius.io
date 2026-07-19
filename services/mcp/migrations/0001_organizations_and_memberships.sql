-- 0001 — Organizations, users, memberships.
-- These identity rows are application records, not credentials. OIDC remains
-- the authentication authority; membership rows remain the authorization and
-- tenant-selection authority.

CREATE TABLE IF NOT EXISTS organizations (
    id              uuid PRIMARY KEY,
    name            text NOT NULL,
    identity_tenant_id text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id              uuid PRIMARY KEY,
    external_issuer text,
    external_subject text,
    display_name    text,
    email           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS external_issuer text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_subject text;

CREATE UNIQUE INDEX IF NOT EXISTS users_external_identity_idx
    ON users (external_issuer, external_subject)
    WHERE external_issuer IS NOT NULL AND external_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_memberships (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            text NOT NULL CHECK (role IN (
        'viewer','technician','planner','controller','procurement','quality',
        'manager','administrator'
    )),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_memberships_org_idx
    ON organization_memberships (organization_id);
CREATE INDEX IF NOT EXISTS organization_memberships_user_idx
    ON organization_memberships (user_id);
