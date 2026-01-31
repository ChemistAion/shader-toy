'use strict';

import { WebviewExtension } from '../webview_extension';

export class NoAudioExtension implements WebviewExtension {
    public generateContent(): string {
        return `\
var audioContext = {
    sampleRate: 0
};`;
    }
}
