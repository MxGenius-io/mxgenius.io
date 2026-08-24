package io.mxgenius.sensorbridge;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Owns one complete, event-driven Android USB enumeration and permission transaction. */
final class AndroidUsbPermissionGate {
    interface Listener {
        void onDiagnostic(String state, String detail);
        void onGranted(UsbDevice device);
        void onDenied(String reason);
        void onFailed(String reason);
    }

    static final int FLIR_USB_VENDOR_ID = 0x09CB;
    static final int FLIR_ONE_PRODUCT_ID = 0x1996;
    private static final String ACTION_USB_PERMISSION =
            "io.mxgenius.sensorbridge.action.USB_PERMISSION";
    private static final long ENUMERATION_POLL_MS = 1_000L;
    private static final long WAITING_HEARTBEAT_MS = 5_000L;
    private static final long GRANT_STABILITY_DELAY_MS = 250L;
    private static final long PERMISSION_STALL_DIAGNOSTIC_MS = 120_000L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final UsbHandshakePolicy policy = new UsbHandshakePolicy();
    private Context receiverContext;
    private UsbManager manager;
    private Listener listener;
    private BroadcastReceiver receiver;
    private Runnable poll;
    private Runnable permissionStallDiagnostic;
    private Runnable stabilityCheck;
    private int activeGeneration = -1;
    private int lastReportedDeviceId = -1;
    private long lastWaitingDiagnosticAtMs;

    boolean isActive() {
        return activeGeneration >= 0;
    }

    void request(Context sourceContext, int generation, Listener nextListener) {
        Context context = sourceContext.getApplicationContext();
        mainHandler.post(() -> begin(context, generation, nextListener));
    }

    void cancel() {
        mainHandler.post(this::cleanup);
    }

    boolean hasGrantedFlirDevice(Context context) {
        UsbManager currentManager = context.getSystemService(UsbManager.class);
        return currentManager != null && selectFlirDevice(currentManager, true) != null;
    }

