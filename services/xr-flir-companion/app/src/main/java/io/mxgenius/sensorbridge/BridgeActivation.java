package io.mxgenius.sensorbridge;

import android.content.Intent;
import android.net.Uri;

import java.net.URI;
import java.util.regex.Pattern;

final class BridgeActivation {
    static final String EXTRA_SESSION_ID = "io.mxgenius.sensorbridge.SESSION_ID";
    static final String EXTRA_BRIDGE_URL = "io.mxgenius.sensorbridge.BRIDGE_URL";
    static final String EXTRA_LOCAL_TOKEN = "io.mxgenius.sensorbridge.LOCAL_TOKEN";
    static final String EXTRA_PILOT = "io.mxgenius.sensorbridge.PILOT";
    private static final Pattern SESSION_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");
    private static final Pattern LOCAL_TOKEN = Pattern.compile("^[A-Za-z0-9_-]{32,128}$");

    final String sessionId;
    final String bridgeUrl;
    final String localToken;
    final boolean insecurePilot;

    private BridgeActivation(String sessionId, String bridgeUrl, String localToken, boolean insecurePilot) {
        this.sessionId = sessionId;
        this.bridgeUrl = bridgeUrl;
        this.localToken = localToken;
        this.insecurePilot = insecurePilot;
    }

    static BridgeActivation fromIntent(Intent intent, boolean debugBuild) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"mxgenius".equals(data.getScheme()) || !"sensor-bridge".equals(data.getHost())) {
            throw new IllegalArgumentException("Open this companion from the MxGenius XR page.");
        }
        return validated(
                data.getQueryParameter("sessionId"),
                data.getQueryParameter("bridge"),
                data.getQueryParameter("localToken"),
                "1".equals(data.getQueryParameter("pilot")),
                debugBuild);
    }

    static BridgeActivation fromServiceIntent(Intent intent, boolean debugBuild) {
        if (intent == null) throw new IllegalArgumentException("Missing thermal activation.");
        return validated(
                intent.getStringExtra(EXTRA_SESSION_ID),
                intent.getStringExtra(EXTRA_BRIDGE_URL),
                intent.getStringExtra(EXTRA_LOCAL_TOKEN),
                intent.getBooleanExtra(EXTRA_PILOT, false),
                debugBuild);
    }

    void putInto(Intent intent) {
        intent.putExtra(EXTRA_SESSION_ID, sessionId);
        if (bridgeUrl != null) intent.putExtra(EXTRA_BRIDGE_URL, bridgeUrl);
        if (localToken != null) intent.putExtra(EXTRA_LOCAL_TOKEN, localToken);
        intent.putExtra(EXTRA_PILOT, insecurePilot);
    }

    String relayLabel() {
        if (localToken != null) return "Quest local · ws://127.0.0.1:" + LocalThermalBroker.DEFAULT_PORT;
        try {
            URI uri = URI.create(bridgeUrl);
            int port = uri.getPort();
            return uri.getScheme() + "://" + uri.getHost() + (port < 0 ? "" : ":" + port);
        } catch (RuntimeException ignored) {
            return "invalid relay";
        }
    }

    private static BridgeActivation validated(
            String sessionId,
            String bridgeUrl,
            String localToken,
            boolean pilot,
            boolean debugBuild) {
        if (!SESSION_ID.matcher(sessionId == null ? "" : sessionId).matches()) {
            throw new IllegalArgumentException("The XR session identifier is invalid.");
        }
        String normalizedBridge = bridgeUrl == null || bridgeUrl.isBlank() ? null : bridgeUrl;
        String normalizedToken = localToken == null || localToken.isBlank() ? null : localToken;
        if (normalizedToken != null && !LOCAL_TOKEN.matcher(normalizedToken).matches()) {
            throw new IllegalArgumentException("The Quest-local thermal token is invalid.");
        }
        if (normalizedBridge != null) validateRelay(normalizedBridge, pilot, debugBuild);
        if (normalizedBridge == null && normalizedToken == null) {
            throw new IllegalArgumentException("A Quest-local token or optional WSS relay is required.");
        }
        return new BridgeActivation(sessionId, normalizedBridge, normalizedToken, pilot);
    }

    private static void validateRelay(String bridgeUrl, boolean pilot, boolean debugBuild) {
        try {
            URI uri = URI.create(bridgeUrl);
            if (uri.getHost() == null) throw new IllegalArgumentException();
            if ("wss".equalsIgnoreCase(uri.getScheme())) return;
            if ("ws".equalsIgnoreCase(uri.getScheme()) && pilot && debugBuild) return;
        } catch (RuntimeException ignored) {
            // Fall through to the same user-facing validation error.
        }
        throw new IllegalArgumentException("An optional remote relay must use WSS (cleartext WS is debug-pilot only).");
    }
}
