package io.mxgenius.sensorbridge;

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
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;

public final class MainActivity extends Activity implements SensorBridgeService.StatusListener {
    private TextView sessionStatus;
    private TextView bridgeStatus;
    private TextView relayStatus;
    private TextView cameraStatus;
    private ImageView thermalPreview;
    private Button connectCamera;
    private Button returnToBrowser;
    private SensorBridgeService service;
    private boolean bound;
    private BridgeActivation activation;
    private boolean cameraConnectRequested;
    private boolean browserHandoffStarted;
    private boolean firstFrameReceived;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((SensorBridgeService.LocalBinder) binder).service();
            bound = true;
            service.setStatusListener(MainActivity.this);
            renderActivation();
        }

        @Override public void onServiceDisconnected(ComponentName name) {
            bound = false;
            service = null;
            bridgeStatus.setText("Bridge · service stopped");
            relayStatus.setText("WebXR · service stopped");
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
        returnToBrowser = findViewById(R.id.return_to_browser);
        returnToBrowser.setOnClickListener(view -> openSensorScene());
        findViewById(R.id.stop_bridge).setOnClickListener(this::stopBridge);
        activate(getIntent());
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
            relayStatus.setText("WebXR · " + relay);
            cameraStatus.setText("FLIR ONE · " + camera);
            boolean cameraIdle = !"streaming".equals(camera) && !"connecting".equals(camera);
            connectCamera.setEnabled(service != null && service.canConnectCamera() && cameraIdle);
            connectCamera.setText("streaming".equals(camera) ? "FLIR ONE streaming" : "Connect FLIR ONE");
            boolean managedHandoff = activation != null && activation.canHandoffToBrowser();
            returnToBrowser.setEnabled(!managedHandoff || firstFrameReceived);
            returnToBrowser.setText(managedHandoff
                    ? (firstFrameReceived
                        ? "Open pinned thermal scene"
                        : "streaming".equals(camera) ? "Waiting for first thermal frame…" : "Waiting for FLIR stream…")
                    : "Close viewer");
            if (managedHandoff
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
            boolean managedHandoff = activation != null && activation.canHandoffToBrowser();
            if (managedHandoff && !browserHandoffStarted) {
                browserHandoffStarted = true;
                bridgeStatus.setText("Bridge · first frame ready · handing off to Meta Browser");
                if (service != null) service.recordTrace(
                        "N14", "HANDOFF", "ready", "first frame confirmed; browser handoff scheduled", "success");
                returnToBrowser.setEnabled(true);
                returnToBrowser.setText("Open pinned thermal scene");
                mainHandler.postDelayed(this::openSensorScene, 450L);
            }
        });
    }

    private void activate(Intent source) {
        activation = null;
        cameraConnectRequested = false;
        browserHandoffStarted = false;
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
            relayStatus.setText("WebXR · " + activation.relayLabel());
            returnToBrowser.setText(activation.canHandoffToBrowser()
                    ? "Waiting for FLIR stream…"
                    : "Close viewer");
            returnToBrowser.setEnabled(!activation.canHandoffToBrowser());
        } else {
            sessionStatus.setText(activationMessage == null
                    ? "Standalone · local thermal preview"
                    : "Standalone · " + activationMessage);
            relayStatus.setText("WebXR · not connected (optional)");
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
        relayStatus.setText("WebXR · " + service.relayLabel());
    }

    private void stopBridge(View ignored) {
        Intent stop = new Intent(this, SensorBridgeService.class);
        stop.setAction(SensorBridgeService.ACTION_STOP);
        startService(stop);
        finish();
    }

    private void openSensorScene() {
        if (activation == null || !activation.canHandoffToBrowser()) {
            finish();
            return;
        }
        try {
            if (service != null) service.recordTrace(
                    "N15", "HANDOFF", "launching", "opening the MxGenius sensor scene in Meta Browser", "info");
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(activation.browserHandoffUrl()));
            browser.addCategory(Intent.CATEGORY_BROWSABLE);
            browser.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(browser);
            finish();
        } catch (RuntimeException error) {
            if (service != null) service.recordTrace(
                    "N15", "HANDOFF", "failed", "Meta Browser activity could not be opened", "error");
            browserHandoffStarted = false;
            bridgeStatus.setText("Bridge · streaming · Meta Browser launch failed");
            returnToBrowser.setEnabled(true);
        }
    }

    private static String shortSession(String value) {
        if (value == null) return "—";
        return value.length() <= 12 ? value : value.substring(0, 12);
    }
}
