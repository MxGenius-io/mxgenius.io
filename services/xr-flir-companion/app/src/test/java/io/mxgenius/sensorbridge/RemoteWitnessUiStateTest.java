package io.mxgenius.sensorbridge;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

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
        String visible = String.join("|", state.safeSummary(NOW), state.layersSummary(),
                state.joinUrl, state.manualCode);
        assertFalse(visible.contains("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"));
        assertEquals("Aircraft customer", state.audience);
    }

    @Test public void qrDecoderAcceptsOnlyTheBoundedCoreSvgShape() {
        StringBuilder path = new StringBuilder();
        for (int y = 4; y < 15; y++) for (int x = 4; x < 15; x++) {
            path.append('M').append(x).append(' ').append(y).append("h1v1h-1z");
        }
        String svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 29 29\" "
                + "shape-rendering=\"crispEdges\"><rect width=\"100%\" height=\"100%\" fill=\"#fff\"/>"
                + "<path d=\"" + path + "\" fill=\"#000\"/></svg>";
        String dataUrl = "data:image/svg+xml;base64," + Base64.getEncoder()
                .encodeToString(svg.getBytes(StandardCharsets.UTF_8));
        boolean[][] modules = RemoteWitnessQrCode.decode(dataUrl);
        assertEquals(29, modules.length);
        assertTrue(modules[4][4]);
    }

    private static RemoteWitnessBootstrap bootstrap() throws Exception {
        JSONObject payload = new JSONObject()
                .put("type", "witness.bootstrap")
                .put("version", 1)
                .put("sessionId", "xr-session-contract-1")
                .put("roomId", "11111111-1111-4111-8111-111111111111")
                .put("joinUrl", "https://mxgenius.io/witness.html?invite=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
                .put("manualCode", "0123456789AB")
                .put("audience", "Aircraft customer")
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
                .put("audience", "Aircraft customer")
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
