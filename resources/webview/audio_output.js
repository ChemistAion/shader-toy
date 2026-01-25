(function (global) {
    'use strict';

    const root = global.ShaderToy = global.ShaderToy || {};
    root.audioOutput = root.audioOutput || {};

    const state = {
        initialized: false,
        enabled: false,
        options: {}
    };

    root.audioOutput.state = state;

    root.audioOutput.init = function (options) {
        state.initialized = true;
        state.options = options || {};
    };

    root.audioOutput.enable = function () {
        state.enabled = true;
    };

    root.audioOutput.disable = function () {
        state.enabled = false;
    };

    root.audioOutput.isAvailable = function () {
        return true;
    };
})(typeof window !== 'undefined' ? window : globalThis);
