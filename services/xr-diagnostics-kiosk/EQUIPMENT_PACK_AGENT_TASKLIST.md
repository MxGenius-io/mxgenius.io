# Pi Equipment Pack Agent Task List

> Status: In progress
>
> Scope: Extend the existing diagnostics kiosk and privileged control helper.
> Do not add a second web server, give the Pi Azure credentials, or expose an
> inbound internet port.

## Contract and identity

- [x] Keep one cloud-owned UUID for each node (`edge_devices.id`).
- [x] Keep the optional hardware identifier separate from the node UUID.
- [x] Bind desired pack versions through `(device_id, generation)` rather than
      copying authorization into Blob prefixes.
- [x] Persist the enrolled node ID and device credential with mode `0600`.
- [x] Expose a local-only enrollment action that never returns a saved secret.
- [x] Prove an enrolled identity survives a service restart.

## Durable reconciliation

- [x] Reconcile once at service startup.
- [x] Poll every 60 seconds as the correctness path.
- [x] Use `If-None-Match` and retain the last desired-state ETag.
- [x] Ignore generations at or below the active generation.
- [ ] Add the WebSocket change notification as a wake-up optimization only.
- [x] Persist bounded, non-secret agent status for the kiosk UI and support.

## Package transfer and verification

- [x] Download into a `.part` file and resume with HTTP Range.
- [x] Bound packages to 2 GiB without buffering them in memory.
- [x] Verify aggregate SHA-256 before opening the package.
- [x] Reject traversal, absolute, backslash, control-character, reserved FAT,
      case-colliding, encrypted, symlink, extra, missing, or size-mismatched
      archive entries.
- [x] Verify every manifest file SHA-256 while extracting.
- [x] Stage only into the inactive A/B slot.

## USB mass-storage activation

- [x] Add a read-only Pi capability probe for ConfigFS, UDC, and required tools.
- [ ] Confirm the flashed Pi model/port supports USB device mode.
- [ ] Add fixed allow-listed `usb.gadget.activate` and rollback operations to
      the existing root helper; accept a slot name, never an arbitrary path.
- [ ] Detach the gadget before changing its backing image.
- [ ] Build/refresh the inactive filesystem image, attach it, and verify UDC
      enumeration before marking the generation active.
- [ ] Restore the prior slot after any activation failure.

## Local UI

- [x] Add one compact Equipment Pack card: node, connection, assigned version,
      active version/slot, progress, and one retry action.
- [x] Keep enrollment under local advanced settings; credential rotation stays
      on the post-flash follow-up list.
- [x] Keep credentials, raw tokens, Blob paths, and verbose logs out of the UI.

## Validation ladder

- [ ] Unit-test identity persistence, ETag handling, generation ordering,
      interrupted downloads, hash failure, safe extraction, slot selection,
      acknowledgement payloads, and rollback state.
- [x] Pass the complete kiosk Python suite (54 tests on 2026-09-10).
- [x] Pass the canonical release preview (`0.3.1-poc.11`, 55 files,
      HTTP/schema/state/WebSocket/scanner/thermal preflight on 2026-09-10).
- [ ] Flash one Pi and record the capability probe.
- [ ] Assign generation 1 and prove A activates and is visible to the USB host.
- [ ] Assign generation 2 and prove B activates without rebuilding the Pi.
- [ ] Interrupt one download and prove resume.
- [ ] Supply one corrupt package and prove the active slot is preserved.
- [ ] Disconnect networking, assign a version, reconnect, and prove polling
      catches up without the WebSocket notification.

## Release gate

- [x] Keep the agent disabled unless `MXG_EDGE_PACKS_ENABLED=1`.
- [ ] Do not enable the Azure Equipment Pack feature flag until the candidate
      core revision has applied migration `0027` and passed authenticated smoke.
- [ ] Do not commit, push, or deploy until the local and physical evidence is
      reviewed together.
