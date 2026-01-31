class ShaderToyStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = [];
        this.current = null;
        this.offset = 0;
        this.requestCooldown = 0;
        this.targetBlocks = 4;
        this.analysis = {
            enabled: false,
            window: 2048,
            ringL: new Float32Array(2048),
            ringR: new Float32Array(2048),
            ringIndex: 0,
            postInterval: Math.floor(sampleRate / 30),
            postCountdown: Math.floor(sampleRate / 30)
        };
        this.port.onmessage = (event) => {
            const message = event && event.data ? event.data : {};
            if (message.type === 'push') {
                const left = message.left ? new Float32Array(message.left) : null;
                const right = message.right ? new Float32Array(message.right) : null;
                if (left && right) {
                    this.queue.push({ left, right });
                }
            }
            if (message.type === 'reset') {
                this.queue.length = 0;
                this.current = null;
                this.offset = 0;
                this.analysis.ringIndex = 0;
            }
            if (message.type === 'analysis') {
                this.analysis.enabled = !!message.enabled;
                const windowSize = Number(message.windowSize);
                if (Number.isFinite(windowSize) && windowSize >= 256) {
                    const size = Math.floor(windowSize);
                    if (size !== this.analysis.window) {
                        this.analysis.window = size;
                        this.analysis.ringL = new Float32Array(size);
                        this.analysis.ringR = new Float32Array(size);
                        this.analysis.ringIndex = 0;
                    }
                }
            }
        };
    }

    process(inputs, outputs) {
        const output = outputs[0];
        if (!output || output.length === 0) {
            return true;
        }

        const frames = output[0].length;
        const channels = output.length;

        let frameIndex = 0;
        while (frameIndex < frames) {
            if (!this.current) {
                this.current = this.queue.shift() || null;
                this.offset = 0;
            }

            if (!this.current) {
                for (let ch = 0; ch < channels; ch++) {
                    output[ch].fill(0, frameIndex);
                }
                break;
            }

            const remaining = this.current.left.length - this.offset;
            const count = Math.min(remaining, frames - frameIndex);

            if (channels >= 1) {
                output[0].set(this.current.left.subarray(this.offset, this.offset + count), frameIndex);
            }
            if (channels >= 2) {
                output[1].set(this.current.right.subarray(this.offset, this.offset + count), frameIndex);
            }

            if (this.analysis.enabled) {
                const ringL = this.analysis.ringL;
                const ringR = this.analysis.ringR;
                const ringSize = ringL.length;
                for (let i = 0; i < count; i++) {
                    const idx = (this.analysis.ringIndex + i) % ringSize;
                    ringL[idx] = output[0][frameIndex + i] || 0;
                    ringR[idx] = output[1] ? (output[1][frameIndex + i] || 0) : 0;
                }
                this.analysis.ringIndex = (this.analysis.ringIndex + count) % ringSize;
                this.analysis.postCountdown -= count;
                if (this.analysis.postCountdown <= 0) {
                    this.analysis.postCountdown += this.analysis.postInterval;

                    let rmsL = 0;
                    let rmsR = 0;

                    const ringLen = ringL.length;
                    for (let i = 0; i < ringLen; i++) {
                        const l = ringL[i];
                        const r = ringR[i];
                        rmsL += l * l;
                        rmsR += r * r;
                    }

                    rmsL = Math.sqrt(rmsL / ringLen);
                    rmsR = Math.sqrt(rmsR / ringLen);

                    this.port.postMessage({
                        type: 'analysis',
                        rmsL,
                        rmsR,
                        windowSize: ringLen
                    });
                }
            }

            frameIndex += count;
            this.offset += count;
            if (this.offset >= this.current.left.length) {
                this.current = null;
                this.offset = 0;
            }
        }

        if (this.requestCooldown > 0) {
            this.requestCooldown -= 1;
        }
        if (this.requestCooldown <= 0 && this.queue.length < this.targetBlocks) {
            this.port.postMessage({ type: 'need', count: this.targetBlocks - this.queue.length });
            this.requestCooldown = 16;
        }

        return true;
    }
}

registerProcessor('shadertoy-stream', ShaderToyStreamProcessor);
