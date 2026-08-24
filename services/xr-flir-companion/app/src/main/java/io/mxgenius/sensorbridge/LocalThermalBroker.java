package io.mxgenius.sensorbridge;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

final class LocalThermalBroker extends WebSocketServer {
    interface Listener {
        void onState(String state);
    }

    static final int DEFAULT_PORT = 4109;
    private static final String PATH = "/thermal";
    private final Set<String> allowedOrigins;
    private final Set<WebSocket> consumers = ConcurrentHashMap.newKeySet();
    private final String nodeId;
    private final Listener listener;
    private final CountDownLatch started = new CountDownLatch(1);
    private static final int HISTORY_LIMIT = 64;
    private final Object eventHistoryLock = new Object();
    private final ArrayDeque<String> eventHistory = new ArrayDeque<>();
    private volatile String sessionId;
    private volatile String token;
    private volatile String sourceStatus = "standby";
    private volatile String sourceReason;

    LocalThermalBroker(InetSocketAddress address, Set<String> allowedOrigins, String nodeId, Listener listener) {
        super(address);
        this.allowedOrigins = Set.copyOf(allowedOrigins);
        this.nodeId = nodeId;
        this.listener = listener;
        setReuseAddr(true);
        setConnectionLostTimeout(15);
    }

    void activate(String nextSessionId, String nextToken) {
        sessionId = nextSessionId;
        token = nextToken;
        for (WebSocket consumer : consumers) consumer.close(1008, "thermal session replaced");
        consumers.clear();
        listener.onState("local ready");
    }

    boolean hasConsumers() {
        return !consumers.isEmpty();
    }

    boolean awaitStarted(long timeout, TimeUnit unit) throws InterruptedException {
        return started.await(timeout, unit);
    }

    void publishSourceStatus(String status, String reason) {
        sourceStatus = status;
        sourceReason = reason;
        String message = sourceStatusJson();
        if (message == null) return;
        for (WebSocket consumer : consumers) if (consumer.isOpen()) consumer.send(message);
    }

    void publishBridgeStatus(String phase, boolean ready, String reason) {
        String message = bridgeStatusJson(phase, ready, reason);
        publishRetained(message);
    }

    void publishTrace(String step, String vector, String state, String detail, String level) {
        publishRetained(traceJson(step, vector, state, detail, level));
    }

    void publishFrame(byte[] frame) {
        if (frame == null) return;
        for (WebSocket consumer : consumers) if (consumer.isOpen()) consumer.send(frame);
    }

    @Override public void onOpen(WebSocket connection, ClientHandshake handshake) {
        if (!authorized(handshake)) {
            connection.close(1008, "invalid thermal session");
            return;
        }
        publishTrace("B03", "BROKER", "accepted", "browser origin and session token accepted", "success");
        consumers.add(connection);
        connection.send(helloJson());
        connection.send(nodeStatusJson());
        synchronized (eventHistoryLock) {
            for (String message : eventHistory) connection.send(message);
        }
        String status = sourceStatusJson();
        if (status != null) connection.send(status);
        listener.onState("local connected");
    }

    @Override public void onClose(WebSocket connection, int code, String reason, boolean remote) {
        consumers.remove(connection);
        listener.onState(consumers.isEmpty() ? "local ready" : "local connected");
    }

    @Override public void onMessage(WebSocket connection, String message) {
        if (message == null || message.isBlank()) return;
        try {
            JSONObject payload = new JSONObject(message);
            String type = payload.optString("type", "");
            if ("ping".equals(type)) {
                connection.send("{\"type\":\"pong\"}");
            } else if ("node.announce".equals(type)) {
                publishTrace("B04", "BROKER", "announced", "WebXR thermal-display client announced", "success");
            } else if ("bridge.session".equals(type)) {
                if (!sessionId.equals(payload.optString("sessionId", ""))) {
                    publishTrace("B05", "BROKER", "rejected", "WebXR session bind did not match activation", "error");
                    connection.close(1008, "thermal session mismatch");
                    return;
                }
                publishTrace("B05", "BROKER", "bound", "WebXR session bind matched activation", "success");
            } else if ("thermal.control".equals(type)) {
                publishTrace(
                        "B06",
                        "BROKER",
                        payload.optBoolean("enabled", false) ? "enabled" : "disabled",
                        "thermal display control received",
                        "info");
            }
        } catch (JSONException error) {
            publishTrace("B00", "BROKER", "protocol-error", "invalid browser control message", "error");
        }
    }

