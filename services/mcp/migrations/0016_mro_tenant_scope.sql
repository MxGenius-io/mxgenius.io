-- 0016 — Tenant ownership for the MCP MRO directory.

ALTER TABLE mro_facilities
    ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS mro_facilities_org_idx
    ON mro_facilities (organization_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS mro_facilities_org_source_idx
    ON mro_facilities (organization_id, source_reference)
    WHERE source_reference IS NOT NULL;
