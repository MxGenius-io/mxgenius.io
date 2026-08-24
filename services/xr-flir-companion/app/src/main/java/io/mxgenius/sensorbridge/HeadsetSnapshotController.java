package io.mxgenius.sensorbridge;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.OutputConfiguration;
import android.hardware.camera2.params.SessionConfiguration;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Size;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/** Captures one bounded RGB frame from a Quest passthrough camera, then releases the camera. */
final class HeadsetSnapshotController {
    interface Callback {
        void onCaptured(byte[] jpeg, int width, int height, String eye);
        void onFailure(String code, String detail);
    }

    static final String HEADSET_CAMERA_PERMISSION = "horizonos.permission.HEADSET_CAMERA";
    private static final String CAMERA_SOURCE_KEY = "com.meta.extra_metadata.camera_source";
    private static final String CAMERA_POSITION_KEY = "com.meta.extra_metadata.position";
    private static final int CAMERA_SOURCE_PASSTHROUGH = 0;
    private static final int RIGHT_EYE = 1;
    private static final long CAPTURE_TIMEOUT_MS = 8_000L;
    private static final int MAX_JPEG_BYTES = 1024 * 1024;
    private static final long TARGET_PIXELS = 800L * 600L;

    private final Context context;
    private final CameraManager cameraManager;
    private final HandlerThread cameraThread = new HandlerThread("QuestSnapshotCamera");
    private final Handler cameraHandler;
    private final Executor cameraExecutor;
    private final AtomicBoolean capturing = new AtomicBoolean(false);
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private Callback callback;
    private Runnable timeout;
    private String currentEye = "unknown";

    HeadsetSnapshotController(Context context) {
        this.context = context.getApplicationContext();
        cameraManager = this.context.getSystemService(CameraManager.class);
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
        cameraExecutor = command -> cameraHandler.post(command);
    }

    boolean isCapturing() {
        return capturing.get();
    }

    void capture(Callback nextCallback) {
        if (nextCallback == null) return;
        if (!capturing.compareAndSet(false, true)) {
            nextCallback.onFailure("snapshot-busy", "another headset snapshot is already in progress");
            return;
        }
        callback = nextCallback;
        cameraHandler.post(this::openCamera);
    }

    void shutdown() {
        cameraHandler.post(() -> finishFailure("snapshot-stopped", "snapshot controller stopped"));
        cameraThread.quitSafely();
    }

