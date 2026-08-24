package io.mxgenius.sensorbridge;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class FlirPermissionPolicyTest {
    @Test public void existingGrantConnectsWithoutAnotherPermissionRequest() {
        assertEquals(
                FlirPermissionPolicy.GrantAction.CONNECT,
                FlirPermissionPolicy.afterGrantCheck(true));
    }

    @Test public void absentGrantRequestsPermissionOnce() {
        assertEquals(
                FlirPermissionPolicy.GrantAction.REQUEST,
                FlirPermissionPolicy.afterGrantCheck(false));
    }

    @Test public void invalidIdentityForcesFreshDiscovery() {
        assertEquals(
                FlirPermissionPolicy.ErrorAction.REDISCOVER,
                FlirPermissionPolicy.afterPermissionError("INVALID_IDENTITY", 0, 3));
    }

    @Test public void unavailableDeviceForcesFreshDiscovery() {
        assertEquals(
                FlirPermissionPolicy.ErrorAction.REDISCOVER,
                FlirPermissionPolicy.afterPermissionError("DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION", 1, 3));
    }

    @Test public void recoveryIsBoundedAndOtherErrorsFail() {
        assertEquals(
                FlirPermissionPolicy.ErrorAction.FAIL,
                FlirPermissionPolicy.afterPermissionError("INVALID_IDENTITY", 3, 3));
        assertEquals(
                FlirPermissionPolicy.ErrorAction.FAIL,
                FlirPermissionPolicy.afterPermissionError("PERMISSION_DENIED", 0, 3));
    }
}
