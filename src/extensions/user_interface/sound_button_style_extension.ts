'use strict';

import { WebviewExtension } from '../webview_extension';

export class SoundButtonStyleExtension implements WebviewExtension {
    private soundOnResourcePath: string;
    private soundOffResourcePath: string;

    constructor(getWebviewResourcePath: (relativePath: string) => string) {
        this.soundOnResourcePath = getWebviewResourcePath('sound_on.png');
        this.soundOffResourcePath = getWebviewResourcePath('sound_off.png');
    }

    public generateContent(): string {
        return `\
#sound-button {
    top: 120px;
    background-size: 32px;
    background-repeat: no-repeat;
    background-position: center;
    background-color: rgba(128, 128, 128, 0.5);
}
#sound-button.sound-on {
    background-image: url('${this.soundOnResourcePath}');
}
#sound-button.sound-off {
    background-image: url('${this.soundOffResourcePath}');
}
#sound-button:hover {
    background-color: lightgray;
    transition-duration: 0.1s;
}`;
    }
}
