package io.mxgenius.sensorbridge;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Deterministic, side-effect-free state machine for one end-to-end thermal commissioning run.
 * Android lifecycle, FLIR callbacks, and WebSocket messages feed this class; it owns the verdict.
 */
final class ThermalCommissioningRun {
    static final long FIRST_FRAME_TIMEOUT_MS = 20_000L;
    static final long SOAK_DURATION_MS = 15_000L;
    static final long MAX_FRAME_GAP_MS = 2_500L;
    static final long BROWSER_TIMEOUT_MS = 120_000L;
    static final int MIN_SOAK_FRAMES = 60;
    static final int REQUIRED_BROWSER_FRAMES = 10;

    static final class Snapshot {
        final String runId;
        final String sessionId;
        final String phase;
        final String result;
        final String failureBoundary;
        final String failureDetail;
        final long startedAtMs;
        final long updatedAtMs;
        final long firstFrameAtMs;
        final long completedAtMs;
        final int nativeFrames;
        final int transientSkips;
        final long maxFrameGapMs;
        final int browserFrames;

        Snapshot(
                String runId,
                String sessionId,
                String phase,
                String result,
                String failureBoundary,
                String failureDetail,
                long startedAtMs,
                long updatedAtMs,
                long firstFrameAtMs,
                long completedAtMs,
                int nativeFrames,
                int transientSkips,
                long maxFrameGapMs,
                int browserFrames) {
            this.runId = runId;
            this.sessionId = sessionId;
            this.phase = phase;
            this.result = result;
            this.failureBoundary = failureBoundary;
            this.failureDetail = failureDetail;
            this.startedAtMs = startedAtMs;
            this.updatedAtMs = updatedAtMs;
            this.firstFrameAtMs = firstFrameAtMs;
            this.completedAtMs = completedAtMs;
            this.nativeFrames = nativeFrames;
            this.transientSkips = transientSkips;
            this.maxFrameGapMs = maxFrameGapMs;
            this.browserFrames = browserFrames;
        }

        boolean terminal() {
            return "pass".equals(result) || "fail".equals(result);
        }

        String summary() {
            if ("pass".equals(result)) {
                return "PASS · native " + nativeFrames + " frames · browser " + browserFrames + "/" + REQUIRED_BROWSER_FRAMES;
            }
            if ("fail".equals(result)) {
                return "FAIL " + failureBoundary + " · " + failureDetail;
            }
            if ("awaiting-browser".equals(phase)) {
                return "NATIVE PASS · " + nativeFrames + " frames · open Meta Browser";
            }
            if ("soaking".equals(phase)) {
                return "SOAKING · " + nativeFrames + "/" + MIN_SOAK_FRAMES + " frames";
            }
            return "RUNNING · " + phase;
        }

        String toJson(String versionName, int versionCode) {
            try {
                JSONObject report = new JSONObject()
                        .put("type", "commissioning.status")
                        .put("schema", "mxg.thermal.commissioning.v1")
                        .put("runId", runId)
                        .put("phase", phase)
                        .put("result", result)
                        .put("versionName", versionName)
                        .put("versionCode", versionCode)
                        .put("startedAtMs", startedAtMs)
                        .put("updatedAtMs", updatedAtMs)
                        .put("firstFrameAtMs", firstFrameAtMs)
                        .put("completedAtMs", completedAtMs)
                        .put("nativeFrames", nativeFrames)
                        .put("transientSkips", transientSkips)
                        .put("maxFrameGapMs", maxFrameGapMs)
                        .put("requiredNativeFrames", MIN_SOAK_FRAMES)
                        .put("browserFrames", browserFrames)
                        .put("requiredBrowserFrames", REQUIRED_BROWSER_FRAMES);
                if (sessionId != null && !sessionId.isBlank()) report.put("sessionId", sessionId);
                if (failureBoundary != null) report.put("failureBoundary", failureBoundary);
                if (failureDetail != null) report.put("failureDetail", failureDetail);
                return report.toString();
            } catch (JSONException error) {
                return "{\"type\":\"commissioning.status\",\"result\":\"fail\",\"failureBoundary\":\"report-encode\"}";
            }
        }
    }

    private String runId;
    private String sessionId;
    private String phase = "idle";
    private String result = "idle";
    private String failureBoundary;
    private String failureDetail;
    private long startedAtMs;
    private long updatedAtMs;
    private long firstFrameAtMs;
    private long lastFrameAtMs;
    private long completedAtMs;
    private long maxFrameGapMs;
    private int nativeFrames;
    private int transientSkips;
    private int browserFrames;

