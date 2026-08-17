package io.mxgenius.sensorbridge;

import android.graphics.Bitmap;

import org.json.JSONException;

import java.net.InetSocketAddress;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class LocalThermalTransport implements ThermalTransport {
    private final LocalThermalBroker broker;
    private final ExecutorService encoder = Executors.newSingleThreadExecutor();
    private final AtomicBoolean encoding = new AtomicBoolean(false);
    private volatile BridgeActivation activation;
    private volatile long lastFrameAtMs;

    LocalThermalTransport(String nodeId, LocalThermalBroker.Listener listener, boolean debugBuild) {
        Set<String> origins = debugBuild
                ? Set.of("https://mxgenius.io", "https://www.mxgenius.io", "http://localhost", "http://127.0.0.1")
                : Set.of("https://mxgenius.io", "https://www.mxgenius.io");
        broker = new LocalThermalBroker(
                new InetSocketAddress("127.0.0.1", LocalThermalBroker.DEFAULT_PORT),
                origins,
                nodeId,
                listener);
    }

    void start() {
        broker.start();
    }

    void activate(BridgeActivation next) {
        activation = next;
        if (next.localToken != null) broker.activate(next.sessionId, next.localToken);
    }

    @Override public String label() {
        return "ws://127.0.0.1:" + LocalThermalBroker.DEFAULT_PORT + "/thermal";
    }

    @Override public void sendSourceStatus(String status, String reason) {
        broker.publishSourceStatus(status, reason);
    }

    @Override public void sendFrame(Bitmap bitmap) {
        BridgeActivation current = activation;
        if (current == null || current.localToken == null || bitmap == null || !broker.hasConsumers()) return;
        long now = System.currentTimeMillis();
        if (now - lastFrameAtMs < 125 || !encoding.compareAndSet(false, true)) return;
        lastFrameAtMs = now;
        encoder.execute(() -> {
            try {
                broker.publishFrame(MxgsFrameEncoder.jpeg(bitmap, current.sessionId));
            } catch (RuntimeException | JSONException ignored) {
                broker.publishSourceStatus("failed", "frame-encode");
            } finally {
                encoding.set(false);
            }
        });
    }

    @Override public void close() {
        encoder.shutdownNow();
        try {
            broker.stop(1000);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
    }
}
