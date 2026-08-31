-- Receiving inspection and non-conforming material.
--
-- The slice ships `quarantine_then_inspect`: a received unit lands in
-- `quarantine` and reaches `available` only by passing inspection. Until now
-- that release was a bare status flip -- `inspect_pass` carried no reference
-- and no required evidence -- so the record showed that someone released the
-- part but not what they checked, against which order, or which tag they read.
-- For a part going onto an aircraft that is the wrong half of the story.
--
-- A `receiving_inspections` row is an evidence record of one inspection. Its
-- `outcome` is stored rather than recomputed from the gates at read time: the
-- gate vocabulary may be extended later, and re-deriving a historical
-- acceptance under today's rules would silently restate what an inspector
-- concluded. The row says what they decided, when, and on what basis.
--
-- Discrepant material goes to `discrepancy_reports`, which is where a part
-- stays accounted for while its disposition is decided.

-- One tag vocabulary. `stock_units.trace_type` already names the airworthiness
-- tag a unit carries, and 0020 widened it to the ten values below, so the
-- inspection reuses that list rather than introducing a parallel one that
-- would drift. This migration deliberately does NOT redefine
-- `stock_units_trace_type_check`: rebuilding it from an older definition would
-- silently drop the values 0020 added and reject rows already on file.

-- The ledger gains the three events this workflow writes. Rebuilt from the
-- live definition rather than from 0015, so nothing added since is dropped:
--   inspect_quarantine  -- inspected and held, the unit does not move
--   discrepancy_hold    -- a discrepancy pulled the unit to hold_ncm
--   discrepancy_release -- an accept-as-is disposition put it back
ALTER TABLE inventory_events DROP CONSTRAINT IF EXISTS inventory_events_event_type_check;
ALTER TABLE inventory_events ADD CONSTRAINT inventory_events_event_type_check
    CHECK (event_type IN (
        'receive', 'inspect_pass', 'inspect_reject', 'issue', 'transfer',
        'adjust', 'return', 'ship', 'scrap', 'split', 'metadata_corrected',
        'inspect_quarantine', 'discrepancy_hold', 'discrepancy_release'
    ));

-- Non-conforming material held pending a disposition decision. Distinct from
-- `quarantine` (awaiting inspection) and `rejected` (inspection failed): a
-- hold is material that failed and is now waiting on what to do with it.
ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_status_check;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_status_check
    CHECK (status IN (
        'quarantine', 'available', 'reserved', 'issued', 'rejected',
        'hold_ncm', 'in_repair', 'shipped', 'scrapped', 'archived'
    ));

-- Suspected Unapproved Part is a regulatory status, not a condition grade, so
-- it is a flag beside `condition_code` rather than a value inside it. A part
-- can be physically new and still suspected unapproved.
ALTER TABLE stock_units
    ADD COLUMN IF NOT EXISTS suspected_unapproved boolean NOT NULL DEFAULT false;
ALTER TABLE stock_units
    ADD COLUMN IF NOT EXISTS suspected_unapproved_reason text;

-- A flag this consequential must never be set without a stated reason.
ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_sup_reason_required;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_sup_reason_required
    CHECK (
        suspected_unapproved = false
        OR (suspected_unapproved_reason IS NOT NULL
            AND length(btrim(suspected_unapproved_reason)) > 0)
    );

