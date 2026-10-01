-- Retire the legacy inventory and procurement vertical so its replacement can
-- begin from a clean application-owned schema. Earlier migrations remain in
-- the ledger because sqlx migrations are immutable once applied.

DROP TABLE IF EXISTS discrepancy_reports CASCADE;
DROP TABLE IF EXISTS receiving_inspections CASCADE;
DROP TABLE IF EXISTS cannibalizations CASCADE;
DROP TABLE IF EXISTS warranty_claims CASCADE;
DROP TABLE IF EXISTS core_exchanges CASCADE;
DROP TABLE IF EXISTS rotable_units CASCADE;
DROP TABLE IF EXISTS part_import_changes CASCADE;
DROP TABLE IF EXISTS part_import_batches CASCADE;
DROP TABLE IF EXISTS part_alternates CASCADE;
DROP TABLE IF EXISTS part_events CASCADE;
DROP TABLE IF EXISTS part_shipments CASCADE;
DROP TABLE IF EXISTS part_request_changes CASCADE;
DROP TABLE IF EXISTS part_orders CASCADE;
DROP TABLE IF EXISTS faa_candidate_queries CASCADE;
DROP TABLE IF EXISTS part_operation_requests CASCADE;
DROP TABLE IF EXISTS inventory_events CASCADE;
DROP TABLE IF EXISTS extraction_candidates CASCADE;
DROP TABLE IF EXISTS extraction_runs CASCADE;
DROP TABLE IF EXISTS part_assets CASCADE;
DROP TABLE IF EXISTS stock_units CASCADE;
DROP TABLE IF EXISTS receiving_drafts CASCADE;
DROP TABLE IF EXISTS inventory_locations CASCADE;
DROP TABLE IF EXISTS certificate_records CASCADE;
DROP TABLE IF EXISTS part_source_options CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS part_requirements CASCADE;
DROP TABLE IF EXISTS parts CASCADE;
