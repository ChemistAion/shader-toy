'use strict';

const path = require('path');

/**
 * Bundles Three.js from npm into a classic <script>-friendly global (THREE).
 * This avoids CDN/packaging changes across Three releases.
 */
module.exports = {
    mode: 'production',
    target: 'web',
    entry: 'three',
    output: {
        path: path.resolve(__dirname, 'resources'),
        filename: 'three.min.js',
        // Expose as global var "THREE" for existing webview code.
        library: {
            name: 'THREE',
            type: 'var'
        },
        iife: true
    },
    devtool: false,
    optimization: {
        minimize: true
    },
    performance: {
        hints: false
    }
};
