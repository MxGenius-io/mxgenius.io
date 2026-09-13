-- Allow a field node to disconnect itself without becoming permanently
-- revoked. Active nodes still require a credential; revoked and pending nodes
-- still cannot retain one. An offline node may represent either a transient
-- heartbeat loss (credential retained) or an explicit unregister (cleared).

ALTER TABLE edge_devices
    DROP CONSTRAINT edge_device_credential_state;

ALTER TABLE edge_devices
    ADD CONSTRAINT edge_device_credential_state CHECK (
        (status = 'pending' AND credential_hash IS NULL)
        OR (status = 'active' AND credential_hash IS NOT NULL)
        OR status = 'offline'
        OR (status = 'revoked' AND credential_hash IS NULL)
    );
