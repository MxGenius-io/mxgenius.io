package io.mxgenius.sensorbridge;

import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.webrtc.AddIceObserver;
import org.webrtc.AudioTrack;
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
import org.webrtc.audio.JavaAudioDeviceModule;

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

/** Consent-scoped Quest video producer with customer microphone playback. */
final class RemoteWitnessPeerController implements AutoCloseable {
    interface SignalingSender {
        boolean send(JSONObject signal);
    }

    interface Listener {
        void onState(String state, String detail);
        void onAudioState(String state, String detail);
        void onCaptureStopped(String reason);
    }

    private static final AtomicBoolean WEBRTC_INITIALIZED = new AtomicBoolean();
    private static final List<String> STREAM_IDS = List.of("mxg-witness");
    private static final int MAX_BITRATE_BPS = 2_500_000;
    private static final int MIN_BITRATE_BPS = 350_000;
    private static final int STATS_INTERVAL_SECONDS = 5;
    private static final int NEGOTIATION_TIMEOUT_SECONDS = 10;
    private static final int MAX_PEER_RECONNECT_ATTEMPTS = 2;

    private final RemoteWitnessBootstrap bootstrap;
    private final SignalingSender signaling;
    private final Listener listener;
    private final ScheduledExecutorService statsWorker = Executors.newSingleThreadScheduledExecutor();
    private final EglBase eglBase;
    private final HardwareVideoEncoderFactory encoderFactory;
    private final PeerConnectionFactory factory;
    private final JavaAudioDeviceModule audioDeviceModule;
    private final RemoteWitnessAudioController audio;
    private final RemoteWitnessCaptureController capture;
    private final RemoteWitnessMediaProgress mediaProgress = new RemoteWitnessMediaProgress();
    private PeerConnection peer;
    private UUID viewerId;
    private UUID pendingViewerId;
    private RtpSender videoSender;
    private PeerConnection.PeerConnectionState peerState = PeerConnection.PeerConnectionState.NEW;
    private boolean roomLive;
    private boolean closed;
    private boolean statsStarted;
    private int peerReconnectAttempt;
    private long peerGeneration;
    private long negotiationGeneration = -1L;

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
        audio = new RemoteWitnessAudioController(context.getApplicationContext(), listener::onAudioState);
        audioDeviceModule = JavaAudioDeviceModule.builder(context.getApplicationContext())
                .setAudioAttributes(RemoteWitnessAudioController.communicationAttributes())
                .setAudioTrackStateCallback(new JavaAudioDeviceModule.AudioTrackStateCallback() {
                    @Override public void onWebRtcAudioTrackStart() { audio.onPlayoutStarted(); }
                    @Override public void onWebRtcAudioTrackStop() { audio.onPlayoutStopped(); }
                })
                .setAudioTrackErrorCallback(new JavaAudioDeviceModule.AudioTrackErrorCallback() {
                    @Override public void onWebRtcAudioTrackInitError(String error) {
                        audio.onPlayoutError("initialization: " + bounded(error, 120));
                    }

                    @Override public void onWebRtcAudioTrackStartError(
                            JavaAudioDeviceModule.AudioTrackStartErrorCode code,
                            String error) {
                        audio.onPlayoutError("start " + code + ": " + bounded(error, 120));
                    }

                    @Override public void onWebRtcAudioTrackError(String error) {
                        audio.onPlayoutError("runtime: " + bounded(error, 120));
                    }
                })
                .createAudioDeviceModule();
        factory = PeerConnectionFactory.builder()
                .setAudioDeviceModule(audioDeviceModule)
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
        if (pendingViewerId != null && peer == null) negotiate(pendingViewerId);
        return true;
    }

    synchronized boolean captureActive() {
        return capture.isActive();
    }

    synchronized String captureProfile() {
        return RemoteWitnessCaptureController.CAPTURE_WIDTH + "x"
                + RemoteWitnessCaptureController.CAPTURE_HEIGHT + "@"
                + RemoteWitnessCaptureController.CAPTURE_FPS + "fps · customer audio receive";
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
        if (capture.isActive() && pendingViewerId != null && peer == null) negotiate(pendingViewerId);
    }

    synchronized void onSignal(UUID participantId, JSONObject signal) {
        if (closed || participantId == null || signal == null) return;
        String kind = signal.optString("kind", "");
        if ("viewer-ready".equals(kind)) {
            if (viewerId != null && !viewerId.equals(participantId)) return;
            pendingViewerId = participantId;
            if (peer != null && participantId.equals(viewerId)
                    && (peerState == PeerConnection.PeerConnectionState.CONNECTED
                    || peerState == PeerConnection.PeerConnectionState.DISCONNECTED
                    || peerState == PeerConnection.PeerConnectionState.FAILED
                    || peerState == PeerConnection.PeerConnectionState.CLOSED)) {
                closePeer("viewer-restart");
                pendingViewerId = participantId;
            }
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
            PeerConnection current = peer;
            long generation = peerGeneration;
            current.addIceCandidate(new IceCandidate(
                    candidate.isNull("sdpMid") ? null : candidate.optString("sdpMid", null),
                    candidate.optInt("sdpMLineIndex", 0),
                    candidate.optString("candidate", "")),
                    new AddIceObserver() {
                        @Override public void onAddSuccess() {}
                        @Override public void onAddFailure(String error) {
                            synchronized (RemoteWitnessPeerController.this) {
                                if (generation != peerGeneration || current != peer) return;
                            }
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
        audioDeviceModule.release();
        audio.close();
        eglBase.release();
    }

    private synchronized void negotiate(UUID participantId) {
        if (closed || !roomLive || !capture.isActive()) return;
        if (peer == null) createPeer(participantId);
        if (peer == null || !participantId.equals(viewerId)) return;
        PeerConnection current = peer;
        long generation = peerGeneration;
        if (negotiationGeneration == generation) return;
        negotiationGeneration = generation;
        capture.setEnabled(true);
        current.createOffer(new CreateSdpObserver() {
            @Override public void onCreateSuccess(SessionDescription description) {
                synchronized (RemoteWitnessPeerController.this) {
                    if (closed || generation != peerGeneration || current != peer) return;
                    current.setLocalDescription(new SetSdpObserver("local-offer") {
                        @Override public void onSetSuccess() {
                            synchronized (RemoteWitnessPeerController.this) {
                                if (closed || generation != peerGeneration || current != peer) return;
                                if (!sendDescription("offer", participantId, description)) {
                                    negotiationGeneration = -1L;
                                    recoverPeer("offer-signal-failed", generation);
                                    return;
                                }
                                listener.onState("negotiating", captureProfile());
                            }
                        }

                        @Override public void onSetFailure(String error) {
                            synchronized (RemoteWitnessPeerController.this) {
                                if (negotiationGeneration == generation) negotiationGeneration = -1L;
                            }
                            super.onSetFailure(error);
                        }
                    }, description);
                }
            }

            @Override public void onCreateFailure(String error) {
                synchronized (RemoteWitnessPeerController.this) {
                    if (negotiationGeneration == generation) negotiationGeneration = -1L;
                }
                super.onCreateFailure(error);
            }
        }, witnessMediaConstraints());
        statsWorker.schedule(() -> {
            synchronized (RemoteWitnessPeerController.this) {
                if (closed || generation != peerGeneration || current != peer
                        || negotiationGeneration != generation) return;
            }
            recoverPeer("answer-timeout", generation);
        }, NEGOTIATION_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private void createPeer(UUID participantId) {
        audio.start();
        PeerConnection.RTCConfiguration configuration = new PeerConnection.RTCConfiguration(iceServers());
        configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        configuration.continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY;
        configuration.iceConnectionReceivingTimeout = 12_000;
        long generation = ++peerGeneration;
        mediaProgress.reset();
        peerState = PeerConnection.PeerConnectionState.NEW;
        peer = factory.createPeerConnection(configuration, new PeerObserver(generation));
        if (peer == null) {
            audio.close();
            listener.onState("peer-failed", "native peer creation failed");
            return;
        }
        viewerId = participantId;
        pendingViewerId = participantId;
        peer.setAudioPlayout(true);
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
        long generation = peerGeneration;
        if (current == null || negotiationGeneration != generation || description.description.isBlank()) return;
        current.setRemoteDescription(new SetSdpObserver("remote-answer") {
            @Override public void onSetSuccess() {
                synchronized (RemoteWitnessPeerController.this) {
                    if (generation != peerGeneration || current != peer) return;
                    negotiationGeneration = -1L;
                }
                listener.onState("answer-applied", captureProfile());
            }

            @Override public void onSetFailure(String error) {
                synchronized (RemoteWitnessPeerController.this) {
                    if (negotiationGeneration == generation) negotiationGeneration = -1L;
                }
                super.onSetFailure(error);
            }
        }, description);
    }

    private boolean sendDescription(String kind, UUID participantId, SessionDescription description) {
        try {
            return signaling.send(new JSONObject()
                    .put("kind", kind)
                    .put("to", participantId.toString())
                    .put("description", new JSONObject()
                            .put("type", description.type.canonicalForm())
                            .put("sdp", description.description)));
        } catch (JSONException error) {
            listener.onState("signal-failed", "offer serialization failed");
            return false;
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
            long generation;
            synchronized (RemoteWitnessPeerController.this) {
                current = peer;
                generation = peerGeneration;
                if (closed || current == null
                        || peerState != PeerConnection.PeerConnectionState.CONNECTED) return;
            }
            current.getStats(report -> reportStats(current, generation, report));
        }, STATS_INTERVAL_SECONDS, STATS_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    private void reportStats(PeerConnection source, long generation, RTCStatsReport report) {
        synchronized (this) {
            if (closed || generation != peerGeneration || source != peer
                    || peerState != PeerConnection.PeerConnectionState.CONNECTED) return;
        }
        String codec = "unknown";
        String audioCodec = "unknown audio";
        long bytesSent = 0L;
        long framesEncoded = 0L;
        long audioPacketsReceived = 0L;
        long audioBytesReceived = 0L;
        Map<String, RTCStats> stats = report.getStatsMap();
        Set<String> codecIds = new HashSet<>();
        Set<String> audioCodecIds = new HashSet<>();
        for (RTCStats stat : stats.values()) {
            Object mediaType = stat.getMembers().get("kind");
            if (mediaType == null) mediaType = stat.getMembers().get("mediaType");
            if ("outbound-rtp".equals(stat.getType()) && "video".equals(String.valueOf(mediaType))) {
                bytesSent = longValue(stat.getMembers().get("bytesSent"), bytesSent);
                framesEncoded = longValue(stat.getMembers().get("framesEncoded"), framesEncoded);
                Object codecId = stat.getMembers().get("codecId");
                if (codecId != null) codecIds.add(String.valueOf(codecId));
            }
            if ("inbound-rtp".equals(stat.getType()) && "audio".equals(String.valueOf(mediaType))) {
                audioPacketsReceived = longValue(stat.getMembers().get("packetsReceived"), audioPacketsReceived);
                audioBytesReceived = longValue(stat.getMembers().get("bytesReceived"), audioBytesReceived);
                Object codecId = stat.getMembers().get("codecId");
                if (codecId != null) audioCodecIds.add(String.valueOf(codecId));
            }
        }
        for (String codecId : codecIds) {
            RTCStats stat = stats.get(codecId);
            if (stat != null && "codec".equals(stat.getType())) {
                Object mime = stat.getMembers().get("mimeType");
                if (mime != null) codec = String.valueOf(mime);
            }
        }
        for (String codecId : audioCodecIds) {
            RTCStats stat = stats.get(codecId);
            if (stat != null && "codec".equals(stat.getType())) {
                Object mime = stat.getMembers().get("mimeType");
                if (mime != null) audioCodec = String.valueOf(mime);
            }
        }
        audio.onInboundAudio(audioPacketsReceived, audioBytesReceived, audioCodec);
        long capturedFrames = capture.capturedFrames();
        RemoteWitnessMediaProgress.State progress;
        synchronized (this) {
            if (closed || generation != peerGeneration || source != peer
                    || peerState != PeerConnection.PeerConnectionState.CONNECTED) return;
            progress = mediaProgress.observe(capturedFrames, bytesSent);
            if (progress == RemoteWitnessMediaProgress.State.STABLE) peerReconnectAttempt = 0;
        }
        String detail = codec + " · " + framesEncoded + " encoded · "
                + capturedFrames + " captured · " + bytesSent + " bytes";
        if (progress == RemoteWitnessMediaProgress.State.LIVE
                || progress == RemoteWitnessMediaProgress.State.STABLE) {
            listener.onState("live", detail);
        } else if (progress == RemoteWitnessMediaProgress.State.WARMING) {
            listener.onState("media-warming", detail);
        } else if (progress == RemoteWitnessMediaProgress.State.CAPTURE_STALLED) {
            listener.onState("capture-stalled", detail);
            capture.stop("capture-stalled");
        } else {
            listener.onState("transport-stalled", detail);
            recoverPeer("transport-stalled", generation);
        }
    }

    private void recoverPeer(String reason, long observedGeneration) {
        UUID retryTarget;
        int attempt;
        synchronized (this) {
            if (closed || observedGeneration != peerGeneration || !roomLive || !capture.isActive()) return;
            retryTarget = viewerId != null ? viewerId : pendingViewerId;
            attempt = ++peerReconnectAttempt;
            closePeer(reason);
            pendingViewerId = retryTarget;
        }
        if (retryTarget == null) return;
        if (attempt > MAX_PEER_RECONNECT_ATTEMPTS) {
            capture.stop(reason);
            return;
        }
        statsWorker.schedule(() -> {
            synchronized (RemoteWitnessPeerController.this) {
                if (!closed && roomLive && capture.isActive() && peer == null) {
                    negotiate(retryTarget);
                }
            }
        }, attempt, TimeUnit.SECONDS);
    }

    private synchronized void closePeer(String reason) {
        capture.setEnabled(false);
        audio.close();
        mediaProgress.reset();
        videoSender = null;
        viewerId = null;
        negotiationGeneration = -1L;
        PeerConnection current = peer;
        peer = null;
        peerState = PeerConnection.PeerConnectionState.CLOSED;
        peerGeneration += 1L;
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

    private static MediaConstraints witnessMediaConstraints() {
        MediaConstraints constraints = new MediaConstraints();
        constraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"));
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
        private final long generation;

        PeerObserver(long generation) {
            this.generation = generation;
        }

        @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
        @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {}
        @Override public void onIceConnectionReceivingChange(boolean receiving) {}
        @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {}

        @Override public void onIceCandidate(IceCandidate candidate) {
            UUID target;
            synchronized (RemoteWitnessPeerController.this) {
                if (generation != peerGeneration || peer == null) return;
                target = viewerId;
            }
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
            synchronized (RemoteWitnessPeerController.this) {
                if (generation != peerGeneration) return;
                peerState = state;
            }
            String label = "peer-" + state.name().toLowerCase(Locale.US);
            listener.onState(state == PeerConnection.PeerConnectionState.CONNECTED ? "media-warming" : label, captureProfile());
            if (state == PeerConnection.PeerConnectionState.CONNECTED) {
                startStats();
            } else if (state == PeerConnection.PeerConnectionState.DISCONNECTED) {
                statsWorker.schedule(() -> {
                    synchronized (RemoteWitnessPeerController.this) {
                        if (generation != peerGeneration || peer == null
                                || peerState != PeerConnection.PeerConnectionState.DISCONNECTED) return;
                    }
                    recoverPeer("peer-disconnected", generation);
                }, 2L, TimeUnit.SECONDS);
            } else if (state == PeerConnection.PeerConnectionState.FAILED
                    || state == PeerConnection.PeerConnectionState.CLOSED) {
                recoverPeer(label, generation);
            }
        }

        @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
        @Override public void onAddStream(MediaStream stream) {}
        @Override public void onRemoveStream(MediaStream stream) {}
        @Override public void onDataChannel(DataChannel channel) {}
        @Override public void onRenegotiationNeeded() {}
        @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] mediaStreams) {
            synchronized (RemoteWitnessPeerController.this) {
                if (generation != peerGeneration || peer == null) return;
            }
            if (receiver.track() instanceof AudioTrack) {
                receiver.track().setEnabled(true);
                audio.onTrackNegotiated();
            }
        }
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
