(function (global) {
    'use strict';

    const root = global.ShaderToy = global.ShaderToy || {};
    root.audioOutput = root.audioOutput || {};
    const audioOutput = root.audioOutput;

    const DEFAULT_BLOCK_SAMPLES = 1024;
    const DEFAULT_CHANNELS = 2;

    const createStubContext = () => ({
        sampleRate: 0,
        resume: function () {},
        suspend: function () {}
    });

    const workletSource = String.raw`
class ShaderToyAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = [];
        this.current = null;
        this.currentOffset = 0;
        this.channels = 2;
        this.lowWater = 2;
        this.needsPending = false;
        this.underruns = 0;

        this.port.onmessage = (event) => {
            const message = event.data || {};
            switch (message.command) {
                case 'init':
                    if (typeof message.channels === 'number') {
                        this.channels = message.channels;
                    }
                    if (typeof message.lowWater === 'number') {
                        this.lowWater = message.lowWater;
                    }
                    if (!this.needsPending) {
                        this.needsPending = true;
                        this.port.postMessage({ command: 'need', count: this.lowWater });
                    }
                    break;
                case 'push': {
                    const buffer = message.data instanceof ArrayBuffer
                        ? message.data
                        : (message.data && message.data.buffer ? message.data.buffer : undefined);
                    if (!buffer) {
                        break;
                    }
                    const data = new Float32Array(buffer);
                    const channels = typeof message.channels === 'number' ? message.channels : this.channels;
                    const frames = typeof message.frames === 'number'
                        ? message.frames
                        : Math.floor(data.length / channels);
                    this.queue.push({
                        id: message.id,
                        buffer,
                        data,
                        channels,
                        frames,
                        offset: 0
                    });
                    if (this.queue.length >= this.lowWater) {
                        this.needsPending = false;
                    }
                    break;
                }
            }
        };

        this.port.postMessage({ command: 'need', count: this.lowWater });
    }

    process(inputs, outputs) {
        const output = outputs[0];
        if (!output || output.length === 0) {
            return true;
        }

        const channels = output.length;
        const frames = output[0].length;

        let frameIndex = 0;
        while (frameIndex < frames) {
            if (!this.current) {
                this.current = this.queue.shift() || null;
                this.currentOffset = 0;
                if (!this.current) {
                    for (let ch = 0; ch < channels; ch++) {
                        output[ch].fill(0, frameIndex);
                    }
                    this.underruns++;
                    break;
                }
            }

            const block = this.current;
            const blockChannels = block.channels || channels;
            const blockFrames = block.frames || 0;
            const blockData = block.data;

            const remainingFrames = blockFrames - this.currentOffset;
            const writableFrames = Math.min(frames - frameIndex, remainingFrames);

            for (let i = 0; i < writableFrames; i++) {
                const baseIndex = (this.currentOffset + i) * blockChannels;
                for (let ch = 0; ch < channels; ch++) {
                    output[ch][frameIndex + i] = blockData[baseIndex + ch] || 0;
                }
            }

            this.currentOffset += writableFrames;
            frameIndex += writableFrames;

            if (this.currentOffset >= blockFrames) {
                if (block.buffer) {
                    this.port.postMessage({ command: 'recycle', id: block.id, data: block.buffer }, [block.buffer]);
                } else {
                    this.port.postMessage({ command: 'recycle', id: block.id });
                }
                this.current = null;
                this.currentOffset = 0;
            }
        }

        if (this.queue.length < this.lowWater && !this.needsPending) {
            this.needsPending = true;
            this.port.postMessage({ command: 'need', count: this.lowWater - this.queue.length });
        }

        return true;
    }
}

registerProcessor('shadertoy-audio-processor', ShaderToyAudioProcessor);
`;

    const resolveWorkletUrl = () => {
        try {
            const current = global.document && global.document.currentScript && global.document.currentScript.src
                ? global.document.currentScript.src
                : undefined;
            if (current) {
                return new URL('audio_worklet_processor.js', current).toString();
            }
            if (global.document && global.document.baseURI) {
                return new URL('webview/audio_worklet_processor.js', global.document.baseURI).toString();
            }
        } catch {
            // ignore
        }
        return undefined;
    };

    const addWorkletModule = async (audioContext, state) => {
        try {
            const blob = new Blob([workletSource], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            await audioContext.audioWorklet.addModule(blobUrl);
            URL.revokeObjectURL(blobUrl);
            return;
        } catch (err) {
            state.lastWorkletError = err;
        }

        const url = resolveWorkletUrl();
        if (!url) {
            throw state.lastWorkletError || new Error('AudioWorklet URL unavailable');
        }

        try {
            const response = await fetch(url);
            if (response.ok) {
                const text = await response.text();
                const blob = new Blob([text], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                await audioContext.audioWorklet.addModule(blobUrl);
                URL.revokeObjectURL(blobUrl);
                return;
            }
        } catch (err) {
            state.lastWorkletError = err;
        }

        await audioContext.audioWorklet.addModule(url);
    };

    const createState = () => ({
        enabled: false,
        ready: false,
        error: undefined,
        context: createStubContext(),
        node: undefined,
        port: undefined,
        gainNode: undefined,
        blockSamples: DEFAULT_BLOCK_SAMPLES,
        channels: DEFAULT_CHANNELS,
        lowWater: 2,
        pendingNeeds: 0,
        pool: [],
        inflight: new Map(),
        nextId: 1,
        lastWorkletError: undefined,
        readyPromise: undefined,
        renderBlock: undefined
    });

    audioOutput.init = function (options) {
        if (audioOutput.state) {
            return audioOutput.state;
        }

        const state = createState();
        audioOutput.state = state;
        state.enabled = !!(options && options.enabled);
        state.blockSamples = (options && options.blockSamples) || DEFAULT_BLOCK_SAMPLES;
        state.channels = (options && options.channels) || DEFAULT_CHANNELS;
        state.lowWater = (options && options.lowWater) || 2;

        if (!state.enabled) {
            return state;
        }

        const AudioContextCtor = global.AudioContext || global.webkitAudioContext;
        if (!AudioContextCtor) {
            state.enabled = false;
            state.error = 'AudioContext unavailable';
            return state;
        }

        const audioContext = new AudioContextCtor();
        state.context = audioContext;
        state.gainNode = audioContext.createGain();
        state.gainNode.gain.value = (options && typeof options.gain === 'number') ? options.gain : 1.0;

        state.readyPromise = addWorkletModule(audioContext, state)
            .then(() => {
                if (!state.enabled) {
                    return;
                }
                state.node = new AudioWorkletNode(audioContext, 'shadertoy-audio-processor', {
                    numberOfInputs: 0,
                    numberOfOutputs: 1,
                    outputChannelCount: [state.channels]
                });
                state.port = state.node.port;
                state.port.onmessage = (event) => {
                    const message = event.data || {};
                    switch (message.command) {
                        case 'need':
                            state.pendingNeeds += typeof message.count === 'number' ? message.count : 1;
                            break;
                        case 'recycle': {
                            const buffer = message.data instanceof ArrayBuffer
                                ? message.data
                                : state.inflight.get(message.id);
                            if (buffer) {
                                state.pool.push(buffer);
                            }
                            state.inflight.delete(message.id);
                            break;
                        }
                    }
                };
                state.node.connect(state.gainNode);
                state.gainNode.connect(audioContext.destination);
                state.port.postMessage({ command: 'init', channels: state.channels, lowWater: state.lowWater });
                state.ready = true;
            })
            .catch((err) => {
                state.enabled = false;
                state.error = err && err.message ? err.message : 'AudioWorklet initialization failed';
            });

        return state;
    };

    audioOutput.update = function () {
        const state = audioOutput.state;
        if (!state || !state.enabled || !state.ready || !state.port) {
            return;
        }

        while (state.pendingNeeds > 0) {
            const buffer = state.pool.pop() || new ArrayBuffer(state.blockSamples * state.channels * 4);
            const view = new Float32Array(buffer);
            if (typeof state.renderBlock === 'function') {
                state.renderBlock(view, state.blockSamples, state.channels);
            } else {
                view.fill(0);
            }

            const id = state.nextId++;
            state.inflight.set(id, buffer);
            state.port.postMessage({
                command: 'push',
                id,
                channels: state.channels,
                frames: state.blockSamples,
                data: buffer
            }, [buffer]);

            state.pendingNeeds--;
        }
    };

    audioOutput.getContext = function () {
        return audioOutput.state ? audioOutput.state.context : createStubContext();
    };

    audioOutput.setGain = function (value) {
        const state = audioOutput.state;
        if (state && state.gainNode) {
            state.gainNode.gain.value = value;
        }
    };

    audioOutput.setEnabled = function (enabled) {
        const state = audioOutput.state;
        if (!state) {
            return;
        }
        state.enabled = !!enabled;
        if (!state.enabled && state.gainNode) {
            state.gainNode.gain.value = 0;
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
