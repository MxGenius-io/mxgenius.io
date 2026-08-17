-- 0017 — Tenant-owned collaborative project workspaces.
--
-- The current JSON document is the application source of truth. Every save
-- also creates an immutable revision row; large reference files live in the
-- private Azure Blob container and are represented here by opaque storage
-- keys rather than public URLs.

CREATE TABLE IF NOT EXISTS project_workspaces (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_key   text NOT NULL
        CHECK (workspace_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    status          text NOT NULL DEFAULT 'collecting'
        CHECK (status IN ('collecting', 'ready_for_review', 'review_complete', 'archived')),
    document        jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(document) = 'object'),
    version         bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, workspace_key),
    UNIQUE (organization_id, id)
);

CREATE INDEX IF NOT EXISTS project_workspaces_org_updated_idx
    ON project_workspaces (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_workspace_revisions (
    workspace_id      uuid NOT NULL REFERENCES project_workspaces(id) ON DELETE CASCADE,
    organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    version           bigint NOT NULL CHECK (version > 0),
    title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    status            text NOT NULL
        CHECK (status IN ('collecting', 'ready_for_review', 'review_complete', 'archived')),
    document          jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    saved_by          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archive_state     text NOT NULL DEFAULT 'pending'
        CHECK (archive_state IN ('pending', 'stored', 'failed')),
    archive_reference text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, version),
    FOREIGN KEY (organization_id, workspace_id)
        REFERENCES project_workspaces(organization_id, id) ON DELETE CASCADE,
    CHECK (
        (archive_state = 'stored' AND archive_reference IS NOT NULL)
        OR (archive_state <> 'stored' AND archive_reference IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS project_workspace_revisions_org_idx
    ON project_workspace_revisions (organization_id, workspace_id, version DESC);

CREATE TABLE IF NOT EXISTS project_workspace_assets (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id      uuid NOT NULL,
    section_key       text NOT NULL
        CHECK (section_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 180),
    media_type        text NOT NULL,
    byte_size         bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 52428800),
    content_hash      text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    storage_key       text NOT NULL,
    note              text CHECK (note IS NULL OR char_length(note) <= 1000),
    uploaded_by       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, storage_key),
    FOREIGN KEY (organization_id, workspace_id)
        REFERENCES project_workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS project_workspace_assets_workspace_idx
    ON project_workspace_assets (organization_id, workspace_id, section_key, created_at DESC);
