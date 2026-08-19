-- 0018 — In-app feedback reports ("Report a Bug" / "Request a Feature").
--
-- One row per report. Screenshot is a single optional blob referenced by an
-- opaque storage key, not a public URL — screenshot upload failure must not
-- lose the report, so the column is nullable.
--
-- report_type is exactly the two independent entry points the reporter UI
-- offers; severity is bug-only (null for feature reports) since the UI has
-- no severity control on the feature-request flow.
--
-- report_number is a globally sequential, human-referenceable ticket number
-- ("FB-1042") — a plain bigserial rather than a per-organization counter, so
-- there is no read-modify-write race to guard against on concurrent inserts.
--
-- status adds 'needs_info' alongside the original 'in_progress'/'resolved'/
-- 'declined' so an admin can park a report on the submitter without it
-- reading as either untouched or finished; admin_notes is a free-text,
-- admin-only field for triage context (never shown to the submitter).

CREATE TABLE IF NOT EXISTS feedback_reports (
    id                      uuid PRIMARY KEY,
    report_number           bigserial UNIQUE NOT NULL,
    organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    reporter_user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title                   text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    report_type             text NOT NULL DEFAULT 'bug'
        CHECK (report_type IN ('bug', 'feature')),
    severity                text
        CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high')),
    description             text CHECK (description IS NULL OR char_length(description) <= 5000),
    status                  text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'in_progress', 'needs_info', 'resolved', 'declined')),
    admin_notes             text CHECK (admin_notes IS NULL OR char_length(admin_notes) <= 5000),
    page_url                text CHECK (page_url IS NULL OR char_length(page_url) <= 2000),
    page_title              text CHECK (page_title IS NULL OR char_length(page_title) <= 200),
    screenshot_storage_key  text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id, reporter_user_id)
);

CREATE INDEX IF NOT EXISTS feedback_reports_owner_created_idx
    ON feedback_reports (organization_id, reporter_user_id, created_at DESC);
