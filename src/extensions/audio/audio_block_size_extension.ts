'use strict';

import { WebviewExtension } from '../webview_extension';

export class AudioBlockSizeExtension implements WebviewExtension {
    private blockSize: number;

    constructor(blockSize: number) {
        this.blockSize = blockSize;
    }

    public generateContent(): string {
        return String(this.blockSize);
    }
}
