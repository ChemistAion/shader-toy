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
        outputPrimed: false,
        workletNode: null,
        workletReady: false,
        workletLoading: false,
        workletFailed: false,
        workletPortReady: false,
        outputUsesWorklet: false,
        audioBuffer: null,
        sourceNode: null,
        stream: {
            active: false,
            nextBlock: 0,
            blockSamples: 256 * 256,
            renderedBlocks: 0,
            lastNeed: 0
        },
        renderBlockWidth: 256,
        renderBlockHeight: 256,
        sampleRing: new Map(),
        sampleRingDepth: 16,
        sampleRingBlockWidth: 64,
        sampleRingBlockHeight: 64,
        analysis: {
            enabled: true,
            windowSize: 2048,
            rmsL: 0,
            rmsR: 0
        },
        transportStartTime: null,
        transportStartContextTime: null,
        renderContexts: new Map(),
        analysisGain: null,
        analyserNodes: [],
        soundBuffer: null,
        soundBuffers: [],
        precisionDetails: null,
        debugDetails: [],
        ready: false,
        pendingStartAt: null,
        gestureHandlerAttached: false,
        gestureGranted: false,
        started: false,
        autoplayNotified: false
    };

    const DEFAULT_BLOCK_DIM = 256;

    root.audioOutput.state = state;

    root.audioOutput.init = function (options) {
        state.initialized = true;
        state.options = options || {};
        state.outputPrimed = false;
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

    const getAnalysisSource = function () {
        if (state.outputUsesWorklet && state.workletNode) {
            return state.workletNode;
        }
        return state.sourceNode;
    };

    const reconnectAnalysisInputs = function () {
        if (!state.soundInputSplitters || state.soundInputSplitters.length === 0) {
            return;
        }
        const source = getAnalysisSource();
        if (!source) {
            return;
        }
        for (const splitter of state.soundInputSplitters) {
            try {
                source.disconnect(splitter);
            } catch {
                // ignore
            }
            try {
                source.connect(splitter);
            } catch {
                // ignore
            }
        }
    };

    const rebuildAnalysisFromGlobals = function () {
        if (!global.ShaderToy || !Array.isArray(global.ShaderToy.audios)) {
            return;
        }
        if (!state.audioContext) {
            return;
        }
        const analysisGain = ensureAnalysisGain();
        const audios = global.ShaderToy.audios;
        for (const audio of audios) {
            const analyserLeft = audio && (audio.AnalyserLeft || audio.Analyser);
            const analyserRight = audio && (audio.AnalyserRight || audio.Analyser);
            if (!analyserLeft || !analyserRight) {
                continue;
            }

            const splitter = state.audioContext.createChannelSplitter(2);
            try {
                splitter.connect(analyserLeft, 0);
                splitter.connect(analyserRight, 1);
            } catch {
                // ignore
            }
            if (analysisGain) {
                try {
                    analyserLeft.connect(analysisGain);
                    analyserRight.connect(analysisGain);
                } catch {
                    // ignore
                }
            }
            state.analyserNodes.push(analyserLeft, analyserRight);
            state.soundInputSplitters = state.soundInputSplitters || [];
            state.soundInputSplitters.push(splitter);
        }
        reconnectAnalysisInputs();
    };

    const connectOutput = function () {
        if (!state.audioContext || !state.gainNode) {
            return;
        }
        disconnectSafe(state.gainNode);
        if (state.workletNode && state.workletReady) {
            disconnectSafe(state.workletNode);
            try {
                state.workletNode.connect(state.gainNode);
                state.gainNode.connect(state.audioContext.destination);
                state.outputUsesWorklet = true;
                reconnectAnalysisInputs();
                return;
            } catch {
                // fall back
            }
        }
        try {
            state.gainNode.connect(state.audioContext.destination);
            state.outputUsesWorklet = false;
            reconnectAnalysisInputs();
        } catch {
            // ignore
        }
    };

    const setupWorkletPort = function () {
        if (!state.workletNode || state.workletPortReady) {
            return;
        }
        state.workletNode.port.onmessage = (event) => {
            const message = event && event.data ? event.data : {};
            if (message.type === 'need') {
                const wantBaseSample = Number(message.wantBaseSample);
                const framesWanted = Number(message.framesWanted);
                if (Number.isFinite(wantBaseSample)) {
                    requestBlocksFromNeed(wantBaseSample, framesWanted);
                } else {
                    const count = Math.max(0, Math.floor(message.count || 0));
                    requestBlocks(count);
                }
            }
            if (message.type === 'analysis') {
                state.analysis.rmsL = Number.isFinite(message.rmsL) ? message.rmsL : 0;
                state.analysis.rmsR = Number.isFinite(message.rmsR) ? message.rmsR : 0;
                if (Number.isFinite(message.windowSize)) {
                    state.analysis.windowSize = message.windowSize;
                }
            }
        };
        state.workletPortReady = true;
        try {
            state.workletNode.port.postMessage({
                type: 'analysis',
                enabled: state.analysis.enabled,
                windowSize: state.analysis.windowSize
            });
            sendWorkletInit();
        } catch {
            // ignore
        }
    };

    const sendWorkletInit = function () {
        if (!state.workletNode || !state.workletPortReady || !state.audioContext) {
            return;
        }
        try {
            state.workletNode.port.postMessage({
                type: 'init',
                sampleRate: state.audioContext.sampleRate,
                channels: 2,
                quantum: 128,
                blockSize: state.stream.blockSamples
            });
        } catch {
            // ignore
        }
    };

    const setTransportStart = function (startAtSeconds) {
        if (!state.audioContext) {
            return;
        }
        state.transportStartTime = Number.isFinite(startAtSeconds) ? startAtSeconds : 0;
        state.transportStartContextTime = state.audioContext.currentTime;
    };

    root.audioOutput.getAudioTime = function () {
        if (!state.audioContext || !state.started) {
            return null;
        }
        if (!Number.isFinite(state.transportStartTime) || !Number.isFinite(state.transportStartContextTime)) {
            return null;
        }
        const now = state.audioContext.currentTime;
        return state.transportStartTime + Math.max(0, now - state.transportStartContextTime);
    };

    root.audioOutput.getSampleBlockSize = function () {
        return state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM);
    };

    root.audioOutput.getSampleRingBlockSize = function () {
        const blockWidth = state.sampleRingBlockWidth || 0;
        const blockHeight = state.sampleRingBlockHeight || 0;
        return (blockWidth > 0 && blockHeight > 0)
            ? (blockWidth * blockHeight)
            : 0;
    };

    root.audioOutput.getSampleRingDepth = function () {
        return state.sampleRingDepth || 0;
    };

    root.audioOutput.getSampleRingTexture = function (soundIndex) {
        const bufferName = getSoundBufferNameByIndex(soundIndex);
        if (!bufferName) {
            return null;
        }
        const ring = state.sampleRing.get(bufferName);
        return ring && ring.texture ? ring.texture : null;
    };

    const getSoundBufferNameByIndex = function (soundIndex) {
        const soundBuffers = state.soundBuffers || [];
        for (const buffer of soundBuffers) {
            const indices = buffer && buffer.SoundIndices ? buffer.SoundIndices : [];
            if (indices && indices.indexOf(soundIndex) >= 0) {
                return buffer.Name;
            }
        }
        return null;
    };

    root.audioOutput.getSampleFromRing = function (soundIndex, sampleIndex) {
        if (!Number.isFinite(sampleIndex) || sampleIndex < 0) {
            return [0, 0];
        }
        const bufferName = getSoundBufferNameByIndex(soundIndex);
        if (!bufferName) {
            return [0, 0];
        }
        const ring = state.sampleRing.get(bufferName);
        if (!ring || !ring.data) {
            return [0, 0];
        }

        const blockSamples = ring.blockWidth * ring.blockHeight;
        if (blockSamples <= 0) {
            return [0, 0];
        }

        const blockIndex = Math.floor(sampleIndex / blockSamples);
        const offset = sampleIndex - blockIndex * blockSamples;
        if (offset < 0) {
            return [0, 0];
        }

        const ringSlot = blockIndex % ring.ringDepth;
        const rowOffset = ringSlot * ring.blockHeight;
        const x = offset % ring.blockWidth;
        const y = Math.floor(offset / ring.blockWidth);
        if (y >= ring.blockHeight) {
            return [0, 0];
        }
        const idx = ((rowOffset + y) * ring.width + x) * 4;
        return [ring.data[idx] || 0, ring.data[idx + 1] || 0];
    };

    const ensureWorklet = function (options) {
        if (state.workletReady || state.workletFailed || state.workletLoading) {
            return;
        }
        if (!state.audioContext || !state.audioContext.audioWorklet) {
            if (state.audioContext && !state.audioContext.audioWorklet) {
                try {
                    const AudioContextCtor = global.AudioContext || global.webkitAudioContext;
                    if (AudioContextCtor) {
                        state.audioContext = new AudioContextCtor();
                    }
                } catch {
                    // ignore
                }
            }
            if (!state.audioContext || !state.audioContext.audioWorklet) {
                state.workletFailed = true;
                setStats('Worklet: unavailable (no audioWorklet)');
                postErrorMessage('AudioWorklet is unavailable in this WebView. Audio output is disabled.');
                return;
            }
        }
        const url = options && options.audioWorkletUrl ? String(options.audioWorkletUrl) : '';
        if (!url) {
            state.workletFailed = true;
            setStats('Worklet: missing module URL');
            postErrorMessage('AudioWorklet module URL is missing. Audio output is disabled.');
            return;
        }
        state.workletLoading = true;
        setStats('Worklet: loading module');
        const loadModule = async () => {
            const inline = global.document ? global.document.getElementById('audio-worklet-source') : null;
            if (inline && inline.textContent) {
                const blob = new Blob([inline.textContent], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                try {
                    await state.audioContext.audioWorklet.addModule(blobUrl);
                    return;
                } finally {
                    URL.revokeObjectURL(blobUrl);
                }
            }

            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const code = await response.text();
                const blob = new Blob([code], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                try {
                    await state.audioContext.audioWorklet.addModule(blobUrl);
                } finally {
                    URL.revokeObjectURL(blobUrl);
                }
            } catch (e) {
                // Fall back to direct URL load.
                await state.audioContext.audioWorklet.addModule(url);
            }
        };

        loadModule().then(() => {
            try {
                state.workletNode = new global.AudioWorkletNode(state.audioContext, 'shadertoy-stream', {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [2],
                    channelCount: 2,
                    channelCountMode: 'explicit',
                    channelInterpretation: 'speakers'
                });
                state.workletReady = true;
                setStats('Worklet: ready');
                setupWorkletPort();
                if (state.options && state.options.autoStart !== false && !state.options.paused) {
                    if (state.audioContext.state !== 'running') {
                        attachInitialStart();
                    }
                    else {
                        root.audioOutput.start(0);
                    }
                }
            } catch {
                state.workletFailed = true;
                setStats('Worklet: failed to create node');
            }
        }).catch((err) => {
            state.workletFailed = true;
            postErrorMessage(`AudioWorklet failed to load: ${err && err.message ? err.message : String(err)}`);
            setStats('Worklet: module load failed');
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
        const precisionRaw = String(options.precision || '32bFLOAT');
        const precision = (precisionRaw === '32bFLOAT' || precisionRaw === '16bFLOAT' || precisionRaw === '16bPACK' || precisionRaw === '8bPACK')
            ? precisionRaw
            : '32bFLOAT';
        const gl = options.gl;
        const isWebGL2 = !!(options.glslUseVersion3 || (gl && (typeof global.WebGL2RenderingContext !== 'undefined') && (gl instanceof global.WebGL2RenderingContext)));

        const extColorFloat = gl ? gl.getExtension('EXT_color_buffer_float') : null;
        const extColorHalfFloat = gl ? gl.getExtension('EXT_color_buffer_half_float') : null;

        const supportsFloat = isWebGL2 && !!extColorFloat;
        const supportsHalfFloat = isWebGL2 && (!!extColorFloat || !!extColorHalfFloat);

        if (precision === '8bPACK') {
            return '8bPACK';
        }
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

    const applyRenderBlockSize = function (options) {
        const requestedRaw = options && Number.isFinite(options.blockSize) ? Math.floor(options.blockSize) : 0;
        let dim = DEFAULT_BLOCK_DIM;
        let blockSamples = dim * dim;

        if (requestedRaw > 0) {
            const rootDim = Math.floor(Math.sqrt(requestedRaw));
            if (rootDim * rootDim === requestedRaw) {
                dim = Math.max(1, rootDim);
                blockSamples = dim * dim;
                if (blockSamples % 128 !== 0) {
                    postInfoMessage(`Audio block size ${blockSamples} is not a multiple of 128; AudioWorklet may underrun.`);
                }
            } else {
                postInfoMessage(`Audio block size ${requestedRaw} must be a perfect square (e.g., 65536). Using ${blockSamples}.`);
            }
        }

        state.renderBlockWidth = dim;
        state.renderBlockHeight = dim;
        state.stream.blockSamples = blockSamples;
    };

    const getPrecisionSummary = function (options, soundBuffers) {
        const precisions = new Set();
        for (const soundBuffer of soundBuffers || []) {
            precisions.add(resolvePrecision(options));
        }
        if (precisions.size === 0) {
            return resolvePrecision(options);
        }
        if (precisions.size === 1) {
            return Array.from(precisions)[0];
        }
        return Array.from(precisions).join(',');
    };

    const reportPrecisionFallback = function (options, resolvedPrecision, label) {
        const requestedRaw = String(options.precision || '32bFLOAT');
        const requested = (requestedRaw === '32bFLOAT' || requestedRaw === '16bFLOAT' || requestedRaw === '16bPACK' || requestedRaw === '8bPACK')
            ? requestedRaw
            : '32bFLOAT';
        if (requested === resolvedPrecision) {
            state.precisionDetails = null;
            return;
        }
        const gl = options.gl;
        const isWebGL2 = !!(options.glslUseVersion3 || (gl && (typeof global.WebGL2RenderingContext !== 'undefined') && (gl instanceof global.WebGL2RenderingContext)));

        const hasExtColorFloat = !!(gl && gl.getExtension('EXT_color_buffer_float'));
        const hasExtColorHalfFloat = !!(gl && gl.getExtension('EXT_color_buffer_half_float'));

        const details = [
            `webgl2=${isWebGL2 ? 'yes' : 'no'}`,
            `EXT_color_buffer_float=${hasExtColorFloat ? 'yes' : 'no'}`,
            `EXT_color_buffer_half_float=${hasExtColorHalfFloat ? 'yes' : 'no'}`
        ].join(', ');
        const labelText = label ? ` (${label})` : '';
        state.precisionDetails = `Precision fallback${labelText}: ${requested} -> ${resolvedPrecision} (${details})`;
        postErrorMessage(`Audio precision${labelText} '${requested}' not supported; using '${resolvedPrecision}'. (${details})`);
        renderStatus();
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

        const samplesPerBlock = (state.renderBlockWidth || 256) * (state.renderBlockHeight || 256);
        const ringBlockSamples = (state.sampleRingBlockWidth || 0) * (state.sampleRingBlockHeight || 0);
        const renderBlockDim = state.renderBlockWidth || 256;

        const footer = (precisionMode === '16bPACK') ? `
    uniform float blockOffset;

    void main() {
    float sampleTime = blockOffset + ((gl_FragCoord.x - 0.5) + (gl_FragCoord.y - 0.5) * ${renderBlockDim}.0) / iSampleRate;
    float sampleIndex = (blockOffset * iSampleRate) + ((gl_FragCoord.x - 0.5) + (gl_FragCoord.y - 0.5) * ${renderBlockDim}.0);
    int sampleIndexInt = int(sampleIndex);
    vec2 y = mainSound(sampleIndexInt, sampleTime);
    vec2 v  = floor((0.5 + 0.5 * y) * 65536.0);
    vec2 vl = mod(v, 256.0) / 255.0;
    vec2 vh = floor(v / 256.0) / 255.0;
    GLSL_FRAGCOLOR = vec4(vl.x, vh.x, vl.y, vh.y);
}` : (precisionMode === '8bPACK') ? `
    uniform float blockOffset;

    void main() {
    float sampleTime = blockOffset + ((gl_FragCoord.x - 0.5) + (gl_FragCoord.y - 0.5) * ${renderBlockDim}.0) / iSampleRate;
    float sampleIndex = (blockOffset * iSampleRate) + ((gl_FragCoord.x - 0.5) + (gl_FragCoord.y - 0.5) * ${renderBlockDim}.0);
    int sampleIndexInt = int(sampleIndex);
    vec2 y = mainSound(sampleIndexInt, sampleTime);
    vec2 v  = floor((0.5 + 0.5 * y) * 255.0 + 0.5);
    vec2 vl = v / 255.0;
    GLSL_FRAGCOLOR = vec4(vl.x, vl.y, 0.0, 1.0);
}` : `
    uniform float blockOffset;

    void main() {
    float sampleTime = blockOffset + ((gl_FragCoord.x - 0.5) + (gl_FragCoord.y - 0.5) * ${renderBlockDim}.0) / iSampleRate;
    float sampleIndex = (blockOffset * iSampleRate) + ((gl_FragCoord.x - 0.5) + (gl_FragCoord.y - 0.5) * ${renderBlockDim}.0);
    int sampleIndexInt = int(sampleIndex);
    vec2 y = mainSound(sampleIndexInt, sampleTime);
    GLSL_FRAGCOLOR = vec4(y, 0.0, 1.0);
}`;

        const source = `${shaderElement.textContent}\n${footer}`;
        const prepared = options.prepareFragmentShader ? options.prepareFragmentShader(source, options.glslUseVersion3) : source;
        try {
            if (options.gl && root.shaderCompile && root.shaderCompile.compileFragShader) {
                const header = options.glslUseVersion3
                    ? '#version 300 es\nprecision highp float;\n'
                    : 'precision highp float;\n';
                const ok = root.shaderCompile.compileFragShader(options.gl, `${header}${prepared}`);
                if (!ok) {
                    postErrorMessage(`Sound shader "${buffer.Name}" failed to compile; audio stopped.`);
                    root.audioOutput.stop();
                    return null;
                }
            }
        } catch {
            // ignore compile probe errors
        }
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
                iAudioTime: { type: 'f', value: 0 },
                iSampleBlockSize: { type: 'i', value: samplesPerBlock },
                iSampleRingBlockSize: { type: 'i', value: ringBlockSamples || 0 },
                iSampleRingDepth: { type: 'i', value: state.sampleRingDepth || 0 },
                iSoundIndex: { type: 'i', value: 0 },
                iSampleRing0: { type: 't' },
                iSampleRing1: { type: 't' },
                iSampleRing2: { type: 't' },
                iSampleRing3: { type: 't' },
                iSampleRing4: { type: 't' },
                iSampleRing5: { type: 't' },
                iSampleRing6: { type: 't' },
                iSampleRing7: { type: 't' },
                iSampleRing8: { type: 't' },
                iSampleRing9: { type: 't' },
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
        state.gainNode.gain.value = (state.enabled && state.outputPrimed) ? state.outputGain : 0;
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

    root.audioOutput.createSoundInput = function (fftSize, soundIndex) {
        if (!state.audioContext || !state.soundBuffers || !state.soundBuffers.length || !global.THREE) {
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

        const analysisSource = getAnalysisSource();
        if (analysisSource) {
            try {
                analysisSource.connect(splitter);
            } catch {
                // ignore
            }
        }

        const soundInput = {
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
        return soundInput;
    };

    const renderStatus = function () {
        // Stats overlay intentionally disabled (kept only as stateful data).
    };

    const setStatus = function (message) {
        state.statusMessage = message;
        state.statusLine = message;
    };

    const setStats = function (message) {
        state.statsLine = message;
    };

    const getVscodeApi = function () {
        try {
            if (root.env && root.env.getVscodeApi) {
                const api = root.env.getVscodeApi();
                if (api) {
                    return api;
                }
            }
        } catch {
            // ignore
        }
        try {
            if (global.acquireVsCodeApi) {
                return global.acquireVsCodeApi();
            }
        } catch {
            // ignore
        }
        return global.vscode;
    };

    const postErrorMessage = function (message) {
        try {
            const vscode = getVscodeApi();
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

    const postInfoMessage = function (message) {
        try {
            const vscode = getVscodeApi();
            if (vscode && message) {
                vscode.postMessage({ command: 'infoMessage', message: message });
            }
        } catch {
            // ignore
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
        const markGesture = () => {
            state.gestureGranted = true;
        };

        attachGestureResume(markGesture);
        global.addEventListener('focus', markGesture, { once: true });
        const autoplayMessage = 'Audio output is blocked (due to WebAudio autoplay gesture policy) until you provide a user action to the GLSL-preview.';
        setStatus(autoplayMessage);
        if (!state.autoplayNotified) {
            state.autoplayNotified = true;
            postInfoMessage(autoplayMessage);
        }
    };

    const scheduleGestureStart = function (startAt) {
        state.pendingStartAt = startAt;
        attachGestureResume(() => {
            state.pendingStartAt = null;
            state.gestureGranted = true;
        });
        const autoplayMessage = 'Audio output is blocked (due to WebAudio autoplay gesture policy) until you provide a user action to the GLSL-preview.';
        setStatus(autoplayMessage);
        if (!state.autoplayNotified) {
            state.autoplayNotified = true;
            postInfoMessage(autoplayMessage);
        }
    };


    const disposeRenderContext = function (soundBufferName) {
        if (!state.renderContexts || state.renderContexts.size === 0) {
            return;
        }
        if (soundBufferName) {
            const ctx = state.renderContexts.get(soundBufferName);
            if (ctx) {
                try { ctx.target.dispose(); } catch { /* ignore */ }
                try { ctx.material.dispose(); } catch { /* ignore */ }
                try { ctx.mesh.geometry.dispose(); } catch { /* ignore */ }
                state.renderContexts.delete(soundBufferName);
            }
            return;
        }

        for (const [name, ctx] of state.renderContexts.entries()) {
            try { ctx.target.dispose(); } catch { /* ignore */ }
            try { ctx.material.dispose(); } catch { /* ignore */ }
            try { ctx.mesh.geometry.dispose(); } catch { /* ignore */ }
            state.renderContexts.delete(name);
        }
    };

    const getRenderContext = function (options, precisionMode, soundBuffer) {
        const renderer = options.renderer;
        if (!renderer || !soundBuffer || !state.audioContext) {
            return null;
        }

        const WIDTH = state.renderBlockWidth || 256;
        const HEIGHT = state.renderBlockHeight || 256;
        const samplesPerBlock = WIDTH * HEIGHT;

        const existing = state.renderContexts.get(soundBuffer.Name);
        if (existing) {
            if (existing.renderer === renderer && existing.precisionMode === precisionMode) {
                return existing;
            }
            disposeRenderContext(soundBuffer.Name);
        }

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
            target.dispose();
            return null;
        }

        const mesh = new global.THREE.Mesh(new global.THREE.PlaneGeometry(2, 2), material);
        scene.add(mesh);

        const pixels = (precisionMode === '16bPACK' || precisionMode === '8bPACK')
            ? new Uint8Array(WIDTH * HEIGHT * 4)
            : new Float32Array(WIDTH * HEIGHT * 4);

        const ctx = {
            renderer,
            soundBufferName: soundBuffer.Name,
            precisionMode,
            target,
            scene,
            camera,
            material,
            mesh,
            pixels,
            samplesPerBlock,
            width: WIDTH,
            height: HEIGHT
        };
        state.renderContexts.set(soundBuffer.Name, ctx);
        state.stream.blockSamples = samplesPerBlock;
        try {
            const typeName = (targetType === global.THREE.FloatType)
                ? 'FloatType'
                : (targetType === global.THREE.HalfFloatType)
                    ? 'HalfFloatType'
                    : 'UnsignedByteType';
            let textureTypeName = 'unknown';
            if (ctx.target && ctx.target.texture) {
                const texType = ctx.target.texture.type;
                if (texType === global.THREE.FloatType) {
                    textureTypeName = 'FloatType';
                } else if (texType === global.THREE.HalfFloatType) {
                    textureTypeName = 'HalfFloatType';
                } else if (texType === global.THREE.UnsignedByteType) {
                    textureTypeName = 'UnsignedByteType';
                } else {
                    textureTypeName = String(texType);
                }
            }
            const readbackType = (precisionMode === '16bPACK' || precisionMode === '8bPACK') ? 'Uint8Array' : 'Float32Array';
            const bytesPerComponent = (precisionMode === '32bFLOAT') ? 4 : (precisionMode === '16bFLOAT' ? 2 : 1);
            const targetBytes = WIDTH * HEIGHT * 4 * bytesPerComponent;
            const audioBlockBytes = samplesPerBlock * 2 * 4;
            state.debugDetails = [
                `RT: precision ${precisionMode}, targetType ${typeName}, texture.type ${textureTypeName}`,
                `Readback: ${readbackType}, RT bytes ${Math.round(targetBytes / 1024)} KB, block PCM bytes ${Math.round(audioBlockBytes / 1024)} KB`
            ];
            renderStatus();
        } catch {
            // ignore
        }
        return ctx;
    };

    const ensureSampleRing = function (soundBufferName) {
        if (!global.THREE || !soundBufferName) {
            return null;
        }
        const existing = state.sampleRing.get(soundBufferName);
        if (existing) {
            return existing;
        }

        const ringDepth = Math.max(1, Math.floor(state.sampleRingDepth || 4));
        const blockWidth = state.sampleRingBlockWidth || 64;
        const blockHeight = state.sampleRingBlockHeight || 64;
        const width = blockWidth;
        const height = blockHeight * ringDepth;
        const data = new Float32Array(width * height * 4);
        const texture = new global.THREE.DataTexture(data, width, height, global.THREE.RGBAFormat, global.THREE.FloatType);
        texture.magFilter = global.THREE.LinearFilter;
        texture.minFilter = global.THREE.LinearFilter;
        texture.needsUpdate = true;

        const ring = {
            name: soundBufferName,
            ringDepth,
            blockWidth,
            blockHeight,
            blockSamples: blockWidth * blockHeight,
            width,
            height,
            data,
            texture,
            writeIndex: 0
        };
        state.sampleRing.set(soundBufferName, ring);
        return ring;
    };

    const writeSampleRing = function (soundBufferName, blockStartSample, left, right) {
        const ring = ensureSampleRing(soundBufferName);
        if (!ring || !left || !right) {
            return;
        }
        const width = ring.width;
        const blockWidth = ring.blockWidth;
        const blockHeight = ring.blockHeight;
        const blockSamples = ring.blockSamples;
        const data = ring.data;

        for (let j = 0; j < left.length; j++) {
            const absoluteSample = blockStartSample + j;
            const ringBlockIndex = Math.floor(absoluteSample / blockSamples);
            const blockOffset = absoluteSample - (ringBlockIndex * blockSamples);
            const ringSlot = ringBlockIndex % ring.ringDepth;
            const x = blockOffset - (Math.floor(blockOffset / blockWidth) * blockWidth);
            const y = Math.floor(blockOffset / blockWidth);
            if (y >= blockHeight) {
                continue;
            }
            const rowOffset = ringSlot * blockHeight;
            const outY = rowOffset + y;
            const idx = (outY * width + x) * 4;
            data[idx + 0] = left[j];
            data[idx + 1] = right[j];
            data[idx + 2] = 0;
            data[idx + 3] = 1;
        }
        ring.writeIndex = Math.floor((blockStartSample + left.length - 1) / blockSamples);
        ring.texture.needsUpdate = true;
    };

    const renderSoundBlock = function (blockIndex, options, precisionMode, soundBuffer, blockStartSample) {
        const ctx = getRenderContext(options, precisionMode, soundBuffer);
        if (!ctx) {
            return null;
        }

        const startSample = Number.isFinite(blockStartSample)
            ? Math.max(0, Math.floor(blockStartSample))
            : (blockIndex * ctx.samplesPerBlock);

        if (ctx.material && ctx.material.uniforms) {
            const soundIndices = soundBuffer && soundBuffer.SoundIndices ? soundBuffer.SoundIndices : [];
            const soundIndexValue = soundIndices && soundIndices.length ? soundIndices[0] : 0;
            if (ctx.material.uniforms.iSoundIndex) {
                ctx.material.uniforms.iSoundIndex.value = soundIndexValue;
            }
            if (ctx.material.uniforms.iSampleBlockSize) {
                ctx.material.uniforms.iSampleBlockSize.value = ctx.samplesPerBlock;
            }
            if (ctx.material.uniforms.iSampleRingBlockSize) {
                const ringBlockSize = root.audioOutput.getSampleRingBlockSize();
                ctx.material.uniforms.iSampleRingBlockSize.value = ringBlockSize;
            }
            if (ctx.material.uniforms.iSampleRingDepth) {
                ctx.material.uniforms.iSampleRingDepth.value = state.sampleRingDepth || 0;
            }
            for (let i = 0; i < 10; i++) {
                const uniformName = `iSampleRing${i}`;
                if (ctx.material.uniforms[uniformName]) {
                    ctx.material.uniforms[uniformName].value = root.audioOutput.getSampleRingTexture(i);
                }
            }
        }

        const previousShader = global.currentShader;
        if (soundBuffer && soundBuffer.File) {
            global.currentShader = {
                Name: soundBuffer.Name,
                File: soundBuffer.File,
                LineOffset: soundBuffer.LineOffset
            };
        }

        const renderer = ctx.renderer;
        const previousTarget = renderer.getRenderTarget();
        ctx.material.uniforms.blockOffset.value = startSample / state.audioContext.sampleRate;
        if (ctx.material.uniforms.iAudioTime) {
            ctx.material.uniforms.iAudioTime.value = ctx.material.uniforms.blockOffset.value;
        }
        renderer.setRenderTarget(ctx.target);
        renderer.render(ctx.scene, ctx.camera);
        renderer.readRenderTargetPixels(ctx.target, 0, 0, ctx.width, ctx.height, ctx.pixels);
        renderer.setRenderTarget(previousTarget);

        const left = new Float32Array(ctx.samplesPerBlock);
        const right = new Float32Array(ctx.samplesPerBlock);

        if (precisionMode === '16bPACK') {
            for (let j = 0; j < ctx.samplesPerBlock; j++) {
                const pixelIndex = j * 4;
                left[j] = (ctx.pixels[pixelIndex + 0] + 256 * ctx.pixels[pixelIndex + 1]) / 65535 * 2 - 1;
                right[j] = (ctx.pixels[pixelIndex + 2] + 256 * ctx.pixels[pixelIndex + 3]) / 65535 * 2 - 1;
            }
        } else if (precisionMode === '8bPACK') {
            for (let j = 0; j < ctx.samplesPerBlock; j++) {
                const pixelIndex = j * 4;
                left[j] = (ctx.pixels[pixelIndex + 0] / 255) * 2 - 1;
                right[j] = (ctx.pixels[pixelIndex + 1] / 255) * 2 - 1;
            }
        } else {
            for (let j = 0; j < ctx.samplesPerBlock; j++) {
                const pixelIndex = j * 4;
                left[j] = Math.max(-1, Math.min(1, ctx.pixels[pixelIndex + 0]));
                right[j] = Math.max(-1, Math.min(1, ctx.pixels[pixelIndex + 1]));
            }
        }

        writeSampleRing(soundBuffer.Name, startSample, left, right);

        global.currentShader = previousShader;
        return { left, right, startSample };
    };

    const resetStreaming = function () {
        state.stream.active = false;
        state.stream.nextBlock = 0;
        state.stream.renderedBlocks = 0;
        state.stream.lastNeed = 0;
        state.statsLine = undefined;
        state.outputPrimed = false;
        renderStatus();
        if (state.workletNode) {
            try {
                state.workletNode.port.postMessage({ type: 'reset' });
            } catch {
                // ignore
            }
        }
    };

    const resetSampleRings = function () {
        if (!state.sampleRing || state.sampleRing.size === 0) {
            return;
        }
        for (const ring of state.sampleRing.values()) {
            if (ring && ring.data) {
                ring.data.fill(0);
            }
            if (ring && ring.texture) {
                ring.texture.needsUpdate = true;
            }
        }
    };

    const requestBlocks = function (count, baseSample) {
        if (!state.stream.active || !state.workletNode || !state.audioContext) {
            return;
        }
        const options = state.options || {};
        const soundBuffers = state.soundBuffers || [];
        const precisionSummary = getPrecisionSummary(options, soundBuffers);
        const mixGain = soundBuffers.length > 0 ? 1 / soundBuffers.length : 1;
        const blocks = Math.max(0, Math.floor(count || 0));
        const blockSamples = state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM);
        const startSample = Number.isFinite(baseSample)
            ? Math.max(0, Math.floor(baseSample))
            : (state.stream.nextBlock * blockSamples);
        state.stream.lastNeed = blocks;
        const blockSeconds = blockSamples / state.audioContext.sampleRate;
        for (let i = 0; i < blocks; i++) {
            let mixedLeft = null;
            let mixedRight = null;
            const blockStartSample = startSample + (i * blockSamples);
            const blockIndex = Math.floor(blockStartSample / blockSamples);

            for (const soundBuffer of soundBuffers) {
                const precisionMode = resolvePrecision(options);
                const block = renderSoundBlock(blockIndex, options, precisionMode, soundBuffer, blockStartSample);
                if (!block) {
                    continue;
                }
                if (!mixedLeft || !mixedRight) {
                    mixedLeft = new Float32Array(block.left.length);
                    mixedRight = new Float32Array(block.right.length);
                }
                for (let j = 0; j < block.left.length; j++) {
                    mixedLeft[j] += block.left[j] * mixGain;
                    mixedRight[j] += block.right[j] * mixGain;
                }
            }

            if (!mixedLeft || !mixedRight) {
                break;
            }

            state.stream.nextBlock = blockIndex + 1;
            state.stream.renderedBlocks += 1;
            try {
                state.workletNode.port.postMessage(
                    { type: 'push', left: mixedLeft.buffer, right: mixedRight.buffer, frames: blockSamples, baseSample: blockStartSample },
                    [mixedLeft.buffer, mixedRight.buffer]
                );
            } catch {
                // ignore
            }
            if (!state.outputPrimed) {
                state.outputPrimed = true;
                applyOutputGain();
            }
        }

        const workletState = state.workletFailed
            ? 'failed'
            : (state.workletReady ? 'ready' : (state.workletLoading ? 'loading' : 'idle'));
        setStats(`Streaming: block ${blockSeconds.toFixed(3)}s, rendered ${state.stream.renderedBlocks}, need ${state.stream.lastNeed}, sources ${soundBuffers.length}, precision ${precisionSummary}, worklet ${workletState}`);
    };

    const requestBlocksFromNeed = function (wantBaseSample, framesWanted) {
        const blockSamples = state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM);
        if (!Number.isFinite(framesWanted) || framesWanted <= 0 || blockSamples <= 0) {
            return;
        }
        const blocks = Math.max(0, Math.ceil(framesWanted / blockSamples));
        requestBlocks(blocks, wantBaseSample);
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

        applyRenderBlockSize(options);

        const soundBuffers = options.buffers.filter((buffer) => buffer && buffer.IsSound);
        if (!soundBuffers.length) {
            root.audioOutput.stop();
            state.soundBuffers = [];
            state.soundBuffer = null;
            state.ready = false;
            return;
        }
        soundBuffers.sort((a, b) => {
            const aIndex = a.SoundIndices && a.SoundIndices.length ? a.SoundIndices[0] : 0;
            const bIndex = b.SoundIndices && b.SoundIndices.length ? b.SoundIndices[0] : 0;
            return aIndex - bIndex;
        });
        state.soundBuffers = soundBuffers;
        state.soundBuffer = soundBuffers[0] || null;
        disposeRenderContext();
        state.sampleRing = new Map();
        for (const soundBuffer of soundBuffers) {
            if (soundBuffer && soundBuffer.Name) {
                ensureSampleRing(soundBuffer.Name);
            }
        }

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
        sendWorkletInit();

        rebuildAnalysisFromGlobals();

        const durationSeconds = Number.isFinite(options.durationSeconds) ? options.durationSeconds : 180;
        const totalSamples = Math.max(1, Math.floor(audioContext.sampleRate * durationSeconds));
        state.audioBuffer = audioContext.createBuffer(2, totalSamples, audioContext.sampleRate);

        for (const buffer of options.buffers) {
            if (buffer && buffer.Shader && buffer.Shader.uniforms && buffer.Shader.uniforms.iSampleRate) {
                buffer.Shader.uniforms.iSampleRate.value = audioContext.sampleRate;
            }
        }

        const precisionMode = resolvePrecision(options);
        const precisionSummary = getPrecisionSummary(options, soundBuffers);
        reportPrecisionFallback(options, precisionMode);
        
        const blockSeconds = (state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM)) / state.audioContext.sampleRate;
        setStatus(`Audio: ${precisionSummary} @ ${state.audioContext.sampleRate} Hz, duration ${durationSeconds}s, block ${blockSeconds.toFixed(3)}s`);
        resetSampleRings();

        if (state.workletFailed) {
            state.ready = false;
            setStats('Worklet: unavailable (no audio)');
            postErrorMessage('AudioWorklet is unavailable. Audio output is disabled.');
            return;
        }

        if (state.workletReady) {
            resetStreaming();
            setStats('Worklet: streaming enabled');
        } else {
            setStats('Worklet: loading module');
        }
        state.ready = true;
        state.started = false;
        state.outputPrimed = false;

        if (state.workletReady && options.autoStart !== false && !options.paused) {
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

        applyRenderBlockSize(options);

        const soundBuffers = options.buffers.filter((buffer) => buffer && buffer.IsSound);

        if (!soundBuffers.length) {
            state.soundBuffers = [];
            state.soundBuffer = null;
            state.ready = false;
            disposeRenderContext();
            root.audioOutput.stop();
            return;
        }
        soundBuffers.sort((a, b) => {
            const aIndex = a.SoundIndices && a.SoundIndices.length ? a.SoundIndices[0] : 0;
            const bIndex = b.SoundIndices && b.SoundIndices.length ? b.SoundIndices[0] : 0;
            return aIndex - bIndex;
        });
        state.soundBuffers = soundBuffers;
        state.soundBuffer = soundBuffers[0] || null;
        disposeRenderContext();
        state.sampleRing = new Map();
        for (const soundBuffer of soundBuffers) {
            if (soundBuffer && soundBuffer.Name) {
                ensureSampleRing(soundBuffer.Name);
            }
        }

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
        sendWorkletInit();

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
        const precisionSummary = getPrecisionSummary(options, soundBuffers);
        reportPrecisionFallback(options, precisionMode);

        const blockSeconds = (state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM)) / audioContext.sampleRate;
        setStatus(`Audio: ${precisionSummary} @ ${audioContext.sampleRate} Hz, duration ${durationSeconds}s, block ${blockSeconds.toFixed(3)}s`);
        resetSampleRings();

        if (state.workletFailed) {
            state.ready = false;
            setStats('Worklet: unavailable (no audio)');
            postErrorMessage('AudioWorklet is unavailable. Audio output is disabled.');
            return;
        }

        if (state.workletReady) {
            resetStreaming();
            setStats('Worklet: streaming enabled');
        } else {
            setStats('Worklet: loading module');
        }
        state.ready = true;
        state.outputPrimed = false;

        const shouldStart = state.started || (options.autoStart !== false && !options.paused);
        state.started = false;
        if (state.workletReady && shouldStart) {
            if (audioContext.state !== 'running') {
                attachInitialStart();
            }
            else {
                root.audioOutput.start(0);
            }
        }
    };

    root.audioOutput.start = function (offsetSeconds, fromGesture) {
        if (!state.ready || !state.audioContext || !state.gainNode) {
            return;
        }

        const startAt = Number.isFinite(offsetSeconds) ? Math.max(0, offsetSeconds) : 0;
        const useWorklet = state.workletReady && state.workletNode;

        const resumeAndStart = () => {
            root.audioOutput.stop();

            if (useWorklet) {
                resetStreaming();
                state.stream.active = true;
                state.stream.nextBlock = Math.floor(startAt * state.audioContext.sampleRate / state.stream.blockSamples);
                requestBlocks(4);
                state.sourceNode = null;
                setTransportStart(startAt);

                state.audioContext.resume().then(() => {
                    state.started = true;
                    if (state.statusMessage && state.statusMessage.indexOf('Audio output is blocked') >= 0) {
                        const precisionMode = getPrecisionSummary(state.options || {}, state.soundBuffers || []);
                        const blockSeconds = (state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM)) / state.audioContext.sampleRate;
                        const durationSeconds = Number.isFinite(state.options.durationSeconds) ? state.options.durationSeconds : 180;
                        setStatus(`Audio: ${precisionMode} @ ${state.audioContext.sampleRate} Hz, duration ${durationSeconds}s, block ${blockSeconds.toFixed(3)}s`);
                    }
                }).catch(() => {
                    const autoplayMessage = 'Audio output is blocked (due to WebAudio autoplay gesture policy) until you provide a user action to the GLSL-preview.';
                    setStatus(autoplayMessage);
                    if (!state.autoplayNotified) {
                        state.autoplayNotified = true;
                        postInfoMessage(autoplayMessage);
                    }
                });
                return;
            }

            if (!state.workletReady && !state.workletFailed) {
                return;
            }

            postErrorMessage('AudioWorklet is unavailable. Audio output is disabled.');
            return;
        };

        if (fromGesture) {
            return;
        }

        if (state.audioContext.state !== 'running') {
            if (state.gestureGranted) {
                resumeAndStart();
                return;
            }
            scheduleGestureStart(startAt);
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
        if (state.stream.active) {
            resetStreaming();
        }
        state.started = false;
        state.transportStartTime = null;
        state.transportStartContextTime = null;
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
            root.audioOutput.start(0, false);
            return;
        }
        if (typeof state.audioContext.resume === 'function') {
            state.audioContext.resume();
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
