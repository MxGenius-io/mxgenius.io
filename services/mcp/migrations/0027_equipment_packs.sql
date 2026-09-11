-- Equipment Packs and outbound edge-device desired state.
--
-- Package bytes live in the private documents Blob container. PostgreSQL owns
-- the immutable manifest, tenant boundary, upload ledger, assignment
-- generation, and device acknowledgement history. A WebSocket notification is
-- only a prompt to reconcile this durable state.

CREATE TABLE IF NOT EXISTS equipment_packs (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    equipment_family  text NOT NULL CHECK (char_length(btrim(equipment_family)) BETWEEN 1 AND 120),
    description       text CHECK (description IS NULL OR char_length(description) <= 1000),
    archived          boolean NOT NULL DEFAULT false,
    created_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS equipment_packs_org_updated_idx
    ON equipment_packs (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS equipment_pack_versions (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pack_id           uuid NOT NULL,
    version_number    bigint NOT NULL CHECK (version_number > 0),
    status            text NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading', 'published', 'failed')),
    manifest          jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
    content_hash      text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    byte_size         bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 2147483648),
    file_count        integer NOT NULL CHECK (file_count BETWEEN 1 AND 100000),
    storage_key       text NOT NULL,
    created_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at        timestamptz NOT NULL DEFAULT now(),
    published_at      timestamptz,
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, storage_key),
    UNIQUE (organization_id, pack_id, version_number),
    FOREIGN KEY (organization_id, pack_id)
        REFERENCES equipment_packs(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT equipment_pack_version_publish_complete CHECK (
        (status = 'published' AND published_at IS NOT NULL)
        OR (status <> 'published' AND published_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS equipment_pack_versions_pack_idx
    ON equipment_pack_versions (organization_id, pack_id, version_number DESC);

CREATE TABLE IF NOT EXISTS equipment_pack_upload_blocks (
    organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    version_id        uuid NOT NULL,
    block_index       integer NOT NULL CHECK (block_index BETWEEN 0 AND 49999),
    block_id          text NOT NULL CHECK (char_length(block_id) BETWEEN 4 AND 128),
    byte_size         integer NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
    content_hash      text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    uploaded_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (version_id, block_index),
    UNIQUE (organization_id, version_id, block_index),
    FOREIGN KEY (organization_id, version_id)
        REFERENCES equipment_pack_versions(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS edge_devices (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    display_name      text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
    hardware_id       text CHECK (hardware_id IS NULL OR char_length(hardware_id) BETWEEN 1 AND 180),
    status            text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'offline', 'revoked')),
    credential_hash   text CHECK (credential_hash IS NULL OR credential_hash ~ '^sha256:[0-9a-f]{64}$'),
    credential_issued_at timestamptz,
    last_seen_at      timestamptz,
    created_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, hardware_id),
    CONSTRAINT edge_device_credential_state CHECK (
        (status = 'pending' AND credential_hash IS NULL)
        OR (status IN ('active', 'offline') AND credential_hash IS NOT NULL)
        OR (status = 'revoked' AND credential_hash IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS edge_devices_org_seen_idx
    ON edge_devices (organization_id, last_seen_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS edge_device_enrollment_codes (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_id         uuid NOT NULL,
    code_hash         text NOT NULL CHECK (code_hash ~ '^sha256:[0-9a-f]{64}$'),
    expires_at        timestamptz NOT NULL,
    consumed_at       timestamptz,
    created_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (code_hash),
    FOREIGN KEY (organization_id, device_id)
        REFERENCES edge_devices(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS edge_device_enrollment_active_idx
    ON edge_device_enrollment_codes (code_hash, expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS edge_device_assignments (
    device_id         uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    version_id        uuid NOT NULL,
    generation        bigint NOT NULL CHECK (generation > 0),
    requested_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, device_id),
    FOREIGN KEY (organization_id, device_id)
        REFERENCES edge_devices(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, version_id)
        REFERENCES equipment_pack_versions(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS edge_device_assignments_org_idx
    ON edge_device_assignments (organization_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS edge_device_deployments (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_id         uuid NOT NULL,
    version_id        uuid NOT NULL,
    generation        bigint NOT NULL CHECK (generation > 0),
    state             text NOT NULL CHECK (state IN (
        'downloading', 'verified', 'staged', 'activating', 'active', 'failed'
    )),
    active_slot       text CHECK (active_slot IS NULL OR active_slot IN ('A', 'B')),
    observed_hash     text CHECK (observed_hash IS NULL OR observed_hash ~ '^sha256:[0-9a-f]{64}$'),
    error_code        text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$'),
    detail            text CHECK (detail IS NULL OR char_length(detail) <= 1000),
    reported_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (device_id, generation, state),
    FOREIGN KEY (organization_id, device_id)
        REFERENCES edge_devices(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, version_id)
        REFERENCES equipment_pack_versions(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS edge_device_deployments_history_idx
    ON edge_device_deployments (organization_id, device_id, generation DESC, reported_at DESC);
