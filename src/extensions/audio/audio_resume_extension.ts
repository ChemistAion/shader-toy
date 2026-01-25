'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioResumeExtension implements WebviewExtension {
    public generateContent(): string {
        return `
audioContext.resume();
if (window.ShaderToy && window.ShaderToy.audioOutput && window.ShaderToy.audioOutput.resume) {
    window.ShaderToy.audioOutput.resume();
}`;
    }
}
