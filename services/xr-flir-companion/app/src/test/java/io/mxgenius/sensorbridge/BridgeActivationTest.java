package io.mxgenius.sensorbridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class BridgeActivationTest {
    private static final String LOCAL_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test public void localActivationDoesNotRequireRemoteRelay() {
        BridgeActivation activation = BridgeActivation.validated("case-42", null, LOCAL_TOKEN, false, false);
        assertEquals("case-42", activation.sessionId);
        assertEquals(LOCAL_TOKEN, activation.localToken);
        assertNull(activation.bridgeUrl);
        assertTrue(activation.canHandoffToBrowser());
        assertEquals(
                "https://mxgenius.io/globe-vr.html?scene=sensor&bridgeManaged=1"
                        + "#sensorHandoff=1&sessionId=case-42&localToken=" + LOCAL_TOKEN,
                activation.browserHandoffUrl());
    }

    @Test public void remoteRelayRemainsAnOptionalSecureAdapter() {
        BridgeActivation activation = BridgeActivation.validated(
                "case-42",
                "wss://relay.example/ws/ingest",
                null,
                false,
                false);
        assertEquals("wss://relay.example/ws/ingest", activation.bridgeUrl);
        assertNull(activation.localToken);
        assertFalse(activation.canHandoffToBrowser());
        assertThrows(IllegalStateException.class, activation::browserHandoffUrl);
    }

    @Test public void activationRejectsMissingOrProductionCleartextTransport() {
        assertThrows(IllegalArgumentException.class,
                () -> BridgeActivation.validated("case-42", null, null, false, false));
        assertThrows(IllegalArgumentException.class,
                () -> BridgeActivation.validated("case-42", "ws://192.168.1.10/ws", null, true, false));
    }
}
