'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioPauseExtension implements WebviewExtension {
    public generateContent(): string {
        return 'if (typeof audioContext.suspend === "function") { audioContext.suspend(); }';
    }
}
