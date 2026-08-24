package io.mxgenius.sensorbridge;

import android.app.Activity;
import android.graphics.Bitmap;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
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

    private static final int FLIR_USB_VENDOR_ID = 0x09CB;
    private static final int MAX_PERMISSION_REDISCOVERIES = 3;
    private static final long PERMISSION_REDISCOVERY_BASE_MS = 500L;
    private static final long RECONNECT_SETTLE_MS = 900L;

    private final ExecutorService cameraWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService frameWorker = Executors.newSingleThreadExecutor();
    private final UsbPermissionHandler usbPermissions = new UsbPermissionHandler();
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
        discoverAndConnect(activity, 0);
    }

    private void discoverAndConnect(Activity activity, int recoveryAttempt) {
        if (claimed.get() || !scanInFlight.compareAndSet(false, true)) return;
        closing = false;
        int generation = discoveryGeneration.incrementAndGet();
        reportUsbInventory(activity, generation);
        listener.onUsbDiagnostic(
                "discovery-start",
                "fresh FLIR discovery · generation=" + generation + " · recovery=" + recoveryAttempt + "/" + MAX_PERMISSION_REDISCOVERIES);
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
                listener.onCameraState("permission-required", null);
                resolvePermission(identity, activity, generation, recoveryAttempt);
            }

            @Override public void onDiscoveryError(CommunicationInterface communicationInterface, ErrorCode errorCode) {
                if (!isActiveGeneration(generation)) return;
                scanInFlight.set(false);
                claimed.set(false);
                listener.onCameraState("failed", "discovery-" + errorCode.toString().toLowerCase(Locale.ROOT));
            }
        }, CommunicationInterface.USB);
    }

    private void resolvePermission(Identity identity, Activity activity, int generation, int recoveryAttempt) {
        if (!isActiveGeneration(generation) || activity.isFinishing() || activity.isDestroyed()) {
            claimed.set(false);
            listener.onUsbDiagnostic(
                    "permission-aborted",
                    "foreground activity closed before USB authorization · generation=" + generation);
            listener.onCameraState("failed", "usb-permission-activity-closed");
            return;
        }
        boolean alreadyGranted = UsbPermissionHandler.hasFlirOnePermission(identity, activity);
        listener.onUsbDiagnostic(
                "permission-check",
                alreadyGranted
                        ? "FLIR USB authorization already granted · generation=" + generation
                        : "FLIR USB authorization required · generation=" + generation);
        if (FlirPermissionPolicy.afterGrantCheck(alreadyGranted) == FlirPermissionPolicy.GrantAction.CONNECT) {
            listener.onUsbDiagnostic(
                    "permission-bypassed",
                    "existing device-scoped authorization reused without another prompt · generation=" + generation);
            connect(identity, generation);
            return;
        }

        listener.onUsbDiagnostic(
                "permission-request",
                "requesting device-scoped FLIR USB access once · generation=" + generation);
        mainHandler.post(() -> usbPermissions.requestFlirOnePermisson(identity, activity, new UsbPermissionHandler.UsbPermissionListener() {
                    @Override public void permissionGranted(Identity grantedIdentity) {
                        if (!isActiveGeneration(generation)) return;
                        listener.onUsbDiagnostic(
                                "permission-granted",
                                "Quest granted device-scoped FLIR USB access · generation=" + generation);
                        connect(grantedIdentity, generation);
                    }

                    @Override public void permissionDenied(Identity deniedIdentity) {
                        if (!isActiveGeneration(generation)) return;
                        claimed.set(false);
                        listener.onUsbDiagnostic(
                                "permission-denied",
                                "operator denied device-scoped FLIR USB access · generation=" + generation);
                        listener.onCameraState("permission-denied", "usb-permission-denied");
                    }

                    @Override public void error(ErrorType errorType, Identity failedIdentity) {
                        if (!isActiveGeneration(generation)) return;
                        String errorName = errorType.toString();
                        if (FlirPermissionPolicy.afterPermissionError(
                                errorName,
                                recoveryAttempt,
                                MAX_PERMISSION_REDISCOVERIES) == FlirPermissionPolicy.ErrorAction.REDISCOVER) {
                            rediscoverAfterPermissionError(activity, generation, recoveryAttempt + 1, errorName);
                            return;
                        }
                        claimed.set(false);
                        listener.onUsbDiagnostic(
                                "permission-error",
                                "FLIR USB authorization failed · " + errorName.toLowerCase(Locale.ROOT)
                                        + " · generation=" + generation
                                        + " · recoveries=" + recoveryAttempt);
                        listener.onCameraState("failed", "usb-permission-" + errorType.toString().toLowerCase(Locale.ROOT));
                    }
                }));
    }

    private void rediscoverAfterPermissionError(
            Activity activity,
            int failedGeneration,
            int nextRecoveryAttempt,
            String errorName) {
        if (!discoveryGeneration.compareAndSet(failedGeneration, failedGeneration + 1)) return;
        DiscoveryFactory.getInstance().stop(CommunicationInterface.USB);
        scanInFlight.set(false);
        claimed.set(false);
        long delayMs = PERMISSION_REDISCOVERY_BASE_MS * nextRecoveryAttempt;
        listener.onUsbDiagnostic(
                "permission-rediscovery",
                "discarding stale FLIR identity after " + errorName.toLowerCase(Locale.ROOT)
                        + " · next-recovery=" + nextRecoveryAttempt + "/" + MAX_PERMISSION_REDISCOVERIES
                        + " · delay=" + delayMs + "ms");
        listener.onCameraState("reconnecting", "usb-identity-refresh");
        int rediscoveryToken = failedGeneration + 1;
        mainHandler.postDelayed(() -> {
            if (closing
                    || discoveryGeneration.get() != rediscoveryToken
                    || activity.isFinishing()
                    || activity.isDestroyed()) return;
            discoverAndConnect(activity, nextRecoveryAttempt);
        }, delayMs);
    }

    void close() {
        close(null);
    }

    void reconnect(Activity activity) {
        listener.onUsbDiagnostic("settling", "releasing FLIR interface for " + RECONNECT_SETTLE_MS + "ms before rediscovery");
        close(() -> mainHandler.postDelayed(() -> discoverAndConnect(activity), RECONNECT_SETTLE_MS));
    }

    private void reportUsbInventory(Activity activity, int generation) {
        UsbManager manager = activity.getSystemService(UsbManager.class);
        if (manager == null) {
            listener.onUsbDiagnostic("manager-unavailable", "Quest did not expose Android UsbManager");
            return;
        }
        List<UsbDevice> devices = new ArrayList<>(manager.getDeviceList().values());
        devices.sort(Comparator.comparingInt(UsbDevice::getVendorId).thenComparingInt(UsbDevice::getProductId));
        List<UsbDevice> flirDevices = devices.stream()
                .filter(device -> device.getVendorId() == FLIR_USB_VENDOR_ID)
                .toList();
        if (flirDevices.isEmpty()) {
            listener.onUsbDiagnostic(
                    "not-enumerated",
                    "Quest enumerated " + devices.size() + " USB device(s), but no FLIR VID 09cb device · generation=" + generation);
            return;
        }
        for (UsbDevice device : flirDevices) {
            listener.onUsbDiagnostic(
                    "enumerated",
                    String.format(
                            Locale.ROOT,
                            "FLIR USB vid=%04x pid=%04x class=%d permission=%s product=%s generation=%d",
                            device.getVendorId(),
                            device.getProductId(),
                            device.getDeviceClass(),
                            manager.hasPermission(device),
                            safeUsbText(device.getProductName()),
                            generation));
        }
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

    private static String safeUsbText(String value) {
        if (value == null || value.isBlank()) return "unknown";
        String clean = value.replaceAll("[^A-Za-z0-9 ._+-]+", " ").replaceAll("\\s+", " ").trim();
        return clean.substring(0, Math.min(clean.length(), 64));
    }
}
