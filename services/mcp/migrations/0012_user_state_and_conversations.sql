-- 0012 — Durable application state for chat threads and user profiles.
-- Authentication remains OIDC-owned. These rows are tenant/user-scoped
-- application data and never contain credentials.

CREATE TABLE IF NOT EXISTS chat_threads (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id         uuid,
    title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    status          text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id, user_id),
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases(organization_id, case_id)
);

CREATE INDEX IF NOT EXISTS chat_threads_owner_updated_idx
    ON chat_threads (organization_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_threads_case_idx
    ON chat_threads (organization_id, case_id, updated_at DESC)
    WHERE case_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_messages (
    id              uuid PRIMARY KEY,
    thread_id       uuid NOT NULL,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            text NOT NULL CHECK (role IN ('user', 'assistant')),
    content         text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 65536),
    response_id     text,
    payload         jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (thread_id, organization_id, user_id)
        REFERENCES chat_threads(id, organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx
    ON chat_messages (thread_id, created_at, id);
CREATE INDEX IF NOT EXISTS chat_messages_owner_idx
    ON chat_messages (organization_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_profiles (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name    text CHECK (
        display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 120
    ),
    timezone        text CHECK (
        timezone IS NULL OR char_length(timezone) BETWEEN 1 AND 80
    ),
    settings        jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(settings) = 'object'),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS profile_images (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type      text NOT NULL CHECK (
        media_type IN ('image/jpeg', 'image/png', 'image/webp')
    ),
    content         bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 2097152),
    content_hash    text NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);
