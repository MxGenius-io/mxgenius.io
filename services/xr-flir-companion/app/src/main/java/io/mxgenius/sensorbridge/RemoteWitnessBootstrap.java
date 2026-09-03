package io.mxgenius.sensorbridge;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.util.Base64;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * One-time, memory-only handoff from the authenticated Quest browser session.
 * The producer credential must never be rendered, persisted, or included in a URL.
 */
final class RemoteWitnessBootstrap {
    static final int VERSION = 1;
    static final String SOCKET_PATH = "/api/xr/witness/ws";
    private static final long MAX_SESSION_LIFETIME_MS = 4L * 60L * 60L * 1000L;
    private static final Pattern SESSION_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");
    private static final Pattern CREDENTIAL = Pattern.compile("^[a-f0-9]{64}$");
    private static final Pattern MANUAL_CODE = Pattern.compile("^[A-F0-9]{12}$");
    private static final Pattern INVITE_QUERY = Pattern.compile("^invite=[A-Fa-f0-9]{64}$");
    private static final Pattern ICE_URL = Pattern.compile("^(stun:|stuns:|turn:|turns:).{1,1018}$");
    private static final String QR_PREFIX = "data:image/svg+xml;base64,";
    private static final Set<String> MESSAGE_KEYS = Set.of(
            "type", "version", "sessionId", "roomId", "joinUrl", "manualCode",
            "audience", "qrDataUrl", "producerCredential", "socketPath", "socketUrl",
            "expiresAtMs", "iceServers", "projection");
    private static final Set<String> ICE_KEYS = Set.of("urls", "username", "credential", "credentialType");
    private static final Set<String> PROJECTION_KEYS = Set.of("target", "caseSummary", "caseMedia");

    final String sessionId;
    final UUID roomId;
    final String joinUrl;
    final String manualCode;
    final String audience;
    final String qrDataUrl;
    final String producerCredential;
    final String socketPath;
    final String socketUrl;
    final long expiresAtMs;
    final JSONArray iceServers;
    final JSONObject projection;

    private RemoteWitnessBootstrap(
            String sessionId,
            UUID roomId,
            String joinUrl,
            String manualCode,
            String audience,
            String qrDataUrl,
            String producerCredential,
            String socketPath,
            String socketUrl,
            long expiresAtMs,
            JSONArray iceServers,
            JSONObject projection) {
        this.sessionId = sessionId;
        this.roomId = roomId;
        this.joinUrl = joinUrl;
        this.manualCode = manualCode;
        this.audience = audience;
        this.qrDataUrl = qrDataUrl;
        this.producerCredential = producerCredential;
        this.socketPath = socketPath;
        this.socketUrl = socketUrl;
        this.expiresAtMs = expiresAtMs;
        this.iceServers = iceServers;
        this.projection = projection;
    }

    static RemoteWitnessBootstrap parse(JSONObject payload, String expectedSessionId, long nowMs) {
        requireExactKeys(payload, MESSAGE_KEYS);
        if (!"witness.bootstrap".equals(payload.optString("type"))
                || payload.optInt("version", -1) != VERSION) {
            throw new IllegalArgumentException("unsupported witness bootstrap");
        }
        String sessionId = required(payload, "sessionId", 128);
        if (!SESSION_ID.matcher(sessionId).matches() || !sessionId.equals(expectedSessionId)) {
            throw new IllegalArgumentException("witness session mismatch");
        }
        UUID roomId;
        try {
            roomId = UUID.fromString(required(payload, "roomId", 36));
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("invalid witness room", error);
        }
        String joinUrl = required(payload, "joinUrl", 1024);
        validateJoinUrl(joinUrl);
        String manualCode = required(payload, "manualCode", 12);
        if (!MANUAL_CODE.matcher(manualCode).matches()) {
            throw new IllegalArgumentException("invalid witness manual code");
        }
        String audience = optional(payload, "audience", "Aircraft customer", 80);
        String qrDataUrl = optional(payload, "qrDataUrl", null, 32 * 1024);
        if (qrDataUrl != null) validateQrDataUrl(qrDataUrl);
        String producerCredential = required(payload, "producerCredential", 64);
        if (!CREDENTIAL.matcher(producerCredential).matches()) {
            throw new IllegalArgumentException("invalid witness producer credential");
        }
        if (joinUrl.contains(producerCredential)) {
            throw new IllegalArgumentException("producer credential leaked into witness URL");
        }
        String socketPath = required(payload, "socketPath", 64);
        if (!SOCKET_PATH.equals(socketPath)) {
            throw new IllegalArgumentException("invalid witness socket path");
        }
        String socketUrl = required(payload, "socketUrl", 1024);
        validateSocketUrl(socketUrl, socketPath, producerCredential);
        long expiresAtMs;
        try {
            expiresAtMs = payload.getLong("expiresAtMs");
        } catch (JSONException error) {
            throw new IllegalArgumentException("invalid witness expiry", error);
        }
        if (expiresAtMs <= nowMs || expiresAtMs - nowMs > MAX_SESSION_LIFETIME_MS) {
            throw new IllegalArgumentException("witness session expiry is outside the allowed window");
        }
        JSONArray iceServers = payload.optJSONArray("iceServers");
        if (iceServers == null || iceServers.length() > 4) {
            throw new IllegalArgumentException("invalid witness ICE configuration");
        }
        validateIceServers(iceServers);
        JSONObject projection = payload.optJSONObject("projection");
        if (projection != null) validateProjection(projection);
        return new RemoteWitnessBootstrap(
                sessionId,
                roomId,
                joinUrl,
                manualCode,
                audience,
                qrDataUrl,
                producerCredential,
                socketPath,
                socketUrl,
                expiresAtMs,
                copyArray(iceServers),
                projection == null ? null : copyObject(projection));
    }

