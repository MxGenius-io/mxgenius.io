-- Part interchangeability: alternates and supersessions over the catalog.
--
-- Saying two part numbers are interchangeable is an airworthiness claim, not a
-- data-cleanup convenience. It asserts that one part may be fitted where the
-- other is called for, which is a determination an operator makes against an
-- IPC, a service bulletin, or a manufacturer notice -- never something a
-- system infers from similar-looking part numbers. So every row here records
-- who asserted the relation and against which document, and the tool that
-- reads it returns that provenance with the answer rather than presenting a
-- bare list of substitutes.
--
-- The catalog (`parts`) is global rather than tenant-owned, and so is this
-- table: an alternate is a property of the parts, not of who holds them. The
-- asserting user and organization are recorded so a claim can be traced back
-- to the operator who made it.

CREATE TABLE IF NOT EXISTS part_alternates (
    id                 uuid PRIMARY KEY,
    part_id            uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    alternate_part_id  uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    -- `alternate`  : fit-for-fit interchangeable in both directions.
    -- `supersedes` : `part_id` replaces `alternate_part_id`.
    -- `superseded_by`: `part_id` is replaced by `alternate_part_id`.
    relation           text NOT NULL
        CHECK (relation IN ('alternate', 'supersedes', 'superseded_by')),
    -- A supersession is inherently directional: the replacement may be fitted
    -- where the old part was called for, but not the reverse. `alternate` is
    -- normally mutual, and a one-way alternate is the exception that has to be
    -- stated rather than assumed.
    one_way            boolean NOT NULL DEFAULT false,
    -- The document the claim rests on: an IPC revision, service bulletin, or
    -- manufacturer notice. Free text because the authority differs by source,
    -- but recorded so the assertion is never anonymous.
    authority          text,
    notes              text,
    -- Who stands behind the claim.
    asserted_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    asserted_by_organization_id uuid NOT NULL
        REFERENCES organizations(id) ON DELETE CASCADE,
    asserted_at        timestamptz NOT NULL DEFAULT now(),
    -- Withdrawn rather than deleted: a claim that was acted on stays visible.
    retired_at         timestamptz,
    retired_by         uuid REFERENCES users(id) ON DELETE RESTRICT,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    version            bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    -- A part is not an alternate for itself; such a row would make every
    -- lookup return its own input as a substitute.
    CONSTRAINT part_alternates_no_self CHECK (part_id <> alternate_part_id)
);

-- One live claim per direction per pair. A retired claim does not block a
-- later, corrected one, so the uniqueness is over live rows only.
CREATE UNIQUE INDEX IF NOT EXISTS part_alternates_live_pair_idx
    ON part_alternates (part_id, alternate_part_id, relation)
    WHERE retired_at IS NULL;

-- The read path is "what may I fit where this part is called for", so the
-- lookup is by part with the retired rows excluded.
CREATE INDEX IF NOT EXISTS part_alternates_part_idx
    ON part_alternates (part_id)
    WHERE retired_at IS NULL;

-- A mutual alternate has to be findable from either side without the caller
-- knowing which way the row was written.
CREATE INDEX IF NOT EXISTS part_alternates_alternate_idx
    ON part_alternates (alternate_part_id)
    WHERE retired_at IS NULL;
