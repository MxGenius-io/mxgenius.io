package io.mxgenius.sensorbridge;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Binder;
import android.os.IBinder;
import android.os.SystemClock;

import com.flir.thermalsdk.androidsdk.ThermalSdkAndroid;
import com.flir.thermalsdk.log.ThermalLog;

import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class SensorBridgeService extends Service implements FlirCameraController.Listener {
    interface StatusListener {
        void onStatus(String bridge, String relay, String camera);
        void onFrame(Bitmap bitmap);
    }

    static final String ACTION_STOP = "io.mxgenius.sensorbridge.STOP";
    private static final int NOTIFICATION_ID = 4107;
    private static final String CHANNEL_ID = "mxg_sensor_bridge";
    private static final long PREVIEW_INTERVAL_MS = 100L;
    private final LocalBinder binder = new LocalBinder();
    private final ExecutorService lifecycleWorker = Executors.newSingleThreadExecutor();
    private RelayClient relay;
    private volatile LocalThermalTransport localTransport;
    private volatile FlirCameraController camera;
    private BridgeActivation activation;
    private StatusListener statusListener;
    private volatile String bridgeState = "starting";
    private volatile String bridgeReason = "service-created";
    private volatile boolean cameraRuntimeReady;
    private volatile boolean destroyed;
    private String relayState = "not connected (optional)";
    private String cameraState = "standby";
    private long lastPreviewAtMs;

    public final class LocalBinder extends Binder {
        SensorBridgeService service() { return SensorBridgeService.this; }
    }

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, notification("Preparing sensor bridge…"));
        localTransport = new LocalThermalTransport(stableNodeId(), this::onRelayState, BuildConfig.DEBUG);
        setBridgeState("starting", false, "foreground-active");
        lifecycleWorker.execute(this::initializeRuntime);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }

        boolean hasRelayActivation = intent != null
                && intent.hasExtra(BridgeActivation.EXTRA_SESSION_ID)
                && (intent.hasExtra(BridgeActivation.EXTRA_LOCAL_TOKEN)
                    || intent.hasExtra(BridgeActivation.EXTRA_BRIDGE_URL));
        if (!hasRelayActivation) {
            if (relay == null) relayState = "not connected (optional)";
            publishStatus();
            updateNotification();
            return START_STICKY;
        }

        try {
            BridgeActivation next = BridgeActivation.fromServiceIntent(intent, BuildConfig.DEBUG);
            LocalThermalTransport transport = localTransport;
            if (transport != null) transport.activate(next);
            if (relay != null) relay.close();
            activation = next;
            relay = null;
            if (next.bridgeUrl != null) {
                relay = new RelayClient(next, stableNodeId(), state -> updateNotification());
                relay.connect();
            }
            updateNotification();
            return START_REDELIVER_INTENT;
        } catch (RuntimeException error) {
            activation = null;
            if (relay != null) relay.close();
            relay = null;
            relayState = "activation rejected (preview still available)";
            publishStatus();
            updateNotification();
            return START_STICKY;
        }
    }

    @Override public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override public void onDestroy() {
        destroyed = true;
        setBridgeState("stopped", false, "service-stopped");
        statusListener = null;
        FlirCameraController currentCamera = camera;
        if (currentCamera != null) currentCamera.shutdown();
        if (relay != null) relay.close();
        LocalThermalTransport transport = localTransport;
        if (transport != null) transport.close();
        lifecycleWorker.shutdownNow();
        super.onDestroy();
    }

    void setStatusListener(StatusListener listener) {
        statusListener = listener;
        publishStatus();
    }

    void clearStatusListener(StatusListener listener) {
        if (statusListener == listener) statusListener = null;
    }

    void connectCamera(Activity activity) {
        FlirCameraController current = camera;
        if (cameraRuntimeReady && current != null) current.discoverAndConnect(activity);
    }

    boolean canConnectCamera() {
        return cameraRuntimeReady && camera != null;
    }

    String sessionId() {
        return activation == null ? null : activation.sessionId;
    }

    String relayLabel() {
        LocalThermalTransport transport = localTransport;
        String localLabel = transport == null ? "local transport starting" : transport.label();
        return activation == null ? localLabel + " · waiting for scene" : activation.relayLabel();
    }

    @Override public void onCameraState(String state, String reason) {
        cameraState = state;
        LocalThermalTransport transport = localTransport;
        if (transport != null) transport.sendSourceStatus(state, reason);
        RelayClient current = relay;
        if (current != null) current.sendSourceStatus(state, reason);
        publishStatus();
        updateNotification();
    }

    @Override public void onFrame(Bitmap bitmap) {
        long now = SystemClock.elapsedRealtime();
        StatusListener currentListener = statusListener;
        if (currentListener != null && now - lastPreviewAtMs >= PREVIEW_INTERVAL_MS) {
            lastPreviewAtMs = now;
            currentListener.onFrame(bitmap);
        }
        LocalThermalTransport transport = localTransport;
        if (transport != null) transport.sendFrame(bitmap);
        RelayClient currentRelay = relay;
        if (currentRelay != null) currentRelay.sendFrame(bitmap);
    }

    private void onRelayState(String state) {
        relayState = state;
        publishStatus();
        updateNotification();
    }

    private void publishStatus() {
        StatusListener current = statusListener;
        if (current != null) current.onStatus(bridgeLabel(), relayState, cameraState);
    }

    private void initializeRuntime() {
        LocalThermalTransport transport = localTransport;
        if (transport == null || destroyed) return;
        try {
            setBridgeState("broker-starting", false, "binding-loopback-4109");
            if (!transport.startAndAwait(4, TimeUnit.SECONDS)) {
                throw new IllegalStateException("loopback-start-timeout");
            }
            if (destroyed) return;
            setBridgeState("broker-ready", false, "loopback-4109-listening");
            setBridgeState("sdk-starting", false, "flir-atlas-" + BuildConfig.FLIR_SDK_VERSION);
            ThermalSdkAndroid.init(getApplicationContext(), ThermalLog.LogLevel.INFO);
            if (destroyed) return;
            camera = new FlirCameraController(this);
            cameraRuntimeReady = true;
            setBridgeState("ready", true, "camera-runtime-ready");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            if (!destroyed) setBridgeState("failed", false, "startup-interrupted");
        } catch (RuntimeException | LinkageError error) {
            cameraRuntimeReady = false;
            setBridgeState("failed", false, startupReason(error));
        }
    }

    private void setBridgeState(String state, boolean ready, String reason) {
        bridgeState = state;
        bridgeReason = reason;
        LocalThermalTransport transport = localTransport;
        if (transport != null) transport.sendBridgeStatus(state, ready, reason);
        publishStatus();
        updateNotification();
    }

    private String bridgeLabel() {
        return bridgeReason == null || bridgeReason.isBlank()
                ? bridgeState
                : bridgeState + " · " + bridgeReason;
    }

    private static String startupReason(Throwable error) {
        if (error instanceof UnsatisfiedLinkError) return "native-library-load";
        String name = error.getClass().getSimpleName();
        return name == null || name.isBlank() ? "startup-error" : "startup-" + name.toLowerCase();
    }

    private String stableNodeId() {
        SharedPreferences preferences = getSharedPreferences("bridge", MODE_PRIVATE);
        String value = preferences.getString("node_id", null);
        if (value != null) return value;
        value = "quest-sensor-" + UUID.randomUUID();
        preferences.edit().putString("node_id", value).apply();
        return value;
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "MxGenius sensor bridge", NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification notification(String text) {
        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setContentTitle("MxGenius FLIR companion")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

    private void updateNotification() {
        String text = "Bridge " + bridgeState + " · FLIR " + cameraState + " · WebXR " + relayState;
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(text));
    }
}
