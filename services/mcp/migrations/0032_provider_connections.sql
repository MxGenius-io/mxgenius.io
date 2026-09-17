-- Tenant-owned external-provider connections.
--
-- Both the provider identity and credential are AES-256-GCM ciphertext written
-- by the application. Browser-facing reads expose only identity_hint and state.

CREATE TABLE IF NOT EXISTS organization_provider_connections (
    organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider             text NOT NULL CHECK (provider IN ('jetnet')),
    identity_hint        text NOT NULL CHECK (char_length(identity_hint) BETWEEN 1 AND 254),
    identity_ciphertext  bytea NOT NULL,
    credential_ciphertext bytea NOT NULL,
    status               text NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'degraded', 'disconnected')),
    tested_at            timestamptz,
    created_by           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS organization_provider_connections_state_idx
    ON organization_provider_connections (organization_id, status, updated_at DESC);
