'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioUpdateExtension implements WebviewExtension {
    public generateContent(): string {
        return `\
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
}`;
    }
}
