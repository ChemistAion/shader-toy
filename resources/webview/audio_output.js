(function (global) {
    'use strict';

    const root = global.ShaderToy = global.ShaderToy || {};
    root.audioOutput = root.audioOutput || {};

    const state = {
        initialized: false,
        enabled: true,
        options: {},
        audioContext: null,
        gainNode: null,
        gainConnected: false,
        outputGain: 0.5,
        workletNode: null,
        workletReady: false,
        workletLoading: false,
        workletFailed: false,
        outputUsesWorklet: false,
        audioBuffer: null,
        sourceNode: null,
        analysisGain: null,
        analyserNodes: [],
        soundBuffer: null,
        ready: false,
        pendingStartAt: null,
        gestureHandlerAttached: false,
        started: false
    };

    root.audioOutput.state = state;

    root.audioOutput.init = function (options) {
        state.initialized = true;
        state.options = options || {};
    };

    const disconnectSafe = function (node) {
        if (!node) {
            return;
        }
        try {
            node.disconnect();
        } catch {
            // ignore
        }
    };

    const connectOutput = function () {
        if (!state.audioContext || !state.gainNode) {
            return;
        }
        disconnectSafe(state.gainNode);
        if (state.workletNode && state.workletReady) {
            disconnectSafe(state.workletNode);
            try {
                state.gainNode.connect(state.workletNode);
                state.workletNode.connect(state.audioContext.destination);
                state.outputUsesWorklet = true;
                return;
            } catch {
                // fall back
            }
        }
        try {
            state.gainNode.connect(state.audioContext.destination);
            state.outputUsesWorklet = false;
        } catch {
            // ignore
        }
    };

    const ensureWorklet = function (options) {
        if (state.workletReady || state.workletFailed || state.workletLoading) {
            return;
        }
        if (!state.audioContext || !state.audioContext.audioWorklet) {
            state.workletFailed = true;
            return;
        }
        const url = options && options.audioWorkletUrl ? String(options.audioWorkletUrl) : '';
        if (!url) {
            state.workletFailed = true;
            return;
        }
        state.workletLoading = true;
        state.audioContext.audioWorklet.addModule(url).then(() => {
            try {
                state.workletNode = new global.AudioWorkletNode(state.audioContext, 'shadertoy-pass-through');
                state.workletReady = true;
            } catch {
                state.workletFailed = true;
            }
        }).catch(() => {
            state.workletFailed = true;
        }).finally(() => {
            state.workletLoading = false;
            connectOutput();
        });
    };

    const resolveAudioContext = function (input) {
        if (input && typeof input.createBuffer === 'function') {
            return input;
        }
        const AudioContextCtor = global.AudioContext || global.webkitAudioContext;
        if (!AudioContextCtor) {
            return null;
        }
        return new AudioContextCtor();
    };

    const resolvePrecision = function (options) {
        const precision = String(options.precision || '32bFLOAT');
        const gl = options.gl;
        const supportsFloat = gl && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('WEBGL_color_buffer_float'));
        const supportsHalfFloat = gl && (gl.getExtension('EXT_color_buffer_half_float'));

        if (precision === '32bFLOAT' && supportsFloat) {
            return '32bFLOAT';
        }
        if (precision === '16bFLOAT' && supportsHalfFloat) {
            return '16bFLOAT';
        }
        if (precision === '32bFLOAT' && supportsHalfFloat) {
            return '16bFLOAT';
        }
        return '16bPACK';
    };

    const reportPrecisionFallback = function (options, resolvedPrecision) {
        const requested = String(options.precision || '32bFLOAT');
        if (requested === resolvedPrecision) {
            return;
        }
        const gl = options.gl;
        const supportsFloat = gl && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('WEBGL_color_buffer_float'));
        const supportsHalfFloat = gl && (gl.getExtension('EXT_color_buffer_half_float'));
        const details = `EXT_color_buffer_float=${supportsFloat ? 'yes' : 'no'}, EXT_color_buffer_half_float=${supportsHalfFloat ? 'yes' : 'no'}`;
        postErrorMessage(`Audio precision '${requested}' not supported; using '${resolvedPrecision}'. (${details})`);
    };

    const buildSoundMaterial = function (buffer, options, sampleRate, precisionMode) {
        if (!global.document || !global.document.getElementById) {
            return null;
        }
        const shaderElement = global.document.getElementById(buffer.Name);
        if (!shaderElement || !shaderElement.textContent) {
            postErrorMessage('mainSound shader source not found.');
            return null;
        }

        const footer = (precisionMode === '16bPACK') ? `
    uniform float blockOffset;

    void main() {
    float t = blockOffset + ((gl_FragCoord.x - 0.5) + (gl_FragCoord.y - 0.5) * 512.0) / iSampleRate;
    vec2 y = mainSound(t);
    vec2 v  = floor((0.5 + 0.5 * y) * 65536.0);
    vec2 vl = mod(v, 256.0) / 255.0;
    vec2 vh = floor(v / 256.0) / 255.0;
    GLSL_FRAGCOLOR = vec4(vl.x, vh.x, vl.y, vh.y);
}` : `
    uniform float blockOffset;

    void main() {
    float t = blockOffset + ((gl_FragCoord.x - 0.5) + (gl_FragCoord.y - 0.5) * 512.0) / iSampleRate;
    vec2 y = mainSound(t);
    GLSL_FRAGCOLOR = vec4(y, 0.0, 1.0);
}`;

        const source = `${shaderElement.textContent}\n${footer}`;
        const prepared = options.prepareFragmentShader ? options.prepareFragmentShader(source, options.glslUseVersion3) : source;
        const vertexSource = 'void main() { gl_Position = vec4(position, 1.0); }';
        const preparedVertex = options.prepareVertexShader
            ? options.prepareVertexShader(vertexSource, options.glslUseVersion3)
            : vertexSource;
        const materialOptions = {
            vertexShader: preparedVertex,
            fragmentShader: prepared,
            depthWrite: false,
            depthTest: false,
            uniforms: {
                iSampleRate: { type: 'f', value: sampleRate },
                blockOffset: { type: 'f', value: 0 }
            }
        };
        if (options.glslUseVersion3 && global.THREE.GLSL3) {
            materialOptions.glslVersion = global.THREE.GLSL3;
        }
        return new global.THREE.ShaderMaterial(materialOptions);
    };

    const applyOutputGain = function () {
        if (!state.gainNode) {
            return;
        }
        state.gainNode.gain.value = state.enabled ? state.outputGain : 0;
    };

    root.audioOutput.enable = function () {
        state.enabled = true;
        applyOutputGain();
    };

    root.audioOutput.disable = function () {
        state.enabled = false;
        applyOutputGain();
    };

    root.audioOutput.setOutputEnabled = function (enabled) {
        state.enabled = !!enabled;
        applyOutputGain();
    };

    root.audioOutput.isAvailable = function () {
        return true;
    };

    const ensureAnalysisGain = function () {
        if (!state.audioContext) {
            return null;
        }
        if (!state.analysisGain) {
            const analysisGain = state.audioContext.createGain();
            analysisGain.gain.value = 0;
            analysisGain.connect(state.audioContext.destination);
            state.analysisGain = analysisGain;
        }
        return state.analysisGain;
    };

    root.audioOutput.createSoundInput = function (fftSize) {
        if (!state.audioContext || !state.soundBuffer || !global.THREE) {
            return null;
        }

        const analyserLeft = state.audioContext.createAnalyser();
        const analyserRight = state.audioContext.createAnalyser();
        const resolvedFft = Number.isFinite(fftSize) ? Math.max(32, Math.floor(fftSize)) : 2048;
        analyserLeft.fftSize = resolvedFft;
        analyserRight.fftSize = resolvedFft;

        const dataSize = Math.max(analyserLeft.fftSize, analyserLeft.frequencyBinCount);
        const dataArray = new Uint8Array(dataSize * 2 * 4);
        const freqLeft = new Uint8Array(analyserLeft.frequencyBinCount);
        const freqRight = new Uint8Array(analyserRight.frequencyBinCount);
        const timeLeft = new Uint8Array(analyserLeft.fftSize);
        const timeRight = new Uint8Array(analyserRight.fftSize);

        const texture = new global.THREE.DataTexture(dataArray, dataSize, 2, global.THREE.RGBAFormat, global.THREE.UnsignedByteType);
        texture.magFilter = global.THREE.LinearFilter;
        texture.needsUpdate = true;

        const analysisGain = ensureAnalysisGain();
        const splitter = state.audioContext.createChannelSplitter(2);
        splitter.connect(analyserLeft, 0);
        splitter.connect(analyserRight, 1);
        if (analysisGain) {
            analyserLeft.connect(analysisGain);
            analyserRight.connect(analysisGain);
        }
        state.analyserNodes.push(analyserLeft, analyserRight);
        state.soundInputSplitters = state.soundInputSplitters || [];
        state.soundInputSplitters.push(splitter);

        if (state.sourceNode) {
            try {
                state.sourceNode.connect(splitter);
            } catch {
                // ignore
            }
        }

        return {
            AnalyserLeft: analyserLeft,
            AnalyserRight: analyserRight,
            Data: dataArray,
            DataSize: dataSize,
            FrequencySamples: analyserLeft.frequencyBinCount,
            AmplitudeSamples: analyserLeft.fftSize,
            FrequencyDataLeft: freqLeft,
            FrequencyDataRight: freqRight,
            TimeDataLeft: timeLeft,
            TimeDataRight: timeRight,
            Texture: texture
        };
    };

    const getStatusElement = function () {
        if (!state.showStatus || !global.document || !global.document.body) {
            return null;
        }
        let el = global.document.getElementById('audio-output-status');
        if (!el) {
            el = global.document.createElement('div');
            el.id = 'audio-output-status';
            el.style.position = 'absolute';
            el.style.left = '8px';
            el.style.bottom = '8px';
            el.style.padding = '6px 8px';
            el.style.fontFamily = 'Consolas, monospace';
            el.style.fontSize = '12px';
            el.style.background = 'rgba(0,0,0,0.65)';
            el.style.color = '#ddd';
            el.style.borderRadius = '4px';
            el.style.whiteSpace = 'pre';
            el.style.zIndex = '4';
            global.document.body.appendChild(el);
        }
        return el;
    };

    const showStatus = function (message) {
        const el = getStatusElement();
        if (el) {
            el.textContent = message;
        }
    };

    const renderStatus = function () {
        const parts = [];
        if (state.statusLine) {
            parts.push(state.statusLine);
        }
        if (state.statsLine) {
            parts.push(state.statsLine);
        }
        showStatus(parts.join('\n'));
    };

    const setStatus = function (message) {
        state.statusMessage = message;
        state.statusLine = message;
        renderStatus();
    };

    const setStats = function (message) {
        state.statsLine = message;
        renderStatus();
    };

    const postErrorMessage = function (message) {
        try {
            const vscode = root.env && root.env.getVscodeApi ? root.env.getVscodeApi() : undefined;
            if (vscode && message) {
                vscode.postMessage({ command: 'errorMessage', message: message });
            }
        } catch {
            // ignore
        }
        if (message) {
            setStatus(message);
        }
    };

    const attachGestureResume = function (callback) {
        if (state.gestureHandlerAttached) {
            return;
        }
        state.gestureHandlerAttached = true;
        const onGesture = () => {
            state.gestureHandlerAttached = false;
            global.removeEventListener('pointerdown', onGesture);
            global.removeEventListener('keydown', onGesture);
            callback();
        };
        global.addEventListener('pointerdown', onGesture, { once: true });
        global.addEventListener('keydown', onGesture, { once: true });
    };

    const attachInitialStart = function () {
        const startIfNeeded = () => {
            if (!state.started) {
                root.audioOutput.start(0, true);
            }
        };

        attachGestureResume(startIfNeeded);
        global.addEventListener('focus', startIfNeeded, { once: true });
        setStatus('Audio output is blocked (due to WebAudio autoplay gesture policy) until you provide a user action to the GLSL-preview.');
    };

    const scheduleGestureStart = function (startAt, resumeAndStart) {
        state.pendingStartAt = startAt;
        attachGestureResume(() => {
            const pending = state.pendingStartAt;
            state.pendingStartAt = null;
            resumeAndStart(pending ?? 0);
        });
        setStatus('Audio output is blocked (due to WebAudio autoplay gesture policy) until you provide a user action to the GLSL-preview.');
    };

    const renderAllBlocks = function (options) {
        const renderer = options.renderer;
        const soundBuffer = state.soundBuffer;
        if (!renderer || !soundBuffer || !state.audioBuffer || !state.audioContext) {
            return;
        }

        const previousShader = global.currentShader;
        if (soundBuffer && soundBuffer.File) {
            global.currentShader = {
                Name: soundBuffer.Name,
                File: soundBuffer.File,
                LineOffset: soundBuffer.LineOffset
            };
        }

        const WIDTH = 512;
        const HEIGHT = 512;
        const samplesPerBlock = WIDTH * HEIGHT;
        const totalSamples = state.audioBuffer.length;
        const numBlocks = Math.ceil(totalSamples / samplesPerBlock);

        const precisionMode = resolvePrecision(options);
        let targetType = global.THREE.UnsignedByteType;
        if (precisionMode === '32bFLOAT' && global.THREE.FloatType) {
            targetType = global.THREE.FloatType;
        } else if (precisionMode === '16bFLOAT' && global.THREE.HalfFloatType) {
            targetType = global.THREE.HalfFloatType;
        }
        const target = new global.THREE.WebGLRenderTarget(WIDTH, HEIGHT, { type: targetType });
        const scene = new global.THREE.Scene();
        const camera = new global.THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        camera.position.set(0, 0, 1);
        camera.lookAt(scene.position);

        const material = buildSoundMaterial(soundBuffer, options, state.audioContext.sampleRate, precisionMode);
        if (!material) {
            return;
        }

        const mesh = new global.THREE.Mesh(new global.THREE.PlaneGeometry(2, 2), material);
        scene.add(mesh);

        const pixels = (precisionMode === '16bPACK')
            ? new Uint8Array(WIDTH * HEIGHT * 4)
            : new Float32Array(WIDTH * HEIGHT * 4);
        const outputDataL = state.audioBuffer.getChannelData(0);
        const outputDataR = state.audioBuffer.getChannelData(1);

        const previousTarget = renderer.getRenderTarget();

        const renderStart = global.performance && typeof global.performance.now === 'function'
            ? global.performance.now()
            : Date.now();

        for (let i = 0; i < numBlocks; i++) {
            material.uniforms.blockOffset.value = (i * samplesPerBlock) / state.audioContext.sampleRate;
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
            renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);

            const baseIndex = i * samplesPerBlock;
            const remaining = totalSamples - baseIndex;
            const blockSamples = Math.min(samplesPerBlock, remaining);

            if (precisionMode === '16bPACK') {
                for (let j = 0; j < blockSamples; j++) {
                    const pixelIndex = j * 4;
                    outputDataL[baseIndex + j] = (pixels[pixelIndex + 0] + 256 * pixels[pixelIndex + 1]) / 65535 * 2 - 1;
                    outputDataR[baseIndex + j] = (pixels[pixelIndex + 2] + 256 * pixels[pixelIndex + 3]) / 65535 * 2 - 1;
                }
            } else {
                for (let j = 0; j < blockSamples; j++) {
                    const pixelIndex = j * 4;
                    outputDataL[baseIndex + j] = Math.max(-1, Math.min(1, pixels[pixelIndex + 0]));
                    outputDataR[baseIndex + j] = Math.max(-1, Math.min(1, pixels[pixelIndex + 1]));
                }
            }
        }

        renderer.setRenderTarget(previousTarget);
        target.dispose();
        material.dispose();
        mesh.geometry.dispose();

        const renderEnd = global.performance && typeof global.performance.now === 'function'
            ? global.performance.now()
            : Date.now();
        const renderSeconds = Math.max(0, renderEnd - renderStart) / 1000;
        setStats(`Pre-processing time: ${renderSeconds.toFixed(2)}s`);

        global.currentShader = previousShader;
    };

    root.audioOutput.initFromGlobals = function (options) {
        root.audioOutput.init(options);

        if (!options || !options.buffers || !global.THREE) {
            return;
        }

        if (!options.glslUseVersion3) {
            postErrorMessage('mainSound requires shader-toy.webglVersion set to "WebGL2".');
            return;
        }

        const soundBuffer = options.buffers.find((buffer) => buffer && buffer.IsSound);
        if (!soundBuffer) {
            return;
        }
        state.soundBuffer = soundBuffer;

        const audioContext = resolveAudioContext(options.audioContext);
        if (!audioContext) {
            return;
        }

        state.audioContext = audioContext;
        state.showStatus = options.showSoundButton !== false;
        state.outputGain = 0.5;
        state.gainNode = audioContext.createGain();
        applyOutputGain();
        connectOutput();
        ensureWorklet(options);

        const durationSeconds = Number.isFinite(options.durationSeconds) ? options.durationSeconds : 180;
        const totalSamples = Math.max(1, Math.floor(audioContext.sampleRate * durationSeconds));
        state.audioBuffer = audioContext.createBuffer(2, totalSamples, audioContext.sampleRate);

        for (const buffer of options.buffers) {
            if (buffer && buffer.Shader && buffer.Shader.uniforms && buffer.Shader.uniforms.iSampleRate) {
                buffer.Shader.uniforms.iSampleRate.value = audioContext.sampleRate;
            }
        }

        const precisionMode = resolvePrecision(options);
        reportPrecisionFallback(options, precisionMode);
        const blockSeconds = (512 * 512) / state.audioContext.sampleRate;
        setStatus(`Audio: ${precisionMode} @ ${state.audioContext.sampleRate} Hz, duration ${durationSeconds}s, block ${blockSeconds.toFixed(3)}s`);

        renderAllBlocks(options);
        state.ready = true;
        state.started = false;

        if (options.autoStart !== false && !options.paused) {
            if (state.audioContext.state !== 'running') {
                attachInitialStart();
            }
            else {
                root.audioOutput.start(0);
            }
        }
    };

    root.audioOutput.reloadFromGlobals = function (options) {
        root.audioOutput.init(options);

        if (!options || !options.buffers || !global.THREE) {
            return;
        }

        if (!options.glslUseVersion3) {
            postErrorMessage('mainSound requires shader-toy.webglVersion set to "WebGL2".');
            return;
        }

        const soundBuffer = options.buffers.find((buffer) => buffer && buffer.IsSound);
        if (!soundBuffer) {
            state.soundBuffer = null;
            state.ready = false;
            return;
        }
        state.soundBuffer = soundBuffer;

        const audioContext = state.audioContext || resolveAudioContext(options.audioContext);
        if (!audioContext) {
            return;
        }

        state.audioContext = audioContext;
        state.showStatus = options.showSoundButton !== false;
        if (!state.gainNode) {
            state.gainNode = audioContext.createGain();
        }
        applyOutputGain();
        connectOutput();
        ensureWorklet(options);

        state.analyserNodes = [];
        state.soundInputSplitters = [];

        const durationSeconds = Number.isFinite(options.durationSeconds) ? options.durationSeconds : 180;
        const totalSamples = Math.max(1, Math.floor(audioContext.sampleRate * durationSeconds));
        state.audioBuffer = audioContext.createBuffer(2, totalSamples, audioContext.sampleRate);

        for (const buffer of options.buffers) {
            if (buffer && buffer.Shader && buffer.Shader.uniforms && buffer.Shader.uniforms.iSampleRate) {
                buffer.Shader.uniforms.iSampleRate.value = audioContext.sampleRate;
            }
        }

        const precisionMode = resolvePrecision(options);
        reportPrecisionFallback(options, precisionMode);
        const blockSeconds = (512 * 512) / audioContext.sampleRate;
        setStatus(`Audio: ${precisionMode} @ ${audioContext.sampleRate} Hz, duration ${durationSeconds}s, block ${blockSeconds.toFixed(3)}s`);

        renderAllBlocks(options);
        state.ready = true;

        const shouldStart = state.started || (options.autoStart !== false && !options.paused);
        state.started = false;
        if (shouldStart) {
            if (audioContext.state !== 'running') {
                attachInitialStart();
            }
            else {
                root.audioOutput.start(0);
            }
        }
    };

    root.audioOutput.start = function (offsetSeconds, fromGesture) {
        if (!state.ready || !state.audioBuffer || !state.audioContext || !state.gainNode) {
            return;
        }

        const startAt = Number.isFinite(offsetSeconds) ? Math.max(0, offsetSeconds) : 0;
        const resumeAndStart = () => {
            root.audioOutput.stop();

            const source = state.audioContext.createBufferSource();
            source.buffer = state.audioBuffer;
            source.connect(state.gainNode);
            if (state.soundInputSplitters && state.soundInputSplitters.length) {
                for (const splitter of state.soundInputSplitters) {
                    try {
                        source.connect(splitter);
                    } catch {
                        // ignore
                    }
                }
            } else if (state.analyserNodes.length) {
                for (const analyser of state.analyserNodes) {
                    try {
                        source.connect(analyser);
                    } catch {
                        // ignore
                    }
                }
            }
            state.sourceNode = source;

            state.audioContext.resume().then(() => {
                source.start(0, startAt);
                state.started = true;
                if (state.statusMessage && state.statusMessage.indexOf('Audio output is blocked') >= 0) {
                    const precisionMode = resolvePrecision(state.options);
                    const blockSeconds = (512 * 512) / state.audioContext.sampleRate;
                    const durationSeconds = Number.isFinite(state.options.durationSeconds) ? state.options.durationSeconds : 180;
                    setStatus(`Audio: ${precisionMode} @ ${state.audioContext.sampleRate} Hz, duration ${durationSeconds}s, block ${blockSeconds.toFixed(3)}s`);
                }
            }).catch(() => {
                setStatus('Audio output is blocked (due to WebAudio autoplay gesture policy) until you provide a user action to the GLSL-preview.');
            });
        };

        if (fromGesture) {
            resumeAndStart();
            return;
        }

        if (state.audioContext.state !== 'running') {
            scheduleGestureStart(startAt, resumeAndStart);
            return;
        }

        resumeAndStart();
    };

    root.audioOutput.stop = function () {
        if (state.sourceNode) {
            try {
                state.sourceNode.stop();
            } catch {
                // ignore
            }
            state.sourceNode.disconnect();
            state.sourceNode = null;
        }
        state.started = false;
    };

    root.audioOutput.pause = function () {
        if (state.audioContext && typeof state.audioContext.suspend === 'function') {
            state.audioContext.suspend();
        }
    };

    root.audioOutput.resume = function () {
        if (!state.ready || !state.audioContext) {
            return;
        }
        if (!state.started) {
            root.audioOutput.start(0, true);
            return;
        }
        if (typeof state.audioContext.resume === 'function') {
            state.audioContext.resume();
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
