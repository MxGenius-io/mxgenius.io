package io.mxgenius.sensorbridge;

import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.webrtc.AddIceObserver;
import org.webrtc.DataChannel;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.EglBase;
import org.webrtc.HardwareVideoEncoderFactory;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.MediaStreamTrack;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RTCStats;
import org.webrtc.RTCStatsReport;
import org.webrtc.RtpCapabilities;
import org.webrtc.RtpReceiver;
import org.webrtc.RtpSender;
import org.webrtc.RtpTransceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.VideoCodecInfo;
import org.webrtc.VideoTrack;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** One video-only WebRTC producer backed by a consent-scoped Quest compositor capture. */
final class RemoteWitnessPeerController implements AutoCloseable {
    interface SignalingSender {
        boolean send(JSONObject signal);
    }

    interface Listener {
        void onState(String state, String detail);
        void onCaptureStopped(String reason);
    }

    private static final AtomicBoolean WEBRTC_INITIALIZED = new AtomicBoolean();
    private static final List<String> STREAM_IDS = List.of("mxg-witness");
    private static final int MAX_BITRATE_BPS = 2_500_000;
    private static final int MIN_BITRATE_BPS = 350_000;
    private static final int STATS_INTERVAL_SECONDS = 5;
    private static final int MAX_PEER_RECONNECT_ATTEMPTS = 2;

    private final RemoteWitnessBootstrap bootstrap;
    private final SignalingSender signaling;
    private final Listener listener;
    private final ScheduledExecutorService statsWorker = Executors.newSingleThreadScheduledExecutor();
    private final EglBase eglBase;
    private final HardwareVideoEncoderFactory encoderFactory;
    private final PeerConnectionFactory factory;
    private final RemoteWitnessCaptureController capture;
    private PeerConnection peer;
    private UUID viewerId;
    private UUID pendingViewerId;
    private RtpSender videoSender;
    private boolean roomLive;
    private boolean closed;
    private boolean statsStarted;
    private int peerReconnectAttempt;

    RemoteWitnessPeerController(
            Context context,
            RemoteWitnessBootstrap bootstrap,
            SignalingSender signaling,
            Listener listener) {
        this.bootstrap = bootstrap;
        this.signaling = signaling;
        this.listener = listener;
        initializeWebRtc(context.getApplicationContext());
        eglBase = EglBase.create();
        encoderFactory = new HardwareVideoEncoderFactory(eglBase.getEglBaseContext(), true, false);
        factory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(encoderFactory)
                .setVideoDecoderFactory(new DefaultVideoDecoderFactory(eglBase.getEglBaseContext()))
                .createPeerConnectionFactory();
        capture = new RemoteWitnessCaptureController(
                context,
                factory,
                eglBase.getEglBaseContext(),
                reason -> {
                    synchronized (RemoteWitnessPeerController.this) {
                        closePeer("capture-stopped");
                    }
                    listener.onCaptureStopped(reason);
                });
        listener.onState("ready-for-consent", supportedCodecSummary());
    }

    synchronized boolean startCapture(Intent consentData) {
        if (closed || !roomLive) return false;
        if (!capture.isActive()) capture.start(consentData);
        listener.onState("capture-ready", captureProfile());
        if (pendingViewerId != null) negotiate(pendingViewerId);
        return true;
    }

    synchronized boolean captureActive() {
        return capture.isActive();
    }

    synchronized String captureProfile() {
        return RemoteWitnessCaptureController.CAPTURE_WIDTH + "x"
                + RemoteWitnessCaptureController.CAPTURE_HEIGHT + "@"
                + RemoteWitnessCaptureController.CAPTURE_FPS + "fps · video only";
    }

    synchronized void onRoomState(JSONObject room) {
        if (closed || room == null || !bootstrap.roomId.toString().equals(room.optString("roomId"))) return;
        JSONObject layers = room.optJSONObject("layers");
        String status = room.optString("status", "unknown");
        roomLive = "live".equals(status) && layers != null && layers.optBoolean("pov", false);
        if (!roomLive) {
            pendingViewerId = null;
            closePeer("room-" + status);
            if (capture.isActive()) capture.stop("room-" + status);
            listener.onState(requiresFreshConsent(status) ? "consent-required" : status, "media stopped");
            return;
        }
        listener.onState(capture.isActive() ? "capture-ready" : "ready-for-consent", captureProfile());
        if (capture.isActive() && pendingViewerId != null) negotiate(pendingViewerId);
    }

