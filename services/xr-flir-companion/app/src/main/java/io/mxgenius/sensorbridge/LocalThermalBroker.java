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
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

final class LocalThermalBroker extends WebSocketServer {
    interface Listener {
        void onState(String state);
    }

    interface SnapshotResponder {
        void success(byte[] jpeg, int width, int height, String eye);
        void failure(String code, String detail);
    }

    interface SnapshotHandler {
        void request(String requestId, SnapshotResponder responder);
    }

    interface CommissioningHandler {
        void acknowledgeBrowser(String runId, int renderedFrames);
    }

    interface WitnessBootstrapHandler {
        CompletionStage<Void> accept(RemoteWitnessBootstrap bootstrap);
    }

    static final int DEFAULT_PORT = 4109;
    private static final String PATH = "/thermal";
    private final Set<String> allowedOrigins;
    private final Set<WebSocket> consumers = ConcurrentHashMap.newKeySet();
    private final Set<WebSocket> sessionBoundConsumers = ConcurrentHashMap.newKeySet();
    private final String nodeId;
    private final Listener listener;
    private final SnapshotHandler snapshotHandler;
    private final CommissioningHandler commissioningHandler;
    private final WitnessBootstrapHandler witnessBootstrapHandler;
    private final CountDownLatch started = new CountDownLatch(1);
    private static final int HISTORY_LIMIT = 64;
    private final Object eventHistoryLock = new Object();
    private final ArrayDeque<String> eventHistory = new ArrayDeque<>();
    private volatile String sessionId;
    private volatile String token;
    private volatile String sourceStatus = "standby";
    private volatile String sourceReason;
    private volatile UUID acceptedWitnessRoomId;

    LocalThermalBroker(InetSocketAddress address, Set<String> allowedOrigins, String nodeId, Listener listener) {
        this(address, allowedOrigins, nodeId, listener,
                (requestId, responder) -> responder.failure("snapshot-unavailable", "headset snapshot capture is unavailable"),
                (runId, renderedFrames) -> {},
                bootstrap -> unavailableWitnessBootstrap());
    }

    LocalThermalBroker(
            InetSocketAddress address,
            Set<String> allowedOrigins,
            String nodeId,
            Listener listener,
            SnapshotHandler snapshotHandler) {
        this(address, allowedOrigins, nodeId, listener, snapshotHandler, (runId, renderedFrames) -> {},
                bootstrap -> unavailableWitnessBootstrap());
    }

    LocalThermalBroker(
            InetSocketAddress address,
            Set<String> allowedOrigins,
            String nodeId,
            Listener listener,
            SnapshotHandler snapshotHandler,
            CommissioningHandler commissioningHandler) {
        this(address, allowedOrigins, nodeId, listener, snapshotHandler, commissioningHandler,
                bootstrap -> unavailableWitnessBootstrap());
    }

    LocalThermalBroker(
            InetSocketAddress address,
            Set<String> allowedOrigins,
            String nodeId,
            Listener listener,
            SnapshotHandler snapshotHandler,
            CommissioningHandler commissioningHandler,
            WitnessBootstrapHandler witnessBootstrapHandler) {
        super(address);
        this.allowedOrigins = Set.copyOf(allowedOrigins);
        this.nodeId = nodeId;
        this.listener = listener;
        this.snapshotHandler = snapshotHandler;
        this.commissioningHandler = commissioningHandler;
        this.witnessBootstrapHandler = witnessBootstrapHandler;
        setReuseAddr(true);
        setConnectionLostTimeout(15);
    }

