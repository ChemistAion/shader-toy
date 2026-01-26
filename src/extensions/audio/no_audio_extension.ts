'use strict';

import { WebviewExtension } from '../webview_extension';

export class NoAudioExtension implements WebviewExtension {
    public generateContent(): string {
        return `\
var audioContext = (window.ShaderToy && window.ShaderToy.audioContext)
    ? window.ShaderToy.audioContext
    : {
        sampleRate: 0
    };
if (window.ShaderToy) {
    window.ShaderToy.audioContext = audioContext;
}`;
    }
}
