-- Signed confirmation grants are short-lived, single-use server records.
-- The JWT carries the same binding; both the signature and this row must
-- validate before the typed tool seam accepts a mutation.

CREATE TABLE confirmation_grants (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_name           text NOT NULL,
    object_id           text NOT NULL,
    object_version      bigint,
    qualified_approval  boolean NOT NULL DEFAULT false,
    issued_at           timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    consumed_at         timestamptz,
    CHECK (expires_at > issued_at)
);

CREATE INDEX confirmation_grants_actor_idx
    ON confirmation_grants (organization_id, user_id, expires_at);
CREATE INDEX confirmation_grants_unconsumed_idx
    ON confirmation_grants (expires_at)
    WHERE consumed_at IS NULL;
