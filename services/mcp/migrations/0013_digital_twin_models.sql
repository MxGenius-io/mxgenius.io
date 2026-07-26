-- 0013 — Tenant-owned digital-twin GLB assets and per-user highlight state.

CREATE TABLE IF NOT EXISTS digital_twin_models (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    uploaded_by         uuid NOT NULL REFERENCES users(id),
    name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    revision            text NOT NULL DEFAULT '1'
        CHECK (char_length(revision) BETWEEN 1 AND 80),
    lod                 text NOT NULL DEFAULT 'uploaded'
        CHECK (char_length(lod) BETWEEN 1 AND 40),
    applicable_aircraft text[] NOT NULL DEFAULT '{}',
    media_type          text NOT NULL DEFAULT 'model/gltf-binary'
        CHECK (media_type = 'model/gltf-binary'),
    content             bytea NOT NULL
        CHECK (octet_length(content) BETWEEN 20 AND 104857600),
    content_hash        text NOT NULL,
    mesh_manifest       jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(mesh_manifest) = 'array'),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, content_hash),
    UNIQUE (organization_id, id)
);

CREATE INDEX IF NOT EXISTS digital_twin_models_catalog_idx
    ON digital_twin_models (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS digital_twin_highlight_state (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id        uuid NOT NULL,
    mesh_ids        jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(mesh_ids) = 'array'),
    mesh_path       text,
    component_id    text,
    zone_id         text,
    source          text NOT NULL
        CHECK (source IN ('user_raycast', 'model_tool')),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS digital_twin_highlight_model_idx
    ON digital_twin_highlight_state (organization_id, model_id, updated_at DESC);