    synchronized void onSignal(UUID participantId, JSONObject signal) {
        if (closed || participantId == null || signal == null) return;
        String kind = signal.optString("kind", "");
        if ("viewer-ready".equals(kind)) {
            if (viewerId != null && !viewerId.equals(participantId)) return;
            pendingViewerId = participantId;
            peerReconnectAttempt = 0;
            if (roomLive && capture.isActive()) negotiate(participantId);
            return;
        }
        if (viewerId == null || !viewerId.equals(participantId)) return;
        if ("answer".equals(kind)) {
            JSONObject description = signal.optJSONObject("description");
            if (description == null || !"answer".equals(description.optString("type"))) return;
            setRemoteDescription(new SessionDescription(
                    SessionDescription.Type.ANSWER,
                    description.optString("sdp", "")));
        } else if ("ice".equals(kind)) {
            JSONObject candidate = signal.optJSONObject("candidate");
            if (candidate == null || peer == null) return;
            peer.addIceCandidate(new IceCandidate(
                    candidate.isNull("sdpMid") ? null : candidate.optString("sdpMid", null),
                    candidate.optInt("sdpMLineIndex", 0),
                    candidate.optString("candidate", "")),
                    new AddIceObserver() {
                        @Override public void onAddSuccess() {}
                        @Override public void onAddFailure(String error) {
                            listener.onState("ice-rejected", bounded(error, 160));
                        }
                    });
        }
    }

