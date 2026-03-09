(function (global) {
    'use strict';

    const root = global.ShaderToy = global.ShaderToy || {};
    root.frameTiming = root.frameTiming || {};

    let frameBoundaryTime = 0;
    let pendingFrameNumber = 0;
    let activeFrame = false;
    let excludedTimeMs = 0;
    let excludedSectionStartTime = 0;
    let enabled = false;
    let lastPostTime = 0;
    const POST_INTERVAL = 16; // throttle to ~60Hz

    function closeExcludedSection(now) {
        if (excludedSectionStartTime <= 0) return;
        excludedTimeMs += (now || performance.now()) - excludedSectionStartTime;
        excludedSectionStartTime = 0;
    }

    function resetSampleWindow() {
        frameBoundaryTime = 0;
        pendingFrameNumber = 0;
        activeFrame = false;
        excludedTimeMs = 0;
        excludedSectionStartTime = 0;
        lastPostTime = 0;
    }

    /**
     * Marks the start of a preview frame and posts the prior adjusted sample.
     */
    root.frameTiming.beginFrame = function (vscodeApi, frameNumber) {
        if (!enabled) return;
        const now = performance.now();

        if (activeFrame) {
            closeExcludedSection(now);

            const cpuMs = Math.max(0, now - frameBoundaryTime - excludedTimeMs);
            if (vscodeApi && cpuMs > 0 && now - lastPostTime >= POST_INTERVAL) {
                lastPostTime = now;
                vscodeApi.postMessage({
                    command: 'frameData',
                    cpuMs: cpuMs,
                    gpuMs: 0,
                    frameNumber: pendingFrameNumber || 0
                });
            }
        }

        frameBoundaryTime = now;
        pendingFrameNumber = frameNumber || 0;
        excludedTimeMs = 0;
        activeFrame = true;
    };

    /**
     * Ends the current render submission phase.
     */
    root.frameTiming.endFrame = function () {
        if (!enabled || !activeFrame) return;
        closeExcludedSection();
    };

    root.frameTiming.beginExcludedSection = function () {
        if (!enabled || !activeFrame || excludedSectionStartTime > 0) return;
        excludedSectionStartTime = performance.now();
    };

    root.frameTiming.endExcludedSection = function () {
        if (!enabled || !activeFrame) return;
        closeExcludedSection();
    };

    root.frameTiming.setEnabled = function (value) {
        enabled = !!value;
        if (!value) {
            resetSampleWindow();
        }
    };

    root.frameTiming.resetSampleWindow = resetSampleWindow;

    root.frameTiming.setPaused = function (_value) {
        resetSampleWindow();
    };

    root.frameTiming.isEnabled = function () {
        return enabled;
    };
})(typeof window !== 'undefined' ? window : globalThis);
