package io.mxgenius.sensorbridge;

/** Pure permission decisions kept separate from the FLIR and Android callbacks. */
final class FlirPermissionPolicy {
    enum GrantAction { CONNECT, REQUEST }
    enum ErrorAction { REDISCOVER, FAIL }

    private FlirPermissionPolicy() {}

    static GrantAction afterGrantCheck(boolean alreadyGranted) {
        return alreadyGranted ? GrantAction.CONNECT : GrantAction.REQUEST;
    }

    static ErrorAction afterPermissionError(String errorType, int recoveryAttempt, int maxRecoveries) {
        boolean identityChanged = "INVALID_IDENTITY".equals(errorType)
                || "DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION".equals(errorType);
        return identityChanged && recoveryAttempt < maxRecoveries
                ? ErrorAction.REDISCOVER
                : ErrorAction.FAIL;
    }
}
