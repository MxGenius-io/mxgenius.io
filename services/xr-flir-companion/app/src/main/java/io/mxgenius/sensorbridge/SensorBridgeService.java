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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
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
        default void onWitness(String summary) {}
        default void onWitness(RemoteWitnessUiState state) {}
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
    private volatile RemoteWitnessBootstrap witnessBootstrap;
    private volatile RemoteWitnessSocket witnessSocket;
    private volatile RemoteWitnessPeerController witnessPeer;
    private BridgeActivation activation;
    private StatusListener statusListener;
    private volatile String bridgeState = "starting";
    private volatile String bridgeReason = "service-created";
    private volatile boolean cameraRuntimeReady;
    private volatile boolean destroyed;
    private volatile boolean firstFrameTraced;
    private volatile boolean headsetCameraForegroundReady;
    private volatile boolean mediaProjectionForegroundReady;
    private volatile boolean witnessRoomLive;
    private volatile String witnessState = "NO ACTIVE INVITATION";
    private volatile RemoteWitnessUiState witnessUiState = RemoteWitnessUiState.EMPTY;
    private volatile Intent pendingWitnessConsent;
    private volatile boolean witnessStartRequested;
    private String relayState = "not connected (optional)";
    private String cameraState = "standby";
    private volatile String usbState = "not-checked";
    private volatile String usbDetail = "USB inventory has not run";
    private volatile String commissioningFirstFrameTimeoutRunId;
    private String lastCommissioningPayload;
    private long lastPreviewAtMs;

    public final class LocalBinder extends Binder {
        SensorBridgeService service() { return SensorBridgeService.this; }
    }

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID,
                notification("Preparing sensor bridge…"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        headsetSnapshots = new HeadsetSnapshotController(this);
        localTransport = new LocalThermalTransport(
                stableNodeId(),
                this::onRelayState,
                this::onSnapshotRequest,
                this::onBrowserCommissioningAck,
                this::onWitnessBootstrap,
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
            clearWitness("xr-session-replaced", false);
            activation = next;
            LocalThermalTransport transport = localTransport;
            if (transport != null) transport.activate(next);
            trace("N02", "ACTIVATION", "accepted", "browser session and local token activated", "success");
            if (relay != null) relay.close();
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
        clearWitness("service-stopped", false);
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
        listener.onWitness(witnessState);
        listener.onWitness(witnessUiState);
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
        commissioningFirstFrameTimeoutRunId = null;
        firstFrameTraced = false;
        publishCommissioning(report);
        trace("C01", "COMMISSION", "started", "deterministic run " + runId.substring(0, 12) + " · build " + BuildConfig.VERSION_NAME, "info");
        if ("streaming".equals(cameraState)) {
            trace("C02", "COMMISSION", "stable-session", "preserving the healthy FLIR stream; commissioning begins on the next decoded frame", "success");
            scheduleCommissioningFirstFrameTimeout(runId);
        } else {
            trace("C02", "COMMISSION", "handshake", "camera is not healthy; first-frame timer will begin only after USB and FLIR synchronization", "info");
            cameraState = "reconnecting";
            publishStatus();
            current.reconnect(activity);
        }
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

    boolean canStartCameraDiscovery() {
        return canConnectCamera()
                && !"streaming".equals(cameraState)
                && !"connecting".equals(cameraState)
                && !"discovering".equals(cameraState)
                && !"waiting-usb".equals(cameraState)
                && !"permission-required".equals(cameraState)
                && !"reconnecting".equals(cameraState);
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
            headsetCameraForegroundReady = true;
            refreshForegroundTypes("FLIR bridge ready · headset snapshot armed");
            trace("N21", "SNAPSHOT", "armed", "one-shot Quest RGB capture is ready", "success");
            return true;
        } catch (RuntimeException error) {
            headsetCameraForegroundReady = false;
            trace("N21", "SNAPSHOT", "blocked", "Horizon OS rejected camera foreground preparation", "error");
            return false;
        }
    }

    boolean headsetCameraArmed() {
        return headsetCameraForegroundReady;
    }

    boolean canRequestWitnessCapture() {
        RemoteWitnessBootstrap bootstrap = witnessBootstrap();
        RemoteWitnessSocket socket = witnessSocket;
        RemoteWitnessPeerController peer = witnessPeer;
        return bootstrap != null && socket != null && socket.isOpen()
                && peer != null && !peer.captureActive() && witnessUiState.canEnd(System.currentTimeMillis());
    }

    boolean witnessCaptureActive() {
        RemoteWitnessPeerController peer = witnessPeer;
        return peer != null && peer.captureActive();
    }

    RemoteWitnessUiState witnessUiState() {
        witnessBootstrap();
        return witnessUiState;
    }

    boolean beginWitnessStart(boolean resume) {
        RemoteWitnessSocket socket = witnessSocket;
        RemoteWitnessUiState state = witnessUiState;
        long now = System.currentTimeMillis();
        boolean allowed = resume ? state.canResume(now) : state.canStart(now);
        String action = resume ? "resume" : "approve";
        if (!allowed || socket == null || !socket.sendControl(action, null, null)) {
            setWitnessUiState(state.withMedia("control-failed", action + " could not be sent"));
            trace("W30", "WITNESS", "control-blocked", action + " was not available for the current room state", "warn");
            return false;
        }
        witnessStartRequested = true;
        setWitnessUiState(state.withMedia("consent-requested", "waiting for Horizon sharing consent"));
        trace("W30", "WITNESS", action, "wearer requested " + action + " and compositor consent", "info");
        return true;
    }

    boolean pauseWitness() {
        RemoteWitnessSocket socket = witnessSocket;
        if (socket == null || !witnessUiState.canPause(System.currentTimeMillis())
                || !socket.sendControl("pause", null, null)) return false;
        pendingWitnessConsent = null;
        witnessStartRequested = false;
        RemoteWitnessPeerController peer = witnessPeer;
        if (peer != null) peer.stopCapture("wearer-paused");
        setWitnessUiState(witnessUiState.withMedia("paused", "wearer paused customer view"));
        trace("W33", "WITNESS", "paused", "wearer paused customer media", "success");
        return true;
    }

    boolean endWitness() {
        RemoteWitnessSocket socket = witnessSocket;
        if (socket == null || !witnessUiState.canEnd(System.currentTimeMillis())) return false;
        boolean sent = socket.sendControl("revoke", null, null);
        if (!sent) {
            setWitnessUiState(witnessUiState.withMedia("control-failed", "END could not reach the room; retry after reconnect"));
            return false;
        }
        clearWitness("wearer-ended", true);
        return true;
    }

    boolean toggleWitnessExtras() {
        RemoteWitnessSocket socket = witnessSocket;
        RemoteWitnessUiState state = witnessUiState;
        return socket != null && state.canEnd(System.currentTimeMillis())
                && socket.sendControl("set-layers", state.toggledExtras(), null);
    }

    void startWitnessCapture(int resultCode, Intent consentData) {
        RemoteWitnessPeerController peer = witnessPeer;
        if (resultCode != Activity.RESULT_OK || consentData == null || peer == null
                || !witnessStartRequested || witnessBootstrap() == null) {
            trace("W31", "WITNESS", "blocked", "valid room approval and fresh compositor consent are required", "warn");
            pendingWitnessConsent = null;
            witnessStartRequested = false;
            setWitnessUiState(witnessUiState.withMedia("consent-required", "fresh wearer consent is required"));
            return;
        }
        pendingWitnessConsent = new Intent(consentData);
        setWitnessUiState(witnessUiState.withMedia("consent-granted", "waiting for approved customer room"));
        startPendingWitnessCaptureIfReady();
    }

    private synchronized void startPendingWitnessCaptureIfReady() {
        Intent consentData = pendingWitnessConsent;
        RemoteWitnessPeerController peer = witnessPeer;
        if (consentData == null || peer == null || !witnessRoomLive || !witnessStartRequested) return;
        pendingWitnessConsent = null;
        try {
            mediaProjectionForegroundReady = true;
            refreshForegroundTypes("Customer view preparing…");
            if (!peer.startCapture(consentData)) {
                mediaProjectionForegroundReady = false;
                refreshForegroundTypes("Customer view unavailable");
                witnessStartRequested = false;
                setWitnessUiState(witnessUiState.withMedia("consent-required", "customer view was not ready"));
                return;
            }
            trace("W31", "WITNESS", "capture-ready", "Horizon compositor surface connected to the native video-only WebRTC track", "success");
            setWitnessUiState(witnessUiState.withMedia("capture-ready", peer.captureProfile()));
        } catch (RuntimeException | LinkageError error) {
            mediaProjectionForegroundReady = false;
            refreshForegroundTypes("Customer view unavailable");
            trace("W31", "WITNESS", "capture-failed", startupReason(error), "error");
            witnessStartRequested = false;
            setWitnessUiState(witnessUiState.withMedia("capture-failed", "Try START again"));
        }
    }

    void projectionConsentDenied() {
        pendingWitnessConsent = null;
        witnessStartRequested = false;
        trace("W30", "WITNESS", "consent-denied", "wearer did not grant compositor sharing", "warn");
        setWitnessUiState(witnessUiState.withMedia("consent-required", "Sharing permission was not granted"));
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
        if ("streaming".equals(state)
                && "running".equals(activeReport.result)
                && activeReport.firstFrameAtMs == 0) {
            scheduleCommissioningFirstFrameTimeout(activeReport.runId);
        }
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
            commissioningFirstFrameTimeoutRunId = null;
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

    @Override public void onUsbDiagnostic(String state, String detail) {
        usbState = state;
        usbDetail = detail == null || detail.isBlank() ? state : detail;
        String step = switch (state) {
            case "discovery-start", "identity-found" -> "U01";
            case "permission-requested" -> "U02";
            case "permission-retry", "reconnect" -> "U03";
            case "permission-existing", "permission-granted", "connect-start" -> "U04";
            case "permission-denied", "permission-error" -> "U00";
            default -> "U01";
        };
        String level = switch (state) {
            case "permission-retry", "reconnect" -> "warn";
            case "permission-denied", "permission-error" -> "error";
            default -> "info";
        };
        trace(step, "USB", state, usbDetail, level);
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
            current.onWitness(witnessState);
            current.onWitness(witnessUiState);
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

    private String commissioningJson(ThermalCommissioningRun.Snapshot report) {
        try {
            return new JSONObject(report.toJson(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE))
                    .put("deviceManufacturer", Build.MANUFACTURER)
                    .put("deviceModel", Build.MODEL)
                    .put("androidSdk", Build.VERSION.SDK_INT)
                    .put("osRelease", Build.VERSION.RELEASE)
                    .put("usbState", usbState)
                    .put("usbDetail", usbDetail)
                    .toString();
        } catch (JSONException error) {
            return report.toJson(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE);
        }
    }

    private void onSnapshotRequest(String requestId, LocalThermalBroker.SnapshotResponder responder) {
        HeadsetSnapshotController controller = headsetSnapshots;
        if (!headsetCameraForegroundReady || controller == null) {
            responder.failure("snapshot-not-armed", "use ARM RGB SNAPSHOT in the native panel before capture");
            trace("N22", "SNAPSHOT", "blocked", "capture requested before explicit headset camera arming", "error");
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
            case "waiting-usb" -> trace("N09", "USB", "waiting", "waiting for FLIR enumeration and synchronized Android authorization", "info");
            case "permission-required" -> trace("N09", "USB", "permission", "waiting for Android FLIR USB authorization", "info");
            case "permission-denied" -> trace("N09", "USB", "denied", detail, "error");
            case "connecting" -> trace("N10", "FLIR", "connecting", "Android USB grant confirmed; blocking Camera.connect started", "info");
            case "ready" -> trace("N11", "FLIR", "stream-ready", "Camera.connect returned and thermal stream was configured", "info");
            case "streaming" -> trace("N12", "FLIR", "streaming", "native callback registered; waiting for first decoded thermal frame", "info");
            case "failed", "offline" -> trace("N00", "FLIR", state, detail, "error");
            default -> trace("N07", "FLIR", state, detail, "info");
        }
    }

    RemoteWitnessBootstrap witnessBootstrap() {
        RemoteWitnessBootstrap current = witnessBootstrap;
        if (current != null && System.currentTimeMillis() >= current.expiresAtMs) {
            clearWitness("expired", true);
            return null;
        }
        return current;
    }

    private CompletionStage<Void> onWitnessBootstrap(RemoteWitnessBootstrap bootstrap) {
        BridgeActivation current = activation;
        if (current == null || !current.sessionId.equals(bootstrap.sessionId)) {
            throw new IllegalStateException("witness bootstrap does not match the active XR session");
        }
        clearWitness("witness-room-replaced", false);
        witnessBootstrap = bootstrap;
        witnessUiState = RemoteWitnessUiState.from(bootstrap);
        witnessState = witnessUiState.safeSummary(System.currentTimeMillis());
        RemoteWitnessPeerController nextPeer = new RemoteWitnessPeerController(
                getApplicationContext(),
                bootstrap,
                signal -> {
                    RemoteWitnessSocket activeSocket = witnessSocket;
                    return activeSocket != null && activeSocket.sendSignal(signal);
                },
                new RemoteWitnessPeerController.Listener() {
                    @Override public void onState(String state, String detail) {
                        trace("W32", "WITNESS", state, detail, "live".equals(state) ? "success" : "info");
                        setWitnessUiState(witnessUiState.withMedia(state, detail));
                    }

                    @Override public void onCaptureStopped(String reason) {
                        mediaProjectionForegroundReady = false;
                        witnessStartRequested = false;
                        pendingWitnessConsent = null;
                        if (!destroyed) {
                            refreshForegroundTypes("Customer view stopped");
                            setWitnessUiState(witnessUiState.withMedia(
                                    "consent-required", reason.replace('-', ' ')));
                        }
                        RemoteWitnessSocket activeSocket = witnessSocket;
                        if (activeSocket != null && ("projection-revoked".equals(reason) || "projection-start-failed".equals(reason))) {
                            activeSocket.sendControl("pause", null, null);
                        }
                    }
                });
        witnessPeer = nextPeer;
        RemoteWitnessSocket next = new RemoteWitnessSocket(bootstrap, new RemoteWitnessSocket.Listener() {
            @Override public void onState(String state) {
                trace("W21", "WITNESS", state, "native producer socket state changed", "connected".equals(state) ? "success" : "info");
                setWitnessUiState(witnessUiState.withNetwork(state));
                if (state.startsWith("reconnecting") || state.startsWith("server-error")) {
                    RemoteWitnessPeerController activePeer = witnessPeer;
                    if (activePeer != null) activePeer.stopCapture("signal-interrupted");
                }
                updateNotification();
            }

            @Override public void onRoomState(JSONObject room) {
                JSONObject layers = room.optJSONObject("layers");
                witnessRoomLive = "live".equals(room.optString("status"))
                        && layers != null && layers.optBoolean("pov", false);
                setWitnessUiState(witnessUiState.withRoom(room));
                RemoteWitnessPeerController activePeer = witnessPeer;
                if (activePeer != null) activePeer.onRoomState(room);
                startPendingWitnessCaptureIfReady();
                publishStatus();
            }

            @Override public void onSignal(UUID participantId, JSONObject signal) {
                RemoteWitnessPeerController activePeer = witnessPeer;
                if (activePeer != null) activePeer.onSignal(participantId, signal);
            }

            @Override public void onTerminal(String reason) {
                clearWitnessIfCurrent(bootstrap.roomId, reason);
            }
        });
        witnessSocket = next;
        CompletableFuture<Void> ready = next.connect();
        ready.whenComplete((ignored, error) -> {
            if (error != null) {
                clearWitnessIfCurrent(bootstrap.roomId, "producer-connect-failed");
                return;
            }
            long delay = Math.max(1L, bootstrap.expiresAtMs - System.currentTimeMillis());
            commissioningWorker.schedule(
                    () -> clearWitnessIfCurrent(bootstrap.roomId, "expired"),
                    delay,
                    TimeUnit.MILLISECONDS);
        });
        trace("W20", "WITNESS", "received", "native witness room metadata held in memory pending producer connection", "info");
        publishStatus();
        updateNotification();
        return ready;
    }

    private void clearWitnessIfCurrent(UUID roomId, String reason) {
        RemoteWitnessBootstrap current = witnessBootstrap;
        if (current != null && current.roomId.equals(roomId)) clearWitness(reason, true);
    }

    private synchronized void clearWitness(String reason, boolean traceClear) {
        RemoteWitnessPeerController currentPeer = witnessPeer;
        witnessPeer = null;
        witnessRoomLive = false;
        witnessStartRequested = false;
        pendingWitnessConsent = null;
        if (currentPeer != null) currentPeer.close();
        RemoteWitnessSocket currentSocket = witnessSocket;
        witnessSocket = null;
        witnessBootstrap = null;
        if (currentSocket != null) currentSocket.close();
        mediaProjectionForegroundReady = false;
        if (!destroyed) refreshForegroundTypes("Customer view stopped");
        RemoteWitnessUiState ended = witnessUiState.roomId == null
                ? RemoteWitnessUiState.EMPTY
                : witnessUiState.ended(reason);
        witnessUiState = ended;
        if (destroyed) witnessState = ended.safeSummary(System.currentTimeMillis());
        else setWitnessUiState(ended);
        if (traceClear) {
            trace("W22", "WITNESS", "cleared", "native witness room cleared: " + reason, "warn");
            publishStatus();
            updateNotification();
        }
    }

    private void scheduleCommissioningFirstFrameTimeout(String runId) {
        if (runId == null || runId.isBlank() || runId.equals(commissioningFirstFrameTimeoutRunId)) return;
        commissioningFirstFrameTimeoutRunId = runId;
        trace(
                "C02",
                "COMMISSION",
                "first-frame-window",
                "FLIR stream registered; " + ThermalCommissioningRun.FIRST_FRAME_TIMEOUT_MS
                        + "ms first-frame timer started",
                "info");
        commissioningWorker.schedule(() -> {
            if (!runId.equals(commissioningFirstFrameTimeoutRunId)) return;
            commissioningFirstFrameTimeoutRunId = null;
            publishCommissioning(commissioning.firstFrameTimeout(runId, System.currentTimeMillis()));
        }, ThermalCommissioningRun.FIRST_FRAME_TIMEOUT_MS, TimeUnit.MILLISECONDS);
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
        String text = "Bridge " + bridgeState + " · FLIR " + cameraState + " · witness " + witnessState;
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(text));
    }

    private void setWitnessState(String state) {
        witnessState = state == null || state.isBlank() ? "UNKNOWN" : state;
        StatusListener current = statusListener;
        if (current != null) current.onWitness(witnessState);
        updateNotification();
    }

    private void setWitnessUiState(RemoteWitnessUiState state) {
        witnessUiState = state == null ? RemoteWitnessUiState.EMPTY : state;
        witnessState = witnessUiState.safeSummary(System.currentTimeMillis());
        StatusListener current = statusListener;
        if (current != null) {
            current.onWitness(witnessState);
            current.onWitness(witnessUiState);
        }
        updateNotification();
    }

    private void refreshForegroundTypes(String text) {
        int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
        if (headsetCameraForegroundReady) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
        if (mediaProjectionForegroundReady) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
        startForeground(NOTIFICATION_ID, notification(text), types);
    }
}
