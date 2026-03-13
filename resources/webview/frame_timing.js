(function (global) {
    'use strict';

    const root = global.ShaderToy = global.ShaderToy || {};
    root.frameTiming = root.frameTiming || {};

    let frameStartTime = 0;
    let activeFrame = false;
    let excludedTimeMs = 0;
    let excludedSectionStartTime = 0;
    let skipNextFrameSample = false;
    let enabled = false;
    let lastPostTime = 0;
    const POST_INTERVAL = 16; // throttle to ~60Hz

    function closeExcludedSection(now) {
        if (excludedSectionStartTime <= 0) return;
        excludedTimeMs += (now || performance.now()) - excludedSectionStartTime;
        excludedSectionStartTime = 0;
    }

    function resetSampleWindow() {
        frameStartTime = 0;
        activeFrame = false;
        excludedTimeMs = 0;
        excludedSectionStartTime = 0;
        lastPostTime = 0;
    }

    function clearActiveSample() {
        frameStartTime = 0;
        activeFrame = false;
        excludedTimeMs = 0;
        excludedSectionStartTime = 0;
    }

    /**
     * Marks the start of the preview's core render span.
     */
    root.frameTiming.beginFrame = function (vscodeApi, frameNumber) {
        if (!enabled) return;
        if (activeFrame) {
            resetSampleWindow();
        }

        frameStartTime = performance.now();
        excludedTimeMs = 0;
        activeFrame = true;
    };

    /**
     * Ends the preview's core render span and posts an adjusted sample.
     */
    root.frameTiming.endFrame = function (vscodeApi, frameNumber) {
        if (!enabled || !activeFrame || !vscodeApi || frameStartTime <= 0) return;

        const now = performance.now();
        closeExcludedSection(now);

        const cpuMs = Math.max(0, now - frameStartTime - excludedTimeMs);
        clearActiveSample();

        if (skipNextFrameSample) {
            skipNextFrameSample = false;
            return;
        }

        if (cpuMs > 0 && now - lastPostTime >= POST_INTERVAL) {
            lastPostTime = now;
            vscodeApi.postMessage({
                command: 'frameData',
                cpuMs: cpuMs,
                gpuMs: 0,
                frameNumber: frameNumber || 0
            });
        }
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

    root.frameTiming.skipNextFrameSample = function () {
        skipNextFrameSample = true;
        clearActiveSample();
    };

    root.frameTiming.setPaused = function (_value) {
        resetSampleWindow();
        skipNextFrameSample = false;
    };

    root.frameTiming.isEnabled = function () {
        return enabled;
    };
})(typeof window !== 'undefined' ? window : globalThis);
