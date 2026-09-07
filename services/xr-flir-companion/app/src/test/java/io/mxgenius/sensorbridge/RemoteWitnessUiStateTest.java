package io.mxgenius.sensorbridge;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class RemoteWitnessUiStateTest {
    private static final long NOW = 1_780_000_000_000L;

    @Test public void phaseTracksRoomAndPeerInsteadOfTreatingAnOpenSocketAsLive() throws Exception {
        RemoteWitnessUiState state = RemoteWitnessUiState.from(bootstrap()).withNetwork("connected");
        assertEquals(RemoteWitnessUiState.Phase.WAITING, state.phase(NOW));
        assertTrue(state.canStart(NOW));
        state = state.withMedia("ready-for-consent", "H264 available");
        assertEquals(RemoteWitnessUiState.Phase.WAITING, state.phase(NOW));
        state = state.withMedia("consent-requested", "wearer opened the prompt");
        assertEquals(RemoteWitnessUiState.Phase.CONNECTING, state.phase(NOW));

        state = state.withRoom(room("live", true, 1));
        assertEquals(RemoteWitnessUiState.Phase.CONNECTING, state.phase(NOW));
        assertFalse(state.canStart(NOW));
        assertTrue(state.canPause(NOW));

        state = state.withMedia("live", "H264 · 120 frames");
        assertEquals(RemoteWitnessUiState.Phase.LIVE, state.phase(NOW));

        state = state.withRoom(room("paused", true, 1));
        assertEquals(RemoteWitnessUiState.Phase.PAUSED, state.phase(NOW));
        assertTrue(state.canResume(NOW));

        state = state.ended("wearer-ended");
        assertEquals(RemoteWitnessUiState.Phase.ENDED, state.phase(NOW));
        assertFalse(state.canEnd(NOW));
    }

    @Test public void wearerProjectionContainsNoProducerCredential() throws Exception {
        RemoteWitnessUiState state = RemoteWitnessUiState.from(bootstrap()).withNetwork("connected");
        String visible = String.join("|", state.safeSummary(NOW), state.layersSummary(), state.pin);
        assertFalse(visible.contains("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"));
        assertEquals("7319042", state.pin);
        assertEquals("Guest witness", state.audience);
    }

    private static RemoteWitnessBootstrap bootstrap() throws Exception {
        JSONObject payload = new JSONObject()
                .put("type", "witness.bootstrap")
                .put("version", 1)
                .put("sessionId", "xr-session-contract-1")
                .put("roomId", "11111111-1111-4111-8111-111111111111")
                .put("pin", "7319042")
                .put("audience", "Guest witness")
                .put("producerCredential", "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789")
                .put("socketPath", "/api/xr/witness/ws")
                .put("socketUrl", "wss://mxg-core.example.net/api/xr/witness/ws")
                .put("expiresAtMs", NOW + 3_600_000L)
                .put("iceServers", new JSONArray());
        return RemoteWitnessBootstrap.parse(payload, "xr-session-contract-1", NOW);
    }

    private static JSONObject room(String status, boolean approved, int viewers) throws Exception {
        return new JSONObject()
                .put("roomId", "11111111-1111-4111-8111-111111111111")
                .put("audience", "Guest witness")
                .put("status", status)
                .put("approved", approved)
                .put("viewerCount", viewers)
                .put("expiresAtMs", NOW + 3_600_000L)
                .put("layers", new JSONObject()
                        .put("pov", true).put("thermal", false).put("target", true)
                        .put("caseSummary", true).put("caseMedia", false).put("microphone", false))
                .put("recording", new JSONObject().put("state", "off"));
    }
}