    synchronized void stopCapture(String reason) {
        closePeer(reason);
        if (capture.isActive()) capture.stop(reason);
    }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true;
        roomLive = false;
        pendingViewerId = null;
        closePeer("peer-controller-closed");
        capture.close();
        statsWorker.shutdownNow();
        factory.dispose();
        eglBase.release();
    }

    private synchronized void negotiate(UUID participantId) {
        if (closed || !roomLive || !capture.isActive()) return;
        if (peer == null) createPeer(participantId);
        if (peer == null || !participantId.equals(viewerId)) return;
        capture.setEnabled(true);
        peer.createOffer(new CreateSdpObserver() {
            @Override public void onCreateSuccess(SessionDescription description) {
                synchronized (RemoteWitnessPeerController.this) {
                    if (closed || peer == null) return;
                    peer.setLocalDescription(new SetSdpObserver("local-offer") {
                        @Override public void onSetSuccess() {
                            sendDescription("offer", participantId, description);
                            listener.onState("negotiating", captureProfile());
                        }
                    }, description);
                }
            }
        }, videoOnlyConstraints());
    }

    private void createPeer(UUID participantId) {
        PeerConnection.RTCConfiguration configuration = new PeerConnection.RTCConfiguration(iceServers());
        configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        configuration.continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY;
        configuration.iceConnectionReceivingTimeout = 12_000;
        peer = factory.createPeerConnection(configuration, new PeerObserver());
        if (peer == null) {
            listener.onState("peer-failed", "native peer creation failed");
            return;
        }
        viewerId = participantId;
        pendingViewerId = participantId;
        peer.setAudioPlayout(false);
        peer.setAudioRecording(false);
        VideoTrack track = capture.track();
        if (track == null) return;
        videoSender = peer.addTrack(track, STREAM_IDS);
        preferHardwareH264();
        constrainSender();
    }

    private void preferHardwareH264() {
        if (peer == null) return;
        List<RtpCapabilities.CodecCapability> codecs = new ArrayList<>(
                factory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs);
        codecs.sort(Comparator.comparingInt(codec -> "H264".equalsIgnoreCase(codec.name) ? 0 : 1));
        for (RtpTransceiver transceiver : peer.getTransceivers()) {
            if (transceiver.getMediaType() == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO) {
                transceiver.setCodecPreferences(codecs);
            }
        }
    }

    private void constrainSender() {
        if (videoSender == null) return;
        org.webrtc.RtpParameters parameters = videoSender.getParameters();
        for (org.webrtc.RtpParameters.Encoding encoding : parameters.encodings) {
            encoding.minBitrateBps = MIN_BITRATE_BPS;
            encoding.maxBitrateBps = MAX_BITRATE_BPS;
            encoding.maxFramerate = RemoteWitnessCaptureController.CAPTURE_FPS;
        }
        videoSender.setParameters(parameters);
    }

    private void setRemoteDescription(SessionDescription description) {
        PeerConnection current = peer;
        if (current == null || description.description.isBlank()) return;
        current.setRemoteDescription(new SetSdpObserver("remote-answer") {
            @Override public void onSetSuccess() {
                listener.onState("answer-applied", captureProfile());
            }
        }, description);
    }

    private void sendDescription(String kind, UUID participantId, SessionDescription description) {
        try {
            signaling.send(new JSONObject()
                    .put("kind", kind)
                    .put("to", participantId.toString())
                    .put("description", new JSONObject()
                            .put("type", description.type.canonicalForm())
                            .put("sdp", description.description)));
        } catch (JSONException error) {
            listener.onState("signal-failed", "offer serialization failed");
        }
    }

    private List<PeerConnection.IceServer> iceServers() {
        List<PeerConnection.IceServer> result = new ArrayList<>();
        JSONArray servers = bootstrap.iceServers;
        for (int index = 0; index < servers.length(); index++) {
            JSONObject server = servers.optJSONObject(index);
            if (server == null) continue;
            List<String> urls = new ArrayList<>();
            Object rawUrls = server.opt("urls");
            if (rawUrls instanceof String) {
                urls.add((String) rawUrls);
            } else if (rawUrls instanceof JSONArray values) {
                for (int item = 0; item < values.length(); item++) {
                    String value = values.optString(item, "");
                    if (!value.isBlank()) urls.add(value);
                }
            }
            if (urls.isEmpty()) continue;
            PeerConnection.IceServer.Builder builder = PeerConnection.IceServer.builder(urls);
            if (server.has("username")) builder.setUsername(server.optString("username", ""));
            if (server.has("credential")) builder.setPassword(server.optString("credential", ""));
            result.add(builder.createIceServer());
        }
        return result;
    }

    private void startStats() {
        if (statsStarted) return;
        statsStarted = true;
        statsWorker.scheduleAtFixedRate(() -> {
            PeerConnection current;
            synchronized (RemoteWitnessPeerController.this) {
                current = peer;
                if (closed || current == null) return;
            }
            current.getStats(this::reportStats);
        }, STATS_INTERVAL_SECONDS, STATS_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    private void reportStats(RTCStatsReport report) {
        String codec = "unknown";
        long bytesSent = 0L;
        long framesEncoded = capture.capturedFrames();
        Map<String, RTCStats> stats = report.getStatsMap();
        Set<String> codecIds = new HashSet<>();
        for (RTCStats stat : stats.values()) {
            if (!"outbound-rtp".equals(stat.getType())) continue;
            Object mediaType = stat.getMembers().get("kind");
            if (mediaType == null) mediaType = stat.getMembers().get("mediaType");
            if (!"video".equals(String.valueOf(mediaType))) continue;
            bytesSent = longValue(stat.getMembers().get("bytesSent"), bytesSent);
            framesEncoded = longValue(stat.getMembers().get("framesEncoded"), framesEncoded);
            Object codecId = stat.getMembers().get("codecId");
            if (codecId != null) codecIds.add(String.valueOf(codecId));
        }
        for (String codecId : codecIds) {
            RTCStats stat = stats.get(codecId);
            if (stat != null && "codec".equals(stat.getType())) {
                Object mime = stat.getMembers().get("mimeType");
                if (mime != null) codec = String.valueOf(mime);
            }
        }
        listener.onState("live", codec + " · " + framesEncoded + " frames · " + bytesSent + " bytes");
    }

    private synchronized void closePeer(String reason) {
        capture.setEnabled(false);
        videoSender = null;
        viewerId = null;
        PeerConnection current = peer;
        peer = null;
        if (current != null) {
            current.close();
            current.dispose();
            listener.onState("peer-closed", reason);
        }
    }

    private String supportedCodecSummary() {
        List<String> codecs = new ArrayList<>();
        for (VideoCodecInfo codec : encoderFactory.getSupportedCodecs()) {
            if (!codecs.contains(codec.name)) codecs.add(codec.name);
        }
        return "hardware encoders: " + (codecs.isEmpty() ? "none reported" : String.join(", ", codecs));
    }

    private static MediaConstraints videoOnlyConstraints() {
        MediaConstraints constraints = new MediaConstraints();
        constraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"));
        constraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"));
        return constraints;
    }

    private static boolean requiresFreshConsent(String status) {
        return "paused".equals(status) || "headset-offline".equals(status);
    }

    private static void initializeWebRtc(Context context) {
        if (!WEBRTC_INITIALIZED.compareAndSet(false, true)) return;
        PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context)
                        .setEnableInternalTracer(false)
                        .createInitializationOptions());
    }

    private static long longValue(Object raw, long fallback) {
        return raw instanceof Number ? ((Number) raw).longValue() : fallback;
    }

    private static String bounded(String value, int maximum) {
        if (value == null) return "unknown";
        String trimmed = value.trim();
        return trimmed.length() <= maximum ? trimmed : trimmed.substring(0, maximum);
    }

    private final class PeerObserver implements PeerConnection.Observer {
        @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
        @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {}
        @Override public void onIceConnectionReceivingChange(boolean receiving) {}
        @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {}

        @Override public void onIceCandidate(IceCandidate candidate) {
            UUID target;
            synchronized (RemoteWitnessPeerController.this) { target = viewerId; }
            if (target == null) return;
            try {
                JSONObject payload = new JSONObject()
                        .put("candidate", candidate.sdp)
                        .put("sdpMLineIndex", candidate.sdpMLineIndex);
                if (candidate.sdpMid != null) payload.put("sdpMid", candidate.sdpMid);
                signaling.send(new JSONObject()
                        .put("kind", "ice")
                        .put("to", target.toString())
                        .put("candidate", payload));
            } catch (JSONException error) {
                listener.onState("signal-failed", "ICE serialization failed");
            }
        }

        @Override public void onConnectionChange(PeerConnection.PeerConnectionState state) {
            listener.onState(state == PeerConnection.PeerConnectionState.CONNECTED ? "live" : "peer-" + state.name().toLowerCase(Locale.US), captureProfile());
            if (state == PeerConnection.PeerConnectionState.CONNECTED) startStats();
            if (state == PeerConnection.PeerConnectionState.CONNECTED) peerReconnectAttempt = 0;
            if (state == PeerConnection.PeerConnectionState.FAILED) {
                UUID retryTarget;
                int attempt;
                synchronized (RemoteWitnessPeerController.this) {
                    retryTarget = viewerId;
                    closePeer("peer-failed");
                    attempt = ++peerReconnectAttempt;
                }
                if (retryTarget != null && attempt <= MAX_PEER_RECONNECT_ATTEMPTS) {
                    statsWorker.schedule(() -> {
                        synchronized (RemoteWitnessPeerController.this) {
                            if (!closed && roomLive && capture.isActive()) negotiate(retryTarget);
                        }
                    }, attempt, TimeUnit.SECONDS);
                }
            }
        }

        @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
        @Override public void onAddStream(MediaStream stream) {}
        @Override public void onRemoveStream(MediaStream stream) {}
        @Override public void onDataChannel(DataChannel channel) {}
        @Override public void onRenegotiationNeeded() {}
        @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] mediaStreams) {}
    }

    private abstract class CreateSdpObserver implements SdpObserver {
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String error) { listener.onState("offer-failed", bounded(error, 160)); }
        @Override public void onSetFailure(String error) { listener.onState("offer-failed", bounded(error, 160)); }
    }

    private class SetSdpObserver implements SdpObserver {
        private final String boundary;
        SetSdpObserver(String boundary) { this.boundary = boundary; }
        @Override public void onCreateSuccess(SessionDescription description) {}
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String error) { listener.onState(boundary + "-failed", bounded(error, 160)); }
        @Override public void onSetFailure(String error) { listener.onState(boundary + "-failed", bounded(error, 160)); }
    }
}
