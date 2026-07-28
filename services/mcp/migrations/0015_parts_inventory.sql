-- 0015 — Tenant-owned physical parts inventory, receiving, assets, extraction,
-- and FAA candidate provenance.
--
-- The existing `parts` table remains the shared catalog used by mxg.parts.*
-- resolution tools. Physical inventory is represented by `stock_units`.

ALTER TABLE parts ADD COLUMN IF NOT EXISTS classification text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS is_serialized boolean NOT NULL DEFAULT false;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'parts_classification_check'
    ) THEN
        ALTER TABLE parts ADD CONSTRAINT parts_classification_check
            CHECK (
                classification IS NULL OR classification IN (
                    'rotable', 'repairable', 'expendable', 'consumable'
                )
            );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS inventory_locations (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code            text NOT NULL,
    name            text,
    location_type   text NOT NULL DEFAULT 'stock'
        CHECK (location_type IN (
            'stock', 'quarantine', 'bonded', 'scrap', 'shipping', 'receiving'
        )),
    barcode         text,
    active          boolean NOT NULL DEFAULT true,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS inventory_locations_org_idx
    ON inventory_locations (organization_id, active, code);

CREATE TABLE IF NOT EXISTS receiving_drafts (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    part_id         uuid REFERENCES parts(id) ON DELETE RESTRICT,
    status          text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'processing', 'ready', 'confirmed', 'cancelled')),
    proposed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    confirmed_by    uuid REFERENCES users(id) ON DELETE RESTRICT,
    confirmed_at    timestamptz,
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    CHECK (
        (status = 'confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
        OR status <> 'confirmed'
    )
);

