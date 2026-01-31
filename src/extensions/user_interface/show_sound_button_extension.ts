'use strict';

import { WebviewExtension } from '../webview_extension';

export class ShowSoundButtonExtension implements WebviewExtension {
    private value: boolean;

    constructor(value: boolean) {
        this.value = value;
    }

    public generateContent(): string {
        return this.value ? 'true' : 'false';
    }
}
