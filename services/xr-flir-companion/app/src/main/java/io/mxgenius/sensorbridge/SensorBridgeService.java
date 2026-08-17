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

public final class SensorBridgeService extends Service implements FlirCameraController.Listener {
    interface StatusListener {
        void onStatus(String relay, String camera);
        void onFrame(Bitmap bitmap);
    }

    static final String ACTION_STOP = "io.mxgenius.sensorbridge.STOP";
    private static final int NOTIFICATION_ID = 4107;
    private static final String CHANNEL_ID = "mxg_sensor_bridge";
    private static final long PREVIEW_INTERVAL_MS = 100L;
    private final LocalBinder binder = new LocalBinder();
    private RelayClient relay;
    private LocalThermalTransport localTransport;
    private FlirCameraController camera;
    private BridgeActivation activation;
    private StatusListener statusListener;
    private String relayState = "not connected (optional)";
    private String cameraState = "standby";
    private long lastPreviewAtMs;

    public final class LocalBinder extends Binder {
        SensorBridgeService service() { return SensorBridgeService.this; }
    }

    @Override public void onCreate() {
        super.onCreate();
        ThermalSdkAndroid.init(getApplicationContext(), ThermalLog.LogLevel.INFO);
        camera = new FlirCameraController(this);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, notification("Standalone FLIR viewer ready"));
        localTransport = new LocalThermalTransport(stableNodeId(), this::onRelayState, BuildConfig.DEBUG);
        localTransport.start();
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
            localTransport.activate(next);
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
        statusListener = null;
        if (camera != null) camera.shutdown();
        if (relay != null) relay.close();
        if (localTransport != null) localTransport.close();
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
        camera.discoverAndConnect(activity);
    }

    String sessionId() {
        return activation == null ? null : activation.sessionId;
    }

    String relayLabel() {
        return activation == null ? localTransport.label() + " · waiting for scene" : activation.relayLabel();
    }

    @Override public void onCameraState(String state, String reason) {
        cameraState = state;
        localTransport.sendSourceStatus(state, reason);
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
        localTransport.sendFrame(bitmap);
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
        if (current != null) current.onStatus(relayState, cameraState);
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
        String text = "FLIR " + cameraState + " · WebXR " + relayState;
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(text));
    }
}
