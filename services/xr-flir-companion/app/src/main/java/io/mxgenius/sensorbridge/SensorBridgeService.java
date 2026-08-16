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

import com.flir.thermalsdk.androidsdk.ThermalSdkAndroid;
import com.flir.thermalsdk.log.ThermalLog;

import java.util.UUID;

public final class SensorBridgeService extends Service implements FlirCameraController.Listener {
    interface StatusListener {
        void onStatus(String relay, String camera);
    }

    static final String ACTION_STOP = "io.mxgenius.sensorbridge.STOP";
    private static final int NOTIFICATION_ID = 4107;
    private static final String CHANNEL_ID = "mxg_sensor_bridge";
    private final LocalBinder binder = new LocalBinder();
    private RelayClient relay;
    private FlirCameraController camera;
    private BridgeActivation activation;
    private StatusListener statusListener;
    private String relayState = "idle";
    private String cameraState = "standby";

    public final class LocalBinder extends Binder {
        SensorBridgeService service() { return SensorBridgeService.this; }
    }

    @Override public void onCreate() {
        super.onCreate();
        ThermalSdkAndroid.init(getApplicationContext(), ThermalLog.LogLevel.INFO);
        camera = new FlirCameraController(this);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, notification("Waiting for browser activation"));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            BridgeActivation next = BridgeActivation.fromServiceIntent(intent, BuildConfig.DEBUG);
            if (relay != null) relay.close();
            activation = next;
            relay = new RelayClient(next, stableNodeId(), this::onRelayState);
            relay.connect();
            updateNotification();
            return START_REDELIVER_INTENT;
        } catch (RuntimeException error) {
            relayState = "invalid-activation";
            publishStatus();
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    @Override public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override public void onDestroy() {
        statusListener = null;
        if (camera != null) camera.shutdown();
        if (relay != null) relay.close();
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
        if (activation == null || relay == null) {
            cameraState = "activation-required";
            publishStatus();
            return;
        }
        camera.discoverAndConnect(activity);
    }

    String sessionId() {
        return activation == null ? "—" : activation.sessionId;
    }

    String relayLabel() {
        return activation == null ? "—" : activation.relayLabel();
    }

    @Override public void onCameraState(String state, String reason) {
        cameraState = state;
        RelayClient current = relay;
        if (current != null) current.sendSourceStatus(state, reason);
        publishStatus();
        updateNotification();
    }

    @Override public void onFrame(Bitmap bitmap) {
        RelayClient current = relay;
        if (current != null) current.sendFrame(bitmap);
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
        value = "quest-flir-" + UUID.randomUUID();
        preferences.edit().putString("node_id", value).apply();
        return value;
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "MxGenius sensor bridge", NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private android.app.Notification notification(String text) {
        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setContentTitle("MxGenius FLIR bridge")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

    private void updateNotification() {
        String text = "Relay " + relayState + " · FLIR " + cameraState;
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(text));
    }
}
