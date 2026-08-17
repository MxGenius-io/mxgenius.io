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
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;

public final class MainActivity extends Activity implements SensorBridgeService.StatusListener {
    private TextView sessionStatus;
    private TextView relayStatus;
    private TextView cameraStatus;
    private ImageView thermalPreview;
    private Button connectCamera;
    private SensorBridgeService service;
    private boolean bound;
    private BridgeActivation activation;

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
            relayStatus.setText("WebXR · service stopped");
            cameraStatus.setText("FLIR ONE · service stopped");
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        sessionStatus = findViewById(R.id.session_status);
        relayStatus = findViewById(R.id.relay_status);
        cameraStatus = findViewById(R.id.camera_status);
        thermalPreview = findViewById(R.id.thermal_preview);
        connectCamera = findViewById(R.id.connect_camera);
        connectCamera.setOnClickListener(view -> {
            if (service != null) service.connectCamera(this);
        });
        findViewById(R.id.return_to_browser).setOnClickListener(view -> finish());
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

    @Override public void onStatus(String relay, String camera) {
        runOnUiThread(() -> {
            relayStatus.setText("WebXR · " + relay);
            cameraStatus.setText("FLIR ONE · " + camera);
            connectCamera.setEnabled(!"streaming".equals(camera) && !"connecting".equals(camera));
            connectCamera.setText("streaming".equals(camera) ? "FLIR ONE streaming" : "Connect FLIR ONE");
        });
    }

    @Override public void onFrame(Bitmap bitmap) {
        runOnUiThread(() -> thermalPreview.setImageBitmap(bitmap));
    }

    private void activate(Intent source) {
        activation = null;
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
        } else {
            sessionStatus.setText(activationMessage == null
                    ? "Standalone · local thermal preview"
                    : "Standalone · " + activationMessage);
            relayStatus.setText("WebXR · not connected (optional)");
        }
        cameraStatus.setText("FLIR ONE · ready to connect");
        connectCamera.setEnabled(true);
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

    private static String shortSession(String value) {
        if (value == null) return "—";
        return value.length() <= 12 ? value : value.substring(0, 12);
    }
}
