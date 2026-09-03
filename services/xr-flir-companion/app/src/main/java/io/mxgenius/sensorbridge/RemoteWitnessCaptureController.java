package io.mxgenius.sensorbridge;

import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjection;

import org.webrtc.EglBase;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.ScreenCapturerAndroid;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;

/** Owns one consent-scoped Horizon compositor capture. A stopped token is never reused. */
final class RemoteWitnessCaptureController implements AutoCloseable {
    interface Listener {
        void onCaptureStopped(String reason);
    }

    static final int CAPTURE_WIDTH = 1280;
    static final int CAPTURE_HEIGHT = 720;
    static final int CAPTURE_FPS = 15;
    static final String TRACK_ID = "MXG-WITNESS-POV";

    private final Context context;
    private final PeerConnectionFactory factory;
    private final EglBase.Context eglContext;
    private final Listener listener;
    private ScreenCapturerAndroid capturer;
    private SurfaceTextureHelper textureHelper;
    private VideoSource videoSource;
    private VideoTrack videoTrack;
    private boolean stopping;

    RemoteWitnessCaptureController(
            Context context,
            PeerConnectionFactory factory,
            EglBase.Context eglContext,
            Listener listener) {
        this.context = context.getApplicationContext();
        this.factory = factory;
        this.eglContext = eglContext;
        this.listener = listener;
    }

    synchronized VideoTrack start(Intent consentData) {
        if (consentData == null) throw new IllegalArgumentException("projection consent is required");
        if (videoTrack != null) throw new IllegalStateException("projection is already active");
        stopping = false;
        textureHelper = SurfaceTextureHelper.create("MxGWitnessProjection", eglContext);
        if (textureHelper == null) throw new IllegalStateException("projection texture unavailable");
        videoSource = factory.createVideoSource(true);
        capturer = new ScreenCapturerAndroid(consentData, new MediaProjection.Callback() {
            @Override public void onStop() {
                release(false, "projection-revoked");
            }
        });
        try {
            capturer.initialize(textureHelper, context, videoSource.getCapturerObserver());
            capturer.startCapture(CAPTURE_WIDTH, CAPTURE_HEIGHT, CAPTURE_FPS);
            videoTrack = factory.createVideoTrack(TRACK_ID, videoSource);
            videoTrack.setEnabled(false);
            return videoTrack;
        } catch (RuntimeException | LinkageError error) {
            release(true, "projection-start-failed");
            throw error;
        }
    }

    synchronized boolean isActive() {
        return videoTrack != null;
    }

    synchronized long capturedFrames() {
        return capturer == null ? 0L : capturer.getNumCapturedFrames();
    }

    synchronized void setEnabled(boolean enabled) {
        if (videoTrack != null) videoTrack.setEnabled(enabled);
    }

    synchronized VideoTrack track() {
        return videoTrack;
    }

    void stop(String reason) {
        release(true, reason);
    }

    @Override public void close() {
        release(true, "capture-closed");
    }

    private void release(boolean stopProjection, String reason) {
        ScreenCapturerAndroid currentCapturer;
        VideoTrack currentTrack;
        VideoSource currentSource;
        SurfaceTextureHelper currentHelper;
        synchronized (this) {
            if (stopping) return;
            if (capturer == null && textureHelper == null && videoSource == null && videoTrack == null) return;
            stopping = true;
            currentCapturer = capturer;
            currentTrack = videoTrack;
            currentSource = videoSource;
            currentHelper = textureHelper;
            capturer = null;
            videoTrack = null;
            videoSource = null;
            textureHelper = null;
        }
        // Let the owner remove the sender/peer while the detached track is still valid.
        try {
            listener.onCaptureStopped(reason);
        } catch (RuntimeException ignored) {
            // Resource release must complete even if a UI/status callback fails.
        }
        if (currentCapturer != null) {
            if (stopProjection) {
                try {
                    currentCapturer.stopCapture();
                } catch (RuntimeException ignored) {
                    // Cleanup remains best-effort and idempotent after system revocation.
                }
            }
            currentCapturer.dispose();
        }
        if (currentTrack != null) {
            currentTrack.setEnabled(false);
            currentTrack.dispose();
        }
        if (currentSource != null) currentSource.dispose();
        if (currentHelper != null) currentHelper.dispose();
        synchronized (this) { stopping = false; }
    }
}
