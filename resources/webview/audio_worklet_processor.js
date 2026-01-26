class ShaderToyStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = [];
        this.current = null;
        this.offset = 0;
        this.requestCooldown = 0;
        this.targetBlocks = 4;
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
