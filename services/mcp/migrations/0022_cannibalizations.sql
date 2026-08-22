-- Cannibalization: robbing a serviceable part off one aircraft to return
-- another to service.
--
-- This is an airworthiness claim, not a stock movement, so it is the most
-- heavily constrained table in the module. The record is a thin correlation
-- over two atomic part events that already exist -- a donor removal and a
-- receiver install -- rather than a second, divergent copy of serial lineage.
-- The rotable register and the event ledger stay the source of truth.

CREATE TABLE IF NOT EXISTS cannibalizations (
    id                        uuid PRIMARY KEY,
    organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rotable_unit_id           uuid,
    donor_removal_event_id    uuid,
    receiver_install_event_id uuid,
    donor_aircraft_id         text,
    receiver_aircraft_id      text,
    part_number               text,
    serial_number             text,
    -- No life_limited_part table exists here, so the fact is carried as a
    -- flag. When set, the accumulated life crossing the tail boundary must be
    -- recorded before the rob can be approved.
    is_life_limited           boolean NOT NULL DEFAULT false,
    transferred_hours         numeric(10,1),
    transferred_cycles        integer,
    backfill_order_id         uuid,
    cannibalized_at           timestamptz,
    expected_rts_without      timestamptz,
    expected_rts_with         timestamptz,
    rts_impact_rationale      text,
    status                    text NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'approved', 'rejected', 'completed', 'cancelled')),
    proposed_by               uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by               uuid REFERENCES users(id) ON DELETE RESTRICT,
    decided_at                timestamptz,
    notes                     text,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    version                   bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, rotable_unit_id)
        REFERENCES rotable_units (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, donor_removal_event_id)
        REFERENCES part_events (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, receiver_install_event_id)
        REFERENCES part_events (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, backfill_order_id)
        REFERENCES part_orders (organization_id, id) ON DELETE RESTRICT,

    -- A rob must name where the part came from.
    CONSTRAINT cannibalizations_donor_check
        CHECK (donor_aircraft_id IS NOT NULL OR donor_removal_event_id IS NOT NULL),
    -- The robbed part must be identifiable afterwards.
    CONSTRAINT cannibalizations_identity_check
        CHECK (rotable_unit_id IS NOT NULL OR serial_number IS NOT NULL),
    -- An approved or completed rob records who approved it.
    CONSTRAINT cannibalizations_approved_check
        CHECK (status NOT IN ('approved', 'completed') OR approved_by IS NOT NULL),
    -- A tail cannot rob itself.
    CONSTRAINT cannibalizations_no_self_check
        CHECK (donor_aircraft_id IS NULL OR receiver_aircraft_id IS NULL
               OR donor_aircraft_id <> receiver_aircraft_id),
    -- A completed rob carries both atomic events. This is the thin-correlation
    -- premise: without them there is no lineage to point at.
    CONSTRAINT cannibalizations_completed_check
        CHECK (status <> 'completed'
               OR (donor_removal_event_id IS NOT NULL AND receiver_install_event_id IS NOT NULL)),
    -- Separation of duties: the person who proposed a rob cannot be the one
    -- who blesses it.
    CONSTRAINT cannibalizations_sod_check
        CHECK (approved_by IS NULL OR approved_by <> proposed_by),
    -- A life-limited rob records the life that crossed the tail boundary
    -- before it can be approved or completed.
    CONSTRAINT cannibalizations_life_check
        CHECK (NOT is_life_limited
               OR status NOT IN ('approved', 'completed')
               OR transferred_hours IS NOT NULL
               OR transferred_cycles IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS cannibalizations_queue_idx
    ON cannibalizations (organization_id, status, cannibalized_at DESC);
CREATE INDEX IF NOT EXISTS cannibalizations_rotable_idx
    ON cannibalizations (organization_id, rotable_unit_id)
    WHERE rotable_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cannibalizations_donor_ac_idx
    ON cannibalizations (organization_id, donor_aircraft_id)
    WHERE donor_aircraft_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cannibalizations_receiver_ac_idx
    ON cannibalizations (organization_id, receiver_aircraft_id)
    WHERE receiver_aircraft_id IS NOT NULL;

-- An event may anchor at most one completed rob. Without this, the same
-- removal could be claimed as the donor side of two different completed
-- cannibalizations and the lineage would fork.
CREATE UNIQUE INDEX IF NOT EXISTS cannibalizations_donor_event_once_idx
    ON cannibalizations (organization_id, donor_removal_event_id)
    WHERE status = 'completed' AND donor_removal_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cannibalizations_receiver_event_once_idx
    ON cannibalizations (organization_id, receiver_install_event_id)
    WHERE status = 'completed' AND receiver_install_event_id IS NOT NULL;
