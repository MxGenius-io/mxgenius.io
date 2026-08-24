package io.mxgenius.sensorbridge;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.content.pm.PackageManager;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;

public final class MainActivity extends Activity implements SensorBridgeService.StatusListener {
    private static final int HEADSET_CAMERA_PERMISSION_REQUEST = 4210;
    private TextView sessionStatus;
    private TextView bridgeStatus;
    private TextView relayStatus;
    private TextView cameraStatus;
    private ImageView thermalPreview;
    private Button connectCamera;
    private Button openImmersive;
    private SensorBridgeService service;
    private boolean bound;
    private BridgeActivation activation;
    private boolean cameraConnectRequested;
    private boolean spatialLaunchStarted;
    private boolean firstFrameReceived;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((SensorBridgeService.LocalBinder) binder).service();
            bound = true;
            service.setStatusListener(MainActivity.this);
            if (hasHeadsetCameraPermissions()) service.prepareHeadsetCamera();
            renderActivation();
        }

        @Override public void onServiceDisconnected(ComponentName name) {
            bound = false;
            service = null;
            bridgeStatus.setText("Bridge · service stopped");
            relayStatus.setText("Spatial · service stopped");
            cameraStatus.setText("FLIR ONE · service stopped");
            connectCamera.setEnabled(false);
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        sessionStatus = findViewById(R.id.session_status);
        bridgeStatus = findViewById(R.id.bridge_status);
        relayStatus = findViewById(R.id.relay_status);
        cameraStatus = findViewById(R.id.camera_status);
        thermalPreview = findViewById(R.id.thermal_preview);
        connectCamera = findViewById(R.id.connect_camera);
        connectCamera.setOnClickListener(view -> {
            cameraConnectRequested = true;
            if (service != null) service.connectCamera(this);
        });
        openImmersive = findViewById(R.id.return_to_browser);
        openImmersive.setOnClickListener(view -> openImmersiveScene());
        findViewById(R.id.stop_bridge).setOnClickListener(this::stopBridge);
        requestHeadsetCameraPermissionsIfNeeded();
        activate(getIntent());
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != HEADSET_CAMERA_PERMISSION_REQUEST) return;
        boolean granted = hasHeadsetCameraPermissions();
        if (service != null) {
            if (granted) service.prepareHeadsetCamera();
            service.recordTrace(
                    "N21",
                    "SNAPSHOT",
                    granted ? "permission-granted" : "permission-denied",
                    granted ? "Quest RGB snapshot permissions granted" : "Quest RGB snapshot permissions denied; thermal remains available",
                    granted ? "success" : "warn");
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        activate(intent);
    }

    @Override protected void onStart() {
        super.onStart();
        bindService(new Intent(this, SensorBridgeService.class), connection, Context.BIND_AUTO_CREATE);
    }

    @Override protected void onStop() {
        if (bound) {
            service.clearStatusListener(this);
            unbindService(connection);
            bound = false;
        }
        super.onStop();
    }

    @Override protected void onDestroy() {
        thermalPreview.setImageDrawable(null);
        super.onDestroy();
    }

    @Override public void onStatus(String bridge, String relay, String camera) {
        runOnUiThread(() -> {
            bridgeStatus.setText("Bridge · " + bridge);
            relayStatus.setText("Spatial · native panel · optional transport " + relay);
            cameraStatus.setText("FLIR ONE · " + camera);
            boolean cameraIdle = !"streaming".equals(camera) && !"connecting".equals(camera);
            connectCamera.setEnabled(service != null && service.canConnectCamera() && cameraIdle);
            connectCamera.setText("streaming".equals(camera) ? "FLIR ONE streaming" : "Connect FLIR ONE");
            boolean managedLaunch = activation != null;
            openImmersive.setEnabled(firstFrameReceived);
            openImmersive.setText(firstFrameReceived
                    ? "Enter native immersive thermal"
                    : "streaming".equals(camera) ? "Waiting for first thermal frame…" : "Waiting for FLIR stream…");
            if (managedLaunch
                    && !cameraConnectRequested
                    && bridge.startsWith("ready")
                    && !"streaming".equals(camera)
                    && !"connecting".equals(camera)
                    && !"discovering".equals(camera)
                    && !"permission-required".equals(camera)) {
                cameraConnectRequested = true;
                service.connectCamera(this);
            }
        });
    }

    @Override public void onFrame(Bitmap bitmap) {
        runOnUiThread(() -> {
            thermalPreview.setImageBitmap(bitmap);
            firstFrameReceived = true;
            openImmersive.setEnabled(true);
            openImmersive.setText("Enter native immersive thermal");
            if (activation != null && !spatialLaunchStarted) {
                spatialLaunchStarted = true;
                bridgeStatus.setText("Bridge · first frame ready · entering native spatial mode");
                if (service != null) service.recordTrace(
                        "N14", "SPATIAL", "ready", "first frame confirmed; native immersive launch scheduled", "success");
                mainHandler.postDelayed(this::openImmersiveScene, 450L);
            }
        });
    }

    private void activate(Intent source) {
        activation = null;
        cameraConnectRequested = false;
        spatialLaunchStarted = false;
        firstFrameReceived = false;
        String activationMessage = null;
        Uri data = source == null ? null : source.getData();
        if (data != null) {
            try {
                activation = BridgeActivation.fromIntent(source, BuildConfig.DEBUG);
            } catch (RuntimeException error) {
                activationMessage = error.getMessage();
            }
        }

        Intent serviceIntent = new Intent(this, SensorBridgeService.class);
        if (activation != null) activation.putInto(serviceIntent);
        startForegroundService(serviceIntent);

        if (activation != null) {
            sessionStatus.setText("Session · " + shortSession(activation.sessionId));
            relayStatus.setText("Spatial · native panel · optional transport " + activation.relayLabel());
            openImmersive.setText("Waiting for FLIR stream…");
            openImmersive.setEnabled(false);
        } else {
            sessionStatus.setText(activationMessage == null
                    ? "Standalone · local thermal preview"
                    : "Standalone · " + activationMessage);
            relayStatus.setText("Spatial · native panel ready");
            openImmersive.setText("Waiting for FLIR stream…");
            openImmersive.setEnabled(false);
        }
        bridgeStatus.setText("Bridge · starting · foreground-active");
        cameraStatus.setText("FLIR ONE · waiting for bridge readiness");
        connectCamera.setEnabled(false);
    }

    private void renderActivation() {
        if (service == null) return;
        String sessionId = service.sessionId();
        sessionStatus.setText(sessionId == null
                ? "Standalone · local thermal preview"
                : "Session · " + shortSession(sessionId));
        relayStatus.setText("Spatial · native panel · optional transport " + service.relayLabel());
    }

    private void stopBridge(View ignored) {
        Intent stop = new Intent(this, SensorBridgeService.class);
        stop.setAction(SensorBridgeService.ACTION_STOP);
        startService(stop);
        finish();
    }

    private boolean hasHeadsetCameraPermissions() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(HeadsetSnapshotController.HEADSET_CAMERA_PERMISSION) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestHeadsetCameraPermissionsIfNeeded() {
        if (hasHeadsetCameraPermissions()) return;
        requestPermissions(
                new String[] {
                        Manifest.permission.CAMERA,
                        HeadsetSnapshotController.HEADSET_CAMERA_PERMISSION
                },
                HEADSET_CAMERA_PERMISSION_REQUEST);
    }

    private void openImmersiveScene() {
        try {
            if (service != null) service.recordTrace(
                    "N15", "SPATIAL", "launching", "opening the native MxGenius immersive thermal panel", "info");
            Intent immersive = new Intent(this, ThermalImmersiveActivity.class);
            if (activation != null) activation.putInto(immersive);
            immersive.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(immersive);
            finish();
        } catch (RuntimeException error) {
            if (service != null) service.recordTrace(
                    "N15", "SPATIAL", "failed", "native immersive activity could not be opened", "error");
            spatialLaunchStarted = false;
            bridgeStatus.setText("Bridge · streaming · native spatial launch failed");
            openImmersive.setEnabled(true);
        }
    }

    private static String shortSession(String value) {
        if (value == null) return "—";
        return value.length() <= 12 ? value : value.substring(0, 12);
    }
}
