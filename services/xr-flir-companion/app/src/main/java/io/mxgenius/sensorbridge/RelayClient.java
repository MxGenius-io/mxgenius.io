package io.mxgenius.sensorbridge;

import android.graphics.Bitmap;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

final class RelayClient implements ThermalTransport {
    interface Listener {
        void onRelayState(String state);
    }

    private final OkHttpClient http = new OkHttpClient.Builder().retryOnConnectionFailure(true).build();
    private final ExecutorService encoder = Executors.newSingleThreadExecutor();
    private final AtomicBoolean encoding = new AtomicBoolean(false);
    private final BridgeActivation activation;
    private final String nodeId;
    private final Listener listener;
    private volatile WebSocket socket;
    private volatile boolean open;
    private volatile long lastFrameAtMs;

    RelayClient(BridgeActivation activation, String nodeId, Listener listener) {
        this.activation = activation;
        this.nodeId = nodeId;
        this.listener = listener;
    }

    void connect() {
        listener.onRelayState("connecting");
        Request request = new Request.Builder().url(activation.bridgeUrl).build();
        socket = http.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket webSocket, Response response) {
                open = true;
                announce();
                sendSourceStatus("permission-required", null);
                listener.onRelayState("connected");
            }

            @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                open = false;
                listener.onRelayState("disconnected");
            }

            @Override public void onFailure(WebSocket webSocket, Throwable error, Response response) {
                open = false;
                listener.onRelayState("failed");
            }
        });
    }

    boolean isOpen() {
        return open;
    }

    @Override public String label() {
        return activation.relayLabel();
    }

    @Override public void sendSourceStatus(String status, String reason) {
        try {
            JSONObject message = new JSONObject()
                    .put("type", "source.status")
                    .put("sourceType", "flir-one-pro")
                    .put("status", status)
                    .put("sessionId", activation.sessionId)
                    .put("observedAtMs", System.currentTimeMillis());
            if (reason != null && !reason.isBlank()) message.put("reason", reason);
            sendJson(message);
        } catch (JSONException ignored) {
            listener.onRelayState("failed");
        }
    }

    @Override public void sendFrame(Bitmap bitmap) {
        if (!open || bitmap == null) return;
        long now = System.currentTimeMillis();
        if (now - lastFrameAtMs < 125 || !encoding.compareAndSet(false, true)) return;
        lastFrameAtMs = now;
        encoder.execute(() -> {
            try {
                byte[] frame = MxgsFrameEncoder.jpeg(bitmap, activation.sessionId);
                WebSocket current = socket;
                if (current != null && open) current.send(ByteString.of(frame));
            } catch (RuntimeException | JSONException ignored) {
                sendSourceStatus("failed", "frame-encode");
            } finally {
                encoding.set(false);
            }
        });
    }

    @Override public void close() {
        open = false;
        WebSocket current = socket;
        socket = null;
        if (current != null) current.close(1000, "bridge stopped");
        encoder.shutdownNow();
        http.dispatcher().executorService().shutdown();
        http.connectionPool().evictAll();
    }

    private void announce() {
        try {
            sendJson(new JSONObject()
                    .put("type", "node.announce")
                    .put("nodeId", nodeId)
                    .put("nodeType", "quest-companion")
                    .put("nodeName", "MxGenius FLIR Companion")
                    .put("capabilities", List.of(
                            "thermal-source", "flir-one-pro-usb-c", "mxgs-1", "thermal-jpeg"))
                    .put("sourceType", "flir-one-pro")
                    .put("softwareVersion", BuildConfig.VERSION_NAME)
                    .put("sdkVersion", BuildConfig.FLIR_SDK_VERSION));
        } catch (JSONException ignored) {
            listener.onRelayState("failed");
        }
    }

    private void sendJson(JSONObject message) {
        WebSocket current = socket;
        if (current != null && open) current.send(message.toString());
    }
}
