package io.mxgenius.sensorbridge;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.IBinder;
import android.content.pm.PackageManager;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

public final class MainActivity extends Activity implements SensorBridgeService.StatusListener {
    private static final int REQUEST_BLUETOOTH_CONNECT = 4108;
    private TextView sessionStatus;
    private TextView relayStatus;
    private TextView cameraStatus;
    private TextView piStatus;
    private Button connectCamera;
    private Button connectPi;
    private SensorBridgeService service;
    private boolean bound;
    private BridgeActivation activation;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((SensorBridgeService.LocalBinder) binder).service();
            bound = true;
            service.setStatusListener(MainActivity.this);
            renderActivation();
            requestPiConnection();
        }

        @Override public void onServiceDisconnected(ComponentName name) {
            bound = false;
            service = null;
            relayStatus.setText("Relay · service stopped");
            cameraStatus.setText("FLIR ONE · service stopped");
            piStatus.setText("PI EDGE · service stopped");
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        sessionStatus = findViewById(R.id.session_status);
        relayStatus = findViewById(R.id.relay_status);
        cameraStatus = findViewById(R.id.camera_status);
        piStatus = findViewById(R.id.pi_status);
        connectCamera = findViewById(R.id.connect_camera);
        connectPi = findViewById(R.id.connect_pi);
        connectCamera.setOnClickListener(view -> {
            if (service != null) service.connectCamera(this);
        });
        connectPi.setOnClickListener(view -> requestPiConnection());
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
        if (activation != null) {
            bindService(new Intent(this, SensorBridgeService.class), connection, Context.BIND_AUTO_CREATE);
        }
    }

    @Override protected void onStop() {
        if (bound) {
            service.clearStatusListener(this);
            unbindService(connection);
            bound = false;
        }
        super.onStop();
    }

    @Override public void onStatus(String relay, String camera, String pi) {
        runOnUiThread(() -> {
            relayStatus.setText("Relay · " + relay);
            cameraStatus.setText("FLIR ONE · " + camera);
            connectCamera.setEnabled(!"streaming".equals(camera) && !"connecting".equals(camera));
            connectCamera.setText("streaming".equals(camera) ? "FLIR ONE streaming" : "Connect FLIR ONE");
            piStatus.setText("PI EDGE · " + pi);
            connectPi.setEnabled(!"streaming".equals(pi) && !"connecting".equals(pi));
            connectPi.setText("streaming".equals(pi) ? "Pi diagnostics streaming" : "Connect MxGenius Pi");
        });
    }

    private void activate(Intent source) {
        try {
            activation = BridgeActivation.fromIntent(source, BuildConfig.DEBUG);
            Intent serviceIntent = new Intent(this, SensorBridgeService.class);
            activation.putInto(serviceIntent);
            startForegroundService(serviceIntent);
            sessionStatus.setText("Session · " + shortSession(activation.sessionId));
            relayStatus.setText("Relay · " + activation.relayLabel());
            cameraStatus.setText("FLIR ONE · permission required");
            piStatus.setText("PI EDGE · permission required");
            connectCamera.setEnabled(true);
            connectPi.setEnabled(true);
        } catch (RuntimeException error) {
            activation = null;
            sessionStatus.setText(error.getMessage());
            relayStatus.setText("Relay · not assigned");
            cameraStatus.setText("FLIR ONE · blocked");
            piStatus.setText("PI EDGE · blocked");
            connectCamera.setEnabled(false);
            connectPi.setEnabled(false);
        }
    }

    private void requestPiConnection() {
        if (activation == null || service == null) return;
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, REQUEST_BLUETOOTH_CONNECT);
            return;
        }
        service.connectPi();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_BLUETOOTH_CONNECT) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            if (service != null) service.connectPi();
        } else {
            piStatus.setText("PI EDGE · nearby-device permission denied");
        }
    }

    private void renderActivation() {
        if (service == null) return;
        sessionStatus.setText("Session · " + shortSession(service.sessionId()));
        if (activation != null) relayStatus.setText("Relay · " + service.relayLabel());
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
