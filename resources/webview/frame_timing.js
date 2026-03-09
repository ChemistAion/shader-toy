(function (global) {
    'use strict';

    const root = global.ShaderToy = global.ShaderToy || {};
    root.frameTiming = root.frameTiming || {};

    let frameStartTime = 0;
    let enabled = false;
    let lastPostTime = 0;
    const POST_INTERVAL = 16; // throttle to ~60Hz

    function resetSampleWindow() {
        frameStartTime = 0;
        lastPostTime = 0;
    }

    /**
     * Marks the start of the preview's core render span.
     */
    root.frameTiming.beginFrame = function () {
        if (!enabled) return;
        frameStartTime = performance.now();
    };

    /**
     * Marks the end of the preview's core render span and posts a
     * 'frameData' message to the extension host.
     */
    root.frameTiming.endFrame = function (vscodeApi, frameNumber) {
        if (!enabled || !vscodeApi) return;
        if (frameStartTime <= 0) return;

        const now = performance.now();
        const cpuMs = now - frameStartTime;
        frameStartTime = 0;

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
