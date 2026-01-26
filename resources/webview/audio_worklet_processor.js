class ShaderToyPassThroughProcessor extends AudioWorkletProcessor {
    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output) {
            return true;
        }
        const channels = Math.min(input.length, output.length);
        for (let ch = 0; ch < channels; ch++) {
            const inChannel = input[ch];
            const outChannel = output[ch];
            if (!inChannel || !outChannel) {
                continue;
            }
            outChannel.set(inChannel);
        }
        return true;
    }
}

registerProcessor('shadertoy-pass-through', ShaderToyPassThroughProcessor);
