package io.mxgenius.sensorbridge;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class PiDiagnosticsClient {
    interface Listener {
        void onPiState(String state);
        void onDiagnostics(JSONObject diagnostics);
    }

    private static final UUID SERIAL_PORT_PROFILE =
            UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String DEVICE_NAME = "MxGenius";
    private static final int MAX_MESSAGE_BYTES = 1024 * 1024;
    private static final long RETRY_DELAY_MS = 3000;

    private final Context context;
    private final Listener listener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile BluetoothSocket socket;

    PiDiagnosticsClient(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    void connect() {
        if (context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED) {
            listener.onPiState("permission-required");
            return;
        }
        if (!running.compareAndSet(false, true)) return;
        worker.execute(this::run);
    }

    void close() {
        running.set(false);
        closeSocket();
        worker.shutdownNow();
    }

    private void run() {
        try {
            BluetoothManager manager = context.getSystemService(BluetoothManager.class);
            BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
            if (adapter == null) {
                listener.onPiState("unsupported");
                return;
            }
            while (running.get()) {
                try {
                    if (!adapter.isEnabled()) {
                        listener.onPiState("bluetooth-disabled");
                        pause();
                        continue;
                    }
                    BluetoothDevice device = pairedPi(adapter.getBondedDevices());
                    if (device == null) {
                        listener.onPiState("pairing-required");
                        pause();
                        continue;
                    }
                    listener.onPiState("connecting");
                    BluetoothSocket next = device.createRfcommSocketToServiceRecord(SERIAL_PORT_PROFILE);
                    socket = next;
                    next.connect();
                    listener.onPiState("connected");
                    readMessages(next);
                } catch (SecurityException error) {
                    listener.onPiState("permission-required");
                    return;
                } catch (IOException | JSONException error) {
                    if (running.get()) listener.onPiState("reconnecting");
                } finally {
                    closeSocket();
                }
                pause();
            }
        } finally {
            running.set(false);
            listener.onPiState("stopped");
        }
    }

    private void readMessages(BluetoothSocket connected) throws IOException, JSONException {
        DataInputStream input = new DataInputStream(connected.getInputStream());
        while (running.get()) {
            JSONObject message = readMessage(input);
            listener.onDiagnostics(message);
            listener.onPiState("streaming");
        }
    }

    static JSONObject readMessage(DataInputStream input) throws IOException, JSONException {
        int length;
        try {
            length = input.readInt();
        } catch (EOFException error) {
            throw new IOException("Pi diagnostics stream closed", error);
        }
        if (length < 1 || length > MAX_MESSAGE_BYTES) {
            throw new IOException("Pi diagnostics message is outside the allowed size");
        }
        byte[] payload = new byte[length];
        input.readFully(payload);
        JSONObject message = new JSONObject(new String(payload, StandardCharsets.UTF_8));
        validate(message);
        return message;
    }

    private static BluetoothDevice pairedPi(Set<BluetoothDevice> devices) {
        return devices.stream()
                .filter(device -> {
                    String name = device.getName();
                    return name != null && (name.equalsIgnoreCase(DEVICE_NAME)
                            || name.toLowerCase().startsWith("mxgenius"));
                })
                .sorted(Comparator.comparing(BluetoothDevice::getAddress))
                .findFirst()
                .orElse(null);
    }

    private static void validate(JSONObject message) throws JSONException {
        String type = message.getString("type");
        if (!"diagnostics.state".equals(type) && !"diagnostics.delta".equals(type)) {
            throw new JSONException("Unsupported Pi diagnostics message type");
        }
        if (!"mxg.edge.diagnostics".equals(message.getString("schema"))) {
            throw new JSONException("Unsupported Pi diagnostics schema");
        }
    }

    private void pause() {
        if (!running.get()) return;
        try {
            Thread.sleep(RETRY_DELAY_MS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private void closeSocket() {
        BluetoothSocket current = socket;
        socket = null;
        if (current == null) return;
        try {
            current.close();
        } catch (IOException ignored) {
            // Reconnection and service teardown are best effort.
        }
    }
}
