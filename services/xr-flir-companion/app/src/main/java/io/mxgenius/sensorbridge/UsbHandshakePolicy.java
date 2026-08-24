package io.mxgenius.sensorbridge;

/**
 * Pure state policy for one FLIR USB authorization lifecycle.
 *
 * <p>Android owns discovery and permission delivery; this class only decides what the bridge
 * may do next. Keeping the policy free of Android types makes every race reproducible in local
 * unit tests.</p>
 */
final class UsbHandshakePolicy {
    enum Phase {
        IDLE,
        WAITING_FOR_DEVICE,
        WAITING_FOR_PERMISSION,
        VERIFYING_PERMISSION,
        GRANTED,
        DENIED,
        FAILED
    }

    enum Decision {
        WAIT,
        REQUEST_PERMISSION,
        VERIFY_PERMISSION,
        GRANT,
        DENY
    }

    private Phase phase = Phase.IDLE;
    private int deviceId = -1;
    private boolean requestIssued;

    Decision start() {
        phase = Phase.WAITING_FOR_DEVICE;
        deviceId = -1;
        requestIssued = false;
        return Decision.WAIT;
    }

    Decision observe(Integer observedDeviceId, boolean hasPermission) {
        if (observedDeviceId == null) {
            phase = Phase.WAITING_FOR_DEVICE;
            deviceId = -1;
            requestIssued = false;
            return Decision.WAIT;
        }

        boolean changed = deviceId != observedDeviceId;
        deviceId = observedDeviceId;
        if (hasPermission) {
            phase = Phase.VERIFYING_PERMISSION;
            requestIssued = false;
            return Decision.VERIFY_PERMISSION;
        }
        if (changed || !requestIssued) {
            phase = Phase.WAITING_FOR_PERMISSION;
            requestIssued = true;
            return Decision.REQUEST_PERMISSION;
        }
        phase = Phase.WAITING_FOR_PERMISSION;
        return Decision.WAIT;
    }

    Decision permissionResult(
            boolean callbackGranted,
            Integer observedDeviceId,
            boolean hasPermission) {
        if (observedDeviceId == null || observedDeviceId != deviceId) {
            return observe(observedDeviceId, hasPermission);
        }
        if (callbackGranted || hasPermission) {
            phase = Phase.VERIFYING_PERMISSION;
            requestIssued = false;
            return Decision.VERIFY_PERMISSION;
        }
        phase = Phase.DENIED;
        return Decision.DENY;
    }

    Decision inconclusivePermissionResult(Integer observedDeviceId, boolean hasPermission) {
        if (observedDeviceId == null || observedDeviceId != deviceId) {
            return observe(observedDeviceId, hasPermission);
        }
        if (hasPermission) {
            phase = Phase.VERIFYING_PERMISSION;
            requestIssued = false;
            return Decision.VERIFY_PERMISSION;
        }
        // The OS completed a callback without enough identity to call it a denial. Keep waiting
        // without opening duplicate prompts; detach/re-attach or an observed grant advances it.
        phase = Phase.WAITING_FOR_PERMISSION;
        requestIssued = true;
        return Decision.WAIT;
    }

    Decision stabilityResult(Integer observedDeviceId, boolean hasPermission) {
        if (observedDeviceId != null && observedDeviceId == deviceId && hasPermission) {
            phase = Phase.GRANTED;
            requestIssued = false;
            return Decision.GRANT;
        }
        return observe(observedDeviceId, hasPermission);
    }

    void fail() {
        phase = Phase.FAILED;
    }

    void cancel() {
        phase = Phase.IDLE;
        deviceId = -1;
        requestIssued = false;
    }

    Phase phase() {
        return phase;
    }

    int deviceId() {
        return deviceId;
    }
}
