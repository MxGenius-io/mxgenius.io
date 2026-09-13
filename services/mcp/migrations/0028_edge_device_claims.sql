-- Device-originated, short-code enrollment.
--
-- The Pi receives the credential over its own TLS connection and only shows a
-- seven-digit claim code. The authenticated browser approves the claim but
-- never receives the device credential.

CREATE TABLE IF NOT EXISTS edge_device_claims (
    id                uuid PRIMARY KEY,
    hardware_id       text NOT NULL CHECK (char_length(hardware_id) BETWEEN 1 AND 180),
    claim_code_hash   text NOT NULL CHECK (claim_code_hash ~ '^sha256:[0-9a-f]{64}$'),
    credential_hash   text NOT NULL CHECK (credential_hash ~ '^sha256:[0-9a-f]{64}$'),
    expires_at        timestamptz NOT NULL,
    organization_id   uuid REFERENCES organizations(id) ON DELETE CASCADE,
    device_id         uuid,
    display_name      text CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 120),
    approved_by       uuid REFERENCES users(id) ON DELETE RESTRICT,
    approved_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (claim_code_hash),
    UNIQUE (credential_hash),
    FOREIGN KEY (organization_id, device_id)
        REFERENCES edge_devices(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT edge_device_claim_approval_complete CHECK (
        (approved_at IS NULL AND organization_id IS NULL AND device_id IS NULL
            AND display_name IS NULL AND approved_by IS NULL)
        OR
        (approved_at IS NOT NULL AND organization_id IS NOT NULL AND device_id IS NOT NULL
            AND display_name IS NOT NULL AND approved_by IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS edge_device_claims_pending_idx
    ON edge_device_claims (hardware_id, expires_at DESC)
    WHERE approved_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS edge_devices_credential_hash_unique_idx
    ON edge_devices (credential_hash)
    WHERE credential_hash IS NOT NULL;
