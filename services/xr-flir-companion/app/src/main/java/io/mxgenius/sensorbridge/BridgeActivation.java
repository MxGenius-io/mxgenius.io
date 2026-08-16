package io.mxgenius.sensorbridge;

import android.content.Intent;
import android.net.Uri;

import java.net.URI;
import java.util.regex.Pattern;

final class BridgeActivation {
    static final String EXTRA_SESSION_ID = "io.mxgenius.sensorbridge.SESSION_ID";
    static final String EXTRA_BRIDGE_URL = "io.mxgenius.sensorbridge.BRIDGE_URL";
    static final String EXTRA_PILOT = "io.mxgenius.sensorbridge.PILOT";
    private static final Pattern SESSION_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");

    final String sessionId;
    final String bridgeUrl;
    final boolean insecurePilot;

    private BridgeActivation(String sessionId, String bridgeUrl, boolean insecurePilot) {
        this.sessionId = sessionId;
        this.bridgeUrl = bridgeUrl;
        this.insecurePilot = insecurePilot;
    }

    static BridgeActivation fromIntent(Intent intent, boolean debugBuild) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"mxgenius".equals(data.getScheme()) || !"sensor-bridge".equals(data.getHost())) {
            throw new IllegalArgumentException("Open this companion from the MxGenius XR page.");
        }
        String sessionId = data.getQueryParameter("sessionId");
        String bridgeUrl = data.getQueryParameter("bridge");
        boolean pilot = "1".equals(data.getQueryParameter("pilot"));
        if (!SESSION_ID.matcher(sessionId == null ? "" : sessionId).matches()) {
            throw new IllegalArgumentException("The XR session identifier is invalid.");
        }
        validateRelay(bridgeUrl, pilot, debugBuild);
        return new BridgeActivation(sessionId, bridgeUrl, pilot);
    }

    static BridgeActivation fromServiceIntent(Intent intent, boolean debugBuild) {
        String sessionId = intent.getStringExtra(EXTRA_SESSION_ID);
        String bridgeUrl = intent.getStringExtra(EXTRA_BRIDGE_URL);
        boolean pilot = intent.getBooleanExtra(EXTRA_PILOT, false);
        if (!SESSION_ID.matcher(sessionId == null ? "" : sessionId).matches()) {
            throw new IllegalArgumentException("The XR session identifier is invalid.");
        }
        validateRelay(bridgeUrl, pilot, debugBuild);
        return new BridgeActivation(sessionId, bridgeUrl, pilot);
    }

    void putInto(Intent intent) {
        intent.putExtra(EXTRA_SESSION_ID, sessionId);
        intent.putExtra(EXTRA_BRIDGE_URL, bridgeUrl);
        intent.putExtra(EXTRA_PILOT, insecurePilot);
    }

    String relayLabel() {
        try {
            URI uri = URI.create(bridgeUrl);
            int port = uri.getPort();
            return uri.getScheme() + "://" + uri.getHost() + (port < 0 ? "" : ":" + port);
        } catch (RuntimeException ignored) {
            return "invalid relay";
        }
    }

    private static void validateRelay(String bridgeUrl, boolean pilot, boolean debugBuild) {
        try {
            URI uri = URI.create(bridgeUrl == null ? "" : bridgeUrl);
            if (uri.getHost() == null) throw new IllegalArgumentException();
            if ("wss".equalsIgnoreCase(uri.getScheme())) return;
            if ("ws".equalsIgnoreCase(uri.getScheme()) && pilot && debugBuild) return;
        } catch (RuntimeException ignored) {
            // Fall through to the same user-facing validation error.
        }
        throw new IllegalArgumentException("A secure WSS relay is required (cleartext WS is debug-pilot only).");
    }
}