    String safeSummary() {
        return roomId + " · expires " + expiresAtMs + " · " + iceServers.length() + " ICE server(s)";
    }

    String socketUrl() {
        return socketUrl;
    }

    private static void validateJoinUrl(String value) {
        try {
            URI uri = URI.create(value);
            if (!"https".equalsIgnoreCase(uri.getScheme())
                    || uri.getHost() == null
                    || uri.getHost().isBlank()
                    || uri.getUserInfo() != null
                    || uri.getFragment() != null
                    || !INVITE_QUERY.matcher(uri.getRawQuery() == null ? "" : uri.getRawQuery()).matches()) {
                throw new IllegalArgumentException("invalid witness join URL");
            }
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("invalid witness join URL", error);
        }
    }

    private static void validateSocketUrl(String value, String expectedPath, String producerCredential) {
        try {
            URI uri = URI.create(value);
            if (!"wss".equalsIgnoreCase(uri.getScheme())
                    || uri.getHost() == null
                    || uri.getHost().isBlank()
                    || uri.getUserInfo() != null
                    || uri.getQuery() != null
                    || uri.getFragment() != null
                    || !expectedPath.equals(uri.getPath())
                    || value.contains(producerCredential)) {
                throw new IllegalArgumentException("invalid witness socket URL");
            }
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("invalid witness socket URL", error);
        }
    }

    private static void validateQrDataUrl(String value) {
        if (!value.startsWith(QR_PREFIX)) throw new IllegalArgumentException("invalid witness QR data URL");
        try {
            byte[] decoded = Base64.getDecoder().decode(value.substring(QR_PREFIX.length()));
            String svg = new String(decoded, java.nio.charset.StandardCharsets.UTF_8);
            if (decoded.length > 24 * 1024 || !svg.startsWith("<svg ") || !svg.contains("<path ")) {
                throw new IllegalArgumentException("invalid witness QR image");
            }
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("invalid witness QR image", error);
        }
    }

    private static void validateIceServers(JSONArray servers) {
        for (int index = 0; index < servers.length(); index++) {
            JSONObject server = servers.optJSONObject(index);
            if (server == null) throw new IllegalArgumentException("invalid witness ICE server");
            requireExactKeys(server, ICE_KEYS);
            Object urls = server.opt("urls");
            if (urls instanceof String value) {
                validateIceUrl(value);
            } else if (urls instanceof JSONArray values) {
                if (values.length() < 1 || values.length() > 4) {
                    throw new IllegalArgumentException("invalid witness ICE URL list");
                }
                for (int item = 0; item < values.length(); item++) {
                    Object raw = values.opt(item);
                    if (!(raw instanceof String)) throw new IllegalArgumentException("invalid witness ICE URL");
                    validateIceUrl((String) raw);
                }
            } else {
                throw new IllegalArgumentException("witness ICE server requires urls");
            }
            boundedOptional(server, "username", 256);
            boundedOptional(server, "credential", 256);
            if (server.has("credentialType") && !"password".equals(server.optString("credentialType"))) {
                throw new IllegalArgumentException("unsupported witness ICE credential type");
            }
        }
    }

    private static void validateIceUrl(String value) {
        if (!ICE_URL.matcher(value).matches()) throw new IllegalArgumentException("invalid witness ICE URL");
    }

    private static void validateProjection(JSONObject projection) {
        requireExactKeys(projection, PROJECTION_KEYS);
        if (projection.toString().length() > 32 * 1024) {
            throw new IllegalArgumentException("witness projection is too large");
        }
        JSONArray media = projection.optJSONArray("caseMedia");
        if (media != null && media.length() > 8) {
            throw new IllegalArgumentException("witness projection has too much case media");
        }
    }

    private static String required(JSONObject payload, String key, int maximum) {
        String value = payload.optString(key, "");
        if (value.isBlank() || value.length() > maximum) {
            throw new IllegalArgumentException("invalid witness " + key);
        }
        return value;
    }

    private static String optional(JSONObject payload, String key, String fallback, int maximum) {
        if (!payload.has(key) || payload.isNull(key)) return fallback;
        Object raw = payload.opt(key);
        if (!(raw instanceof String value) || value.isBlank() || value.length() > maximum) {
            throw new IllegalArgumentException("invalid witness " + key);
        }
        return value;
    }

    private static void boundedOptional(JSONObject payload, String key, int maximum) {
        if (!payload.has(key)) return;
        Object raw = payload.opt(key);
        if (!(raw instanceof String) || ((String) raw).length() > maximum) {
            throw new IllegalArgumentException("invalid witness " + key);
        }
    }

    private static void requireExactKeys(JSONObject payload, Set<String> allowed) {
        java.util.Iterator<String> keys = payload.keys();
        while (keys.hasNext()) {
            if (!allowed.contains(keys.next())) {
                throw new IllegalArgumentException("unknown witness field");
            }
        }
    }

    private static JSONArray copyArray(JSONArray value) {
        try {
            return new JSONArray(value.toString());
        } catch (JSONException error) {
            throw new IllegalArgumentException("invalid witness ICE configuration", error);
        }
    }

    private static JSONObject copyObject(JSONObject value) {
        try {
            return new JSONObject(value.toString());
        } catch (JSONException error) {
            throw new IllegalArgumentException("invalid witness projection", error);
        }
    }
}
