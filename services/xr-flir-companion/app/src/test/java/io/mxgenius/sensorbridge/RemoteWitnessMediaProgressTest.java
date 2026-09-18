package io.mxgenius.sensorbridge;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class RemoteWitnessMediaProgressTest {
    @Test
    public void firstSampleWarmsAndAdvancingCaptureAndTransportBecomeLive() {
        RemoteWitnessMediaProgress progress = new RemoteWitnessMediaProgress();

        assertEquals(RemoteWitnessMediaProgress.State.WARMING, progress.observe(10L, 1_000L));
        assertEquals(RemoteWitnessMediaProgress.State.LIVE, progress.observe(25L, 4_000L));
    }

    @Test
    public void stoppedCompositorRequiresTwoSamplesBeforeFreshConsent() {
        RemoteWitnessMediaProgress progress = new RemoteWitnessMediaProgress();
        progress.observe(10L, 1_000L);

        assertEquals(RemoteWitnessMediaProgress.State.WARMING, progress.observe(10L, 1_000L));
        assertEquals(RemoteWitnessMediaProgress.State.CAPTURE_STALLED, progress.observe(10L, 1_000L));
    }

    @Test
    public void advancingCaptureWithStoppedRtpRequestsPeerRepair() {
        RemoteWitnessMediaProgress progress = new RemoteWitnessMediaProgress();
        progress.observe(10L, 1_000L);

        assertEquals(RemoteWitnessMediaProgress.State.WARMING, progress.observe(20L, 1_000L));
        assertEquals(RemoteWitnessMediaProgress.State.TRANSPORT_STALLED, progress.observe(30L, 1_000L));
    }

    @Test
    public void resetRequiresASecondWarmupAndClearsOldStalls() {
        RemoteWitnessMediaProgress progress = new RemoteWitnessMediaProgress();
        progress.observe(10L, 1_000L);
        progress.observe(20L, 1_000L);
        assertEquals(RemoteWitnessMediaProgress.State.TRANSPORT_STALLED, progress.observe(30L, 1_000L));

        progress.reset();

        assertEquals(RemoteWitnessMediaProgress.State.WARMING, progress.observe(40L, 1_000L));
        assertEquals(RemoteWitnessMediaProgress.State.LIVE, progress.observe(50L, 2_000L));
    }

    @Test
    public void recoveryBudgetIsResetOnlyAfterSixConsecutiveHealthySamples() {
        RemoteWitnessMediaProgress progress = new RemoteWitnessMediaProgress();
        progress.observe(10L, 1_000L);

        for (int sample = 1; sample < 6; sample += 1) {
            assertEquals(
                    RemoteWitnessMediaProgress.State.LIVE,
                    progress.observe(10L + sample, 1_000L + sample));
        }
        assertEquals(RemoteWitnessMediaProgress.State.STABLE, progress.observe(16L, 1_006L));

        assertEquals(RemoteWitnessMediaProgress.State.WARMING, progress.observe(16L, 1_006L));
        assertEquals(RemoteWitnessMediaProgress.State.CAPTURE_STALLED, progress.observe(16L, 1_006L));
        assertEquals(RemoteWitnessMediaProgress.State.LIVE, progress.observe(17L, 1_007L));
    }
}
