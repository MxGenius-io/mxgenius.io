package io.mxgenius.sensorbridge;

/** Classifies compositor and RTP counter deltas without treating ICE as proof of live media. */
final class RemoteWitnessMediaProgress {
    enum State { WARMING, LIVE, STABLE, CAPTURE_STALLED, TRANSPORT_STALLED }

    private static final int STALL_SAMPLE_LIMIT = 2;
    private static final int STABLE_SAMPLE_LIMIT = 6;

    private long lastCapturedFrames = -1L;
    private long lastBytesSent = -1L;
    private int captureStallSamples;
    private int transportStallSamples;
    private int liveSamples;

    synchronized State observe(long capturedFrames, long bytesSent) {
        long captured = Math.max(0L, capturedFrames);
        long sent = Math.max(0L, bytesSent);
        if (lastCapturedFrames < 0L || lastBytesSent < 0L) {
            lastCapturedFrames = captured;
            lastBytesSent = sent;
            return State.WARMING;
        }

        boolean captureAdvanced = captured > lastCapturedFrames;
        boolean transportAdvanced = sent > lastBytesSent;
        lastCapturedFrames = captured;
        lastBytesSent = sent;

        if (!captureAdvanced) {
            captureStallSamples += 1;
            transportStallSamples = 0;
            liveSamples = 0;
            return captureStallSamples >= STALL_SAMPLE_LIMIT
                    ? State.CAPTURE_STALLED : State.WARMING;
        }

        captureStallSamples = 0;
        if (!transportAdvanced) {
            transportStallSamples += 1;
            liveSamples = 0;
            return transportStallSamples >= STALL_SAMPLE_LIMIT
                    ? State.TRANSPORT_STALLED : State.WARMING;
        }

        transportStallSamples = 0;
        liveSamples += 1;
        return liveSamples >= STABLE_SAMPLE_LIMIT ? State.STABLE : State.LIVE;
    }

    synchronized void reset() {
        lastCapturedFrames = -1L;
        lastBytesSent = -1L;
        captureStallSamples = 0;
        transportStallSamples = 0;
        liveSamples = 0;
    }
}
