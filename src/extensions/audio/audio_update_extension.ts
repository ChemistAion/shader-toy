'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioUpdateExtension implements WebviewExtension {
    public generateContent(): string {
        return `\
    const audios = (window.ShaderToy && window.ShaderToy.audios) ? window.ShaderToy.audios : [];
    for (let audio of audios) {
    const analyserLeft = audio.AnalyserLeft || audio.Analyser;
    const analyserRight = audio.AnalyserRight || audio.Analyser;
    if (!analyserLeft || !analyserRight) {
        continue;
    }

    // Get audio data
    analyserLeft.getByteFrequencyData(audio.FrequencyDataLeft);
    analyserRight.getByteFrequencyData(audio.FrequencyDataRight);
    analyserLeft.getByteTimeDomainData(audio.TimeDataLeft);
    analyserRight.getByteTimeDomainData(audio.TimeDataRight);

    const dataSize = audio.DataSize || audio.Data.length / 8;
    const freqSamples = audio.FrequencySamples || audio.FrequencyDataLeft.length;
    const ampSamples = audio.AmplitudeSamples || audio.TimeDataLeft.length;

    for (let x = 0; x < dataSize; x++) {
        const freqIndex = Math.floor(x * freqSamples / dataSize);
        const ampIndex = Math.floor(x * ampSamples / dataSize);

        const row0 = x * 4;
        const row1 = (dataSize + x) * 4;

        audio.Data[row0 + 0] = audio.FrequencyDataLeft[freqIndex];
        audio.Data[row0 + 1] = audio.FrequencyDataRight[freqIndex];
        audio.Data[row0 + 2] = 0;
        audio.Data[row0 + 3] = 255;

        audio.Data[row1 + 0] = audio.TimeDataLeft[ampIndex];
        audio.Data[row1 + 1] = audio.TimeDataRight[ampIndex];
        audio.Data[row1 + 2] = 0;
        audio.Data[row1 + 3] = 255;
    }

    audio.Texture.needsUpdate = true;
}

if (window.ShaderToy && window.ShaderToy.audioOutput && typeof window.ShaderToy.audioOutput.getSampleRingTexture === 'function') {
    const audioOutput = window.ShaderToy.audioOutput;
    const audioTime = audioOutput.getAudioTime ? audioOutput.getAudioTime() : null;
    const sampleBlockSize = audioOutput.getSampleBlockSize ? audioOutput.getSampleBlockSize() : null;
    const sampleRingDepth = audioOutput.getSampleRingDepth ? audioOutput.getSampleRingDepth() : null;

    if (buffers && buffers.length) {
        for (const buffer of buffers) {
            if (!buffer || buffer.IsSound || !buffer.Shader || !buffer.Shader.uniforms) {
                continue;
            }
            const uniforms = buffer.Shader.uniforms;
            if (uniforms.iAudioTime && audioTime !== null) {
                uniforms.iAudioTime.value = audioTime;
            }
            if (uniforms.iSampleBlockSize && sampleBlockSize !== null) {
                uniforms.iSampleBlockSize.value = sampleBlockSize;
            }
            if (uniforms.iSampleRingDepth && sampleRingDepth !== null) {
                uniforms.iSampleRingDepth.value = sampleRingDepth;
            }
            for (let i = 0; i < 10; i++) {
                const uniformName = 'iSampleRing' + i;
                if (uniforms[uniformName]) {
                    uniforms[uniformName].value = audioOutput.getSampleRingTexture(i);
                }
            }
            if (Array.isArray(buffer.SampleBindings)) {
                for (const binding of buffer.SampleBindings) {
                    if (!binding || !binding.Name) {
                        continue;
                    }
                    const uniform = uniforms[binding.Name];
                    if (uniform) {
                        uniform.value = audioOutput.getSampleRingTexture(binding.SoundIndex);
                    }
                }
            }
        }
    }
}
`;
    }
}
