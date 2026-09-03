package io.mxgenius.sensorbridge;

import org.json.JSONObject;
import org.json.JSONException;

import java.util.Locale;

/** Credential-free, immutable projection of the native Remote Witness session for the wearer. */
public final class RemoteWitnessUiState {
    enum Phase { WAITING, CONNECTING, LIVE, PAUSED, ENDED, ERROR }

    static final RemoteWitnessUiState EMPTY = new RemoteWitnessUiState(
            null, "Aircraft customer", "none", false, 0, 0L,
            null, null, null, "offline", "idle", null,
            true, false, true, false, false, false, "off");

    final String roomId;
    final String audience;
    final String roomStatus;
    final boolean approved;
    final int viewerCount;
    final long expiresAtMs;
    final String manualCode;
    final String joinUrl;
    final String qrDataUrl;
    final String networkState;
    final String mediaState;
    final String error;
    final boolean pov;
    final boolean thermal;
    final boolean target;
    final boolean caseSummary;
    final boolean caseMedia;
    final boolean microphone;
    final String recordingState;

    private RemoteWitnessUiState(
            String roomId,
            String audience,
            String roomStatus,
            boolean approved,
            int viewerCount,
            long expiresAtMs,
            String manualCode,
            String joinUrl,
            String qrDataUrl,
            String networkState,
            String mediaState,
            String error,
            boolean pov,
            boolean thermal,
            boolean target,
            boolean caseSummary,
            boolean caseMedia,
            boolean microphone,
            String recordingState) {
        this.roomId = roomId;
        this.audience = bounded(audience, "Aircraft customer", 80);
        this.roomStatus = bounded(roomStatus, "unknown", 32);
        this.approved = approved;
        this.viewerCount = Math.max(0, Math.min(4, viewerCount));
        this.expiresAtMs = Math.max(0L, expiresAtMs);
        this.manualCode = manualCode;
        this.joinUrl = joinUrl;
        this.qrDataUrl = qrDataUrl;
        this.networkState = bounded(networkState, "offline", 48);
        this.mediaState = bounded(mediaState, "idle", 48);
        this.error = error == null ? null : bounded(error, "Witness unavailable", 160);
        this.pov = pov;
        this.thermal = thermal;
        this.target = target;
        this.caseSummary = caseSummary;
        this.caseMedia = caseMedia;
        this.microphone = microphone;
        this.recordingState = bounded(recordingState, "off", 24);
    }

    static RemoteWitnessUiState from(RemoteWitnessBootstrap bootstrap) {
        if (bootstrap == null) return EMPTY;
        return new RemoteWitnessUiState(
                bootstrap.roomId.toString(), bootstrap.audience, "headset-offline", false, 0,
                bootstrap.expiresAtMs, bootstrap.manualCode, bootstrap.joinUrl, bootstrap.qrDataUrl,
                "connecting", "idle", null,
                true, false, true, true, false, false, "off");
    }

    RemoteWitnessUiState withRoom(JSONObject room) {
        if (room == null || roomId == null || !roomId.equals(room.optString("roomId"))) return this;
        JSONObject layers = room.optJSONObject("layers");
        JSONObject recording = room.optJSONObject("recording");
        return copy(
                bounded(room.optString("audience", audience), audience, 80),
                bounded(room.optString("status", roomStatus), roomStatus, 32),
                room.optBoolean("approved", approved),
                room.optInt("viewerCount", viewerCount),
                room.optLong("expiresAtMs", expiresAtMs),
                networkState,
                mediaState,
                null,
                layers == null ? pov : layers.optBoolean("pov", pov),
                layers == null ? thermal : layers.optBoolean("thermal", thermal),
                layers == null ? target : layers.optBoolean("target", target),
                layers == null ? caseSummary : layers.optBoolean("caseSummary", caseSummary),
                layers == null ? caseMedia : layers.optBoolean("caseMedia", caseMedia),
                layers == null ? microphone : layers.optBoolean("microphone", microphone),
                recording == null ? recordingState : recording.optString("state", recordingState));
    }

    RemoteWitnessUiState withNetwork(String state) {
        String nextError = state != null && state.startsWith("server-error:")
                ? state.substring("server-error:".length()).replace('-', ' ')
                : error;
        return copy(audience, roomStatus, approved, viewerCount, expiresAtMs,
                state, mediaState, nextError, pov, thermal, target, caseSummary, caseMedia, microphone,
                recordingState);
    }

