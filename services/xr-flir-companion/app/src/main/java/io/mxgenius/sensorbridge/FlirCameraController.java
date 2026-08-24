package io.mxgenius.sensorbridge;

import android.app.Activity;
import android.graphics.Bitmap;

import com.flir.thermalsdk.ErrorCode;
import com.flir.thermalsdk.ErrorCodeException;
import com.flir.thermalsdk.androidsdk.image.BitmapAndroid;
import com.flir.thermalsdk.androidsdk.live.connectivity.UsbPermissionHandler;
import com.flir.thermalsdk.image.PaletteManager;
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
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

final class FlirCameraController {
    interface Listener {
        void onCameraState(String state, String reason);
        void onFrame(Bitmap bitmap);
        void onFrameDiagnostic(String state, String detail);
    }

    private final ExecutorService cameraWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService frameWorker = Executors.newSingleThreadExecutor();
    private final UsbPermissionHandler usbPermissions = new UsbPermissionHandler();
    private final Listener listener;
    private final Object updateLock = new Object();
    private final AtomicBoolean claimed = new AtomicBoolean();
    private final AtomicBoolean framePending = new AtomicBoolean();
    private final AtomicInteger consecutiveFrameSkips = new AtomicInteger();
    private Camera camera;
    private Stream stream;
    private ThermalStreamer streamer;
    private volatile boolean closing;

    FlirCameraController(Listener listener) {
        this.listener = listener;
    }

    void discoverAndConnect(Activity activity) {
        if (claimed.get()) return;
        closing = false;
        listener.onCameraState("discovering", null);
        DiscoveryFactory.getInstance().scan(new DiscoveryEventListener() {
            @Override public void onCameraFound(DiscoveredCamera discoveredCamera) {
                Identity identity = discoveredCamera.getIdentity();
                if (identity.communicationInterface != CommunicationInterface.USB
                        || !claimed.compareAndSet(false, true)) return;
                DiscoveryFactory.getInstance().stop(CommunicationInterface.USB);
                listener.onCameraState("permission-required", null);
                usbPermissions.requestFlirOnePermisson(identity, activity, new UsbPermissionHandler.UsbPermissionListener() {
                    @Override public void permissionGranted(Identity grantedIdentity) {
                        connect(grantedIdentity);
                    }

                    @Override public void permissionDenied(Identity deniedIdentity) {
                        claimed.set(false);
                        listener.onCameraState("permission-denied", "usb-permission-denied");
                    }

                    @Override public void error(ErrorType errorType, Identity failedIdentity) {
                        claimed.set(false);
                        listener.onCameraState("failed", "usb-permission-" + errorType.toString().toLowerCase(Locale.ROOT));
                    }
                });
            }

            @Override public void onDiscoveryError(CommunicationInterface communicationInterface, ErrorCode errorCode) {
                claimed.set(false);
                listener.onCameraState("failed", "discovery-" + errorCode.toString().toLowerCase(Locale.ROOT));
            }
        }, CommunicationInterface.USB);
    }

    void close() {
        close(null);
    }

    void reconnect(Activity activity) {
        close(() -> activity.runOnUiThread(() -> discoverAndConnect(activity)));
    }

    private void close(Runnable afterClose) {
        closing = true;
        DiscoveryFactory.getInstance().stop(CommunicationInterface.USB);
        cameraWorker.execute(() -> {
            try {
                if (stream != null && stream.isStreaming()) stream.stop();
            } catch (RuntimeException ignored) {
                // Continue releasing the camera.
            }
            synchronized (updateLock) {
                try {
                    if (camera != null) camera.disconnect();
                } catch (RuntimeException ignored) {
                    // Service teardown is best effort.
                }
                stream = null;
                streamer = null;
                camera = null;
            }
            framePending.set(false);
            claimed.set(false);
            if (afterClose != null) afterClose.run();
        });
    }

    void shutdown() {
        close();
        cameraWorker.shutdown();
        frameWorker.shutdown();
    }

    private void connect(Identity identity) {
        listener.onCameraState("connecting", null);
        cameraWorker.execute(() -> {
            try {
                Camera next = new Camera();
                next.connect(identity, errorCode -> {
                    claimed.set(false);
                    listener.onCameraState("offline", "camera-disconnected-" + safeReason(errorCode));
                }, new ConnectParameters());
                camera = next;
                stream = next.getStreams().get(0);
                if (!stream.isThermal()) throw new IOException("No thermal stream was exposed.");
                streamer = new ThermalStreamer(stream);
                streamer.withThermalImage(image -> image.setPalette(
                        PaletteManager.getDefaultPalettes().stream()
                                .filter(palette -> "iron".equalsIgnoreCase(palette.name))
                                .findFirst()
                                .orElseGet(() -> PaletteManager.getDefaultPalettes().get(0))));
                listener.onCameraState("ready", null);
                stream.start(
                        unused -> queueFrame(),
                        error -> listener.onCameraState("failed", "stream-error-" + safeReason(error)));
                listener.onCameraState("streaming", null);
            } catch (IOException | RuntimeException error) {
                claimed.set(false);
                listener.onCameraState("failed", "camera-connect-" + safeReason(error));
            }
        });
    }

    private void queueFrame() {
        if (closing || !framePending.compareAndSet(false, true)) return;
        try {
            frameWorker.execute(() -> {
                Bitmap bitmap = null;
                try {
                    synchronized (updateLock) {
                        ThermalStreamer current = streamer;
                        if (closing || current == null) return;
                        // FLIR documents update() as expensive and blocking. Keep it off both the
                        // SDK streaming callback and Android UI threads, and serialize disconnect.
                        current.update();
                        Bitmap sdkBitmap = BitmapAndroid.createBitmap(current.getImage()).getBitMap();
                        if (sdkBitmap != null) {
                            // The Spatial panel uploads after this lock is released. Detach from
                            // FLIR's mutable/native image buffer before the next streamer update.
                            bitmap = sdkBitmap.copy(Bitmap.Config.ARGB_8888, false);
                        }
                    }
                    int recoveredSkips = consecutiveFrameSkips.getAndSet(0);
                    if (recoveredSkips > 0) {
                        listener.onFrameDiagnostic(
                                "recovered",
                                "frame stream recovered after " + recoveredSkips + " skipped update(s)");
                    }
                    if (bitmap != null && !closing) listener.onFrame(bitmap);
                } catch (ErrorCodeException | NullPointerException | IllegalArgumentException error) {
                    // FLIR's own sample treats these as transient while radiometric frames settle.
                    int skipped = consecutiveFrameSkips.incrementAndGet();
                    if (!closing && (skipped == 1 || skipped % 10 == 0)) {
                        listener.onFrameDiagnostic(
                                "skipped",
                                safeReason(error) + " · consecutive=" + skipped);
                    }
                } catch (RuntimeException error) {
                    if (!closing) listener.onCameraState("failed", "frame-decode-" + safeReason(error));
                } finally {
                    framePending.set(false);
                }
            });
        } catch (RejectedExecutionException ignored) {
            framePending.set(false);
        }
    }

    private static String safeReason(Object value) {
        if (value == null) return "unknown";
        String reason = value instanceof Throwable throwable
                ? throwable.getClass().getSimpleName() + "-" + throwable.getMessage()
                : value.toString();
        reason = reason == null ? "unknown" : reason.toLowerCase(Locale.ROOT);
        reason = reason.replaceAll("[^a-z0-9._-]+", "-").replaceAll("-+", "-");
        return reason.length() > 96 ? reason.substring(0, 96) : reason;
    }
}