    @SuppressLint("MissingPermission")
    private void openCamera() {
        if (!hasPermissions()) {
            finishFailure("snapshot-permission", "headset camera permission is not granted");
            return;
        }
        if (cameraManager == null) {
            finishFailure("snapshot-unavailable", "Android camera service is unavailable");
            return;
        }
        try {
            CameraSelection selection = selectCamera();
            currentEye = selection.eye;
            reader = ImageReader.newInstance(
                    selection.size.getWidth(),
                    selection.size.getHeight(),
                    ImageFormat.JPEG,
                    2);
            reader.setOnImageAvailableListener(this::onImageAvailable, cameraHandler);
            timeout = () -> finishFailure("snapshot-timeout", "headset camera did not return a frame");
            cameraHandler.postDelayed(timeout, CAPTURE_TIMEOUT_MS);
            cameraManager.openCamera(selection.cameraId, cameraExecutor, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice opened) {
                    if (!capturing.get()) {
                        opened.close();
                        return;
                    }
                    camera = opened;
                    createSession(opened, selection);
                }

                @Override public void onDisconnected(CameraDevice disconnected) {
                    disconnected.close();
                    finishFailure("snapshot-disconnected", "headset camera disconnected before capture");
                }

                @Override public void onError(CameraDevice failed, int error) {
                    failed.close();
                    finishFailure("snapshot-camera-" + error, cameraError(error));
                }
            });
        } catch (SecurityException error) {
            finishFailure("snapshot-permission", "headset camera access was rejected by Horizon OS");
        } catch (Exception error) {
            finishFailure("snapshot-unavailable", safeDetail(error));
        }
    }

    private void createSession(CameraDevice opened, CameraSelection selection) {
        try {
            opened.createCaptureSession(new SessionConfiguration(
                    SessionConfiguration.SESSION_REGULAR,
                    List.of(new OutputConfiguration(reader.getSurface())),
                    cameraExecutor,
                    new CameraCaptureSession.StateCallback() {
                        @Override public void onConfigured(CameraCaptureSession configured) {
                            if (!capturing.get()) {
                                configured.close();
                                return;
                            }
                            session = configured;
                            captureFrame(opened, configured);
                        }

                        @Override public void onConfigureFailed(CameraCaptureSession failed) {
                            finishFailure("snapshot-configure", "headset camera capture session could not be configured");
                        }
                    }));
        } catch (Exception error) {
            finishFailure("snapshot-configure", safeDetail(error));
        }
    }

    private void captureFrame(CameraDevice opened, CameraCaptureSession configured) {
        try {
            CaptureRequest.Builder builder = opened.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            builder.addTarget(reader.getSurface());
            CaptureRequest request = builder.build();
            configured.captureSingleRequest(request, cameraExecutor, new CameraCaptureSession.CaptureCallback() {});
        } catch (Exception error) {
            finishFailure("snapshot-capture", safeDetail(error));
        }
    }

    private void onImageAvailable(ImageReader imageReader) {
        Image image = null;
        byte[] jpeg = null;
        int width = 0;
        int height = 0;
        String failureCode = null;
        String failureDetail = null;
        try {
            image = imageReader.acquireLatestImage();
            if (image == null || !capturing.get()) return;
            ByteBuffer buffer = image.getPlanes()[0].getBuffer();
            if (!buffer.hasRemaining() || buffer.remaining() > MAX_JPEG_BYTES) {
                failureCode = "snapshot-size";
                failureDetail = "headset JPEG exceeded the one-megabyte transport limit";
            } else {
                jpeg = new byte[buffer.remaining()];
                buffer.get(jpeg);
                if (jpeg.length < 4 || (jpeg[0] & 0xff) != 0xff || (jpeg[1] & 0xff) != 0xd8) {
                    jpeg = null;
                    failureCode = "snapshot-format";
                    failureDetail = "headset camera returned an invalid JPEG frame";
                } else {
                    width = image.getWidth();
                    height = image.getHeight();
                }
            }
        } catch (Exception error) {
            failureCode = "snapshot-read";
            failureDetail = safeDetail(error);
        } finally {
            if (image != null) image.close();
        }
        if (failureCode != null) finishFailure(failureCode, failureDetail);
        else if (jpeg != null) finishSuccess(jpeg, width, height, currentEye);
    }

    private CameraSelection selectCamera() throws Exception {
        CameraSelection fallback = null;
        for (String cameraId : cameraManager.getCameraIdList()) {
            CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
            Integer source = characteristics.get(new CameraCharacteristics.Key<>(CAMERA_SOURCE_KEY, Integer.class));
            if (source == null || source != CAMERA_SOURCE_PASSTHROUGH) continue;
            Integer position = characteristics.get(new CameraCharacteristics.Key<>(CAMERA_POSITION_KEY, Integer.class));
            Size[] sizes = characteristics
                    .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                    .getOutputSizes(ImageFormat.JPEG);
            if (sizes == null || sizes.length == 0) continue;
            Size selectedSize = Arrays.stream(sizes)
                    .filter(size -> size.getWidth() <= 1280 && size.getHeight() <= 1280)
                    .min(Comparator.comparingLong(size -> Math.abs(
                            (long) size.getWidth() * size.getHeight() - TARGET_PIXELS)))
                    .orElseGet(() -> Arrays.stream(sizes)
                            .min(Comparator.comparingLong(size -> (long) size.getWidth() * size.getHeight()))
                            .orElseThrow());
            String eye = position != null && position == RIGHT_EYE ? "right" : "left";
            CameraSelection candidate = new CameraSelection(cameraId, selectedSize, eye);
            if (position != null && position == RIGHT_EYE) return candidate;
            fallback = candidate;
        }
        if (fallback != null) return fallback;
        throw new IllegalStateException("no Quest passthrough RGB camera was found");
    }

    private boolean hasPermissions() {
        return context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                && context.checkSelfPermission(HEADSET_CAMERA_PERMISSION) == PackageManager.PERMISSION_GRANTED;
    }

    private void finishSuccess(byte[] jpeg, int width, int height, String eye) {
        if (!capturing.compareAndSet(true, false)) return;
        Callback completed = callback;
        callback = null;
        closeCapture();
        if (completed != null) completed.onCaptured(jpeg, width, height, eye);
    }

    private void finishFailure(String code, String detail) {
        if (!capturing.compareAndSet(true, false)) return;
        Callback failed = callback;
        callback = null;
        closeCapture();
        if (failed != null) failed.onFailure(code, detail);
    }

    private void closeCapture() {
        if (timeout != null) cameraHandler.removeCallbacks(timeout);
        timeout = null;
        if (session != null) session.close();
        session = null;
        if (camera != null) camera.close();
        camera = null;
        if (reader != null) reader.close();
        reader = null;
        currentEye = "unknown";
    }

    private static String cameraError(int error) {
        return switch (error) {
            case CameraDevice.StateCallback.ERROR_CAMERA_IN_USE -> "headset camera is already in use";
            case CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE -> "all headset camera slots are in use";
            case CameraDevice.StateCallback.ERROR_CAMERA_DISABLED -> "headset camera is disabled by policy";
            case CameraDevice.StateCallback.ERROR_CAMERA_DEVICE -> "headset camera device failed";
            case CameraDevice.StateCallback.ERROR_CAMERA_SERVICE -> "Horizon camera service failed";
            default -> "headset camera failed with code " + error;
        };
    }

    private static String safeDetail(Throwable error) {
        String message = error.getMessage();
        if (message != null && !message.isBlank()) return message.replaceAll("\\s+", " ").trim();
        String name = error.getClass().getSimpleName();
        return name == null || name.isBlank() ? "headset camera failed" : name;
    }

    private record CameraSelection(String cameraId, Size size, String eye) {}
}