    @Override public void onMessage(WebSocket connection, java.nio.ByteBuffer message) {
        connection.close(1003, "consumer binary input is not supported");
    }

    @Override public void onError(WebSocket connection, Exception error) {
        if (connection == null) listener.onState("local failed");
    }

    @Override public void onStart() {
        started.countDown();
        listener.onState(token == null ? "waiting for scene activation" : "local ready");
    }

    private boolean authorized(ClientHandshake handshake) {
        if (sessionId == null || token == null) return false;
        String origin = handshake.getFieldValue("Origin");
        if (!allowedOrigins.contains(origin)) return false;
        try {
            URI resource = URI.create("ws://127.0.0.1" + handshake.getResourceDescriptor());
            if (!PATH.equals(resource.getPath())) return false;
            Map<String, String> query = queryParameters(resource.getRawQuery());
            return sessionId.equals(query.get("sessionId")) && secureEquals(token, query.get("token"));
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private String helloJson() {
        try {
            return new JSONObject()
                    .put("type", "bridge.hello")
                    .put("version", 1)
                    .put("role", "consumer")
                    .put("transport", "quest-loopback")
                    .put("frameProtocol", "MXGS/1")
                    .toString();
        } catch (JSONException error) {
            return "{\"type\":\"bridge.hello\",\"version\":1,\"role\":\"consumer\",\"transport\":\"quest-loopback\",\"frameProtocol\":\"MXGS/1\"}";
        }
    }

    private String nodeStatusJson() {
        try {
            JSONObject node = new JSONObject()
                    .put("nodeId", nodeId)
                    .put("nodeType", "quest-companion")
                    .put("nodeName", "MxGenius FLIR Companion")
                    .put("capabilities", new org.json.JSONArray()
                            .put("thermal-source")
                            .put("flir-one-pro-usb-c")
                            .put("mxgs-1")
                            .put("thermal-jpeg"));
            return new JSONObject().put("type", "node.status").put("status", "connected").put("node", node).toString();
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
    }

    private String sourceStatusJson() {
        if (sessionId == null) return null;
        try {
            JSONObject message = new JSONObject()
                    .put("type", "source.status")
                    .put("sourceType", "flir-one-pro")
                    .put("status", sourceStatus)
                    .put("sessionId", sessionId)
                    .put("observedAtMs", System.currentTimeMillis());
            if (sourceReason != null && !sourceReason.isBlank()) message.put("reason", sourceReason);
            return message.toString();
        } catch (JSONException error) {
            return null;
        }
    }

    private String bridgeStatusJson(String phase, boolean ready, String reason) {
        try {
            JSONObject message = new JSONObject()
                    .put("type", "bridge.status")
                    .put("phase", phase)
                    .put("ready", ready)
                    .put("version", BuildConfig.VERSION_NAME)
                    .put("observedAtMs", System.currentTimeMillis());
            if (reason != null && !reason.isBlank()) message.put("reason", reason);
            return message.toString();
        } catch (JSONException error) {
            return "{\"type\":\"bridge.status\",\"phase\":\"failed\",\"ready\":false}";
        }
    }

    private String traceJson(String step, String vector, String state, String detail, String level) {
        try {
            return new JSONObject()
                    .put("type", "bridge.trace")
                    .put("step", step)
                    .put("vector", vector)
                    .put("state", state)
                    .put("detail", detail)
                    .put("level", level)
                    .put("observedAtMs", System.currentTimeMillis())
                    .toString();
        } catch (JSONException error) {
            return "{\"type\":\"bridge.trace\",\"step\":\"N00\",\"vector\":\"BRIDGE\",\"state\":\"trace-error\",\"level\":\"error\"}";
        }
    }

    private void publishRetained(String message) {
        synchronized (eventHistoryLock) {
            if (eventHistory.size() >= HISTORY_LIMIT) eventHistory.removeFirst();
            eventHistory.addLast(message);
        }
        for (WebSocket consumer : consumers) if (consumer.isOpen()) consumer.send(message);
    }

    private static Map<String, String> queryParameters(String rawQuery) {
        Map<String, String> result = new java.util.HashMap<>();
        if (rawQuery == null || rawQuery.isBlank()) return result;
        for (String pair : rawQuery.split("&")) {
            String[] parts = pair.split("=", 2);
            String key = URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
            String value = parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "";
            result.put(key, value);
        }
        return result;
    }

    private static boolean secureEquals(String expected, String actual) {
        if (actual == null) return false;
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                actual.getBytes(StandardCharsets.UTF_8));
    }
}