CREATE INDEX IF NOT EXISTS receiving_drafts_org_status_idx
    ON receiving_drafts (organization_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS stock_units (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    part_id             uuid NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
    serial_number       text,
    lot_number          text,
    quantity            numeric(12,3) NOT NULL CHECK (quantity > 0),
    condition_code      text NOT NULL
        CHECK (condition_code IN ('NE', 'NS', 'OH', 'SV', 'RP', 'AR', 'US', 'SC')),
    status              text NOT NULL DEFAULT 'quarantine'
        CHECK (status IN (
            'quarantine', 'available', 'reserved', 'issued', 'rejected',
            'in_repair', 'shipped', 'scrapped', 'archived'
        )),
    trace_type          text NOT NULL DEFAULT 'none'
        CHECK (trace_type IN (
            'form_8130', 'easa_form1', 'dual_release', 'coc', 'teardown', 'none'
        )),
    certificate_number  text,
    location_id         uuid NOT NULL,
    owner_type          text NOT NULL DEFAULT 'owned'
        CHECK (owner_type IN (
            'owned', 'customer', 'consignment', 'exchange_core', 'loaner'
        )),
    received_at         timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    version             bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    archived_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, location_id)
        REFERENCES inventory_locations(organization_id, id) ON DELETE RESTRICT,
    CHECK (
        (status = 'archived' AND archived_at IS NOT NULL)
        OR status <> 'archived'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_units_serial_identity_idx
    ON stock_units (organization_id, part_id, lower(serial_number))
    WHERE serial_number IS NOT NULL AND status <> 'archived';
CREATE INDEX IF NOT EXISTS stock_units_search_idx
    ON stock_units (organization_id, status, location_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS stock_units_part_idx
    ON stock_units (organization_id, part_id);

CREATE TABLE IF NOT EXISTS part_assets (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    receiving_draft_id  uuid,
    stock_unit_id       uuid,
    kind                text NOT NULL
        CHECK (kind IN (
            'part_photo', 'placard_photo', 'packing_slip', 'form_8130',
            'certificate', 'shipping_box', 'other'
        )),
    original_filename   text NOT NULL,
    media_type          text NOT NULL,
    byte_size           bigint NOT NULL CHECK (byte_size > 0),
    sha256              text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    storage_key         text NOT NULL,
    processing_state    text NOT NULL DEFAULT 'pending_upload'
        CHECK (processing_state IN (
            'pending_upload', 'uploaded', 'processing', 'ready',
            'quarantined', 'failed', 'archived'
        )),
    uploaded_by         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    uploaded_at         timestamptz,
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, storage_key),
    FOREIGN KEY (organization_id, receiving_draft_id)
        REFERENCES receiving_drafts(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, stock_unit_id)
        REFERENCES stock_units(organization_id, id) ON DELETE CASCADE,
    CHECK ((receiving_draft_id IS NULL) <> (stock_unit_id IS NULL))
);

CREATE INDEX IF NOT EXISTS part_assets_draft_idx
    ON part_assets (organization_id, receiving_draft_id, created_at);
CREATE INDEX IF NOT EXISTS part_assets_unit_idx
    ON part_assets (organization_id, stock_unit_id, created_at);

CREATE TABLE IF NOT EXISTS extraction_runs (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    asset_id            uuid NOT NULL,
    state               text NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'processing', 'review_ready', 'completed', 'failed')),
    provider            text NOT NULL,
    model_version       text,
    raw_result_reference text,
    failure_code        text,
    requested_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    started_at          timestamptz,
    completed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, asset_id)
        REFERENCES part_assets(organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS extraction_runs_active_asset_idx
    ON extraction_runs (organization_id, asset_id)
    WHERE state IN ('queued', 'processing', 'review_ready');

CREATE TABLE IF NOT EXISTS extraction_candidates (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    extraction_run_id   uuid NOT NULL,
    field_name          text NOT NULL,
    proposed_value      text,
    normalized_value    text,
    confidence          numeric(5,4) CHECK (confidence >= 0 AND confidence <= 1),
    source_region       jsonb,
    review_state        text NOT NULL DEFAULT 'proposed'
        CHECK (review_state IN ('proposed', 'accepted', 'edited', 'rejected')),
    final_value         text,
    confirmed_by        uuid REFERENCES users(id) ON DELETE RESTRICT,
    confirmed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (extraction_run_id, field_name),
    FOREIGN KEY (organization_id, extraction_run_id)
        REFERENCES extraction_runs(organization_id, id) ON DELETE CASCADE,
    CHECK (
        (review_state = 'proposed' AND confirmed_by IS NULL AND confirmed_at IS NULL)
        OR
        (review_state <> 'proposed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS extraction_candidates_run_idx
    ON extraction_candidates (organization_id, extraction_run_id, field_name);

CREATE TABLE IF NOT EXISTS inventory_events (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    stock_unit_id       uuid NOT NULL,
    event_type          text NOT NULL
        CHECK (event_type IN (
            'receive', 'inspect_pass', 'inspect_reject', 'issue', 'transfer',
            'adjust', 'return', 'ship', 'scrap', 'split', 'metadata_corrected'
        )),
    quantity_delta      numeric(12,3) NOT NULL DEFAULT 0,
    from_location_id    uuid,
    to_location_id      uuid,
    reference_type      text,
    reference_id        text,
    asset_id            uuid,
    agent_action_id     uuid,
    actor_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    correlation_id      uuid NOT NULL,
    notes               text,
    payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, stock_unit_id)
        REFERENCES stock_units(organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, from_location_id)
        REFERENCES inventory_locations(organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, to_location_id)
        REFERENCES inventory_locations(organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, asset_id)
        REFERENCES part_assets(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_events_unit_idx
    ON inventory_events (organization_id, stock_unit_id, created_at, id);
CREATE INDEX IF NOT EXISTS inventory_events_correlation_idx
    ON inventory_events (organization_id, correlation_id);

CREATE OR REPLACE FUNCTION reject_inventory_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'inventory_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS inventory_events_append_only ON inventory_events;
CREATE TRIGGER inventory_events_append_only
    BEFORE UPDATE OR DELETE ON inventory_events
    FOR EACH ROW EXECUTE FUNCTION reject_inventory_event_mutation();

CREATE TABLE IF NOT EXISTS part_operation_requests (
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    idempotency_key     text NOT NULL,
    operation           text NOT NULL,
    request_hash        text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    response_status     integer,
    response_body       jsonb,
    created_by          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    PRIMARY KEY (organization_id, idempotency_key),
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS part_operation_requests_expiry_idx
    ON part_operation_requests (expires_at);

CREATE TABLE IF NOT EXISTS faa_candidate_queries (
    id                      uuid PRIMARY KEY,
    organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    stock_unit_id           uuid NOT NULL,
    state                   text NOT NULL
        CHECK (state IN (
            'candidates_found', 'no_candidates', 'identifiers_incomplete',
            'source_not_configured', 'source_unavailable', 'source_rejected'
        )),
    source_name             text NOT NULL,
    source_url              text,
    normalized_identifiers  jsonb NOT NULL DEFAULT '{}'::jsonb,
    candidates              jsonb NOT NULL DEFAULT '[]'::jsonb,
    retrieved_at            timestamptz NOT NULL,
    correlation_id          uuid NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, stock_unit_id)
        REFERENCES stock_units(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS faa_candidate_queries_unit_idx
    ON faa_candidate_queries (organization_id, stock_unit_id, retrieved_at DESC);
