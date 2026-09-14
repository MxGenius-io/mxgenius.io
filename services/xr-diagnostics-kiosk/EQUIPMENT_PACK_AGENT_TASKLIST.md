# Pi Equipment Pack Agent Task List

> Status: In progress
>
> Scope: Extend the existing diagnostics kiosk and privileged control helper.
> Do not add a second web server, give the Pi Azure credentials, or expose an
> inbound internet port.

## Permanent lifecycle

- [x] Commission each card with a stable, non-secret hardware ID while leaving
      the normal Raspberry Pi OS boot target untouched.
- [x] Install the kiosk, agent, root broker, and systemd units once through the
      running Pi; subsequent software releases use the same SSH updater.
- [x] Prepare software updates beside the live install, retain the prior
      release, and automatically restore it if the post-cutover health gate
      fails.
- [x] Publish content as immutable Equipment Pack versions from authenticated
      Settings and assign a version to a registered device.
- [x] Wake the outbound Pi agent over WebSocket, retain 60-second polling as
      the correctness path, and require no inbound Pi port.
- [x] Download, verify, stage, and activate content through durable A/B slots;
      never use a content assignment to modify the OS or application.
- [x] Preserve the previous USB image and restore it if the new image cannot
      bind. A content failure must not alter the boot lifecycle.
- [x] Build a flashable appliance image locally from a pinned official base;
      verify the input and output checksums and install the complete runtime
      before the Pi's first boot.
- [x] Use an SSH-key-only local operator and publish a bounded boot status onto
      `bootfs` whenever the appliance stage changes.
- [x] Start the local kiosk without waiting for an internet route and keep the
      branded splash inside the web UI so Wayland remains the sole display owner.

## Contract and identity

- [x] Keep one cloud-owned UUID for each node (`edge_devices.id`).
- [x] Keep the optional hardware identifier separate from the node UUID.
- [x] Bind desired pack versions through `(device_id, generation)` rather than
      copying authorization into Blob prefixes.
- [x] Persist the enrolled node ID and device credential with mode `0600`.
- [x] Expose a local-only enrollment action that never returns a saved secret.
- [x] Prove an enrolled identity survives a service restart.
- [x] Let the Pi originate a short-lived claim from its baked hardware ID,
      display only seven digits, and poll until an authenticated manager names
      and approves it. The device credential travels only on the Pi's TLS lane;
      a later manager-approved claim rotates access, including an intentional
      restore of that same revoked hardware record.
- [x] Let the Pi explicitly unregister: invalidate its cloud credential first,
      retain the last active read-only pack, then return to a fresh seven-digit
      claim. Manager revocation remains the security boundary because only a
      new authenticated manager approval can restore it.

## Durable reconciliation

- [x] Reconcile once at service startup.
- [x] Poll every 60 seconds as the correctness path.
- [x] Use `If-None-Match` and retain the last desired-state ETag.
- [x] Ignore generations at or below the active generation.
- [x] Add the WebSocket change notification as a wake-up optimization only.
- [x] Persist bounded, non-secret agent status for the kiosk UI and support.

## Package transfer and verification

- [x] Download into a `.part` file and resume with HTTP Range.
- [x] Resume browser-to-Azure block uploads from a matching durable draft and
      retransmit only missing or hash-mismatched blocks.
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
- [x] Add fixed allow-listed `usb.gadget.activate` to the existing root helper;
      accept a slot name, never an arbitrary path, and restore the prior image
      internally if activation fails.
- [x] Detach the gadget before changing its backing image.
- [x] Build/refresh the inactive filesystem image, attach it, and verify the
      local UDC binding before marking the generation active.
- [ ] Confirm host-side enumeration on the physical Pi/headset USB connection.
- [x] Restore the prior slot after any activation failure.

## Local UI

- [x] Add one compact Equipment Pack card: node, connection, assigned version,
      active version/slot, live phase feedback, retry, and guarded unregister.
- [x] Show busy feedback during Wi-Fi discovery and persist the most recently
      joined network for preferred automatic reconnect.
- [x] Show the seven-digit setup code directly on the Pi and keep approval and
      revocation in the authenticated web registry.
- [x] Keep credentials, raw tokens, Blob paths, and verbose logs out of the UI.
- [x] Add one authenticated web card for pack creation, folder hashing,
      block upload, publication, device assignment, and deployment history.

## Validation ladder

- [x] Unit-test identity persistence, ETag handling, generation ordering,
      interrupted downloads, hash failure, safe extraction, slot selection,
      acknowledgement payloads, and rollback state.
- [x] Pass the complete kiosk Python suite (85 tests on 2026-09-13).
- [x] Pass the canonical release preview (`0.3.1-poc.25`, 58 files,
      HTTP/schema/state/WebSocket/scanner/thermal preflight on 2026-09-13).
- [ ] Flash one Pi and record the capability probe.
- [ ] Assign generation 1 and prove A activates and is visible to the USB host.
- [ ] Assign generation 2 and prove B activates without rebuilding the Pi.
- [ ] Interrupt one download and prove resume.
- [ ] Supply one corrupt package and prove the active slot is preserved.
- [ ] Disconnect networking, assign a version, reconnect, and prove polling
      catches up without the WebSocket notification.

## Release gate

- [x] Keep the agent disabled unless `MXG_EDGE_PACKS_ENABLED=1`.
- [x] Confirm the deployed Azure core has the Equipment Pack feature enabled
      and migration `0027` in its canonical migration set.
- [ ] Pass authenticated publish/assign smoke against the release candidate.
- [x] Keep the change on canonical `main`; deploy the core endpoint before the
      `0.3.1-poc.25` physical test so restored approval and device unregister
      can complete end to end.
