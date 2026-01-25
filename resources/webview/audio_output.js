(function (global) {
    'use strict';

    const root = global.ShaderToy = global.ShaderToy || {};
    root.audioOutput = root.audioOutput || {};

    const state = {
        initialized: false,
        enabled: false,
        options: {},
        audioContext: null,
        gainNode: null,
        audioBuffer: null,
        sourceNode: null,
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

    const buildSoundMaterial = function (buffer, options, sampleRate) {
        if (!global.document || !global.document.getElementById) {
            return null;
        }
        const shaderElement = global.document.getElementById(buffer.Name);
        if (!shaderElement || !shaderElement.textContent) {
            postErrorMessage('mainSound shader source not found.');
            return null;
        }

        const footer = `
    uniform float blockOffset;

    void main() {
    float t = blockOffset + ((gl_FragCoord.x - 0.5) + (gl_FragCoord.y - 0.5) * 512.0) / iSampleRate;
    vec2 y = mainSound(t);
    vec2 v  = floor((0.5 + 0.5 * y) * 65536.0);
    vec2 vl = mod(v, 256.0) / 255.0;
    vec2 vh = floor(v / 256.0) / 255.0;
    GLSL_FRAGCOLOR = vec4(vl.x, vh.x, vl.y, vh.y);
}`;

        const source = `${shaderElement.textContent}\n${footer}`;
        const prepared = options.prepareFragmentShader ? options.prepareFragmentShader(source) : source;
        const materialOptions = {
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
        } else if (!options.glslUseVersion3 && global.THREE.GLSL1) {
            materialOptions.glslVersion = global.THREE.GLSL1;
        }
        return new global.THREE.ShaderMaterial(materialOptions);
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

    const postErrorMessage = function (message) {
        try {
            const vscode = root.env && root.env.getVscodeApi ? root.env.getVscodeApi() : undefined;
            if (vscode && message) {
                vscode.postMessage({ command: 'errorMessage', message: message });
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
        const startIfNeeded = () => {
            if (!state.started) {
                root.audioOutput.start(0, true);
            }
        };

        attachGestureResume(startIfNeeded);
        global.addEventListener('focus', startIfNeeded, { once: true });
        postErrorMessage('Audio output is blocked until you click inside the preview.');
    };

    const scheduleGestureStart = function (startAt, resumeAndStart) {
        state.pendingStartAt = startAt;
        attachGestureResume(() => {
            const pending = state.pendingStartAt;
            state.pendingStartAt = null;
            resumeAndStart(pending ?? 0);
        });
        postErrorMessage('Audio output is blocked until you click inside the preview.');
    };

    const renderAllBlocks = function (options) {
        const renderer = options.renderer;
        const soundBuffer = state.soundBuffer;
        if (!renderer || !soundBuffer || !state.audioBuffer || !state.audioContext) {
            return;
        }

        const WIDTH = 512;
        const HEIGHT = 512;
        const samplesPerBlock = WIDTH * HEIGHT;
        const totalSamples = state.audioBuffer.length;
        const numBlocks = Math.ceil(totalSamples / samplesPerBlock);

        const target = new global.THREE.WebGLRenderTarget(WIDTH, HEIGHT, { type: global.THREE.UnsignedByteType });
        const scene = new global.THREE.Scene();
        const camera = new global.THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        camera.position.set(0, 0, 1);
        camera.lookAt(scene.position);

        const material = buildSoundMaterial(soundBuffer, options, state.audioContext.sampleRate);
        if (!material) {
            return;
        }

        const mesh = new global.THREE.Mesh(new global.THREE.PlaneGeometry(2, 2), material);
        scene.add(mesh);

        const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
        const outputDataL = state.audioBuffer.getChannelData(0);
        const outputDataR = state.audioBuffer.getChannelData(1);

        const previousTarget = renderer.getRenderTarget();

        for (let i = 0; i < numBlocks; i++) {
            material.uniforms.blockOffset.value = (i * samplesPerBlock) / state.audioContext.sampleRate;
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
            renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);

            const baseIndex = i * samplesPerBlock;
            const remaining = totalSamples - baseIndex;
            const blockSamples = Math.min(samplesPerBlock, remaining);

            for (let j = 0; j < blockSamples; j++) {
                const pixelIndex = j * 4;
                outputDataL[baseIndex + j] = (pixels[pixelIndex + 0] + 256 * pixels[pixelIndex + 1]) / 65535 * 2 - 1;
                outputDataR[baseIndex + j] = (pixels[pixelIndex + 2] + 256 * pixels[pixelIndex + 3]) / 65535 * 2 - 1;
            }
        }

        renderer.setRenderTarget(previousTarget);
        target.dispose();
        material.dispose();
        mesh.geometry.dispose();
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
        state.gainNode = audioContext.createGain();
        state.gainNode.gain.value = 0.5;
        state.gainNode.connect(audioContext.destination);

        const durationSeconds = Number.isFinite(options.durationSeconds) ? options.durationSeconds : 180;
        const totalSamples = Math.max(1, Math.floor(audioContext.sampleRate * durationSeconds));
        state.audioBuffer = audioContext.createBuffer(2, totalSamples, audioContext.sampleRate);

        for (const buffer of options.buffers) {
            if (buffer && buffer.Shader && buffer.Shader.uniforms && buffer.Shader.uniforms.iSampleRate) {
                buffer.Shader.uniforms.iSampleRate.value = audioContext.sampleRate;
            }
        }

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
            state.sourceNode = source;

            state.audioContext.resume().then(() => {
                source.start(0, startAt);
                state.started = true;
            }).catch(() => {
                postErrorMessage('Audio output is blocked until you click inside the preview.');
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
