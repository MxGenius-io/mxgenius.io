-- 0002 — Canonical aircraft records.
-- Full JetNet records stay in JetNet; we store canonical IDs, selected
-- normalized fields, freshness, hashes.

CREATE TABLE IF NOT EXISTS aircraft_canonical (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    aircraft_id         text NOT NULL,
    source_system       text,
    source_id           text,
    make                text,
    model               text,
    year                integer CHECK (year IS NULL OR year BETWEEN 1900 AND 2100),
    registration        text,
    serial_number       text,
    base_icao           text,
    base_iata           text,
    base_city           text,
    base_country        text,
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_hash         text,
    freshness_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, aircraft_id)
);

CREATE INDEX IF NOT EXISTS aircraft_canonical_org_idx
    ON aircraft_canonical (organization_id);
CREATE INDEX IF NOT EXISTS aircraft_canonical_reg_idx
    ON aircraft_canonical (organization_id, registration);
CREATE INDEX IF NOT EXISTS aircraft_canonical_serial_idx
    ON aircraft_canonical (organization_id, serial_number);
