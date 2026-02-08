'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioResumeExtension implements WebviewExtension {
    public generateContent(): string {
        return 'if (typeof audioContext.resume === "function") { audioContext.resume(); }';
    }
}
