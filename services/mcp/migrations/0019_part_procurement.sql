-- Part procurement: the request lifecycle head and the orders placed against it.
--
-- `part_requirements` already carried case-anchored demand and is read by
-- scheduling and the shortage view, so it is widened into the request head
-- rather than duplicated by a parallel request table.
--
-- Idempotent throughout: every statement guards on existence so the file can
-- be re-run against a partially migrated database.

-- ---------------------------------------------------------------------------
-- part_requirements becomes the request lifecycle head
-- ---------------------------------------------------------------------------

ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'requested';
ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'stock';
ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS quantity_fulfilled integer NOT NULL DEFAULT 0;
ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS requested_by_name text;
ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- Tenant scope was previously reachable only by joining the case. Backfill it
-- so the procurement queries can scope directly, then enforce it.
UPDATE part_requirements pr
   SET organization_id = mc.organization_id
  FROM maintenance_cases mc
 WHERE mc.case_id = pr.case_id
   AND pr.organization_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM part_requirements WHERE organization_id IS NULL) THEN
        RAISE EXCEPTION
            'part_requirements rows remain without an organization; resolve their cases before continuing';
    END IF;
END $$;

ALTER TABLE part_requirements ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requirements_org_fk') THEN
        ALTER TABLE part_requirements ADD CONSTRAINT part_requirements_org_fk
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requirements_org_id_key') THEN
        ALTER TABLE part_requirements ADD CONSTRAINT part_requirements_org_id_key
            UNIQUE (organization_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requirements_status_check') THEN
        ALTER TABLE part_requirements ADD CONSTRAINT part_requirements_status_check
            CHECK (status IN ('requested', 'sourced', 'ordered', 'received', 'installed', 'cancelled'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requirements_priority_check') THEN
        ALTER TABLE part_requirements ADD CONSTRAINT part_requirements_priority_check
            CHECK (priority IN ('aog', 'scheduled_mx', 'stock'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requirements_fulfilled_check') THEN
        ALTER TABLE part_requirements ADD CONSTRAINT part_requirements_fulfilled_check
            CHECK (quantity_fulfilled >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requirements_version_check') THEN
        ALTER TABLE part_requirements ADD CONSTRAINT part_requirements_version_check
            CHECK (version > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requirements_created_by_fk') THEN
        ALTER TABLE part_requirements ADD CONSTRAINT part_requirements_created_by_fk
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- The queue screen reads live requests by priority; the overdue predicate
-- reads required_by. Both are covered here.
CREATE INDEX IF NOT EXISTS part_requirements_queue_idx
    ON part_requirements (organization_id, priority, status, required_by);
CREATE INDEX IF NOT EXISTS part_requirements_org_case_idx
    ON part_requirements (organization_id, case_id);

-- ---------------------------------------------------------------------------
-- part_orders — procurement and repair economics
-- ---------------------------------------------------------------------------
--
-- A physical purchase order may span several requests, so order_number is
-- deliberately NOT unique.

CREATE TABLE IF NOT EXISTS part_orders (
    id                      uuid PRIMARY KEY,
    organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    part_requirement_id     uuid NOT NULL,
    order_kind              text NOT NULL CHECK (order_kind IN ('po', 'so')),
    type_of_buy             text NOT NULL
        CHECK (type_of_buy IN ('outright', 'exchange', 'repair', 'loan')),
    -- Verbatim upstream value. The normalized vocabulary above has four
    -- entries; external sources carry many more (calibration, rental, ...).
    -- Keep the normalized column for logic and the raw one for parity.
    type_of_buy_raw         text,
    order_number            text,
    supplier_id             uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
    -- External systems supply names, not ids, and resolving one to the other
    -- is lossy. Store the verbatim text now; a later identity pass fills the
    -- foreign key without another migration.
    supplier_name           text,
    ordered_at              timestamptz,
    buyer_name              text,
    backordered             boolean NOT NULL DEFAULT false,
    backorder_eta           timestamptz,
    purchase_cost_usd       numeric(12,2),
    account_used            text,
    status                  text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'placed', 'confirmed', 'cancelled')),
    -- Accounts-payable close-out. Distinct from customer billing.
    invoice_number          text,
    invoice_amount_usd      numeric(12,2),
    -- Repair and exchange economics; meaningful when type_of_buy is one of
    -- those two.
    repair_vs_rental        text CHECK (repair_vs_rental IS NULL OR repair_vs_rental IN ('repair', 'rental')),
    quote_approved_at       timestamptz,
    repair_pricing_usd      numeric(12,2),
    savings_usd             numeric(12,2),
    notes                   text,
    created_by              uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    archived_at             timestamptz,
    version                 bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, part_requirement_id)
        REFERENCES part_requirements (organization_id, id) ON DELETE RESTRICT,
    -- A purchase order does not carry a service order number, and vice versa.
    CONSTRAINT part_orders_number_kind_check CHECK (
        NOT (order_kind = 'po' AND order_number IS NOT NULL AND order_number LIKE 'SO-%')
        AND NOT (order_kind = 'so' AND order_number IS NOT NULL AND order_number LIKE 'PO-%')
    ),
    -- Repair-versus-rental economics only mean something on a repair or
    -- exchange arrangement.
    CONSTRAINT part_orders_economics_check CHECK (
        repair_vs_rental IS NULL OR type_of_buy IN ('repair', 'exchange')
    )
);

CREATE INDEX IF NOT EXISTS part_orders_requirement_idx
    ON part_orders (organization_id, part_requirement_id);
CREATE INDEX IF NOT EXISTS part_orders_supplier_idx
    ON part_orders (organization_id, supplier_id);
CREATE INDEX IF NOT EXISTS part_orders_status_idx
    ON part_orders (organization_id, status, ordered_at DESC);
-- The backorder queue is a small slice of a large table.
CREATE INDEX IF NOT EXISTS part_orders_backorder_idx
    ON part_orders (organization_id, backorder_eta)
    WHERE backordered AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- part_request_changes — append-only field journal
-- ---------------------------------------------------------------------------
--
-- A ledger, not a record: no version, no soft delete, never updated. Every
-- applied edit writes exactly one row per changed field. This journal is what
-- lets the request status machine stay any-to-any safely, because the audit
-- trail is the control rather than the transition topology.

CREATE TABLE IF NOT EXISTS part_request_changes (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    part_requirement_id uuid NOT NULL,
    field_name          text NOT NULL,
    old_value           text,
    new_value           text,
    actor_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    correlation_id      uuid NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, part_requirement_id)
        REFERENCES part_requirements (organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS part_request_changes_requirement_idx
    ON part_request_changes (organization_id, part_requirement_id, created_at, id);

CREATE OR REPLACE FUNCTION reject_part_request_change_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'part_request_changes is append-only; correct forward with a new row';
END;
$$;

DROP TRIGGER IF EXISTS part_request_changes_immutable ON part_request_changes;
CREATE TRIGGER part_request_changes_immutable
    BEFORE UPDATE OR DELETE ON part_request_changes
    FOR EACH ROW EXECUTE FUNCTION reject_part_request_change_mutation();
