package io.mxgenius.sensorbridge;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.drafts.Draft_6455;
import org.java_websocket.handshake.ServerHandshake;
import org.json.JSONObject;
import org.junit.Test;

import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.ByteBuffer;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class LocalThermalBrokerTest {
    private static final String TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test public void authorizedBrowserReceivesSyntheticMxgsFrame() throws Exception {
        int port = freePort();
        LocalThermalBroker broker = new LocalThermalBroker(
                new InetSocketAddress("127.0.0.1", port),
                Set.of("https://mxgenius.io"),
                "quest-sensor-test",
                state -> {});
        broker.activate("case-42", TOKEN);
        broker.start();
        assertTrue(broker.awaitStarted(3, TimeUnit.SECONDS));

        CountDownLatch binaryReceived = new CountDownLatch(1);
        AtomicReference<byte[]> received = new AtomicReference<>();
        WebSocketClient client = client(port, "https://mxgenius.io", TOKEN, binaryReceived, received);
        try {
            assertTrue(client.connectBlocking(3, TimeUnit.SECONDS));
            byte[] frame = syntheticMxgsFrame();
            broker.publishFrame(frame);
            assertTrue(binaryReceived.await(3, TimeUnit.SECONDS));
            assertArrayEquals(frame, received.get());
        } finally {
            client.closeBlocking();
            broker.stop(1000);
        }
    }

    @Test public void foreignOriginCannotConsumeThermalFrames() throws Exception {
        int port = freePort();
        LocalThermalBroker broker = new LocalThermalBroker(
                new InetSocketAddress("127.0.0.1", port),
                Set.of("https://mxgenius.io"),
                "quest-sensor-test",
                state -> {});
        broker.activate("case-42", TOKEN);
        broker.start();
        assertTrue(broker.awaitStarted(3, TimeUnit.SECONDS));

        CountDownLatch closed = new CountDownLatch(1);
        WebSocketClient client = new WebSocketClient(
                uri(port, TOKEN),
                new Draft_6455(),
                Map.of("Origin", "https://example.invalid"),
                0) {
            @Override public void onOpen(ServerHandshake handshake) {}
            @Override public void onMessage(String message) {}
            @Override public void onMessage(ByteBuffer bytes) {}
            @Override public void onClose(int code, String reason, boolean remote) { closed.countDown(); }
            @Override public void onError(Exception error) {}
        };
        try {
            client.connect();
            assertTrue(closed.await(3, TimeUnit.SECONDS));
        } finally {
            if (client.isOpen()) client.closeBlocking();
            broker.stop(1000);
        }
    }

    @Test public void authorizedBrowserReceivesNativeStartupHistory() throws Exception {
        int port = freePort();
        LocalThermalBroker broker = new LocalThermalBroker(
                new InetSocketAddress("127.0.0.1", port),
                Set.of("https://mxgenius.io"),
                "quest-sensor-test",
                state -> {});
        broker.publishBridgeStatus("starting", false, "foreground-active");
        broker.publishTrace("N01", "SERVICE", "foreground", "foreground service created", "success");
        broker.publishBridgeStatus("ready", true, "camera-runtime-ready");
        broker.activate("case-42", TOKEN);
        broker.start();
        assertTrue(broker.awaitStarted(3, TimeUnit.SECONDS));

        CountDownLatch readyReceived = new CountDownLatch(1);
        CountDownLatch traceReceived = new CountDownLatch(1);
        CopyOnWriteArrayList<String> messages = new CopyOnWriteArrayList<>();
        WebSocketClient client = new WebSocketClient(
                uri(port, TOKEN),
                new Draft_6455(),
                Map.of("Origin", "https://mxgenius.io"),
                0) {
            @Override public void onOpen(ServerHandshake handshake) {}
            @Override public void onMessage(String message) {
                messages.add(message);
                if (message.contains("\"type\":\"bridge.status\"")
                        && message.contains("\"phase\":\"ready\"")) readyReceived.countDown();
                if (message.contains("\"type\":\"bridge.trace\"")
                        && message.contains("\"step\":\"N01\"")) traceReceived.countDown();
            }
            @Override public void onMessage(ByteBuffer bytes) {}
            @Override public void onClose(int code, String reason, boolean remote) {}
            @Override public void onError(Exception error) {}
        };
        try {
            assertTrue(client.connectBlocking(3, TimeUnit.SECONDS));
            assertTrue(readyReceived.await(3, TimeUnit.SECONDS));
            assertTrue(traceReceived.await(3, TimeUnit.SECONDS));
            assertTrue(messages.stream().anyMatch(message ->
                    message.contains("\"type\":\"bridge.status\"")
                            && message.contains("\"phase\":\"starting\"")));
        } finally {
            client.closeBlocking();
            broker.stop(1000);
        }
    }

    @Test public void snapshotResultReturnsOnlyToItsAuthenticatedRequester() throws Exception {
        int port = freePort();
        byte[] jpeg = new byte[] {(byte) 0xff, (byte) 0xd8, 0x11, 0x22, (byte) 0xff, (byte) 0xd9};
        LocalThermalBroker broker = new LocalThermalBroker(
                new InetSocketAddress("127.0.0.1", port),
                Set.of("https://mxgenius.io"),
                "quest-sensor-test",
                state -> {},
                (requestId, responder) -> responder.success(jpeg, 640, 480, "right"));
        broker.activate("case-42", TOKEN);
        broker.start();
        assertTrue(broker.awaitStarted(3, TimeUnit.SECONDS));

        CountDownLatch snapshotReceived = new CountDownLatch(1);
        AtomicReference<String> received = new AtomicReference<>();
        WebSocketClient client = new WebSocketClient(
                uri(port, TOKEN),
                new Draft_6455(),
                Map.of("Origin", "https://mxgenius.io"),
                0) {
            @Override public void onOpen(ServerHandshake handshake) {
                send("{\"type\":\"headset.snapshot.request\",\"requestId\":\"snapshot-test-01\"}");
            }
            @Override public void onMessage(String message) {
                if (!message.contains("\"type\":\"headset.snapshot.result\"")) return;
                received.set(message);
                snapshotReceived.countDown();
            }
            @Override public void onMessage(ByteBuffer bytes) {}
            @Override public void onClose(int code, String reason, boolean remote) {}
            @Override public void onError(Exception error) {}
        };
        try {
            assertTrue(client.connectBlocking(3, TimeUnit.SECONDS));
            assertTrue(snapshotReceived.await(3, TimeUnit.SECONDS));
            assertTrue(received.get().contains("\"status\":\"ok\""));
            assertTrue(received.get().contains("\"width\":640"));
            assertTrue(received.get().contains("data:image/jpeg;base64,"));
        } finally {
            client.closeBlocking();
            broker.stop(1000);
        }
    }

    @Test public void scanSnapshotEchoesPurposeCorrelationAndAvailableCameraMetadata() throws Exception {
        int port = freePort();
        byte[] jpeg = new byte[] {(byte) 0xff, (byte) 0xd8, 0x11, 0x22, (byte) 0xff, (byte) 0xd9};
        LocalThermalBroker broker = new LocalThermalBroker(
                new InetSocketAddress("127.0.0.1", port),
                Set.of("https://mxgenius.io"),
                "quest-sensor-test",
                state -> {},
                (requestId, responder) -> responder.success(jpeg, 800, 600, "right"));
        broker.activate("case-42", TOKEN);
        broker.start();
        assertTrue(broker.awaitStarted(3, TimeUnit.SECONDS));

        CountDownLatch snapshotReceived = new CountDownLatch(1);
        AtomicReference<String> received = new AtomicReference<>();
        WebSocketClient client = new WebSocketClient(
                uri(port, TOKEN),
                new Draft_6455(),
                Map.of("Origin", "https://mxgenius.io"),
                0) {
            @Override public void onOpen(ServerHandshake handshake) {
                send("{\"type\":\"headset.snapshot.request\",\"requestId\":\"snapshot-scan-01\",\"purpose\":\"scan\",\"scanId\":\"scan-contract-01\"}");
            }
            @Override public void onMessage(String message) {
                if (!message.contains("\"type\":\"headset.snapshot.result\"")) return;
                received.set(message);
                snapshotReceived.countDown();
            }
            @Override public void onMessage(ByteBuffer bytes) {}
            @Override public void onClose(int code, String reason, boolean remote) {}
            @Override public void onError(Exception error) {}
        };
        try {
            assertTrue(client.connectBlocking(3, TimeUnit.SECONDS));
            assertTrue(snapshotReceived.await(3, TimeUnit.SECONDS));
            JSONObject result = new JSONObject(received.get());
            assertEquals("scan", result.getString("purpose"));
            assertEquals("scan-contract-01", result.getString("scanId"));
            assertEquals("quest-passthrough", result.getJSONObject("camera").getString("source"));
            assertFalse(result.getJSONObject("camera").getBoolean("poseAvailable"));
            assertFalse(result.getJSONObject("camera").getBoolean("intrinsicsAvailable"));
        } finally {
            client.closeBlocking();
            broker.stop(1000);
        }
    }

    @Test public void commissioningAckReachesRunControllerOnlyFromAuthenticatedBrowser() throws Exception {
        int port = freePort();
        CountDownLatch ackReceived = new CountDownLatch(1);
        AtomicReference<String> ack = new AtomicReference<>();
        LocalThermalBroker broker = new LocalThermalBroker(
                new InetSocketAddress("127.0.0.1", port),
                Set.of("https://mxgenius.io"),
                "quest-sensor-test",
                state -> {},
                (requestId, responder) -> responder.failure("unused", "unused"),
                (runId, renderedFrames) -> {
                    ack.set(runId + ":" + renderedFrames);
                    ackReceived.countDown();
                });
        broker.activate("case-42", TOKEN);
        broker.start();
        assertTrue(broker.awaitStarted(3, TimeUnit.SECONDS));

        WebSocketClient client = new WebSocketClient(
                uri(port, TOKEN),
                new Draft_6455(),
                Map.of("Origin", "https://mxgenius.io"),
                0) {
            @Override public void onOpen(ServerHandshake handshake) {
                send("{\"type\":\"commissioning.browser_ack\",\"runId\":\"run-commission-01\",\"renderedFrames\":10}");
            }
            @Override public void onMessage(String message) {}
            @Override public void onMessage(ByteBuffer bytes) {}
            @Override public void onClose(int code, String reason, boolean remote) {}
            @Override public void onError(Exception error) {}
        };
        try {
            assertTrue(client.connectBlocking(3, TimeUnit.SECONDS));
            assertTrue(ackReceived.await(3, TimeUnit.SECONDS));
            assertTrue("run-commission-01:10".equals(ack.get()));
        } finally {
            client.closeBlocking();
            broker.stop(1000);
        }
    }

    @Test public void witnessBootstrapRequiresSessionBindAndIsAcknowledgedWithoutSecretEcho() throws Exception {
        int port = freePort();
        String producerCredential = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        AtomicReference<RemoteWitnessBootstrap> accepted = new AtomicReference<>();
        CountDownLatch acceptedLatch = new CountDownLatch(1);
        java.util.concurrent.CompletableFuture<Void> producerReady = new java.util.concurrent.CompletableFuture<>();
        LocalThermalBroker broker = new LocalThermalBroker(
                new InetSocketAddress("127.0.0.1", port),
                Set.of("https://mxgenius.io"),
                "quest-sensor-test",
                state -> {},
                (requestId, responder) -> responder.failure("unused", "unused"),
                (runId, renderedFrames) -> {},
                bootstrap -> {
                    accepted.set(bootstrap);
                    acceptedLatch.countDown();
                    return producerReady;
                });
        broker.activate("case-42", TOKEN);
        broker.start();
        assertTrue(broker.awaitStarted(3, TimeUnit.SECONDS));

        CountDownLatch ackReceived = new CountDownLatch(1);
        AtomicReference<String> ack = new AtomicReference<>();
        String bootstrap = witnessBootstrapJson(producerCredential);
        WebSocketClient client = new WebSocketClient(
                uri(port, TOKEN),
                new Draft_6455(),
                Map.of("Origin", "https://mxgenius.io"),
                0) {
            @Override public void onOpen(ServerHandshake handshake) {
                send("{\"type\":\"bridge.session\",\"sessionId\":\"case-42\"}");
                send(bootstrap);
            }
            @Override public void onMessage(String message) {
                if (!message.contains("\"type\":\"witness.bootstrap.ack\"")) return;
                ack.set(message);
                ackReceived.countDown();
            }
            @Override public void onMessage(ByteBuffer bytes) {}
            @Override public void onClose(int code, String reason, boolean remote) {}
            @Override public void onError(Exception error) {}
        };
        try {
            assertTrue(client.connectBlocking(3, TimeUnit.SECONDS));
            assertTrue(acceptedLatch.await(3, TimeUnit.SECONDS));
            assertFalse(ackReceived.await(200, TimeUnit.MILLISECONDS));
            producerReady.complete(null);
            assertTrue(ackReceived.await(3, TimeUnit.SECONDS));
            assertEquals("11111111-1111-4111-8111-111111111111", accepted.get().roomId.toString());
            assertTrue(ack.get().contains("\"status\":\"accepted\""));
            assertFalse(ack.get().contains(producerCredential));
        } finally {
            client.closeBlocking();
            broker.stop(1000);
        }
    }

    @Test public void witnessBootstrapBeforeSessionBindFailsClosed() throws Exception {
        int port = freePort();
        CountDownLatch accepted = new CountDownLatch(1);
        LocalThermalBroker broker = new LocalThermalBroker(
                new InetSocketAddress("127.0.0.1", port),
                Set.of("https://mxgenius.io"),
                "quest-sensor-test",
                state -> {},
                (requestId, responder) -> responder.failure("unused", "unused"),
                (runId, renderedFrames) -> {},
                bootstrap -> {
                    accepted.countDown();
                    return java.util.concurrent.CompletableFuture.completedFuture(null);
                });
        broker.activate("case-42", TOKEN);
        broker.start();
        assertTrue(broker.awaitStarted(3, TimeUnit.SECONDS));

        CountDownLatch rejected = new CountDownLatch(1);
        WebSocketClient client = new WebSocketClient(
                uri(port, TOKEN),
                new Draft_6455(),
                Map.of("Origin", "https://mxgenius.io"),
                0) {
            @Override public void onOpen(ServerHandshake handshake) {
                send(witnessBootstrapJson("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"));
            }
            @Override public void onMessage(String message) {
                if (message.contains("\"type\":\"witness.bootstrap.ack\"")
                        && message.contains("\"code\":\"session-bind-required\"")) rejected.countDown();
            }
            @Override public void onMessage(ByteBuffer bytes) {}
            @Override public void onClose(int code, String reason, boolean remote) {}
            @Override public void onError(Exception error) {}
        };
        try {
            assertTrue(client.connectBlocking(3, TimeUnit.SECONDS));
            assertTrue(rejected.await(3, TimeUnit.SECONDS));
            assertFalse(accepted.await(200, TimeUnit.MILLISECONDS));
        } finally {
            client.closeBlocking();
            broker.stop(1000);
        }
    }

    private static WebSocketClient client(
            int port,
            String origin,
            String token,
            CountDownLatch binaryReceived,
            AtomicReference<byte[]> received) {
        return new WebSocketClient(uri(port, token), new Draft_6455(), Map.of("Origin", origin), 0) {
            @Override public void onOpen(ServerHandshake handshake) {}
            @Override public void onMessage(String message) {}
            @Override public void onMessage(ByteBuffer bytes) {
                byte[] payload = new byte[bytes.remaining()];
                bytes.get(payload);
                received.set(payload);
                binaryReceived.countDown();
            }
            @Override public void onClose(int code, String reason, boolean remote) {}
            @Override public void onError(Exception error) {}
        };
    }

    private static URI uri(int port, String token) {
        return URI.create("ws://127.0.0.1:" + port + "/thermal?sessionId=case-42&token=" + token);
    }

    private static String witnessBootstrapJson(String producerCredential) {
        try {
            return new JSONObject()
                    .put("type", "witness.bootstrap")
                    .put("version", 1)
                    .put("sessionId", "case-42")
                    .put("roomId", "11111111-1111-4111-8111-111111111111")
                    .put("joinUrl", "https://mxgenius.io/witness.html?invite=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
                    .put("manualCode", "0123456789AB")
                    .put("producerCredential", producerCredential)
                    .put("socketPath", "/api/xr/witness/ws")
                    .put("socketUrl", "wss://mxg-core.example.net/api/xr/witness/ws")
                    .put("expiresAtMs", System.currentTimeMillis() + 60_000)
                    .put("iceServers", new org.json.JSONArray())
                    .toString();
        } catch (org.json.JSONException error) {
            throw new IllegalStateException("could not build witness bootstrap fixture", error);
        }
    }

    private static int freePort() throws Exception {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    private static byte[] syntheticMxgsFrame() {
        byte[] frame = new byte[28];
        frame[0] = 'M';
        frame[1] = 'X';
        frame[2] = 'G';
        frame[3] = 'S';
        frame[4] = 1;
        frame[6] = 2;
        frame[8] = 1;
        frame[10] = 1;
        frame[24] = (byte) 0xff;
        frame[25] = 0x45;
        frame[26] = 0x23;
        frame[27] = 0x01;
        return frame;
    }
}
