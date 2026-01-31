'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioWorkletUrlExtension implements WebviewExtension {
    private url: string;

    constructor(url: string) {
        this.url = url;
    }

    public generateContent(): string {
        return this.url;
    }
}
