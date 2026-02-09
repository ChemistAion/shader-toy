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
        sourceNode: null,
        stream: {
            active: false,
            nextBlock: 0,
            blockSamples: 0,
            renderedBlocks: 0,
            lastNeed: 0
        },
        sampleRing: new Map(),
        sampleRingDepth: 4,
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
        pendingWorkletStartAt: null,
        gestureHandlerAttached: false,
        started: false,
        autoplayNotified: false,
        workletStats: {
            queueFrames: 0,
            underruns: 0
        }
    };

    const DEFAULT_BLOCK_DIM = 256;
    const MIN_POOL_COUNT = 8;
    const TARGET_POOL_SECONDS = 0.5;

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
            if (message.type === 'recycle' && message.buffer && state.bufferPool) {
                try {
                    const poolBytes = state.bufferPool.blockBytes || 0;
                    if (poolBytes > 0 && message.buffer.byteLength === poolBytes) {
                        state.bufferPool.free.push(message.buffer);
                    }
                } catch {
                    // ignore
                }
            }
            if (message.type === 'analysis') {
                state.analysis.rmsL = Number.isFinite(message.rmsL) ? message.rmsL : 0;
                state.analysis.rmsR = Number.isFinite(message.rmsR) ? message.rmsR : 0;
                if (Number.isFinite(message.windowSize)) {
                    state.analysis.windowSize = message.windowSize;
                }
            }
            if (message.type === 'stats') {
                if (Number.isFinite(message.queueFrames)) {
                    state.workletStats.queueFrames = Math.max(0, Math.floor(message.queueFrames));
                }
                if (Number.isFinite(message.underruns)) {
                    state.workletStats.underruns = Math.max(0, Math.floor(message.underruns));
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
        const width = state.sampleRingBlockWidth || 0;
        const height = state.sampleRingBlockHeight || 0;
        return width * height;
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
            if (state.audioContext && state.audioContext.state !== 'running') {
                return;
            }
            state.workletFailed = true;
            return;
        }
        const url = options && options.audioWorkletUrl ? String(options.audioWorkletUrl) : '';
        if (!url) {
            state.workletFailed = true;
            return;
        }
        state.workletLoading = true;
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
            } catch {
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
            } catch {
                state.workletFailed = true;
                state.workletLoading = false;
                return;
            }

            state.workletReady = true;
            state.workletLoading = false;
            setupWorkletPort();
            connectOutput();
            if (Number.isFinite(state.pendingWorkletStartAt)) {
                const startAt = state.pendingWorkletStartAt;
                state.pendingWorkletStartAt = null;
                root.audioOutput.start(startAt, true);
            }
        }).catch(() => {
            state.workletFailed = true;
            state.workletLoading = false;
        });
    };

    const setStatus = function (message) {
        state.statusMessage = message;
        state.statusLine = message;
    };

    const setStats = function (message) {
        state.statsLine = message;
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
        const autoplayMessage = 'Audio output is blocked (due to WebAudio autoplay gesture policy) until you provide a user action to the GLSL-preview.';
        setStatus(autoplayMessage);
    };

    const scheduleGestureStart = function (startAt, resumeAndStart) {
        state.pendingStartAt = startAt;
        attachGestureResume(() => {
            const pending = state.pendingStartAt;
            state.pendingStartAt = null;
            resumeAndStart(pending ?? 0);
        });
        const autoplayMessage = 'Audio output is blocked (due to WebAudio autoplay gesture policy) until you provide a user action to the GLSL-preview.';
        setStatus(autoplayMessage);
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

    const resolvePrecision = function (options) {
        const requested = options && options.precision ? String(options.precision) : '32bFLOAT';
        if (requested === '32bFLOAT' || requested === '16bFLOAT' || requested === '16bPACK' || requested === '8bPACK') {
            return requested;
        }
        return '32bFLOAT';
    };

    const resolvePrecisionForBuffer = function (options, buffer) {
        if (buffer && buffer.SoundPrecision) {
            return resolvePrecision(Object.assign({}, options, { precision: buffer.SoundPrecision }));
        }
        return resolvePrecision(options);
    };

    const getPrecisionSummary = function (options, soundBuffers) {
        const precision = resolvePrecision(options);
        if (!soundBuffers || !soundBuffers.length) {
            return precision;
        }
        const unique = new Set();
        for (const buffer of soundBuffers) {
            unique.add(resolvePrecisionForBuffer(options, buffer));
        }
        return Array.from(unique).join(', ');
    };

    const resolveAudioContext = function (audioContext) {
        if (audioContext && typeof audioContext.sampleRate === 'number') {
            return audioContext;
        }
        if (state.audioContext && typeof state.audioContext.sampleRate === 'number') {
            return state.audioContext;
        }
        return null;
    };

    const ensureAnalysisGain = function () {
        if (!state.audioContext) {
            return null;
        }
        if (!state.analysisGain) {
            try {
                state.analysisGain = state.audioContext.createGain();
                state.analysisGain.gain.value = 0;
            } catch {
                return null;
            }
        }
        return state.analysisGain;
    };

    root.audioOutput.createSoundInput = function (fftSize, soundIndex) {
        if (!state.audioContext) {
            return null;
        }
        const analyserLeft = state.audioContext.createAnalyser();
        const analyserRight = state.audioContext.createAnalyser();
        const size = Math.max(256, Math.floor(Number(fftSize) || 0));
        analyserLeft.fftSize = size;
        analyserRight.fftSize = size;

        const dataSize = Math.max(analyserLeft.fftSize, analyserLeft.frequencyBinCount);
        const dataArray = new Uint8Array(dataSize * 2 * 4);
        const freqLeft = new Uint8Array(analyserLeft.frequencyBinCount);
        const freqRight = new Uint8Array(analyserRight.frequencyBinCount);
        const timeLeft = new Uint8Array(analyserLeft.fftSize);
        const timeRight = new Uint8Array(analyserRight.fftSize);

        const texture = new global.THREE.DataTexture(dataArray, dataSize, 2, global.THREE.RGBAFormat, global.THREE.UnsignedByteType);
        texture.magFilter = global.THREE.LinearFilter;
        texture.needsUpdate = true;

        const splitter = state.audioContext.createChannelSplitter(2);
        const analysisSource = getAnalysisSource();
        if (analysisSource) {
            try {
                analysisSource.connect(splitter);
            } catch {
                // ignore
            }
        }
        try {
            splitter.connect(analyserLeft, 0);
            splitter.connect(analyserRight, 1);
        } catch {
            // ignore
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
        const blockSamples = blockWidth * blockHeight;
        const data = ring.data;

        if (blockSamples <= 0) {
            return;
        }

        for (let j = 0; j < left.length; j++) {
            const absoluteSample = blockStartSample + j;
            const ringBlockIndex = Math.floor(absoluteSample / blockSamples);
            const blockOffset = absoluteSample - (ringBlockIndex * blockSamples);
            const ringSlot = Math.max(0, ringBlockIndex) % ring.ringDepth;
            const rowOffset = ringSlot * ring.blockHeight;
            const x = blockOffset % blockWidth;
            const y = Math.floor(blockOffset / blockWidth);
            if (y >= blockHeight) {
                continue;
            }
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

    const buildSoundMaterial = function (soundBuffer, options, sampleRate, precisionMode, width, height) {
        if (!global.THREE || !soundBuffer || !options) {
            return null;
        }
        const shaderElement = global.document ? global.document.getElementById(soundBuffer.Name) : null;
        if (!shaderElement || !shaderElement.textContent) {
            return null;
        }
        const source = shaderElement.textContent;
        const prepareFragmentShader = options.prepareFragmentShader;
        const glslUseVersion3 = !!options.glslUseVersion3;
        const fragmentShader = prepareFragmentShader ? prepareFragmentShader(source, glslUseVersion3) : source;

        const uniforms = {
            iResolution: { type: 'v3', value: new global.THREE.Vector3(width, height, 1) },
            iTime: { type: 'f', value: 0.0 },
            iTimeDelta: { type: 'f', value: 0.0 },
            iFrame: { type: 'i', value: 0 },
            iDate: { type: 'v4', value: new global.THREE.Vector4() },
            iChannelResolution: { type: 'v3v', value: Array(10).fill(new global.THREE.Vector3(0, 0, 0)) },
            iMouse: { type: 'v4', value: new global.THREE.Vector4() },
            iMouseButton: { type: 'v2', value: new global.THREE.Vector4() },
            iViewMatrix: { type: 'm44', value: new global.THREE.Matrix4() },
            iSampleRate: { type: 'f', value: sampleRate },
            iAudioTime: { type: 'f', value: 0.0 },
            iSampleBlockSize: { type: 'i', value: width * height },
            iSampleRingBlockSize: { type: 'i', value: (state.sampleRingBlockWidth || 0) * (state.sampleRingBlockHeight || 0) },
            iSampleRingDepth: { type: 'i', value: state.sampleRingDepth || 0 },
            iSoundIndex: { type: 'i', value: -1 },
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
            iChannel0: { type: 't' },
            iChannel1: { type: 't' },
            iChannel2: { type: 't' },
            iChannel3: { type: 't' },
            iChannel4: { type: 't' },
            iChannel5: { type: 't' },
            iChannel6: { type: 't' },
            iChannel7: { type: 't' },
            iChannel8: { type: 't' },
            iChannel9: { type: 't' }
        };

        return new global.THREE.ShaderMaterial({
            glslVersion: glslUseVersion3 ? global.THREE.GLSL3 : global.THREE.GLSL1,
            fragmentShader,
            depthWrite: false,
            depthTest: false,
            uniforms
        });
    };

    const getRenderContext = function (options, precisionMode, soundBuffer) {
        const renderer = options.renderer;
        if (!renderer || !soundBuffer || !state.audioContext) {
            return null;
        }

        const WIDTH = state.renderBlockWidth || DEFAULT_BLOCK_DIM;
        const HEIGHT = state.renderBlockHeight || DEFAULT_BLOCK_DIM;
        const samplesPerBlock = WIDTH * HEIGHT;

        const existing = state.renderContexts.get(soundBuffer.Name);
        if (existing) {
            if (existing.renderer === renderer && existing.precisionMode === precisionMode
                && existing.width === WIDTH && existing.height === HEIGHT) {
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

        const material = buildSoundMaterial(soundBuffer, options, state.audioContext.sampleRate, precisionMode, WIDTH, HEIGHT);
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
        return ctx;
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
            for (let i = 0; i < 10; i++) {
                const uniformName = `iSampleRing${i}`;
                if (ctx.material.uniforms[uniformName]) {
                    ctx.material.uniforms[uniformName].value = root.audioOutput.getSampleRingTexture(i);
                }
            }
        }

        const renderer = ctx.renderer;
        const previousTarget = renderer.getRenderTarget();
        ctx.material.uniforms.iAudioTime.value = startSample / state.audioContext.sampleRate;
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
        return { left, right, startSample };
    };

    const resetStreaming = function () {
        state.stream.active = false;
        state.stream.nextBlock = 0;
        state.stream.renderedBlocks = 0;
        state.stream.lastNeed = 0;
        state.statsLine = undefined;
        state.outputPrimed = false;
        resetBufferPool();
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

    const ensureBufferPool = function (blockSamples) {
        if (!Number.isFinite(blockSamples) || blockSamples <= 0) {
            return;
        }
        const blockBytes = blockSamples * 2 * 4;
        if (state.bufferPool && state.bufferPool.blockBytes === blockBytes) {
            return;
        }
        const blockSeconds = state.audioContext ? (blockSamples / state.audioContext.sampleRate) : 0.01;
        const targetCount = Math.max(MIN_POOL_COUNT, Math.ceil(TARGET_POOL_SECONDS / blockSeconds));
        const free = [];
        for (let i = 0; i < targetCount; i++) {
            free.push(new ArrayBuffer(blockBytes));
        }
        state.bufferPool = { blockBytes, total: targetCount, free };
    };

    const resetBufferPool = function () {
        state.bufferPool = null;
    };

    const requestBlocks = function (count, baseSample) {
        if (!state.stream.active || !state.workletNode || !state.audioContext) {
            return;
        }
        const options = state.options || {};
        const soundBuffers = state.soundBuffers || [];
        const mixGain = soundBuffers.length > 0 ? 1 / soundBuffers.length : 1;
        const blockSamples = state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM);
        ensureBufferPool(blockSamples);
        const pool = state.bufferPool;
        const blocks = Math.max(0, Math.floor(count || 0));
        const startSample = Number.isFinite(baseSample)
            ? Math.max(0, Math.floor(baseSample))
            : (state.stream.nextBlock * blockSamples);
        state.stream.lastNeed = blocks;

        for (let i = 0; i < blocks; i++) {
            const buffer = pool && pool.free.length ? pool.free.pop() : null;
            const expectedBytes = blockSamples * 2 * 4;
            if (!buffer || buffer.byteLength < expectedBytes) {
                if (buffer && pool) {
                    pool.total = Math.max(0, pool.total - 1);
                }
                break;
            }
            const mixedLeft = new Float32Array(buffer, 0, blockSamples);
            const mixedRight = new Float32Array(buffer, blockSamples * 4, blockSamples);
            mixedLeft.fill(0);
            mixedRight.fill(0);
            const blockStartSample = startSample + (i * blockSamples);
            const blockIndex = Math.floor(blockStartSample / blockSamples);

            for (const soundBuffer of soundBuffers) {
                const precisionMode = resolvePrecisionForBuffer(options, soundBuffer);
                const block = renderSoundBlock(blockIndex, options, precisionMode, soundBuffer, blockStartSample);
                if (!block) {
                    continue;
                }
                for (let j = 0; j < block.left.length; j++) {
                    mixedLeft[j] += block.left[j] * mixGain;
                    mixedRight[j] += block.right[j] * mixGain;
                }
            }

            state.stream.nextBlock = blockIndex + 1;
            state.stream.renderedBlocks += 1;
            try {
                state.workletNode.port.postMessage(
                    { type: 'push', buffer, frames: blockSamples, baseSample: blockStartSample, layout: 'planarLR' },
                    [buffer]
                );
            } catch {
                // ignore
            }
            if (!state.outputPrimed) {
                state.outputPrimed = true;
                applyOutputGain();
            }
        }
    };

    const requestBlocksFromNeed = function (wantBaseSample, framesWanted) {
        const blockSamples = state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM);
        if (!Number.isFinite(framesWanted) || framesWanted <= 0 || blockSamples <= 0) {
            return;
        }
        const blocks = Math.max(0, Math.ceil(framesWanted / blockSamples));
        requestBlocks(blocks, wantBaseSample);
    };

    const applyRenderBlockSize = function (options) {
        const blockSize = Math.max(1, Math.floor(Number(options.blockSize) || 0));
        const blockWidth = Math.max(1, Math.floor(Math.sqrt(blockSize)));
        const blockHeight = Math.max(1, Math.ceil(blockSize / blockWidth));
        state.renderBlockWidth = blockWidth;
        state.renderBlockHeight = blockHeight;
        state.stream.blockSamples = blockWidth * blockHeight;
    };

    const applyOutputGain = function () {
        if (!state.gainNode) {
            return;
        }
        const gainValue = state.outputGain || 0;
        try {
            state.gainNode.gain.value = gainValue;
        } catch {
            // ignore
        }
    };

    root.audioOutput.initFromGlobals = function (options) {
        root.audioOutput.init(options);

        if (!options || !options.buffers || !global.THREE) {
            return;
        }

        if (!options.glslUseVersion3) {
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

        for (const buffer of options.buffers) {
            if (buffer && buffer.Shader && buffer.Shader.uniforms && buffer.Shader.uniforms.iSampleRate) {
                buffer.Shader.uniforms.iSampleRate.value = audioContext.sampleRate;
            }
        }

        const precisionSummary = getPrecisionSummary(options, soundBuffers);
        const blockSeconds = (state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM)) / audioContext.sampleRate;
        setStatus(`Audio: ${precisionSummary} @ ${audioContext.sampleRate} Hz, block ${blockSeconds.toFixed(3)}s`);
        resetSampleRings();

        if (state.workletFailed) {
            state.ready = false;
            setStats('Worklet: unavailable (no audio)');
            return;
        }

        resetStreaming();
        if (!state.workletReady) {
            setStats('Worklet: loading');
        } else {
            setStats('Worklet: streaming enabled');
        }
        state.ready = true;
        state.started = false;
        state.outputPrimed = false;

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

        for (const buffer of options.buffers) {
            if (buffer && buffer.Shader && buffer.Shader.uniforms && buffer.Shader.uniforms.iSampleRate) {
                buffer.Shader.uniforms.iSampleRate.value = audioContext.sampleRate;
            }
        }

        const precisionSummary = getPrecisionSummary(options, soundBuffers);
        const blockSeconds = (state.stream.blockSamples || (DEFAULT_BLOCK_DIM * DEFAULT_BLOCK_DIM)) / audioContext.sampleRate;
        setStatus(`Audio: ${precisionSummary} @ ${audioContext.sampleRate} Hz, block ${blockSeconds.toFixed(3)}s`);
        resetSampleRings();

        if (!state.workletReady || state.workletFailed) {
            state.ready = false;
            setStats('Worklet: unavailable (no audio)');
            return;
        }

        resetStreaming();
        setStats('Worklet: streaming enabled');
        state.ready = true;
        state.outputPrimed = false;

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
        if (!state.ready || !state.audioContext || !state.gainNode) {
            return;
        }

        const startAt = Number.isFinite(offsetSeconds) ? Math.max(0, offsetSeconds) : 0;
        if (!state.workletReady || !state.workletNode) {
            state.pendingWorkletStartAt = startAt;
            ensureWorklet(state.options || {});
            return;
        }
        const useWorklet = state.workletReady && state.workletNode;

        const resumeAndStart = () => {
            root.audioOutput.stop();

            if (useWorklet) {
                resetStreaming();
                state.stream.active = true;
                state.stream.nextBlock = Math.floor(startAt * state.audioContext.sampleRate / state.stream.blockSamples);
                const initialBlocks = Math.max(4, Math.ceil(0.25 * state.audioContext.sampleRate / (state.stream.blockSamples || 1)));
                requestBlocks(initialBlocks);
                state.sourceNode = null;
                setTransportStart(startAt);

                state.audioContext.resume().then(() => {
                    state.started = true;
                }).catch(() => {
                    const autoplayMessage = 'Audio output is blocked (due to WebAudio autoplay gesture policy) until you provide a user action to the GLSL-preview.';
                    setStatus(autoplayMessage);
                });
                return;
            }
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
            root.audioOutput.start(0, true);
            return;
        }
        if (typeof state.audioContext.resume === 'function') {
            state.audioContext.resume();
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
