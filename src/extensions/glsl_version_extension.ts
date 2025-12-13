'use strict';

import { WebviewExtension } from './webview_extension';

export type GlslVersionSetting = 'auto' | '100' | '300';

export class GlslVersionExtension implements WebviewExtension {
    private glslVersion: GlslVersionSetting;

    constructor(glslVersion: GlslVersionSetting) {
        this.glslVersion = glslVersion;
    }

    public generateContent(): string {
        return `${this.glslVersion}`;
    }
}
