package io.mxgenius.sensorbridge;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Handler;
import android.os.Looper;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Owns one complete Android USB permission transaction at a time. */
final class AndroidUsbPermissionGate {
    interface Listener {
        void onDiagnostic(String state, String detail);
        void onGranted(UsbDevice device);
        void onDenied(String reason);
        void onFailed(String reason);
    }

    static final int FLIR_USB_VENDOR_ID = 0x09CB;
    private static final String ACTION_USB_PERMISSION =
            "io.mxgenius.sensorbridge.action.USB_PERMISSION";
    private static final long GRANT_STABILITY_DELAY_MS = 250L;
    private static final long PERMISSION_TIMEOUT_MS = 120_000L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Context receiverContext;
    private BroadcastReceiver receiver;
    private Runnable timeout;
    private int activeGeneration = -1;

    boolean isActive() {
        return receiver != null || activeGeneration >= 0;
    }

    void request(Context sourceContext, int generation, Listener listener) {
        Context context = sourceContext.getApplicationContext();
        mainHandler.post(() -> begin(context, generation, listener));
    }

    void cancel() {
        mainHandler.post(() -> cleanup(true));
    }

    boolean hasGrantedFlirDevice(Context context) {
        UsbManager manager = context.getSystemService(UsbManager.class);
        return manager != null && selectFlirDevice(manager, true) != null;
    }

    private void begin(Context context, int generation, Listener listener) {
        cleanup(true);
        activeGeneration = generation;
        UsbManager manager = context.getSystemService(UsbManager.class);
        if (manager == null) {
            activeGeneration = -1;
            listener.onDiagnostic("manager-unavailable", "Quest did not expose Android UsbManager");
            listener.onFailed("usb-manager-unavailable");
            return;
        }

        List<UsbDevice> devices = sortedDevices(manager);
        UsbDevice device = selectFlirDevice(manager, false);
        if (device == null) {
            activeGeneration = -1;
            listener.onDiagnostic(
                    "not-enumerated",
                    "Quest enumerated " + devices.size()
                            + " USB device(s), but no FLIR VID 09cb device · generation=" + generation);
            listener.onFailed("usb-device-not-enumerated");
            return;
        }

        listener.onDiagnostic("enumerated", describeDevice(manager, device, generation));
        if (manager.hasPermission(device)) {
            listener.onDiagnostic(
                    "permission-grant-received",
                    "existing Android device grant observed; verifying re-enumeration · generation=" + generation);
            confirmStable(context, manager, device, generation, listener);
            return;
        }

        receiverContext = context;
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context ignored, Intent intent) {
                if (!ACTION_USB_PERMISSION.equals(intent.getAction())
                        || generation != activeGeneration) return;
                UsbDevice result = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class);
                boolean sameDevice = result != null && result.getDeviceId() == device.getDeviceId();
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                cleanup(true);
                if (!sameDevice) {
                    listener.onDiagnostic(
                            "permission-error",
                            "Android permission callback did not match the requested FLIR device · generation=" + generation);
                    listener.onFailed("usb-permission-device-mismatch");
                    return;
                }
                if (!granted || !manager.hasPermission(result)) {
                    listener.onDiagnostic(
                            "permission-denied",
                            "Android denied device-scoped FLIR USB access · generation=" + generation);
                    listener.onDenied("usb-permission-denied");
                    return;
                }
                activeGeneration = generation;
                listener.onDiagnostic(
                        "permission-grant-received",
                        "Android permission callback granted access; verifying re-enumeration · generation=" + generation);
                confirmStable(context, manager, result, generation, listener);
            }
        };

        try {
            context.registerReceiver(
                    receiver,
                    new IntentFilter(ACTION_USB_PERMISSION),
                    Context.RECEIVER_NOT_EXPORTED);
            Intent callback = new Intent(ACTION_USB_PERMISSION).setPackage(context.getPackageName());
            PendingIntent permissionIntent = PendingIntent.getBroadcast(
                    context,
                    generation,
                    callback,
                    PendingIntent.FLAG_CANCEL_CURRENT
                            | PendingIntent.FLAG_ONE_SHOT
                            | PendingIntent.FLAG_IMMUTABLE);
            timeout = () -> {
                if (generation != activeGeneration) return;
                cleanup(true);
                listener.onDiagnostic(
                        "permission-timeout",
                        "Android USB permission callback did not arrive within "
                                + (PERMISSION_TIMEOUT_MS / 1000L) + "s · generation=" + generation);
                listener.onFailed("usb-permission-timeout");
            };
            mainHandler.postDelayed(timeout, PERMISSION_TIMEOUT_MS);
            listener.onDiagnostic(
                    "permission-requested",
                    "waiting for Android EXTRA_PERMISSION_GRANTED callback · generation=" + generation);
            manager.requestPermission(device, permissionIntent);
        } catch (RuntimeException error) {
            cleanup(true);
            listener.onDiagnostic(
                    "permission-error",
                    "Android USB permission request failed · " + safeReason(error)
                            + " · generation=" + generation);
            listener.onFailed("usb-permission-request-" + safeReason(error));
        }
    }

    private void confirmStable(
            Context context,
            UsbManager manager,
            UsbDevice requestedDevice,
            int generation,
            Listener listener) {
        mainHandler.postDelayed(() -> {
            if (generation != activeGeneration) return;
            UsbDevice current = findDeviceById(manager, requestedDevice.getDeviceId());
            if (current == null || current.getVendorId() != FLIR_USB_VENDOR_ID) {
                activeGeneration = -1;
                listener.onDiagnostic(
                        "permission-unstable",
                        "FLIR device changed during Android permission completion · generation=" + generation);
                listener.onFailed("usb-device-changed-after-permission");
                return;
            }
            if (!manager.hasPermission(current)) {
                activeGeneration = -1;
                listener.onDiagnostic(
                        "permission-unstable",
                        "Android grant was not present after FLIR re-enumeration · generation=" + generation);
                listener.onFailed("usb-permission-not-stable");
                return;
            }
            activeGeneration = -1;
            listener.onDiagnostic(
                    "permission-stable",
                    "Android grant survived FLIR re-enumeration; SDK discovery may start · generation=" + generation);
            listener.onGranted(current);
        }, GRANT_STABILITY_DELAY_MS);
    }

    private void cleanup(boolean invalidateGeneration) {
        if (timeout != null) mainHandler.removeCallbacks(timeout);
        timeout = null;
        if (receiverContext != null && receiver != null) {
            try {
                receiverContext.unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // A concurrent lifecycle callback may already have removed it.
            }
        }
        receiver = null;
        receiverContext = null;
        if (invalidateGeneration) activeGeneration = -1;
    }

    private static UsbDevice selectFlirDevice(UsbManager manager, boolean requirePermission) {
        return sortedDevices(manager).stream()
                .filter(device -> device.getVendorId() == FLIR_USB_VENDOR_ID)
                .filter(device -> !requirePermission || manager.hasPermission(device))
                .findFirst()
                .orElse(null);
    }

    private static UsbDevice findDeviceById(UsbManager manager, int deviceId) {
        return sortedDevices(manager).stream()
                .filter(device -> device.getDeviceId() == deviceId)
                .findFirst()
                .orElse(null);
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
                "FLIR USB vid=%04x pid=%04x deviceId=%d class=%d interfaces=%s permission=%s product=%s generation=%d",
                device.getVendorId(),
                device.getProductId(),
                device.getDeviceId(),
                device.getDeviceClass(),
                interfaces,
                manager.hasPermission(device),
                safeUsbText(device.getProductName()),
                generation);
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
