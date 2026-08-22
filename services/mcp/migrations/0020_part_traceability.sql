-- Part traceability: where a part travelled, and when it went on or came off
-- an aircraft.
--
-- `part_events` is deliberately atomic: one row is one install XOR one
-- removal, and a swap is two rows. That is what lets a later cannibalization
-- be a thin correlation over two existing events rather than a second,
-- divergent copy of serial lineage.
--
-- Attachments reuse the existing `part_assets` store rather than adding a
-- parallel table, so OCR receiving evidence and traceability paperwork live in
-- one place with one upload path.

-- ---------------------------------------------------------------------------
-- Widen the paperwork vocabulary
-- ---------------------------------------------------------------------------
--
-- ATA 106 is the standard used-parts trace form and was missing outright. TSO
-- likewise. A certificate of conformance from the manufacturer is worth more
-- than one from a vendor, so the two are now distinguishable.
--
-- The bare 'coc' value is retained rather than migrated: existing rows
-- recorded a CoC without recording whose it was, and rewriting them to
-- 'coc_vendor' would invent information nobody entered.

ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_trace_type_check;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_trace_type_check
    CHECK (trace_type IN (
        'form_8130', 'easa_form1', 'tso', 'dual_release',
        'coc', 'coc_mfr', 'coc_vendor', 'ata106', 'teardown', 'none'
    ));

-- ---------------------------------------------------------------------------
-- part_shipments — multi-hop legs
-- ---------------------------------------------------------------------------
--
-- `purpose` is what separates a procurement inbound from a repair round trip.
-- `leg_sequence` is advisory ordering, not a constraint. There is deliberately
-- no completed flag: `status = 'delivered'` is the fact.

CREATE TABLE IF NOT EXISTS part_shipments (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    part_requirement_id uuid NOT NULL,
    part_order_id       uuid,
    purpose             text NOT NULL DEFAULT 'procurement'
        CHECK (purpose IN ('procurement', 'repair_out', 'repair_return', 'transfer', 'return')),
    leg_sequence        integer NOT NULL DEFAULT 1 CHECK (leg_sequence > 0),
    serial_number       text,
    origin              text,
    destination         text,
    carrier             text,
    tracking_number     text,
    status              text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_transit', 'delivered', 'exception')),
    shipped_at          timestamptz,
    received_at         timestamptz,
    received_by         text,
    certificate_number  text,
    certificate_type    text
        CHECK (certificate_type IS NULL OR certificate_type IN (
            'form_8130', 'easa_form1', 'tso', 'dual_release',
            'coc', 'coc_mfr', 'coc_vendor', 'ata106', 'teardown', 'none'
        )),
    notes               text,
    created_by          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    archived_at         timestamptz,
    version             bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, part_requirement_id)
        REFERENCES part_requirements (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, part_order_id)
        REFERENCES part_orders (organization_id, id) ON DELETE RESTRICT,
    -- A delivered leg records when it landed.
    CONSTRAINT part_shipments_delivered_check
        CHECK (status <> 'delivered' OR received_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS part_shipments_requirement_idx
    ON part_shipments (organization_id, part_requirement_id, leg_sequence);
CREATE INDEX IF NOT EXISTS part_shipments_order_idx
    ON part_shipments (organization_id, part_order_id);
CREATE INDEX IF NOT EXISTS part_shipments_board_idx
    ON part_shipments (organization_id, status, shipped_at DESC)
    WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- part_events — atomic install / removal
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS part_events (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    part_requirement_id uuid,
    stock_unit_id       uuid,
    event_kind          text NOT NULL CHECK (event_kind IN ('install', 'removal')),
    aircraft_id         text,
    case_id             uuid,
    part_number         text NOT NULL,
    part_serial         text,
    position_reference  text,
    event_at            timestamptz NOT NULL DEFAULT now(),
    performed_by        text,
    -- Only a removal has a reason, and 'cannibalized' is the one a later
    -- cannibalization record correlates against.
    removal_reason      text
        CHECK (removal_reason IS NULL OR removal_reason IN
            ('scheduled', 'unscheduled', 'cannibalized', 'repair')),
    notes               text,
    created_by          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    archived_at         timestamptz,
    version             bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, part_requirement_id)
        REFERENCES part_requirements (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, stock_unit_id)
        REFERENCES stock_units (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases (organization_id, case_id) ON DELETE RESTRICT,
    -- A reason belongs to a removal; an install never carries one.
    CONSTRAINT part_events_reason_check
        CHECK (removal_reason IS NULL OR event_kind = 'removal'),
    -- An event that names neither an aircraft nor a case cannot be placed.
    CONSTRAINT part_events_anchor_check
        CHECK (aircraft_id IS NOT NULL OR case_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS part_events_requirement_idx
    ON part_events (organization_id, part_requirement_id);
CREATE INDEX IF NOT EXISTS part_events_unit_idx
    ON part_events (organization_id, stock_unit_id);
CREATE INDEX IF NOT EXISTS part_events_aircraft_idx
    ON part_events (organization_id, aircraft_id, event_at DESC);
CREATE INDEX IF NOT EXISTS part_events_case_idx
    ON part_events (organization_id, case_id);
-- Serial lineage: every time this serial went on or came off anything.
CREATE INDEX IF NOT EXISTS part_events_serial_idx
    ON part_events (organization_id, part_number, part_serial, event_at DESC)
    WHERE part_serial IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Attachments hang off shipments and events too
-- ---------------------------------------------------------------------------

ALTER TABLE part_assets ADD COLUMN IF NOT EXISTS part_shipment_id uuid;
ALTER TABLE part_assets ADD COLUMN IF NOT EXISTS part_event_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_assets_shipment_fk') THEN
        ALTER TABLE part_assets ADD CONSTRAINT part_assets_shipment_fk
            FOREIGN KEY (organization_id, part_shipment_id)
            REFERENCES part_shipments (organization_id, id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_assets_event_fk') THEN
        ALTER TABLE part_assets ADD CONSTRAINT part_assets_event_fk
            FOREIGN KEY (organization_id, part_event_id)
            REFERENCES part_events (organization_id, id) ON DELETE CASCADE;
    END IF;
END $$;

-- Widen the evidence kinds for traceability paperwork.
ALTER TABLE part_assets DROP CONSTRAINT IF EXISTS part_assets_kind_check;
ALTER TABLE part_assets ADD CONSTRAINT part_assets_kind_check
    CHECK (kind IN (
        'part_photo', 'placard_photo', 'packing_slip', 'form_8130',
        'certificate', 'shipping_box', 'ata106', 'repair_order',
        'release_note', 'other'
    ));

CREATE INDEX IF NOT EXISTS part_assets_shipment_idx
    ON part_assets (organization_id, part_shipment_id)
    WHERE part_shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS part_assets_event_idx
    ON part_assets (organization_id, part_event_id)
    WHERE part_event_id IS NOT NULL;
