-- Customer operations accounts for the edge-device control plane.
--
-- A customer account belongs to the authenticated operator organization. It
-- groups any number of edge devices without weakening the existing tenant
-- boundary. Payment rows are an operational history only; no processor
-- credentials or card data are stored here. Device health is derived from the
-- existing heartbeat and deployment ledgers.

CREATE TABLE IF NOT EXISTS customer_accounts (
    id                   uuid PRIMARY KEY,
    organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name                 text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
    status               text NOT NULL DEFAULT 'active'
        CHECK (status IN ('prospect', 'trial', 'active', 'past_due', 'suspended', 'closed')),
    primary_contact_name text CHECK (
        primary_contact_name IS NULL OR char_length(btrim(primary_contact_name)) BETWEEN 1 AND 160
    ),
    primary_contact_email text CHECK (
        primary_contact_email IS NULL OR char_length(btrim(primary_contact_email)) BETWEEN 3 AND 254
    ),
    billing_email        text CHECK (
        billing_email IS NULL OR char_length(btrim(billing_email)) BETWEEN 3 AND 254
    ),
    notes                text CHECK (notes IS NULL OR char_length(notes) <= 4000),
    created_by           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_accounts_org_name_idx
    ON customer_accounts (organization_id, lower(name));

CREATE INDEX IF NOT EXISTS customer_accounts_org_status_idx
    ON customer_accounts (organization_id, status, updated_at DESC);

ALTER TABLE edge_devices
    ADD COLUMN IF NOT EXISTS customer_account_id uuid;

ALTER TABLE edge_devices
    ADD CONSTRAINT edge_devices_customer_account_fk
    FOREIGN KEY (organization_id, customer_account_id)
    REFERENCES customer_accounts(organization_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS edge_devices_customer_account_idx
    ON edge_devices (organization_id, customer_account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS customer_payments (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id     uuid NOT NULL,
    amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
    currency        text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    status          text NOT NULL CHECK (status IN ('paid', 'pending', 'failed', 'refunded')),
    occurred_at     timestamptz NOT NULL,
    reference       text CHECK (reference IS NULL OR char_length(btrim(reference)) BETWEEN 1 AND 160),
    note            text CHECK (note IS NULL OR char_length(note) <= 1000),
    recorded_by     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, customer_id)
        REFERENCES customer_accounts(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customer_payments_customer_history_idx
    ON customer_payments (organization_id, customer_id, occurred_at DESC, id);
