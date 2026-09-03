package io.mxgenius.sensorbridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class RemoteWitnessBootstrapTest {
    private static final long NOW = 1_780_000_000_000L;
    private static final String PRODUCER = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    @Test public void validBootstrapIsCopiedAndItsSummaryIsRedacted() throws Exception {
        JSONObject payload = validBootstrap();
        RemoteWitnessBootstrap bootstrap = RemoteWitnessBootstrap.parse(payload, "xr-session-contract-1", NOW);
        payload.getJSONArray("iceServers").getJSONObject(0).put("username", "mutated");

        assertEquals("11111111-1111-4111-8111-111111111111", bootstrap.roomId.toString());
        assertEquals("wss://mxg-core.example.net/api/xr/witness/ws", bootstrap.socketUrl());
        assertEquals("Aircraft customer", bootstrap.audience);
        assertEquals(1, bootstrap.iceServers.length());
        assertFalse(bootstrap.iceServers.getJSONObject(0).has("username"));
        assertFalse(bootstrap.safeSummary().contains(PRODUCER));
    }

    @Test public void bootstrapRejectsUnknownFieldsAndSessionMismatch() throws Exception {
        JSONObject unknown = validBootstrap().put("caseMutation", true);
        assertThrows(IllegalArgumentException.class,
                () -> RemoteWitnessBootstrap.parse(unknown, "xr-session-contract-1", NOW));
        assertThrows(IllegalArgumentException.class,
                () -> RemoteWitnessBootstrap.parse(validBootstrap(), "another-session", NOW));
    }

    @Test public void bootstrapRejectsExpiredOrLeakedProducerCredential() throws Exception {
        JSONObject expired = validBootstrap().put("expiresAtMs", NOW);
        assertThrows(IllegalArgumentException.class,
                () -> RemoteWitnessBootstrap.parse(expired, "xr-session-contract-1", NOW));
        JSONObject leaked = validBootstrap().put(
                "joinUrl",
                "https://mxgenius.io/witness.html?invite=" + PRODUCER);
        assertThrows(IllegalArgumentException.class,
                () -> RemoteWitnessBootstrap.parse(leaked, "xr-session-contract-1", NOW));
    }

    @Test public void canonicalBootstrapFixtureIsAcceptedByAndroid() throws Exception {
        try (InputStream stream = getClass().getResourceAsStream("/witness-bootstrap.json")) {
            if (stream == null) throw new IllegalStateException("canonical witness bootstrap fixture is missing");
            JSONObject payload = new JSONObject(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
            RemoteWitnessBootstrap bootstrap = RemoteWitnessBootstrap.parse(payload, "xr-session-contract-1", NOW);
            assertEquals("wss://mxg-core.example.net/api/xr/witness/ws", bootstrap.socketUrl());
        }
    }

    private static JSONObject validBootstrap() throws Exception {
        return new JSONObject()
                .put("type", "witness.bootstrap")
                .put("version", 1)
                .put("sessionId", "xr-session-contract-1")
                .put("roomId", "11111111-1111-4111-8111-111111111111")
                .put("joinUrl", "https://mxgenius.io/witness.html?invite=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
                .put("manualCode", "0123456789AB")
                .put("producerCredential", PRODUCER)
                .put("socketPath", "/api/xr/witness/ws")
                .put("socketUrl", "wss://mxg-core.example.net/api/xr/witness/ws")
                .put("expiresAtMs", NOW + 60_000)
                .put("iceServers", new JSONArray().put(new JSONObject().put("urls", "stun:stun.example.net:3478")))
                .put("projection", new JSONObject()
                        .put("target", JSONObject.NULL)
                        .put("caseSummary", new JSONObject().put("caseId", "case-contract-1"))
                        .put("caseMedia", new JSONArray()));
    }
}
