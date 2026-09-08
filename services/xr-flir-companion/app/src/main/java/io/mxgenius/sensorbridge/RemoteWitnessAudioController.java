package io.mxgenius.sensorbridge;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;

/** Owns the short-lived communication audio route used by a Remote Witness peer. */
final class RemoteWitnessAudioController implements AutoCloseable {
    interface Listener {
        void onAudioState(String state, String detail);
    }

    private final AudioManager audioManager;
    private final Listener listener;
    private final AudioFocusRequest focusRequest;
    private int previousMode = AudioManager.MODE_NORMAL;
    private boolean active;
    private boolean playoutStarted;
    private String route = "system default";
    private String lastState;
    private String lastDetail;

    RemoteWitnessAudioController(Context context, Listener listener) {
        audioManager = context.getSystemService(AudioManager.class);
        this.listener = listener;
        AudioAttributes attributes = communicationAttributes();
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener(this::onAudioFocusChange)
                .build();
    }

    synchronized void start() {
        if (active) return;
        if (audioManager == null) {
            publish("customer-audio-route-failed", "Android audio service unavailable");
            return;
        }
        previousMode = audioManager.getMode();
        int focus = audioManager.requestAudioFocus(focusRequest);
        try {
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            AudioDeviceInfo speaker = null;
            for (AudioDeviceInfo candidate : audioManager.getAvailableCommunicationDevices()) {
                if (candidate.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    speaker = candidate;
                    break;
                }
            }
            if (speaker != null && audioManager.setCommunicationDevice(speaker)) {
                route = bounded(speaker.getProductName().toString(), 80);
            } else {
                route = "system communication output";
            }
            active = true;
            playoutStarted = false;
            publish("customer-audio-route-ready", route + " · focus " + focusLabel(focus));
        } catch (RuntimeException error) {
            audioManager.clearCommunicationDevice();
            audioManager.abandonAudioFocusRequest(focusRequest);
            try {
                audioManager.setMode(previousMode);
            } catch (RuntimeException ignored) {
                // Report the original route failure below.
            }
            publish("customer-audio-route-failed", bounded(error.getClass().getSimpleName(), 80));
        }
    }

    synchronized void onTrackNegotiated() {
        publish("customer-audio-negotiated", "customer microphone track negotiated");
    }

    synchronized void onPlayoutStarted() {
        playoutStarted = true;
        publish("customer-audio-playout-started", route);
    }

    synchronized void onPlayoutStopped() {
        playoutStarted = false;
        if (active) publish("customer-audio-playout-stopped", route);
    }

    synchronized void onPlayoutError(String detail) {
        playoutStarted = false;
        publish("customer-audio-playout-failed", bounded(detail, 160));
    }

    synchronized void onInboundAudio(long packets, long bytes, String codec) {
        if (packets <= 0L && bytes <= 0L) return;
        String detail = bounded(codec, 40) + " · " + packets + " packets · " + bytes + " bytes · " + route;
        publish(playoutStarted ? "customer-audio-live" : "customer-audio-received-no-playout", detail);
    }

    @Override public synchronized void close() {
        boolean wasActive = active || playoutStarted;
        if (audioManager != null && active) {
            audioManager.clearCommunicationDevice();
            audioManager.abandonAudioFocusRequest(focusRequest);
            try {
                audioManager.setMode(previousMode);
            } catch (RuntimeException ignored) {
                // The peer is already closed; restoration remains best effort.
            }
        }
        active = false;
        playoutStarted = false;
        route = "system default";
        if (wasActive) publish("customer-audio-off", "communication route restored");
        lastState = null;
        lastDetail = null;
    }

    private synchronized void onAudioFocusChange(int change) {
        if (!active) return;
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            publish("customer-audio-focus-lost", "audio focus " + change);
        }
    }

    private void publish(String state, String detail) {
        if (state.equals(lastState) && detail.equals(lastDetail)) return;
        lastState = state;
        lastDetail = detail;
        listener.onAudioState(state, detail);
    }

    private static String focusLabel(int focus) {
        return focus == AudioManager.AUDIOFOCUS_REQUEST_GRANTED ? "granted" : "not granted";
    }

    static AudioAttributes communicationAttributes() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
    }

    private static String bounded(String value, int maximum) {
        if (value == null || value.isBlank()) return "unknown";
        String clean = value.trim().replace('\n', ' ').replace('\r', ' ');
        return clean.length() <= maximum ? clean : clean.substring(0, maximum);
    }
}
