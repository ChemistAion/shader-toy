'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioOutputPrecisionExtension implements WebviewExtension {
    private precision: string;

    constructor(precision: string) {
        this.precision = precision;
    }

    public generateContent(): string {
        return this.precision;
    }
}
