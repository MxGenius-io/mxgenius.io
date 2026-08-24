package io.mxgenius.sensorbridge;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;

import com.flir.thermalsdk.ErrorCode;
import com.flir.thermalsdk.ErrorCodeException;
import com.flir.thermalsdk.androidsdk.image.BitmapAndroid;
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
        void onUsbDiagnostic(String state, String detail);
    }

    private static final long RECONNECT_SETTLE_MS = 900L;

    private final ExecutorService cameraWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService frameWorker = Executors.newSingleThreadExecutor();
    private final AndroidUsbPermissionGate permissionGate = new AndroidUsbPermissionGate();
    private final Listener listener;
    private final Object updateLock = new Object();
    private final AtomicBoolean claimed = new AtomicBoolean();
    private final AtomicBoolean scanInFlight = new AtomicBoolean();
    private final AtomicBoolean framePending = new AtomicBoolean();
    private final AtomicInteger consecutiveFrameSkips = new AtomicInteger();
    private final AtomicInteger discoveryGeneration = new AtomicInteger();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Camera camera;
    private Stream stream;
    private ThermalStreamer streamer;
    private volatile boolean closing;

    FlirCameraController(Listener listener) {
        this.listener = listener;
    }

    void discoverAndConnect(Activity activity) {
        beginPermissionGate(activity.getApplicationContext());
    }

    private void beginPermissionGate(Context context) {
        if (claimed.get() || scanInFlight.get() || permissionGate.isActive()) return;
        closing = false;
        int generation = discoveryGeneration.incrementAndGet();
        listener.onCameraState("waiting-usb", null);
        permissionGate.request(context, generation, new AndroidUsbPermissionGate.Listener() {
            @Override public void onDiagnostic(String state, String detail) {
                if (isActiveGeneration(generation)) listener.onUsbDiagnostic(state, detail);
            }

            @Override public void onGranted(android.hardware.usb.UsbDevice device) {
                if (!isActiveGeneration(generation)) return;
                startFlirDiscovery(context, generation);
            }

            @Override public void onDenied(String reason) {
                if (!isActiveGeneration(generation)) return;
                listener.onCameraState("permission-denied", reason);
            }

            @Override public void onFailed(String reason) {
                if (!isActiveGeneration(generation)) return;
                claimed.set(false);
                scanInFlight.set(false);
                listener.onCameraState("failed", reason);
            }
        });
    }

    private void startFlirDiscovery(Context context, int generation) {
        if (!isActiveGeneration(generation) || !scanInFlight.compareAndSet(false, true)) return;
        listener.onUsbDiagnostic(
                "discovery-start",
                "Android grant stable; starting fresh FLIR discovery · generation=" + generation);
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
                        "fresh FLIR USB identity selected · generation=" + generation);
                if (!permissionGate.hasGrantedFlirDevice(context)) {
                    claimed.set(false);
                    restartHandshake(context, generation, "usb-grant-lost-before-connect");
                    return;
                }
                connect(identity, generation);
            }

            @Override public void onDiscoveryError(CommunicationInterface communicationInterface, ErrorCode errorCode) {
                if (!isActiveGeneration(generation)) return;
                scanInFlight.set(false);
                claimed.set(false);
                listener.onCameraState("failed", "discovery-" + errorCode.toString().toLowerCase(Locale.ROOT));
            }
        }, CommunicationInterface.USB);
    }

    private void restartHandshake(Context context, int failedGeneration, String reason) {
        if (!discoveryGeneration.compareAndSet(failedGeneration, failedGeneration + 1)) return;
        DiscoveryFactory.getInstance().stop(CommunicationInterface.USB);
        permissionGate.cancel();
        scanInFlight.set(false);
        claimed.set(false);
        listener.onUsbDiagnostic(
                "handshake-resync",
                "discarding the stale FLIR identity after " + reason
                        + "; returning to the indefinite USB wait lifecycle");
        listener.onCameraState("waiting-usb", "usb-identity-refresh");
        int rediscoveryToken = failedGeneration + 1;
        mainHandler.postDelayed(() -> {
            if (closing
                    || discoveryGeneration.get() != rediscoveryToken) return;
            beginPermissionGate(context);
        }, RECONNECT_SETTLE_MS);
    }

    void close() {
        close(null);
    }

    void reconnect(Activity activity) {
        listener.onUsbDiagnostic("settling", "releasing FLIR interface for " + RECONNECT_SETTLE_MS + "ms before rediscovery");
        Context context = activity.getApplicationContext();
        close(() -> mainHandler.postDelayed(() -> beginPermissionGate(context), RECONNECT_SETTLE_MS));
    }

    private void close(Runnable afterClose) {
        closing = true;
        discoveryGeneration.incrementAndGet();
        permissionGate.cancel();
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
                "opening FLIR stream with authorized identity · generation=" + generation);
        listener.onCameraState("connecting", null);
        cameraWorker.execute(() -> {
            try {
                if (!isActiveGeneration(generation)) return;
                Camera next = new Camera();
                next.connect(identity, errorCode -> {
                    if (!isActiveGeneration(generation)) return;
                    claimed.set(false);
                    listener.onCameraState("offline", "camera-disconnected-" + safeReason(errorCode));
                }, new ConnectParameters());
                if (!next.isConnected()) throw new IOException("FLIR Camera.connect returned without a connection.");
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
                        error -> listener.onCameraState("failed", "stream-error-" + safeReason(error)));
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
