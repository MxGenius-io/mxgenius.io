package io.mxgenius.sensorbridge;

import android.app.Activity;
import android.graphics.Bitmap;

import com.flir.thermalsdk.ErrorCode;
import com.flir.thermalsdk.androidsdk.image.BitmapAndroid;
import com.flir.thermalsdk.androidsdk.live.connectivity.UsbPermissionHandler;
import com.flir.thermalsdk.live.Camera;
import com.flir.thermalsdk.live.CommunicationInterface;
import com.flir.thermalsdk.live.ConnectParameters;
import com.flir.thermalsdk.live.Identity;
import com.flir.thermalsdk.live.discovery.DiscoveredCamera;
import com.flir.thermalsdk.live.discovery.DiscoveryEventListener;
import com.flir.thermalsdk.live.discovery.DiscoveryFactory;
import com.flir.thermalsdk.live.streaming.Stream;
import com.flir.thermalsdk.live.streaming.ThermalStreamer;

import java.io.IOException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class FlirCameraController {
    interface Listener {
        void onCameraState(String state, String reason);
        void onFrame(Bitmap bitmap);
    }

    private final ExecutorService cameraWorker = Executors.newSingleThreadExecutor();
    private final UsbPermissionHandler usbPermissions = new UsbPermissionHandler();
    private final Listener listener;
    private Camera camera;
    private Stream stream;
    private ThermalStreamer streamer;
    private boolean claimed;

    FlirCameraController(Listener listener) {
        this.listener = listener;
    }

    void discoverAndConnect(Activity activity) {
        if (claimed) return;
        listener.onCameraState("discovering", null);
        DiscoveryFactory.getInstance().scan(new DiscoveryEventListener() {
            @Override public void onCameraFound(DiscoveredCamera discoveredCamera) {
                Identity identity = discoveredCamera.getIdentity();
                if (claimed || identity.communicationInterface != CommunicationInterface.USB) return;
                claimed = true;
                DiscoveryFactory.getInstance().stop(CommunicationInterface.USB);
                listener.onCameraState("permission-required", null);
                usbPermissions.requestFlirOnePermisson(identity, activity, new UsbPermissionHandler.UsbPermissionListener() {
                    @Override public void permissionGranted(Identity grantedIdentity) {
                        connect(grantedIdentity);
                    }

                    @Override public void permissionDenied(Identity deniedIdentity) {
                        claimed = false;
                        listener.onCameraState("permission-denied", "usb-permission-denied");
                    }

                    @Override public void error(ErrorType errorType, Identity failedIdentity) {
                        claimed = false;
                        listener.onCameraState("failed", "usb-permission-" + errorType.toString().toLowerCase(Locale.ROOT));
                    }
                });
            }

            @Override public void onDiscoveryError(CommunicationInterface communicationInterface, ErrorCode errorCode) {
                claimed = false;
                listener.onCameraState("failed", "discovery-" + errorCode.toString().toLowerCase(Locale.ROOT));
            }
        }, CommunicationInterface.USB);
    }

    void close() {
        DiscoveryFactory.getInstance().stop(CommunicationInterface.USB);
        cameraWorker.execute(() -> {
            try {
                if (stream != null && stream.isStreaming()) stream.stop();
            } catch (RuntimeException ignored) {
                // Continue releasing the camera.
            }
            try {
                if (camera != null) camera.disconnect();
            } catch (RuntimeException ignored) {
                // Service teardown is best effort.
            }
            stream = null;
            streamer = null;
            camera = null;
            claimed = false;
        });
    }

    void shutdown() {
        close();
        cameraWorker.shutdown();
    }

    private void connect(Identity identity) {
        listener.onCameraState("connecting", null);
        cameraWorker.execute(() -> {
            try {
                Camera next = new Camera();
                next.connect(identity, errorCode -> {
                    claimed = false;
                    listener.onCameraState("offline", "camera-disconnected");
                }, new ConnectParameters());
                camera = next;
                stream = next.getStreams().get(0);
                if (!stream.isThermal()) throw new IOException("No thermal stream was exposed.");
                streamer = new ThermalStreamer(stream);
                listener.onCameraState("ready", null);
                stream.start(unused -> {
                    streamer.update();
                    Bitmap bitmap = BitmapAndroid.createBitmap(streamer.getImage()).getBitMap();
                    listener.onFrame(bitmap);
                }, error -> listener.onCameraState("failed", "stream-error"));
                listener.onCameraState("streaming", null);
            } catch (IOException | RuntimeException error) {
                claimed = false;
                listener.onCameraState("failed", "camera-connect");
            }
        });
    }
}
