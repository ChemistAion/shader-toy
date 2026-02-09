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
                case 'recycle':
                    // Not used on the worklet side.
                    break;
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
