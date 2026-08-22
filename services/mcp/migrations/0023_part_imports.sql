-- Bulk import of parts and stock, as a first-class reversible unit.
--
-- An import is a batch plus an append-only journal of exactly what it did,
-- with the pre-update state of anything it changed. That journal is what
-- makes a rollback possible at all: without a before-state, reversing an
-- update is guesswork.

-- ---------------------------------------------------------------------------
-- parts gains a soft delete so a rollback can undo a part it created
-- ---------------------------------------------------------------------------

ALTER TABLE parts ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS parts_live_idx
    ON parts (part_number) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Close the blank-manufacturer duplicate hole
-- ---------------------------------------------------------------------------
--
-- `UNIQUE (part_number, manufacturer)` does not constrain rows where the
-- manufacturer is NULL, because Postgres treats NULLs as distinct. An importer
-- that find-or-creates by that pair would therefore fan out a fresh duplicate
-- on every run for any part whose manufacturer nobody recorded.
--
-- Detect existing duplicates first and say so plainly. Creating the index
-- without this produces an opaque "could not create unique index" against a
-- table the operator cannot easily inspect.

DO $$
DECLARE
    offending text;
BEGIN
    SELECT string_agg(part_number, ', ' ORDER BY part_number)
      INTO offending
      FROM (
          SELECT part_number
            FROM parts
           WHERE manufacturer IS NULL AND archived_at IS NULL
           GROUP BY part_number
          HAVING count(*) > 1
      ) duplicates;

    IF offending IS NOT NULL THEN
        RAISE EXCEPTION
            'these part numbers already have more than one row with no manufacturer, so a unique index cannot be created: %. Merge or archive the duplicates, then re-run this migration.',
            offending;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS parts_number_no_manufacturer_idx
    ON parts (part_number)
    WHERE manufacturer IS NULL AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- part_import_batches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS part_import_batches (
    id               uuid PRIMARY KEY,
    organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    file_name        text NOT NULL,
    file_format      text NOT NULL CHECK (file_format IN ('csv', 'xlsx')),
    mode             text NOT NULL CHECK (mode IN ('add_only', 'add_and_update')),
    status           text NOT NULL DEFAULT 'applied'
        CHECK (status IN ('applied', 'rolled_back')),
    -- The digest of the exact bytes that were applied. The apply request must
    -- carry the digest the operator previewed, so a plan shown for one file
    -- cannot be used to wave through a different one.
    source_sha256    text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    parts_created    integer NOT NULL DEFAULT 0 CHECK (parts_created >= 0),
    parts_updated    integer NOT NULL DEFAULT 0 CHECK (parts_updated >= 0),
    units_created    integer NOT NULL DEFAULT 0 CHECK (units_created >= 0),
    rows_skipped     integer NOT NULL DEFAULT 0 CHECK (rows_skipped >= 0),
    uploaded_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    rolled_back_by   uuid REFERENCES users(id) ON DELETE RESTRICT,
    rolled_back_at   timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    version          bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (organization_id, id),
    -- A rolled-back batch records who reversed it and when.
    CONSTRAINT part_import_batches_rollback_check
        CHECK (status <> 'rolled_back'
               OR (rolled_back_by IS NOT NULL AND rolled_back_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS part_import_batches_recent_idx
    ON part_import_batches (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- part_import_changes — append-only journal
-- ---------------------------------------------------------------------------
--
-- A ledger, not a record: no version, no soft delete, never updated. Corrected
-- forward if it ever needs correcting at all.

CREATE TABLE IF NOT EXISTS part_import_changes (
    id               bigserial PRIMARY KEY,
    organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    import_batch_id  uuid NOT NULL,
    entity_type      text NOT NULL CHECK (entity_type IN ('part', 'location', 'stock_unit')),
    entity_id        uuid NOT NULL,
    action           text NOT NULL CHECK (action IN ('created', 'updated')),
    -- The pre-update state, so an update can be reversed to exactly what it
    -- replaced rather than to a guess.
    before_json      jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, import_batch_id)
        REFERENCES part_import_batches (organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT part_import_changes_before_check
        CHECK (action <> 'updated' OR before_json IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS part_import_changes_batch_idx
    ON part_import_changes (organization_id, import_batch_id, id);
-- Rollback asks "did a later batch touch this same row?" for every entity it
-- is about to reverse. Without this index that question is a sequential scan
-- per entity.
CREATE INDEX IF NOT EXISTS part_import_changes_entity_idx
    ON part_import_changes (organization_id, entity_type, entity_id, id);

CREATE OR REPLACE FUNCTION reject_part_import_change_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'part_import_changes is append-only; a batch is reversed by rolling it back, never by editing its journal';
END;
$$;

DROP TRIGGER IF EXISTS part_import_changes_append_only ON part_import_changes;
CREATE TRIGGER part_import_changes_append_only
    BEFORE UPDATE OR DELETE ON part_import_changes
    FOR EACH ROW EXECUTE FUNCTION reject_part_import_change_mutation();