    private void begin(Context context, int generation, Listener nextListener) {
        cleanup();
        activeGeneration = generation;
        receiverContext = context;
        listener = nextListener;
        manager = context.getSystemService(UsbManager.class);
        policy.start();
        if (manager == null) {
            fail("manager-unavailable", "Quest did not expose Android UsbManager", "usb-manager-unavailable");
            return;
        }

        boolean hostDeclared = context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_USB_HOST);
        listener.onDiagnostic(
                "host-capability",
                "Android USB host feature=" + hostDeclared + " · observing attach/detach and 1s inventory polling"
                        + " · generation=" + generation);

        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context ignored, Intent intent) {
                if (generation != activeGeneration || intent == null) return;
                try {
                    String action = intent.getAction();
                    if (ACTION_USB_PERMISSION.equals(action)) {
                        handlePermissionResult(intent, generation);
                    } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                        handleTopologyChange(intent, true, generation);
                    } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                        handleTopologyChange(intent, false, generation);
                    }
                } catch (RuntimeException error) {
                    listener.onDiagnostic(
                            "event-recovering",
                            "Android USB event could not be read; inventory polling remains authoritative · "
                                    + safeReason(error) + " · generation=" + generation);
                    schedulePoll(0L, generation);
                }
            }
        };

        try {
            IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
            filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
            filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } catch (RuntimeException error) {
            fail(
                    "receiver-error",
                    "Android USB lifecycle receiver failed · " + safeReason(error)
                            + " · generation=" + generation,
                    "usb-receiver-" + safeReason(error));
            return;
        }

        listener.onDiagnostic(
                "device-waiting",
                "waiting without a deadline for FLIR USB vid=09cb pid=1996"
                        + " · generation=" + generation);
        schedulePoll(0L, generation);
    }

    private void handleTopologyChange(Intent intent, boolean attached, int generation) {
        UsbDevice changed = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class);
        String device = changed == null ? "device metadata unavailable" : describeDevice(manager, changed, generation);
        listener.onDiagnostic(attached ? "attached" : "detached", device);
        if (!attached && (changed == null || isFlirDevice(changed))) {
            cancelPermissionTimers();
            policy.observe(null, false);
            lastReportedDeviceId = -1;
            listener.onDiagnostic(
                    "device-waiting",
                    "FLIR detached during handshake; preserving the lifecycle until it re-enumerates"
                            + " · generation=" + generation);
        }
        schedulePoll(0L, generation);
    }

    private void pollInventory(int generation) {
        if (!isActiveGeneration(generation)) return;
        UsbDevice device = selectFlirDevice(manager, false);
        if (device == null) {
            UsbHandshakePolicy.Decision decision = policy.observe(null, false);
            cancelPermissionTimers();
            lastReportedDeviceId = -1;
            long now = SystemClock.elapsedRealtime();
            if (lastWaitingDiagnosticAtMs == 0L
                    || now - lastWaitingDiagnosticAtMs >= WAITING_HEARTBEAT_MS) {
                lastWaitingDiagnosticAtMs = now;
                listener.onDiagnostic(
                        "device-waiting",
                        "Android currently enumerates " + sortedDevices(manager).size()
                                + " USB device(s); still waiting for FLIR vid=09cb pid=1996"
                                + " · generation=" + generation);
            }
            if (decision != UsbHandshakePolicy.Decision.WAIT) {
                fail("policy-error", "USB policy left waiting state without a device", "usb-policy-invalid-wait");
                return;
            }
            schedulePoll(ENUMERATION_POLL_MS, generation);
            return;
        }

        if (device.getDeviceId() != lastReportedDeviceId) {
            lastReportedDeviceId = device.getDeviceId();
            lastWaitingDiagnosticAtMs = 0L;
            listener.onDiagnostic("enumerated", describeDevice(manager, device, generation));
        }
        applyDecision(
                policy.observe(device.getDeviceId(), manager.hasPermission(device)),
                device,
                generation,
                "inventory");
    }

    private void applyDecision(
            UsbHandshakePolicy.Decision decision,
            UsbDevice device,
            int generation,
            String source) {
        if (!isActiveGeneration(generation)) return;
        switch (decision) {
            case WAIT -> schedulePoll(ENUMERATION_POLL_MS, generation);
            case REQUEST_PERMISSION -> requestPermission(device, generation);
            case VERIFY_PERMISSION -> verifyStable(device, generation, source);
            case GRANT -> grant(device, generation);
            case DENY -> deny(generation);
        }
    }

    private void requestPermission(UsbDevice device, int generation) {
        if (!isActiveGeneration(generation)) return;
        cancelPermissionTimers();
        try {
            Intent callback = new Intent(ACTION_USB_PERMISSION).setPackage(receiverContext.getPackageName());
            PendingIntent permissionIntent = PendingIntent.getBroadcast(
                    receiverContext,
                    generation,
                    callback,
                    PendingIntent.FLAG_CANCEL_CURRENT
                            | PendingIntent.FLAG_ONE_SHOT
                            | PendingIntent.FLAG_IMMUTABLE);
            listener.onDiagnostic(
                    "permission-requested",
                    "one Android permission transaction opened for FLIR deviceId=" + device.getDeviceId()
                            + " · waiting for EXTRA_PERMISSION_GRANTED"
                            + " · generation=" + generation);
            manager.requestPermission(device, permissionIntent);
            permissionStallDiagnostic = () -> {
                if (!isActiveGeneration(generation)
                        || policy.phase() != UsbHandshakePolicy.Phase.WAITING_FOR_PERMISSION) return;
                UsbDevice current = findFlirDeviceById(manager, policy.deviceId());
                if (current != null && manager.hasPermission(current)) {
                    applyDecision(
                            policy.observe(current.getDeviceId(), true),
                            current,
                            generation,
                            "permission-observed-without-callback");
                    return;
                }
                listener.onDiagnostic(
                        "permission-waiting",
                        "Android permission transaction is still unresolved; no duplicate request was issued"
                                + " · generation=" + generation);
            };
            mainHandler.postDelayed(permissionStallDiagnostic, PERMISSION_STALL_DIAGNOSTIC_MS);
            schedulePoll(ENUMERATION_POLL_MS, generation);
        } catch (RuntimeException error) {
            fail(
                    "permission-error",
                    "Android USB permission request failed · " + safeReason(error)
                            + " · generation=" + generation,
                    "usb-permission-request-" + safeReason(error));
        }
    }

    private void handlePermissionResult(Intent intent, int generation) {
        if (!isActiveGeneration(generation)) return;
        cancelPermissionTimers();
        UsbDevice callbackDevice = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class);
        UsbDevice current = callbackDevice != null && isFlirDevice(callbackDevice)
                ? findFlirDeviceById(manager, callbackDevice.getDeviceId())
                : findFlirDeviceById(manager, policy.deviceId());
        if (current == null) current = selectFlirDevice(manager, false);
        boolean callbackGranted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
        boolean currentlyGranted = current != null && manager.hasPermission(current);

        if (current == null) {
            policy.permissionResult(callbackGranted, null, false);
            lastReportedDeviceId = -1;
            listener.onDiagnostic(
                    "permission-device-absent",
                    "permission callback arrived after FLIR left the USB inventory; waiting for re-attachment"
                            + " · callback-granted=" + callbackGranted
                            + " · generation=" + generation);
            schedulePoll(0L, generation);
            return;
        }

        boolean sameTransaction = current.getDeviceId() == policy.deviceId();
        boolean identifiedCallback = callbackDevice != null
                && isFlirDevice(callbackDevice)
                && callbackDevice.getDeviceId() == policy.deviceId();
        UsbHandshakePolicy.Decision decision;
        if (!sameTransaction) {
            decision = policy.observe(current.getDeviceId(), currentlyGranted);
        } else if (!identifiedCallback) {
            decision = policy.inconclusivePermissionResult(current.getDeviceId(), currentlyGranted);
        } else {
            decision = policy.permissionResult(callbackGranted, current.getDeviceId(), currentlyGranted);
        }
        listener.onDiagnostic(
                identifiedCallback ? "permission-result" : "permission-inconclusive",
                (identifiedCallback
                        ? "Android permission callback received"
                        : "Android callback omitted the requested FLIR identity; re-enumerated state controls the next step")
                        + " · callback-device=" + (callbackDevice == null ? "null" : callbackDevice.getDeviceId())
                        + " · current-device=" + current.getDeviceId()
                        + " · callback-granted=" + callbackGranted
                        + " · current-grant=" + currentlyGranted
                        + " · generation=" + generation);
        applyDecision(decision, current, generation, "permission-callback");
    }

    private void verifyStable(UsbDevice requestedDevice, int generation, String source) {
        if (!isActiveGeneration(generation)) return;
        cancelPermissionTimers();
        listener.onDiagnostic(
                "permission-grant-received",
                "Android grant observed via " + source + "; verifying the same enumerated device"
                        + " · generation=" + generation);
        stabilityCheck = () -> {
            if (!isActiveGeneration(generation)) return;
            UsbDevice current = findFlirDeviceById(manager, requestedDevice.getDeviceId());
            boolean granted = current != null && manager.hasPermission(current);
            UsbHandshakePolicy.Decision decision = policy.stabilityResult(
                    current == null ? null : current.getDeviceId(),
                    granted);
            if (decision != UsbHandshakePolicy.Decision.GRANT) {
                listener.onDiagnostic(
                        "permission-unstable",
                        "FLIR changed while Android completed permission; returning to the same wait lifecycle"
                                + " · generation=" + generation);
            }
            applyDecision(decision, current, generation, "stability-check");
        };
        mainHandler.postDelayed(stabilityCheck, GRANT_STABILITY_DELAY_MS);
    }

    private void grant(UsbDevice device, int generation) {
        if (!isActiveGeneration(generation) || device == null) return;
        Listener completed = listener;
        String detail = "Android grant is stable for the same FLIR device; SDK discovery may start"
                + " · generation=" + generation;
        cleanup();
        completed.onDiagnostic("permission-stable", detail);
        completed.onGranted(device);
    }

    private void deny(int generation) {
        if (!isActiveGeneration(generation)) return;
        Listener completed = listener;
        String detail = "Android explicitly denied device-scoped FLIR USB access"
                + " · generation=" + generation;
        cleanup();
        completed.onDiagnostic("permission-denied", detail);
        completed.onDenied("usb-permission-denied");
    }

    private void fail(String state, String detail, String reason) {
        Listener completed = listener;
        policy.fail();
        cleanup();
        if (completed != null) {
            completed.onDiagnostic(state, detail);
            completed.onFailed(reason);
        }
    }

    private void schedulePoll(long delayMs, int generation) {
        if (!isActiveGeneration(generation)) return;
        if (poll != null) mainHandler.removeCallbacks(poll);
        poll = () -> {
            try {
                pollInventory(generation);
            } catch (RuntimeException error) {
                if (!isActiveGeneration(generation)) return;
                listener.onDiagnostic(
                        "inventory-recovering",
                        "Android USB inventory read failed; retrying the same lifecycle in "
                                + ENUMERATION_POLL_MS + "ms · " + safeReason(error)
                                + " · generation=" + generation);
                schedulePoll(ENUMERATION_POLL_MS, generation);
            }
        };
        mainHandler.postDelayed(poll, delayMs);
    }

    private void cancelPermissionTimers() {
        if (permissionStallDiagnostic != null) mainHandler.removeCallbacks(permissionStallDiagnostic);
        permissionStallDiagnostic = null;
        if (stabilityCheck != null) mainHandler.removeCallbacks(stabilityCheck);
        stabilityCheck = null;
    }

    private void cleanup() {
        if (poll != null) mainHandler.removeCallbacks(poll);
        poll = null;
        cancelPermissionTimers();
        if (receiverContext != null && receiver != null) {
            try {
                receiverContext.unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // A concurrent lifecycle callback may already have removed it.
            }
        }
        receiver = null;
        receiverContext = null;
        manager = null;
        listener = null;
        activeGeneration = -1;
        lastReportedDeviceId = -1;
        lastWaitingDiagnosticAtMs = 0L;
        policy.cancel();
    }

    private boolean isActiveGeneration(int generation) {
        return generation == activeGeneration && listener != null && manager != null;
    }

    private static UsbDevice selectFlirDevice(UsbManager manager, boolean requirePermission) {
        return sortedDevices(manager).stream()
                .filter(AndroidUsbPermissionGate::isFlirDevice)
                .filter(device -> !requirePermission || manager.hasPermission(device))
                .findFirst()
                .orElse(null);
    }

    private static UsbDevice findFlirDeviceById(UsbManager manager, int deviceId) {
        if (deviceId < 0) return null;
        return sortedDevices(manager).stream()
                .filter(AndroidUsbPermissionGate::isFlirDevice)
                .filter(device -> device.getDeviceId() == deviceId)
                .findFirst()
                .orElse(null);
    }

    private static boolean isFlirDevice(UsbDevice device) {
        return device.getVendorId() == FLIR_USB_VENDOR_ID
                && device.getProductId() == FLIR_ONE_PRODUCT_ID;
    }

    private static List<UsbDevice> sortedDevices(UsbManager manager) {
        List<UsbDevice> devices = new ArrayList<>(manager.getDeviceList().values());
        devices.sort(Comparator.comparingInt(UsbDevice::getVendorId)
                .thenComparingInt(UsbDevice::getProductId)
                .thenComparingInt(UsbDevice::getDeviceId));
        return devices;
    }

    private static String describeDevice(UsbManager manager, UsbDevice device, int generation) {
        List<String> interfaces = new ArrayList<>();
        for (int index = 0; index < device.getInterfaceCount(); index++) {
            UsbInterface usbInterface = device.getInterface(index);
            interfaces.add(usbInterface.getInterfaceClass()
                    + "/" + usbInterface.getInterfaceSubclass()
                    + "/" + usbInterface.getInterfaceProtocol());
        }
        return String.format(
                Locale.ROOT,
                "USB vid=%04x pid=%04x deviceId=%d class=%d interfaces=%s permission=%s product=%s generation=%d",
                device.getVendorId(),
                device.getProductId(),
                device.getDeviceId(),
                device.getDeviceClass(),
                interfaces,
                manager.hasPermission(device),
                safeUsbText(safeProductName(device)),
                generation);
    }

    private static String safeProductName(UsbDevice device) {
        try {
            return device.getProductName();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static String safeReason(Throwable error) {
        String reason = error.getClass().getSimpleName() + "-" + error.getMessage();
        return reason.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9._-]+", "-")
                .replaceAll("-+", "-");
    }

    private static String safeUsbText(String value) {
        if (value == null || value.isBlank()) return "unknown";
        String clean = value.replaceAll("[^A-Za-z0-9 ._+-]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
        return clean.substring(0, Math.min(clean.length(), 64));
    }
}