CREATE TABLE IF NOT EXISTS receiving_inspections (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    stock_unit_id       uuid NOT NULL,
    -- The shipment this material arrived on, when it is known. Receiving
    -- against a shipment is the normal path; a walk-in or a found part is not,
    -- and is not blocked from being inspected.
    shipment_id         uuid,
    -- What the inspector checked. Each gate is pass, fail, or not applicable;
    -- `na` is a deliberate third value because "no dangerous-goods paperwork"
    -- is a pass for a part that is not dangerous goods and a fail for one that
    -- is, and collapsing them would lose that.
    part_number_matches_order  text NOT NULL DEFAULT 'na'
        CHECK (part_number_matches_order IN ('pass', 'fail', 'na')),
    serial_matches_tag         text NOT NULL DEFAULT 'na'
        CHECK (serial_matches_tag IN ('pass', 'fail', 'na')),
    tag_present_and_legible    text NOT NULL DEFAULT 'na'
        CHECK (tag_present_and_legible IN ('pass', 'fail', 'na')),
    shelf_life_acceptable      text NOT NULL DEFAULT 'na'
        CHECK (shelf_life_acceptable IN ('pass', 'fail', 'na')),
    dangerous_goods_paperwork  text NOT NULL DEFAULT 'na'
        CHECK (dangerous_goods_paperwork IN ('pass', 'fail', 'na')),
    -- The tag actually read, in the same vocabulary the unit carries.
    -- Exactly the vocabulary `stock_units.trace_type` carries after 0020.
    tag_type            text NOT NULL DEFAULT 'none'
        CHECK (tag_type IN (
            'form_8130', 'easa_form1', 'tso', 'dual_release',
            'coc', 'coc_mfr', 'coc_vendor', 'ata106', 'teardown', 'none'
        )),
    tag_reference       text,
    condition_code      text
        CHECK (condition_code IS NULL OR condition_code IN
            ('NE', 'NS', 'OH', 'SV', 'RP', 'AR', 'US', 'SC')),
    quantity_received   numeric(12,3) CHECK (quantity_received IS NULL OR quantity_received > 0),
    shipping_damage     boolean NOT NULL DEFAULT false,
    -- Stored, not derived. See the header: re-deriving this later would
    -- restate an inspector's conclusion under rules they did not apply.
    outcome             text NOT NULL
        CHECK (outcome IN ('accepted', 'quarantined')),
    notes               text,
    inspected_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    inspected_at        timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, stock_unit_id)
        REFERENCES stock_units (organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, shipment_id)
        REFERENCES part_shipments (organization_id, id) ON DELETE RESTRICT,
    -- An acceptance cannot stand on a failed gate. A quarantine may be called
    -- on judgment with every gate passing, so only this direction is closed.
    CONSTRAINT receiving_inspections_acceptance_has_no_failed_gate CHECK (
        outcome <> 'accepted' OR (
            part_number_matches_order <> 'fail'
            AND serial_matches_tag <> 'fail'
            AND tag_present_and_legible <> 'fail'
            AND shelf_life_acceptable <> 'fail'
            AND dangerous_goods_paperwork <> 'fail'
            AND shipping_damage = false
        )
    )
);

-- An inspection is an event, not a current state: a unit re-inspected after
-- rework keeps both records. The read path is one unit's inspection history.
CREATE INDEX IF NOT EXISTS receiving_inspections_unit_idx
    ON receiving_inspections (organization_id, stock_unit_id, inspected_at DESC);

CREATE INDEX IF NOT EXISTS receiving_inspections_shipment_idx
    ON receiving_inspections (organization_id, shipment_id)
    WHERE shipment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS discrepancy_reports (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    stock_unit_id       uuid NOT NULL,
    receiving_inspection_id uuid,
    discrepancy_type    text NOT NULL
        CHECK (discrepancy_type IN (
            'wrong_part', 'wrong_quantity', 'shipping_damage',
            'missing_paperwork', 'illegible_tag', 'expired_shelf_life',
            'suspected_unapproved', 'condition_mismatch', 'other'
        )),
    summary             text NOT NULL CHECK (length(btrim(summary)) > 0),
    -- What is to be done with the material.
    disposition         text
        CHECK (disposition IS NULL OR disposition IN
            ('return_to_vendor', 'rework', 'accept_as_is', 'scrap')),
    status              text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved')),
    resolution_notes    text,
    approved_by         uuid REFERENCES users(id) ON DELETE RESTRICT,
    resolved_at         timestamptz,
    reported_by         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reported_at         timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    version             bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, stock_unit_id)
        REFERENCES stock_units (organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, receiving_inspection_id)
        REFERENCES receiving_inspections (organization_id, id) ON DELETE RESTRICT,
    -- Resolved means somebody decided, and the record says who and what.
    -- Without this a report could be closed with no disposition on file,
    -- which is the state the report exists to prevent.
    CONSTRAINT discrepancy_reports_resolution_is_complete CHECK (
        status <> 'resolved' OR (
            disposition IS NOT NULL
            AND approved_by IS NOT NULL
            AND resolved_at IS NOT NULL
        )
    )
);

CREATE INDEX IF NOT EXISTS discrepancy_reports_open_idx
    ON discrepancy_reports (organization_id, reported_at DESC)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS discrepancy_reports_unit_idx
    ON discrepancy_reports (organization_id, stock_unit_id);