    RemoteWitnessUiState withMedia(String state, String detail) {
        boolean failed = state != null && (state.contains("failed") || state.contains("rejected")
                || state.contains("consent-required"));
        return copy(audience, roomStatus, approved, viewerCount, expiresAtMs,
                networkState, state, failed ? bounded(detail, "Witness media failed", 160) : null,
                pov, thermal, target, caseSummary, caseMedia, microphone, recordingState);
    }

    RemoteWitnessUiState ended(String reason) {
        return new RemoteWitnessUiState(
                null, audience, "ended", approved, 0, expiresAtMs,
                null, null, null, "closed", "stopped",
                bounded(reason, "Session ended", 160),
                pov, thermal, target, caseSummary, caseMedia, microphone, "off");
    }

    Phase phase(long nowMs) {
        if (roomId == null) return Phase.ENDED;
        if (nowMs >= expiresAtMs || "revoked".equals(roomStatus) || "expired".equals(roomStatus)
                || "ended".equals(roomStatus)) return Phase.ENDED;
        if (error != null) return Phase.ERROR;
        if ("paused".equals(roomStatus)) return Phase.PAUSED;
        if ("live".equals(mediaState)) return Phase.LIVE;
        if ("live".equals(roomStatus) || approved || isConnectingMedia(mediaState)) return Phase.CONNECTING;
        return Phase.WAITING;
    }

    boolean canStart(long nowMs) {
        Phase phase = phase(nowMs);
        return roomId != null && "connected".equals(networkState)
                && (phase == Phase.WAITING || phase == Phase.ERROR);
    }

    boolean canPause(long nowMs) {
        Phase phase = phase(nowMs);
        return phase == Phase.CONNECTING || phase == Phase.LIVE;
    }

    boolean canResume(long nowMs) {
        return phase(nowMs) == Phase.PAUSED && "connected".equals(networkState);
    }

    boolean canEnd(long nowMs) {
        return roomId != null && phase(nowMs) != Phase.ENDED;
    }

    String layersSummary() {
        StringBuilder value = new StringBuilder(pov ? "POV" : "POV OFF");
        if (thermal) value.append(" · THERMAL");
        if (target) value.append(" · TARGET");
        if (caseSummary) value.append(" · CASE");
        if (caseMedia) value.append(" · MEDIA");
        if (microphone) value.append(" · MIC");
        return value.toString();
    }

    JSONObject toggledExtras() {
        boolean enable = !(thermal || caseMedia);
        try {
            return new JSONObject()
                    .put("pov", true)
                    .put("thermal", enable)
                    .put("target", target)
                    .put("caseSummary", caseSummary)
                    .put("caseMedia", enable)
                    .put("microphone", false);
        } catch (JSONException error) {
            throw new IllegalStateException("could not create witness layer control", error);
        }
    }

    String safeSummary(long nowMs) {
        return phase(nowMs).name() + " · " + viewerCount + " viewer"
                + (viewerCount == 1 ? "" : "s") + " · " + networkState.toUpperCase(Locale.US);
    }

    private RemoteWitnessUiState copy(
            String audience,
            String roomStatus,
            boolean approved,
            int viewerCount,
            long expiresAtMs,
            String networkState,
            String mediaState,
            String error,
            boolean pov,
            boolean thermal,
            boolean target,
            boolean caseSummary,
            boolean caseMedia,
            boolean microphone,
            String recordingState) {
        return new RemoteWitnessUiState(roomId, audience, roomStatus, approved, viewerCount, expiresAtMs,
                manualCode, joinUrl, qrDataUrl, networkState, mediaState, error,
                pov, thermal, target, caseSummary, caseMedia, microphone, recordingState);
    }

    private static boolean isConnectingMedia(String state) {
        return state != null && (state.startsWith("capture") || state.startsWith("negotiating")
                || state.startsWith("answer") || state.startsWith("peer-connecting")
                || state.startsWith("peer-new") || state.startsWith("consent-requested")
                || state.startsWith("consent-granted"));
    }

    private static String bounded(String value, String fallback, int maximum) {
        if (value == null || value.isBlank()) return fallback;
        return value.length() <= maximum ? value : value.substring(0, maximum);
    }
}
