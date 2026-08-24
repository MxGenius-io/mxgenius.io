package io.mxgenius.sensorbridge;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class UsbHandshakePolicyTest {
    @Test public void coldCameraWaitsWithoutConsumingAttemptsThenRequestsOnce() {
        UsbHandshakePolicy policy = new UsbHandshakePolicy();
        assertEquals(UsbHandshakePolicy.Decision.WAIT, policy.start());
        for (int second = 0; second < 60; second++) {
            assertEquals(UsbHandshakePolicy.Decision.WAIT, policy.observe(null, false));
        }
        assertEquals(
                UsbHandshakePolicy.Decision.REQUEST_PERMISSION,
                policy.observe(41, false));
        assertEquals(UsbHandshakePolicy.Decision.WAIT, policy.observe(41, false));
        assertEquals(UsbHandshakePolicy.Phase.WAITING_FOR_PERMISSION, policy.phase());
    }

    @Test public void existingGrantIsVerifiedBeforeItIsAccepted() {
        UsbHandshakePolicy policy = new UsbHandshakePolicy();
        policy.start();
        assertEquals(
                UsbHandshakePolicy.Decision.VERIFY_PERMISSION,
                policy.observe(42, true));
        assertEquals(
                UsbHandshakePolicy.Decision.GRANT,
                policy.stabilityResult(42, true));
        assertEquals(UsbHandshakePolicy.Phase.GRANTED, policy.phase());
    }

    @Test public void nullPermissionCallbackReturnsToEnumerationWait() {
        UsbHandshakePolicy policy = new UsbHandshakePolicy();
        policy.start();
        policy.observe(43, false);
        assertEquals(
                UsbHandshakePolicy.Decision.WAIT,
                policy.permissionResult(true, null, false));
        assertEquals(UsbHandshakePolicy.Phase.WAITING_FOR_DEVICE, policy.phase());
        assertEquals(
                UsbHandshakePolicy.Decision.REQUEST_PERMISSION,
                policy.observe(44, false));
    }

    @Test public void identityFreeCallbackDoesNotBecomeFalseDenialOrDuplicatePrompt() {
        UsbHandshakePolicy policy = new UsbHandshakePolicy();
        policy.start();
        policy.observe(51, false);
        assertEquals(
                UsbHandshakePolicy.Decision.WAIT,
                policy.inconclusivePermissionResult(51, false));
        assertEquals(UsbHandshakePolicy.Phase.WAITING_FOR_PERMISSION, policy.phase());
        assertEquals(UsbHandshakePolicy.Decision.WAIT, policy.observe(51, false));
        assertEquals(
                UsbHandshakePolicy.Decision.VERIFY_PERMISSION,
                policy.observe(51, true));
    }

    @Test public void detachAndReattachStartsOneNewPhysicalTransaction() {
        UsbHandshakePolicy policy = new UsbHandshakePolicy();
        policy.start();
        assertEquals(
                UsbHandshakePolicy.Decision.REQUEST_PERMISSION,
                policy.observe(45, false));
        assertEquals(UsbHandshakePolicy.Decision.WAIT, policy.observe(null, false));
        assertEquals(
                UsbHandshakePolicy.Decision.REQUEST_PERMISSION,
                policy.observe(46, false));
        assertEquals(UsbHandshakePolicy.Decision.WAIT, policy.observe(46, false));
    }

    @Test public void explicitDenialIsTerminalInsteadOfBeingRetried() {
        UsbHandshakePolicy policy = new UsbHandshakePolicy();
        policy.start();
        policy.observe(47, false);
        assertEquals(
                UsbHandshakePolicy.Decision.DENY,
                policy.permissionResult(false, 47, false));
        assertEquals(UsbHandshakePolicy.Phase.DENIED, policy.phase());
    }

    @Test public void grantObservedBeforeCallbackStillCompletesHandshake() {
        UsbHandshakePolicy policy = new UsbHandshakePolicy();
        policy.start();
        policy.observe(48, false);
        assertEquals(
                UsbHandshakePolicy.Decision.VERIFY_PERMISSION,
                policy.observe(48, true));
        assertEquals(
                UsbHandshakePolicy.Decision.GRANT,
                policy.stabilityResult(48, true));
    }

    @Test public void deviceChangeDuringVerificationReturnsToPermissionSync() {
        UsbHandshakePolicy policy = new UsbHandshakePolicy();
        policy.start();
        policy.observe(49, true);
        assertEquals(
                UsbHandshakePolicy.Decision.REQUEST_PERMISSION,
                policy.stabilityResult(50, false));
        assertEquals(UsbHandshakePolicy.Phase.WAITING_FOR_PERMISSION, policy.phase());
        assertEquals(50, policy.deviceId());
    }
}
