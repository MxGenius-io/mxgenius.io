package io.mxgenius.sensorbridge;

import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;

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
    private static final int MAX_PERMISSION_ATTEMPTS = 2;

    interface Listener {
        void onCameraState(String state, String reason);
        void onFrame(Bitmap bitmap);
        void onFrameDiagnostic(String state, String detail);
        void onUsbDiagnostic(String state, String detail);
    }

    private final ExecutorService cameraWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService frameWorker = Executors.newSingleThreadExecutor();
    private final UsbPermissionHandler usbPermissions = new UsbPermissionHandler();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Listener listener;
    private final Object updateLock = new Object();
    private final AtomicBoolean claimed = new AtomicBoolean();
    private final AtomicBoolean scanInFlight = new AtomicBoolean();
    private final AtomicBoolean framePending = new AtomicBoolean();
    private final AtomicInteger consecutiveFrameSkips = new AtomicInteger();
    private final AtomicInteger discoveryGeneration = new AtomicInteger();
    private Camera camera;
    private Stream stream;
    private ThermalStreamer streamer;
    private volatile boolean closing;

    FlirCameraController(Listener listener) {
        this.listener = listener;
    }

    void discoverAndConnect(Activity activity) {
        if (claimed.get() || !scanInFlight.compareAndSet(false, true)) return;
        closing = false;
        int generation = discoveryGeneration.incrementAndGet();
        listener.onUsbDiagnostic(
                "discovery-start",
                "FLIR Atlas USB discovery started from the foreground activity · generation=" + generation);
        listener.onCameraState("discovering", null);
        DiscoveryFactory.getInstance().scan(new DiscoveryEventListener() {
            @Override public void onCameraFound(DiscoveredCamera discoveredCamera) {
                if (!isActiveGeneration(generation)) return;
                Identity identity = discoveredCamera.getIdentity();
                if (identity.communicationInterface != CommunicationInterface.USB
                        || !claimed.compareAndSet(false, true)) return;
                scanInFlight.set(false);
                DiscoveryFactory.getInstance().stop(CommunicationInterface.USB);
                listener.onUsbDiagnostic(
                        "identity-found",
                        "FLIR Atlas discovered a USB identity · generation=" + generation);
                mainHandler.post(() -> requestPermissionOrConnect(identity, activity, generation));
            }

            @Override public void onDiscoveryError(
                    CommunicationInterface communicationInterface,
                    ErrorCode errorCode) {
                if (!isActiveGeneration(generation)) return;
                scanInFlight.set(false);
                claimed.set(false);
                listener.onCameraState(
                        "failed",
                        "discovery-" + errorCode.toString().toLowerCase(Locale.ROOT));
            }
        }, CommunicationInterface.USB);
    }

    private void requestPermissionOrConnect(Identity identity, Activity activity, int generation) {
        if (!isActiveGeneration(generation)) return;
        if (!UsbPermissionHandler.isFlirOne(identity)) {
            claimed.set(false);
            listener.onUsbDiagnostic(
                    "permission-error",
                    "FLIR Atlas did not recognize the discovered USB identity as FLIR ONE"
                            + " · generation=" + generation);
            listener.onCameraState("failed", "usb-permission-invalid_identity");
            return;
        }
        if (UsbPermissionHandler.hasFlirOnePermission(identity, activity.getApplicationContext())) {
            listener.onUsbDiagnostic(
                    "permission-existing",
                    "FLIR Atlas reports an existing device permission · generation=" + generation);
            connect(identity, generation);
            return;
        }
        requestFlirPermission(identity, activity, generation, 1);
    }

    private void requestFlirPermission(
            Identity identity,
            Activity activity,
            int generation,
            int attempt) {
        if (!isActiveGeneration(generation)) return;
        listener.onCameraState("permission-required", null);
        listener.onUsbDiagnostic(
                "permission-requested",
                "FLIR UsbPermissionHandler requested device access; waiting for its callback"
                        + " · attempt=" + attempt
                        + " · generation=" + generation);
        try {
            usbPermissions.requestFlirOnePermisson(
                    identity,
                    activity,
                    new UsbPermissionHandler.UsbPermissionListener() {
                        @Override public void permissionGranted(Identity grantedIdentity) {
                            if (!isActiveGeneration(generation)) return;
                            listener.onUsbDiagnostic(
                                    "permission-granted",
                                    "FLIR UsbPermissionHandler granted the identity; Camera.connect may start"
                                            + " · generation=" + generation);
                            connect(grantedIdentity, generation);
                        }

                        @Override public void permissionDenied(Identity deniedIdentity) {
                            if (!isActiveGeneration(generation)) return;
                            claimed.set(false);
                            listener.onUsbDiagnostic(
                                    "permission-denied",
                                    "FLIR UsbPermissionHandler reported an explicit denial"
                                            + " · generation=" + generation);
                            listener.onCameraState("permission-denied", "usb-permission-denied");
                        }

                        @Override public void error(ErrorType errorType, Identity failedIdentity) {
                            if (!isActiveGeneration(generation)) return;
                            if (errorType == ErrorType.DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION) {
                                if (attempt >= MAX_PERMISSION_ATTEMPTS) {
                                    claimed.set(false);
                                    listener.onUsbDiagnostic(
                                            "permission-error",
                                            "FLIR UsbPermissionHandler reported device unavailable after the single deferred retry"
                                                    + " · attempt=" + attempt
                                                    + " · generation=" + generation);
                                    listener.onCameraState(
                                            "failed",
                                            "usb-permission-device_unavailable_when_asked_permission");
                                    return;
                                }
                                listener.onUsbDiagnostic(
                                        "permission-retry",
                                        "FLIR reported device unavailable; queuing one retry after its receiver returns"
                                                + " · next-attempt=" + (attempt + 1)
                                                + " · generation=" + generation);
                                mainHandler.post(
                                        () -> requestFlirPermission(
                                                identity,
                                                activity,
                                                generation,
                                                attempt + 1));
                                return;
                            }
                            claimed.set(false);
                            String reason = errorType.toString().toLowerCase(Locale.ROOT);
                            listener.onUsbDiagnostic(
                                    "permission-error",
                                    "FLIR UsbPermissionHandler failed · " + reason
                                            + " · generation=" + generation);
                            listener.onCameraState("failed", "usb-permission-" + reason);
                        }
                    });
        } catch (RuntimeException error) {
            claimed.set(false);
            listener.onUsbDiagnostic(
                    "permission-error",
                    "FLIR UsbPermissionHandler threw before completing · " + safeReason(error)
                            + " · generation=" + generation);
            listener.onCameraState("failed", "usb-permission-" + safeReason(error));
        }
    }

    void close() {
        close(null);
    }

    void reconnect(Activity activity) {
        listener.onUsbDiagnostic(
                "reconnect",
                "stopping the active FLIR stream before starting documented discovery again");
        close(() -> mainHandler.post(() -> discoverAndConnect(activity)));
    }

    private void close(Runnable afterClose) {
        closing = true;
        discoveryGeneration.incrementAndGet();
        DiscoveryFactory.getInstance().stop(CommunicationInterface.USB);
        scanInFlight.set(false);
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

    private void connect(Identity identity, int generation) {
        if (!isActiveGeneration(generation)) return;
        listener.onUsbDiagnostic(
                "connect-start",
                "opening FLIR Camera only after the vendor permission callback"
                        + " · generation=" + generation);
        listener.onCameraState("connecting", null);
        cameraWorker.execute(() -> {
            try {
                if (!isActiveGeneration(generation)) return;
                Camera next = new Camera();
                next.connect(identity, errorCode -> {
                    if (!isActiveGeneration(generation)) return;
                    claimed.set(false);
                    listener.onCameraState(
                            "offline",
                            "camera-disconnected-" + safeReason(errorCode));
                }, new ConnectParameters());
                if (!next.isConnected()) {
                    throw new IOException("FLIR Camera.connect returned without a connection.");
                }
                if (!isActiveGeneration(generation)) {
                    next.disconnect();
                    return;
                }
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
                        error -> listener.onCameraState(
                                "failed",
                                "stream-error-" + safeReason(error)));
                listener.onCameraState("streaming", null);
            } catch (IOException | RuntimeException error) {
                claimed.set(false);
                listener.onCameraState("failed", "camera-connect-" + safeReason(error));
            }
        });
    }

    private boolean isActiveGeneration(int generation) {
        return !closing && discoveryGeneration.get() == generation;
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
                        current.update();
                        Bitmap sdkBitmap = BitmapAndroid.createBitmap(current.getImage()).getBitMap();
                        if (sdkBitmap != null) {
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
                    int skipped = consecutiveFrameSkips.incrementAndGet();
                    if (!closing && (skipped == 1 || skipped % 10 == 0)) {
                        listener.onFrameDiagnostic(
                                "skipped",
                                safeReason(error) + " · consecutive=" + skipped);
                    }
                } catch (RuntimeException error) {
                    if (!closing) {
                        listener.onCameraState("failed", "frame-decode-" + safeReason(error));
                    }
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
