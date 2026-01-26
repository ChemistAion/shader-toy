'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioWorkletSourceExtension implements WebviewExtension {
    private source: string;

    constructor(source: string) {
        this.source = source;
    }

    public generateContent(): string {
        return `\
<script id="audio-worklet-source" type="text/plain">\n${this.source}\n</script>`;
    }
}
