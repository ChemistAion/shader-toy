'use strict';

import { WebviewExtension } from '../webview_extension';

export class AnimationTimelineJsExtension implements WebviewExtension {
    private getWebviewResourcePath: (relativePath: string) => string;
    private generateStandalone: boolean;

    constructor(getWebviewResourcePath: (relativePath: string) => string, generateStandalone: boolean) {
        this.getWebviewResourcePath = getWebviewResourcePath;
        this.generateStandalone = generateStandalone;
    }

    public generateContent(): string {
        if (this.generateStandalone) {
            return 'https://unpkg.com/animation-timeline-js@2.3.5/lib/animation-timeline.min.js';
        }

        return this.getWebviewResourcePath('animation-timeline.min.js');
    }
}