    void activate(String nextSessionId, String nextToken) {
        sessionId = nextSessionId;
        token = nextToken;
        for (WebSocket consumer : consumers) consumer.close(1008, "thermal session replaced");
        consumers.clear();
        sessionBoundConsumers.clear();
        acceptedWitnessRoomId = null;
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

    void publishCommissioning(String reportJson) {
        if (reportJson != null && !reportJson.isBlank()) publishRetained(reportJson);
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
        sessionBoundConsumers.remove(connection);
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
                sessionBoundConsumers.add(connection);
                publishTrace("B05", "BROKER", "bound", "WebXR session bind matched activation", "success");
            } else if ("witness.bootstrap".equals(type)) {
                acceptWitnessBootstrap(connection, payload);
            } else if ("thermal.control".equals(type)) {
                publishTrace(
                        "B06",
                        "BROKER",
                        payload.optBoolean("enabled", false) ? "enabled" : "disabled",
                        "thermal display control received",
                        "info");
            } else if ("headset.snapshot.request".equals(type)) {
                String requestId = payload.optString("requestId", "");
                if (!requestId.matches("^[A-Za-z0-9_-]{8,80}$")) {
                    sendSnapshotFailure(connection, requestId, "snapshot-request", "snapshot request id is invalid");
                    return;
                }
                String purpose = payload.optString("purpose", "evidence");
                String scanId = payload.optString("scanId", "");
                if (!("scan".equals(purpose) || "evidence".equals(purpose))) {
                    sendSnapshotFailure(connection, requestId, "snapshot-purpose", "snapshot purpose must be scan or evidence");
                    return;
                }
                if ("scan".equals(purpose) && !scanId.matches("^[A-Za-z0-9_-]{8,80}$")) {
                    sendSnapshotFailure(connection, requestId, purpose, scanId, "snapshot-scan-id", "scan id is invalid");
                    return;
                }
                publishTrace("B07", "SNAPSHOT", "requested", "authenticated WebXR client requested one " + purpose + " frame", "info");
                snapshotHandler.request(requestId, new SnapshotResponder() {
                    @Override public void success(byte[] jpeg, int width, int height, String eye) {
                        sendSnapshotSuccess(connection, requestId, purpose, scanId, jpeg, width, height, eye);
                    }

                    @Override public void failure(String code, String detail) {
                        sendSnapshotFailure(connection, requestId, purpose, scanId, code, detail);
                    }
                });
            } else if ("commissioning.browser_ack".equals(type)) {
                String runId = payload.optString("runId", "");
                int renderedFrames = payload.optInt("renderedFrames", 0);
                if (!runId.matches("^[A-Za-z0-9_-]{8,80}$") || renderedFrames < 1 || renderedFrames > 10_000) {
                    publishTrace("B10", "COMMISSION", "rejected", "browser render acknowledgement was malformed", "error");
                    return;
                }
                publishTrace("B10", "COMMISSION", "acknowledged", "authenticated browser rendered " + renderedFrames + " ordered frames", "success");
                commissioningHandler.acknowledgeBrowser(runId, renderedFrames);
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
                            .put("thermal-jpeg")
                            .put("headset-snapshot")
                            .put("thermal-commissioning-v1")
                            .put("remote-witness-bootstrap-v1"));
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

    private void acceptWitnessBootstrap(WebSocket connection, JSONObject payload) {
        String roomId = safeRoomId(payload.optString("roomId", ""));
        if (!sessionBoundConsumers.contains(connection)) {
            sendWitnessBootstrapAck(connection, roomId, "rejected", "session-bind-required");
            return;
        }
        try {
            RemoteWitnessBootstrap bootstrap = RemoteWitnessBootstrap.parse(payload, sessionId, System.currentTimeMillis());
            UUID currentRoom = acceptedWitnessRoomId;
            if (currentRoom != null) {
                sendWitnessBootstrapAck(connection, roomId, "rejected", "bootstrap-already-bound");
                return;
            }
            acceptedWitnessRoomId = bootstrap.roomId;
            String expectedSessionId = sessionId;
            CompletionStage<Void> ready = witnessBootstrapHandler.accept(bootstrap);
            if (ready == null) throw new IllegalStateException("native witness bootstrap returned no readiness stage");
            ready.whenComplete((ignored, error) -> {
                if (!bootstrap.roomId.equals(acceptedWitnessRoomId)
                        || !expectedSessionId.equals(sessionId)) return;
                if (error != null) {
                    acceptedWitnessRoomId = null;
                    publishTrace("W20", "WITNESS", "rejected", "native witness producer could not connect", "error");
                    sendWitnessBootstrapAck(connection, roomId, "rejected", "native-producer-unavailable");
                    return;
                }
                publishTrace("W20", "WITNESS", "bound", "native witness producer connected for room " + bootstrap.roomId, "success");
                sendWitnessBootstrapAck(connection, bootstrap.roomId.toString(), "accepted", null);
            });
        } catch (RuntimeException error) {
            acceptedWitnessRoomId = null;
            publishTrace("W20", "WITNESS", "rejected", "native witness bootstrap failed validation", "error");
            sendWitnessBootstrapAck(connection, roomId, "rejected", "invalid-bootstrap");
        }
    }

    private static String safeRoomId(String candidate) {
        try {
            return UUID.fromString(candidate).toString();
        } catch (RuntimeException ignored) {
            return "00000000-0000-0000-0000-000000000000";
        }
    }

    private static CompletionStage<Void> unavailableWitnessBootstrap() {
        CompletableFuture<Void> unavailable = new CompletableFuture<>();
        unavailable.completeExceptionally(new IllegalStateException("native witness producer unavailable"));
        return unavailable;
    }

    private void sendWitnessBootstrapAck(
            WebSocket connection,
            String roomId,
            String status,
            String code) {
        if (!connection.isOpen() || !consumers.contains(connection)) return;
        try {
            JSONObject ack = new JSONObject()
                    .put("type", "witness.bootstrap.ack")
                    .put("version", RemoteWitnessBootstrap.VERSION)
                    .put("sessionId", sessionId)
                    .put("roomId", roomId)
                    .put("status", status)
                    .put("observedAtMs", System.currentTimeMillis());
            if (code != null) ack.put("code", code);
            connection.send(ack.toString());
        } catch (JSONException ignored) {
            connection.close(1011, "witness bootstrap acknowledgement failed");
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

    private void sendSnapshotSuccess(
            WebSocket connection,
            String requestId,
            String purpose,
            String scanId,
            byte[] jpeg,
            int width,
            int height,
            String eye) {
        if (jpeg == null || jpeg.length == 0 || jpeg.length > 1024 * 1024) {
            sendSnapshotFailure(connection, requestId, purpose, scanId, "snapshot-size", "snapshot JPEG exceeded the transport limit");
            return;
        }
        if (!connection.isOpen() || !consumers.contains(connection)) return;
        try {
            String dataUrl = "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(jpeg);
            JSONObject result = new JSONObject()
                    .put("type", "headset.snapshot.result")
                    .put("requestId", requestId)
                    .put("purpose", purpose)
                    .put("status", "ok")
                    .put("mimeType", "image/jpeg")
                    .put("width", width)
                    .put("height", height)
                    .put("eye", eye)
                    .put("capturedAtMs", System.currentTimeMillis())
                    .put("camera", new JSONObject()
                            .put("source", "quest-passthrough")
                            .put("eye", eye)
                            .put("poseAvailable", false)
                            .put("intrinsicsAvailable", false))
                    .put("dataUrl", dataUrl);
            if (!scanId.isBlank()) result.put("scanId", scanId);
            connection.send(result.toString());
            publishTrace("B09", "SNAPSHOT", "delivered", "one " + purpose + " JPEG returned to its requesting WebXR client", "success");
        } catch (JSONException error) {
            sendSnapshotFailure(connection, requestId, purpose, scanId, "snapshot-encode", "snapshot result could not be encoded");
        }
    }

    private void sendSnapshotFailure(WebSocket connection, String requestId, String code, String detail) {
        sendSnapshotFailure(connection, requestId, "", "", code, detail);
    }

    private void sendSnapshotFailure(
            WebSocket connection,
            String requestId,
            String purpose,
            String scanId,
            String code,
            String detail) {
        if (!connection.isOpen()) return;
        try {
            JSONObject result = new JSONObject()
                    .put("type", "headset.snapshot.result")
                    .put("requestId", requestId == null ? "" : requestId)
                    .put("status", "failed")
                    .put("code", cleanProtocolText(code, "snapshot-failed"))
                    .put("detail", cleanProtocolText(detail, "headset snapshot failed"))
                    .put("capturedAtMs", System.currentTimeMillis());
            if ("scan".equals(purpose) || "evidence".equals(purpose)) result.put("purpose", purpose);
            if (scanId != null && scanId.matches("^[A-Za-z0-9_-]{8,80}$")) result.put("scanId", scanId);
            connection.send(result.toString());
        } catch (JSONException ignored) {
            connection.send("{\"type\":\"headset.snapshot.result\",\"status\":\"failed\",\"code\":\"snapshot-failed\"}");
        }
        publishTrace("B08", "SNAPSHOT", "failed", cleanProtocolText(detail, "headset snapshot failed"), "error");
    }

    private static String cleanProtocolText(String value, String fallback) {
        String clean = value == null ? "" : value.replaceAll("\\s+", " ").trim();
        if (clean.isBlank()) clean = fallback;
        return clean.substring(0, Math.min(clean.length(), 160));
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