    synchronized Snapshot start(String nextRunId, String nextSessionId, long nowMs) {
        runId = nextRunId;
        sessionId = nextSessionId;
        phase = "camera-starting";
        result = "running";
        failureBoundary = null;
        failureDetail = null;
        startedAtMs = nowMs;
        updatedAtMs = nowMs;
        firstFrameAtMs = 0;
        lastFrameAtMs = 0;
        completedAtMs = 0;
        maxFrameGapMs = 0;
        nativeFrames = 0;
        transientSkips = 0;
        browserFrames = 0;
        return snapshot();
    }

    synchronized Snapshot onFrame(long nowMs) {
        if (!active() || !("camera-starting".equals(phase) || "soaking".equals(phase))) return snapshot();
        if (firstFrameAtMs == 0) {
            firstFrameAtMs = nowMs;
            phase = "soaking";
        }
        if (lastFrameAtMs > 0) maxFrameGapMs = Math.max(maxFrameGapMs, nowMs - lastFrameAtMs);
        lastFrameAtMs = nowMs;
        nativeFrames += 1;
        updatedAtMs = nowMs;
        return snapshot();
    }

    synchronized Snapshot onTransientSkip(long nowMs) {
        if (active()) {
            transientSkips += 1;
            updatedAtMs = nowMs;
        }
        return snapshot();
    }

    synchronized Snapshot onCameraFailure(String state, String detail, long nowMs) {
        if (!active()) return snapshot();
        return fail("native-camera-" + clean(state, "failed"), clean(detail, "camera failure"), nowMs);
    }

    synchronized Snapshot firstFrameTimeout(String expectedRunId, long nowMs) {
        if (!matches(expectedRunId) || !"camera-starting".equals(phase)) return snapshot();
        return fail("native-first-frame", "no decoded thermal frame within " + FIRST_FRAME_TIMEOUT_MS + "ms", nowMs);
    }

    synchronized Snapshot evaluateNativeSoak(String expectedRunId, long nowMs) {
        if (!matches(expectedRunId) || !"soaking".equals(phase)) return snapshot();
        long terminalGap = lastFrameAtMs == 0 ? SOAK_DURATION_MS : nowMs - lastFrameAtMs;
        maxFrameGapMs = Math.max(maxFrameGapMs, terminalGap);
        if (nativeFrames < MIN_SOAK_FRAMES) {
            return fail("native-frame-rate", "received " + nativeFrames + " of " + MIN_SOAK_FRAMES + " required frames", nowMs);
        }
        if (maxFrameGapMs > MAX_FRAME_GAP_MS) {
            return fail("native-frame-gap", "maximum frame gap was " + maxFrameGapMs + "ms", nowMs);
        }
        if (sessionId == null || sessionId.isBlank()) {
            return fail("browser-session", "run was not launched from an authenticated browser session", nowMs);
        }
        phase = "awaiting-browser";
        updatedAtMs = nowMs;
        return snapshot();
    }

    synchronized Snapshot acknowledgeBrowser(String expectedRunId, int renderedFrames, long nowMs) {
        if (!matches(expectedRunId) || !"awaiting-browser".equals(phase)) return snapshot();
        browserFrames = Math.max(0, renderedFrames);
        updatedAtMs = nowMs;
        if (browserFrames < REQUIRED_BROWSER_FRAMES) return snapshot();
        phase = "complete";
        result = "pass";
        completedAtMs = nowMs;
        return snapshot();
    }

    synchronized Snapshot browserTimeout(String expectedRunId, long nowMs) {
        if (!matches(expectedRunId) || !"awaiting-browser".equals(phase)) return snapshot();
        return fail("browser-render", "no authenticated ten-frame render acknowledgement within " + BROWSER_TIMEOUT_MS + "ms", nowMs);
    }

    synchronized Snapshot snapshot() {
        return new Snapshot(
                runId, sessionId, phase, result, failureBoundary, failureDetail,
                startedAtMs, updatedAtMs, firstFrameAtMs, completedAtMs,
                nativeFrames, transientSkips, maxFrameGapMs, browserFrames);
    }

    private boolean active() {
        return "running".equals(result);
    }

    private boolean matches(String expectedRunId) {
        return runId != null && runId.equals(expectedRunId) && active();
    }

    private Snapshot fail(String boundary, String detail, long nowMs) {
        phase = "complete";
        result = "fail";
        failureBoundary = boundary;
        failureDetail = detail;
        updatedAtMs = nowMs;
        completedAtMs = nowMs;
        return snapshot();
    }

    private static String clean(String value, String fallback) {
        if (value == null || value.isBlank()) return fallback;
        String clean = value.replaceAll("\\s+", " ").trim();
        return clean.substring(0, Math.min(clean.length(), 160));
    }
}
