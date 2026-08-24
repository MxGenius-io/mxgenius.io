package io.mxgenius.sensorbridge;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

import com.flir.thermalsdk.androidsdk.ThermalSdkAndroid;
import com.flir.thermalsdk.log.ThermalLog;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class SensorBridgeService extends Service implements FlirCameraController.Listener {
    interface StatusListener {
        void onStatus(String bridge, String relay, String camera);
        void onFrame(Bitmap bitmap);
        default void onTrace(List<String> entries) {}
        default void onCommissioning(String summary) {}
    }

    static final String ACTION_STOP = "io.mxgenius.sensorbridge.STOP";
    private static final int NOTIFICATION_ID = 4107;
    private static final String CHANNEL_ID = "mxg_sensor_bridge";
    // FLIR acquisition stays at the camera's native cadence. XML-backed Spatial panels
    // only need a bounded preview cadence to avoid repeatedly rebuilding their texture.
    private static final long PREVIEW_INTERVAL_MS = 150L;
    private static final int TRACE_HISTORY_LIMIT = 64;
    private final LocalBinder binder = new LocalBinder();
    private final ExecutorService lifecycleWorker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService commissioningWorker = Executors.newSingleThreadScheduledExecutor();
    private final Object traceLock = new Object();
    private final ArrayDeque<String> traceHistory = new ArrayDeque<>();
    private final ThermalCommissioningRun commissioning = new ThermalCommissioningRun();
    private RelayClient relay;
    private volatile LocalThermalTransport localTransport;
    private volatile FlirCameraController camera;
    private volatile HeadsetSnapshotController headsetSnapshots;
    private BridgeActivation activation;
    private StatusListener statusListener;
    private volatile String bridgeState = "starting";
    private volatile String bridgeReason = "service-created";
    private volatile boolean cameraRuntimeReady;
    private volatile boolean destroyed;
    private volatile boolean firstFrameTraced;
    private volatile boolean headsetCameraForegroundReady;
    private String relayState = "not connected (optional)";
    private String cameraState = "standby";
    private String lastCommissioningPayload;
    private long lastPreviewAtMs;

    public final class LocalBinder extends Binder {
        SensorBridgeService service() { return SensorBridgeService.this; }
    }

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(
                NOTIFICATION_ID,
                notification("Preparing sensor bridge…"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        headsetSnapshots = new HeadsetSnapshotController(this);
        localTransport = new LocalThermalTransport(
                stableNodeId(),
                this::onRelayState,
                this::onSnapshotRequest,
                this::onBrowserCommissioningAck,
                BuildConfig.DEBUG);
        trace("N01", "SERVICE", "foreground", "foreground service created before FLIR initialization", "success");
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
            trace("N02", "ACTIVATION", "standalone", "service started without a browser session", "info");
            publishStatus();
            updateNotification();
            return START_STICKY;
        }

        try {
            BridgeActivation next = BridgeActivation.fromServiceIntent(intent, BuildConfig.DEBUG);
            LocalThermalTransport transport = localTransport;
            if (transport != null) transport.activate(next);
            trace("N02", "ACTIVATION", "accepted", "browser session and local token activated", "success");
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
            trace("N02", "ACTIVATION", "rejected", "browser activation failed validation", "error");
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
        trace("N99", "SERVICE", "stopping", "foreground bridge service is shutting down", "warn");
        setBridgeState("stopped", false, "service-stopped");
        statusListener = null;
        FlirCameraController currentCamera = camera;
        if (currentCamera != null) currentCamera.shutdown();
        HeadsetSnapshotController currentSnapshots = headsetSnapshots;
        headsetSnapshots = null;
        if (currentSnapshots != null) currentSnapshots.shutdown();
        if (relay != null) relay.close();
        LocalThermalTransport transport = localTransport;
        if (transport != null) transport.close();
        lifecycleWorker.shutdownNow();
        commissioningWorker.shutdownNow();
        super.onDestroy();
    }

    void setStatusListener(StatusListener listener) {
        statusListener = listener;
        publishStatus();
        listener.onTrace(traceHistorySnapshot());
        listener.onCommissioning(commissioningSummary());
    }

    void clearStatusListener(StatusListener listener) {
        if (statusListener == listener) statusListener = null;
    }

    void connectCamera(Activity activity) {
        FlirCameraController current = camera;
        if (cameraRuntimeReady && current != null) {
            trace("N07", "FLIR", "requested", "camera discovery requested with foreground activity", "info");
            current.discoverAndConnect(activity);
        } else {
            trace("N07", "FLIR", "blocked", "camera discovery requested before SDK readiness", "error");
        }
    }

    void reconnectCamera(Activity activity) {
        FlirCameraController current = camera;
        if (cameraRuntimeReady && current != null) {
            trace("N18", "FLIR", "reconnect", "operator requested a clean camera reconnect", "info");
            cameraState = "reconnecting";
            publishStatus();
            current.reconnect(activity);
        } else {
            trace("N18", "FLIR", "blocked", "camera reconnect requested before SDK readiness", "error");
        }
    }

    void startCommissioning(Activity activity) {
        FlirCameraController current = camera;
        if (!cameraRuntimeReady || current == null) {
            trace("C00", "COMMISSION", "blocked", "FLIR runtime is not ready", "error");
            return;
        }
        String runId = "run-" + UUID.randomUUID().toString().replace("-", "");
        ThermalCommissioningRun.Snapshot report = commissioning.start(runId, sessionId(), System.currentTimeMillis());
        firstFrameTraced = false;
        publishCommissioning(report);
        trace("C01", "COMMISSION", "started", "deterministic run " + runId.substring(0, 12) + " · build " + BuildConfig.VERSION_NAME, "info");
        trace("C02", "COMMISSION", "cold-reconnect", "releasing prior FLIR stream before discovery", "info");
        cameraState = "reconnecting";
        publishStatus();
        current.reconnect(activity);
        commissioningWorker.schedule(
                () -> publishCommissioning(commissioning.firstFrameTimeout(runId, System.currentTimeMillis())),
                ThermalCommissioningRun.FIRST_FRAME_TIMEOUT_MS,
                TimeUnit.MILLISECONDS);
    }

    String commissioningSummary() {
        ThermalCommissioningRun.Snapshot report = commissioning.snapshot();
        if (report.runId == null) {
            String retained = getSharedPreferences("commissioning", MODE_PRIVATE).getString("last_summary", null);
            return retained == null ? "NOT RUN · press RUN FULL DIAGNOSTIC" : "LAST · " + retained;
        }
        return report.summary();
    }

    boolean commissioningRunning() {
        return "running".equals(commissioning.snapshot().result);
    }

    boolean canConnectCamera() {
        return cameraRuntimeReady && camera != null;
    }

    boolean prepareHeadsetCamera() {
        boolean granted = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(HeadsetSnapshotController.HEADSET_CAMERA_PERMISSION) == PackageManager.PERMISSION_GRANTED;
        if (!granted) {
            trace("N21", "SNAPSHOT", "permission-required", "Quest RGB snapshot permission has not been granted", "warn");
            return false;
        }
        if (headsetCameraForegroundReady) return true;
        try {
            startForeground(
                    NOTIFICATION_ID,
                    notification("FLIR bridge ready · headset snapshot armed"),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC | ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA);
            headsetCameraForegroundReady = true;
            trace("N21", "SNAPSHOT", "armed", "one-shot Quest RGB capture is ready", "success");
            return true;
        } catch (RuntimeException error) {
            trace("N21", "SNAPSHOT", "blocked", "Horizon OS rejected camera foreground preparation", "error");
            return false;
        }
    }

    String sessionId() {
        return activation == null ? null : activation.sessionId;
    }

    String relayLabel() {
        LocalThermalTransport transport = localTransport;
        String localLabel = transport == null ? "local transport starting" : transport.label();
        return activation == null ? localLabel + " · waiting for scene" : activation.relayLabel();
    }

    String browserHandoffUrl() {
        BridgeActivation current = activation;
        return current != null && current.canHandoffToBrowser() ? current.browserHandoffUrl() : null;
    }

    @Override public void onCameraState(String state, String reason) {
        cameraState = state;
        traceCameraState(state, reason);
        ThermalCommissioningRun.Snapshot activeReport = commissioning.snapshot();
        boolean terminalCameraState = "failed".equals(state)
                || "permission-denied".equals(state)
                || ("offline".equals(state) && activeReport.firstFrameAtMs > 0);
        if ("running".equals(activeReport.result) && terminalCameraState) {
            String detail = reason == null || reason.isBlank() ? state : reason;
            publishCommissioning(commissioning.onCameraFailure(state, detail, System.currentTimeMillis()));
        }
        LocalThermalTransport transport = localTransport;
        if (transport != null) transport.sendSourceStatus(state, reason);
        RelayClient current = relay;
        if (current != null) current.sendSourceStatus(state, reason);
        publishStatus();
        updateNotification();
    }

    @Override public void onFrame(Bitmap bitmap) {
        if (!firstFrameTraced) {
            firstFrameTraced = true;
            trace("N13", "FRAME", "decoded", "first native thermal frame decoded", "success");
        }
        ThermalCommissioningRun.Snapshot before = commissioning.snapshot();
        ThermalCommissioningRun.Snapshot after = commissioning.onFrame(System.currentTimeMillis());
        if (before.firstFrameAtMs == 0 && after.firstFrameAtMs > 0 && "soaking".equals(after.phase)) {
            trace("C03", "COMMISSION", "first-frame", "native thermal frame accepted; 15 second soak started", "success");
            publishCommissioning(after);
            String runId = after.runId;
            commissioningWorker.schedule(() -> {
                ThermalCommissioningRun.Snapshot evaluated = commissioning.evaluateNativeSoak(runId, System.currentTimeMillis());
                publishCommissioning(evaluated);
                if ("awaiting-browser".equals(evaluated.phase)) {
                    trace("C04", "COMMISSION", "native-pass", evaluated.nativeFrames + " frames · max gap " + evaluated.maxFrameGapMs + "ms", "success");
                    commissioningWorker.schedule(
                            () -> publishCommissioning(commissioning.browserTimeout(runId, System.currentTimeMillis())),
                            ThermalCommissioningRun.BROWSER_TIMEOUT_MS,
                            TimeUnit.MILLISECONDS);
                }
            }, ThermalCommissioningRun.SOAK_DURATION_MS, TimeUnit.MILLISECONDS);
        } else if (after.nativeFrames > 0 && after.nativeFrames % 30 == 0 && after.nativeFrames != before.nativeFrames) {
            publishCommissioning(after);
        }
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

    @Override public void onFrameDiagnostic(String state, String detail) {
        trace("N20", "FRAME", state, detail, "recovered".equals(state) ? "success" : "warn");
        if ("skipped".equals(state)) publishCommissioning(commissioning.onTransientSkip(System.currentTimeMillis()));
    }

    private void onRelayState(String state) {
        relayState = state;
        publishStatus();
        updateNotification();
    }

    private void onBrowserCommissioningAck(String runId, int renderedFrames) {
        ThermalCommissioningRun.Snapshot before = commissioning.snapshot();
        ThermalCommissioningRun.Snapshot after = commissioning.acknowledgeBrowser(runId, renderedFrames, System.currentTimeMillis());
        publishCommissioning(after);
        if (!before.terminal() && "pass".equals(after.result)) {
            trace("C05", "COMMISSION", "pass", "browser acknowledged " + renderedFrames + " ordered rendered frames", "success");
        }
    }

    private void publishStatus() {
        StatusListener current = statusListener;
        if (current != null) {
            current.onStatus(bridgeLabel(), relayState, cameraState);
            current.onCommissioning(commissioningSummary());
        }
    }

    private void publishCommissioning(ThermalCommissioningRun.Snapshot report) {
        if (report.runId == null) return;
        String json = commissioningJson(report);
        if (json.equals(lastCommissioningPayload)) return;
        lastCommissioningPayload = json;
        getSharedPreferences("commissioning", MODE_PRIVATE).edit()
                .putString("last_report", json)
                .putString("last_summary", report.summary())
                .apply();
        LocalThermalTransport transport = localTransport;
        if (transport != null) transport.sendCommissioning(json);
        StatusListener current = statusListener;
        if (current != null) current.onCommissioning(report.summary());
        if (report.terminal() && "fail".equals(report.result)) {
            trace("C00", "COMMISSION", report.failureBoundary, report.failureDetail, "error");
        }
    }

    private static String commissioningJson(ThermalCommissioningRun.Snapshot report) {
        try {
            return new JSONObject(report.toJson(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE))
                    .put("deviceManufacturer", Build.MANUFACTURER)
                    .put("deviceModel", Build.MODEL)
                    .put("androidSdk", Build.VERSION.SDK_INT)
                    .put("osRelease", Build.VERSION.RELEASE)
                    .toString();
        } catch (JSONException error) {
            return report.toJson(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE);
        }
    }

    private void onSnapshotRequest(String requestId, LocalThermalBroker.SnapshotResponder responder) {
        HeadsetSnapshotController controller = headsetSnapshots;
        if (!headsetCameraForegroundReady || controller == null) {
            responder.failure("snapshot-not-armed", "open the companion once and grant headset camera access");
            trace("N22", "SNAPSHOT", "blocked", "capture requested before headset camera foreground preparation", "error");
            return;
        }
        trace("N22", "SNAPSHOT", "opening", "opening Quest passthrough RGB camera for one frame", "info");
        controller.capture(new HeadsetSnapshotController.Callback() {
            @Override public void onCaptured(byte[] jpeg, int width, int height, String eye) {
                trace("N23", "SNAPSHOT", "captured", width + "x" + height + " " + eye + "-eye JPEG captured; camera released", "success");
                responder.success(jpeg, width, height, eye);
            }

            @Override public void onFailure(String code, String detail) {
                trace("N23", "SNAPSHOT", code, detail, "error");
                responder.failure(code, detail);
            }
        });
    }

    private void initializeRuntime() {
        LocalThermalTransport transport = localTransport;
        if (transport == null || destroyed) return;
        try {
            trace("N03", "BROKER", "binding", "binding Quest loopback port 4109", "info");
            setBridgeState("broker-starting", false, "binding-loopback-4109");
            try {
                if (transport.startAndAwait(4, TimeUnit.SECONDS)) {
                    trace("N04", "BROKER", "listening", "optional Quest loopback broker is accepting browser clients", "success");
                    setBridgeState("broker-ready", false, "optional-loopback-4109-listening");
                } else {
                    trace("N04", "BROKER", "unavailable", "optional loopback broker timed out; native spatial mode continues", "warn");
                    setBridgeState("broker-unavailable", false, "native-spatial-continuing");
                }
            } catch (RuntimeException error) {
                trace("N04", "BROKER", "unavailable", "optional loopback broker failed; native spatial mode continues", "warn");
                setBridgeState("broker-unavailable", false, "native-spatial-continuing");
            }
            if (destroyed) return;
            trace("N05", "SDK", "initializing", "initializing FLIR Atlas " + BuildConfig.FLIR_SDK_VERSION, "info");
            setBridgeState("sdk-starting", false, "flir-atlas-" + BuildConfig.FLIR_SDK_VERSION);
            ThermalSdkAndroid.init(getApplicationContext(), ThermalLog.LogLevel.INFO);
            if (destroyed) return;
            camera = new FlirCameraController(this);
            cameraRuntimeReady = true;
            trace("N06", "SDK", "ready", "FLIR camera runtime initialized", "success");
            setBridgeState("ready", true, "camera-runtime-ready");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            if (!destroyed) {
                trace("N00", "SERVICE", "failed", "startup interrupted", "error");
                setBridgeState("failed", false, "startup-interrupted");
            }
        } catch (RuntimeException | LinkageError error) {
            cameraRuntimeReady = false;
            trace("N00", "SERVICE", "failed", startupReason(error), "error");
            setBridgeState("failed", false, startupReason(error));
        }
    }

    void recordTrace(String step, String vector, String state, String detail, String level) {
        trace(step, vector, state, detail, level);
    }

    private void traceCameraState(String state, String reason) {
        String detail = reason == null || reason.isBlank() ? state : state + " · " + reason;
        switch (state) {
            case "discovering" -> trace("N08", "FLIR", "discovering", "USB camera discovery scan started", "info");
            case "permission-required" -> trace("N09", "USB", "permission", "FLIR ONE found; Android USB approval requested", "info");
            case "permission-denied" -> trace("N09", "USB", "denied", detail, "error");
            case "connecting" -> trace("N10", "FLIR", "connecting", "USB permission granted; opening camera", "success");
            case "ready" -> trace("N11", "FLIR", "stream-ready", "thermal stream discovered and configured", "success");
            case "streaming" -> trace("N12", "FLIR", "streaming", "native thermal stream callback started", "success");
            case "failed", "offline" -> trace("N00", "FLIR", state, detail, "error");
            default -> trace("N07", "FLIR", state, detail, "info");
        }
    }

    private void trace(String step, String vector, String state, String detail, String level) {
        String entry = step + " · " + vector + " · " + state + " · " + detail;
        List<String> snapshot;
        synchronized (traceLock) {
            traceHistory.addLast(entry);
            while (traceHistory.size() > TRACE_HISTORY_LIMIT) traceHistory.removeFirst();
            snapshot = new ArrayList<>(traceHistory);
        }
        StatusListener current = statusListener;
        if (current != null) current.onTrace(snapshot);
        LocalThermalTransport transport = localTransport;
        if (transport != null) transport.sendTrace(step, vector, state, detail, level);
    }

    private List<String> traceHistorySnapshot() {
        synchronized (traceLock) {
            return new ArrayList<>(traceHistory);
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
