package io.mxgenius.sensorbridge;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/** Native owner of the Remote Witness control/signaling socket; continuous media stays on WebRTC. */
final class RemoteWitnessSocket implements AutoCloseable {
    interface Listener {
        void onState(String state);
        default void onRoomState(JSONObject room) {}
        void onTerminal(String reason);
        default void onSignal(UUID participantId, JSONObject signal) {}
    }

    private static final int MAX_MESSAGE_CHARS = 64 * 1024;
    private static final int MAX_RECONNECT_ATTEMPTS = 3;
    private static final Set<String> CONTROL_ACTIONS = Set.of(
            "approve", "pause", "resume", "revoke", "set-layers",
            "recording-consent", "stop-recording");

    private final RemoteWitnessBootstrap bootstrap;
    private final Listener listener;
    private final OkHttpClient http = new OkHttpClient.Builder()
            .retryOnConnectionFailure(true)
            .connectTimeout(6, TimeUnit.SECONDS)
            .callTimeout(6, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build();
    private final CompletableFuture<Void> ready = new CompletableFuture<>();
    private final ScheduledExecutorService reconnectWorker = Executors.newSingleThreadScheduledExecutor();
    private volatile WebSocket socket;
    private volatile boolean open;
    private volatile boolean closing;
    private volatile boolean everOpened;
    private int reconnectAttempt;
    private volatile long generation;

    RemoteWitnessSocket(RemoteWitnessBootstrap bootstrap, Listener listener) {
        this.bootstrap = bootstrap;
        this.listener = listener;
    }

    synchronized CompletableFuture<Void> connect() {
        connectAttempt();
        return ready;
    }

    private synchronized void connectAttempt() {
        if (closing || System.currentTimeMillis() >= bootstrap.expiresAtMs) {
            terminal("expired");
            return;
        }
        long attemptGeneration = ++generation;
        listener.onState("connecting");
        Request request = new Request.Builder()
                .url(bootstrap.socketUrl())
                .header("Sec-WebSocket-Protocol", "mxg-witness.v1, " + bootstrap.producerCredential)
                .build();
        socket = http.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket webSocket, Response response) {
                if (closing || attemptGeneration != generation) {
                    webSocket.close(1000, "witness stopped");
                    return;
                }
                open = true;
                everOpened = true;
                reconnectAttempt = 0;
                listener.onState("connected");
                ready.complete(null);
            }

            @Override public void onMessage(WebSocket webSocket, String text) {
                if (attemptGeneration == generation) handleMessage(text);
            }

            @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                if (attemptGeneration != generation) return;
                open = false;
                if (!closing) handleDisconnect("connection-closed");
            }

            @Override public void onFailure(WebSocket webSocket, Throwable error, Response response) {
                if (attemptGeneration != generation) return;
                open = false;
                if (!closing) handleDisconnect("connection-failed");
            }
        });
    }

    boolean sendControl(String action, JSONObject layers, Boolean consent) {
        if (!CONTROL_ACTIONS.contains(action)) return false;
        if ("set-layers".equals(action) != (layers != null)) return false;
        if ("recording-consent".equals(action) != (consent != null)) return false;
        if (!"set-layers".equals(action) && layers != null) return false;
        if (!"recording-consent".equals(action) && consent != null) return false;
        try {
            JSONObject message = new JSONObject()
                    .put("type", "witness.control")
                    .put("action", action);
            if (layers != null) message.put("layers", layers);
            if (consent != null) message.put("consent", consent);
            return send(message);
        } catch (JSONException error) {
            return false;
        }
    }

    boolean isOpen() {
        return open;
    }

    boolean sendSignal(JSONObject signal) {
        if (signal == null) return false;
        try {
            return send(new JSONObject().put("type", "witness.signal").put("signal", signal));
        } catch (JSONException error) {
            return false;
        }
    }

    @Override public void close() {
        if (closing) return;
        closing = true;
        generation += 1;
        open = false;
        if (!ready.isDone()) ready.completeExceptionally(new IllegalStateException("witness socket stopped"));
        WebSocket current = socket;
        socket = null;
        if (current != null) current.close(1000, "witness stopped");
        reconnectWorker.shutdownNow();
        http.dispatcher().executorService().shutdown();
        http.connectionPool().evictAll();
    }

    private void handleMessage(String text) {
        if (text == null || text.length() > MAX_MESSAGE_CHARS) {
            terminal("invalid-message");
            return;
        }
        try {
            JSONObject message = new JSONObject(text);
            String type = message.optString("type", "");
            if ("witness.room-ended".equals(type)) {
                if (bootstrap.roomId.toString().equals(message.optString("roomId"))) terminal("room-ended");
                return;
            }
            if ("witness.room-state".equals(type) || "witness.presence".equals(type)) {
                JSONObject room = message.optJSONObject("room");
                if (room == null || !bootstrap.roomId.toString().equals(room.optString("roomId"))) {
                    terminal("room-mismatch");
                    return;
                }
                String status = room.optString("status", "unknown");
                listener.onState(status);
                listener.onRoomState(room);
                if ("revoked".equals(status) || "expired".equals(status)) terminal(status);
                return;
            }
            if ("witness.signal".equals(type)) {
                JSONObject signal = message.optJSONObject("signal");
                if (bootstrap.roomId.toString().equals(message.optString("roomId")) && signal != null) {
                    try {
                        listener.onSignal(UUID.fromString(message.optString("participantId")), signal);
                    } catch (IllegalArgumentException error) {
                        terminal("invalid-participant");
                    }
                }
                return;
            }
            if ("witness.error".equals(type)) {
                String code = message.optString("code", "WITNESS_ERROR");
                if ("WITNESS_REVOKED".equals(code) || "WITNESS_SESSION_EXPIRED".equals(code)) {
                    terminal(code.toLowerCase());
                } else {
                    listener.onState("server-error:" + code);
                }
            }
        } catch (JSONException error) {
            terminal("invalid-message");
        }
    }

    private boolean send(JSONObject message) {
        WebSocket current = socket;
        return current != null && open && current.send(message.toString());
    }

    private void terminal(String reason) {
        if (closing) return;
        listener.onTerminal(reason);
    }

    private synchronized void handleDisconnect(String reason) {
        if (closing) return;
        if (!everOpened) {
            if (!ready.isDone()) ready.completeExceptionally(new IllegalStateException("witness socket unavailable"));
            terminal(reason);
            return;
        }
        if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS || System.currentTimeMillis() >= bootstrap.expiresAtMs) {
            terminal("reconnect-exhausted");
            return;
        }
        int attempt = ++reconnectAttempt;
        long delayMs = Math.min(4_000L, 500L << (attempt - 1));
        listener.onState("reconnecting-" + attempt + "-of-" + MAX_RECONNECT_ATTEMPTS);
        reconnectWorker.schedule(this::connectAttempt, delayMs, TimeUnit.MILLISECONDS);
    }
}
