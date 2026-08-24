package io.mxgenius.sensorbridge;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertTrue;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.drafts.Draft_6455;
import org.java_websocket.handshake.ServerHandshake;
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
