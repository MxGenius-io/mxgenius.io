-- Rotables and core obligations.
--
-- `rotable_units` is the serialized register: one row per physical rotable
-- tracked across tails, repairs, and loans. `current_status` and
-- `current_aircraft_id` are a rebuildable projection of the latest part event
-- for that unit, not independent truth.
--
-- `core_exchanges` records what is owed back to a supplier after an exchange
-- or repair, which is a real financial and contractual obligation rather than
-- a note on the order.

CREATE TABLE IF NOT EXISTS rotable_units (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    part_id             uuid REFERENCES parts(id) ON DELETE RESTRICT,
    part_number         text NOT NULL,
    serial_number       text NOT NULL,
    nomenclature        text,
    current_status      text NOT NULL DEFAULT 'in_stock'
        CHECK (current_status IN (
            'in_stock', 'installed', 'in_repair', 'in_transit', 'on_loan', 'scrapped'
        )),
    current_aircraft_id text,
    stock_unit_id       uuid,
    last_part_event_id  uuid,
    times_repaired      integer NOT NULL DEFAULT 0 CHECK (times_repaired >= 0),
    notes               text,
    created_by          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    -- Retirement is a soft delete: the register keeps the history.
    retired_at          timestamptz,
    version             bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, stock_unit_id)
        REFERENCES stock_units (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, last_part_event_id)
        REFERENCES part_events (organization_id, id) ON DELETE RESTRICT
);

-- A serial identifies exactly one live unit of a given part number. Retired
-- rows are excluded so the same serial can be re-registered if it genuinely
-- comes back.
CREATE UNIQUE INDEX IF NOT EXISTS rotable_units_identity_idx
    ON rotable_units (organization_id, part_number, lower(serial_number))
    WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS rotable_units_aircraft_idx
    ON rotable_units (organization_id, current_aircraft_id)
    WHERE current_aircraft_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rotable_units_status_idx
    ON rotable_units (organization_id, current_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS rotable_units_part_idx
    ON rotable_units (organization_id, part_id) WHERE part_id IS NOT NULL;

-- Deliberately NOT a database constraint: "a unit installed on a tail cannot
-- be in stock" is enforced at the API boundary instead. A bulk register import
-- routinely carries rows that already contradict it, and a CHECK would reject
-- the import wholesale rather than letting the contradiction be corrected.
-- See the coherence rule in the rotables repository.

CREATE TABLE IF NOT EXISTS core_exchanges (
    id                     uuid PRIMARY KEY,
    organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    part_order_id          uuid NOT NULL,
    rotable_unit_id        uuid,
    part_id                uuid REFERENCES parts(id) ON DELETE RESTRICT,
    core_shipment_id       uuid,
    core_charge_usd        numeric(12,2),
    core_cost_usd          numeric(12,2),
    exchange_pricing_usd   numeric(12,2),
    outright_pricing_usd   numeric(12,2),
    core_due_date          timestamptz,
    core_returned_date     timestamptz,
    repairable_part_number text,
    repairable_serial      text,
    status                 text NOT NULL DEFAULT 'due'
        CHECK (status IN ('due', 'returned', 'waived', 'billed')),
    notes                  text,
    created_by             uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    archived_at            timestamptz,
    version                bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, part_order_id)
        REFERENCES part_orders (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, rotable_unit_id)
        REFERENCES rotable_units (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, core_shipment_id)
        REFERENCES part_shipments (organization_id, id) ON DELETE RESTRICT,
    -- A returned core records when it went back.
    CONSTRAINT core_exchanges_returned_check
        CHECK (status <> 'returned' OR core_returned_date IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS core_exchanges_order_idx
    ON core_exchanges (organization_id, part_order_id);
CREATE INDEX IF NOT EXISTS core_exchanges_rotable_idx
    ON core_exchanges (organization_id, rotable_unit_id)
    WHERE rotable_unit_id IS NOT NULL;
-- The queue that matters: what is still owed, soonest first.
CREATE INDEX IF NOT EXISTS core_exchanges_due_idx
    ON core_exchanges (organization_id, core_due_date)
    WHERE status = 'due' AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS warranty_claims (
    id                   uuid PRIMARY KEY,
    organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    claim_number         text,
    rotable_unit_id      uuid,
    part_order_id        uuid,
    supplier_id          uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
    case_id              uuid,
    part_number          text,
    serial_number        text,
    claim_date           timestamptz,
    status               text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'submitted', 'approved', 'denied', 'credited', 'closed')),
    claim_amount_usd     numeric(12,2),
    credit_amount_usd    numeric(12,2),
    credit_memo_number   text,
    description          text,
    resolution           text,
    notes                text,
    created_by           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    archived_at          timestamptz,
    version              bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, rotable_unit_id)
        REFERENCES rotable_units (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, part_order_id)
        REFERENCES part_orders (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, case_id)
        REFERENCES maintenance_cases (organization_id, case_id) ON DELETE RESTRICT,
    -- A credited claim records what was credited.
    CONSTRAINT warranty_claims_credited_check
        CHECK (status <> 'credited' OR credit_amount_usd IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS warranty_claims_number_idx
    ON warranty_claims (organization_id, claim_number)
    WHERE claim_number IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS warranty_claims_rotable_idx
    ON warranty_claims (organization_id, rotable_unit_id)
    WHERE rotable_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS warranty_claims_board_idx
    ON warranty_claims (organization_id, status, claim_date DESC)
    WHERE archived_at IS NULL;
