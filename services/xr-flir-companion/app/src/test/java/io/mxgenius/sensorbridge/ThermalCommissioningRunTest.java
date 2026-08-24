package io.mxgenius.sensorbridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ThermalCommissioningRunTest {
    @Test public void oneRunPassesOnlyAfterNativeSoakAndTenBrowserFrames() {
        ThermalCommissioningRun run = new ThermalCommissioningRun();
        long started = 1_000L;
        ThermalCommissioningRun.Snapshot report = run.start("run-commission-01", "session-01", started);
        assertEquals("camera-starting", report.phase);

        long firstFrame = 2_000L;
        for (int index = 0; index < 75; index++) report = run.onFrame(firstFrame + index * 200L);
        report = run.evaluateNativeSoak("run-commission-01", firstFrame + ThermalCommissioningRun.SOAK_DURATION_MS);
        assertEquals("awaiting-browser", report.phase);
        assertEquals(75, report.nativeFrames);
        assertTrue(report.maxFrameGapMs <= ThermalCommissioningRun.MAX_FRAME_GAP_MS);

        report = run.acknowledgeBrowser("run-commission-01", 9, 18_000L);
        assertFalse(report.terminal());
        report = run.acknowledgeBrowser("run-commission-01", 10, 18_200L);
        assertEquals("pass", report.result);
        assertEquals("complete", report.phase);
        assertTrue(report.toJson("0.1.0-poc.11", 11).contains("\"schema\":\"mxg.thermal.commissioning.v1\""));
    }

    @Test public void firstFrameTimeoutNamesItsBoundary() {
        ThermalCommissioningRun run = new ThermalCommissioningRun();
        run.start("run-commission-02", "session-02", 1_000L);
        ThermalCommissioningRun.Snapshot report = run.firstFrameTimeout(
                "run-commission-02", 1_000L + ThermalCommissioningRun.FIRST_FRAME_TIMEOUT_MS);
        assertEquals("fail", report.result);
        assertEquals("native-first-frame", report.failureBoundary);
    }

    @Test public void nativeSoakRejectsInsufficientFrames() {
        ThermalCommissioningRun run = new ThermalCommissioningRun();
        run.start("run-commission-03", "session-03", 1_000L);
        for (int index = 0; index < 20; index++) run.onFrame(2_000L + index * 700L);
        ThermalCommissioningRun.Snapshot report = run.evaluateNativeSoak(
                "run-commission-03", 2_000L + ThermalCommissioningRun.SOAK_DURATION_MS);
        assertEquals("fail", report.result);
        assertEquals("native-frame-rate", report.failureBoundary);
    }

    @Test public void nativeCameraFailureWinsImmediately() {
        ThermalCommissioningRun run = new ThermalCommissioningRun();
        run.start("run-commission-04", "session-04", 1_000L);
        run.onFrame(2_000L);
        ThermalCommissioningRun.Snapshot report = run.onCameraFailure(
                "offline", "camera-disconnected-device-lost", 2_100L);
        assertEquals("fail", report.result);
        assertEquals("native-camera-offline", report.failureBoundary);
        assertTrue(report.summary().contains("camera-disconnected-device-lost"));
    }
}
