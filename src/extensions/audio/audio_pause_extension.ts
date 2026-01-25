'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioPauseExtension implements WebviewExtension {
    public generateContent(): string {
        return `
audioContext.suspend();
if (window.ShaderToy && window.ShaderToy.audioOutput && window.ShaderToy.audioOutput.pause) {
    window.ShaderToy.audioOutput.pause();
}`;
    }
}
