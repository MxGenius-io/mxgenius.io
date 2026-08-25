-- Reporting indexes.
--
-- The parts journals were indexed for point lookups: `inventory_events` by
-- stock unit, `part_events` by aircraft or serial, `part_orders` by status.
-- Every one of those leads with a column a date-ranged report does not know,
-- so an org-wide "what happened between these two dates" read had no index it
-- could use and fell back to a sequential scan of the whole journal.
--
-- These are read-only additions: no table is rewritten and no constraint
-- changes, so the file is safe to re-run.

-- ---------------------------------------------------------------------------
-- inventory_events — org-wide timeline
-- ---------------------------------------------------------------------------
--
-- Descending to match the report's newest-first order, and carrying `id` so
-- keyset pagination on (created_at, id) is served by the index alone rather
-- than re-sorting each page.

CREATE INDEX IF NOT EXISTS inventory_events_timeline_idx
    ON inventory_events (organization_id, created_at DESC, id DESC);

-- Filtering to one movement kind is the common narrowing, and it is selective
-- enough to deserve its own leading column.
CREATE INDEX IF NOT EXISTS inventory_events_type_timeline_idx
    ON inventory_events (organization_id, event_type, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- part_events — org-wide install/removal timeline
-- ---------------------------------------------------------------------------
--
-- `part_events_aircraft_idx` and `part_events_serial_idx` already cover the
-- per-tail and per-serial questions. This covers the unfiltered period sweep,
-- which neither of those can serve.

CREATE INDEX IF NOT EXISTS part_events_timeline_idx
    ON part_events (organization_id, event_at DESC, id DESC)
    WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- part_orders — spend and lead time by period
-- ---------------------------------------------------------------------------
--
-- `part_orders_status_idx` leads with status, which a spend report does not
-- filter on. Orders with no `ordered_at` were never placed, so they are absent
-- rather than sorted to one end.

CREATE INDEX IF NOT EXISTS part_orders_ordered_idx
    ON part_orders (organization_id, ordered_at DESC)
    WHERE ordered_at IS NOT NULL AND archived_at IS NULL;

-- Supplier rollups group by supplier over a period.
CREATE INDEX IF NOT EXISTS part_orders_supplier_period_idx
    ON part_orders (organization_id, supplier_id, ordered_at DESC)
    WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- part_shipments — delivery dates close the lead-time join
-- ---------------------------------------------------------------------------
--
-- Lead time is `ordered_at` to the delivery of the order's shipment, so the
-- join reaches part_shipments by order id and needs the delivered legs.

CREATE INDEX IF NOT EXISTS part_shipments_delivered_idx
    ON part_shipments (organization_id, part_order_id, received_at DESC)
    WHERE status = 'delivered' AND archived_at IS NULL;
